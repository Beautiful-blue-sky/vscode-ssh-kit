// SSH Kit — SSH Config import/export commands
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { formatHostEndpoint } from "../core/endpoint";
import { SSHHost } from "../core/types";
import { createImportedHostUpdates, findImportMatch } from "../core/hostMatching";
import { StorageService } from "../core/storage";
import { getErrorMessage } from "../core/utils";
import { importFromSSHConfig, exportToSSHConfig } from "../ssh/sshConfig";
import {
  getEffectiveSSHConfigPath,
  getManagedConfigPath,
  inspectManagedIntegration,
  repairManagedIntegration,
  setupManagedIntegration,
  uninstallManagedIntegration,
} from "../ssh/managedConfig";
import { HostTreeDataProvider } from "../views/treeView";
import {
  KeyFileEntry,
  KeyFileImportPlan,
  findExistingKeyFilePath,
  getImportKeyTargetPath,
  sanitizeKeyFileName,
} from "../keys/keyManager";

const MAX_BACKUP_FILE_SIZE = 64 * 1024 * 1024;

/** Import hosts from SSH config */
export async function importConfig(
  storage: StorageService,
  tree: HostTreeDataProvider
): Promise<void> {
  try {
    const { hosts } = importFromSSHConfig(getEffectiveSSHConfigPath());
    if (hosts.length === 0) {
      vscode.window.showInformationMessage(vscode.l10n.t("No importable hosts were found in SSH Config."));
      return;
    }

    const preview = previewSSHConfigImport(hosts, storage.getAllHosts());
    const confirmed = await confirmSSHConfigImport(preview);
    if (!confirmed) {return;}

    const {
      imported,
      updated,
      endpointMatched,
      skipped,
      ambiguous,
    } = await storage.importSSHConfigHosts(hosts);

    tree.refresh();

    const parts: string[] = [];
    if (imported > 0) {parts.push(vscode.l10n.t("Imported {count} hosts", { count: imported }));}
    if (updated > 0) {
      parts.push(endpointMatched > 0
        ? vscode.l10n.t("Updated {count} existing hosts ({endpointCount} matched by endpoint)", {
            count: updated,
            endpointCount: endpointMatched,
          })
        : vscode.l10n.t("Updated {count} existing hosts", { count: updated }));
    }
    if (skipped > 0) {parts.push(vscode.l10n.t("Skipped {count} duplicates", { count: skipped }));}
    if (ambiguous > 0) {parts.push(vscode.l10n.t("Skipped {count} ambiguous endpoints that need manual review", { count: ambiguous }));}
    if (parts.length === 0) {parts.push(vscode.l10n.t("No hosts needed to be imported or updated"));}
    vscode.window.showInformationMessage(`${parts.join(", ")}.`);
  } catch (err: unknown) {
    vscode.window.showErrorMessage(vscode.l10n.t("Import failed: {error}", { error: getErrorMessage(err) }));
  }
}

interface SSHConfigImportPreview {
  imported: number;
  updated: number;
  nameMatched: number;
  endpointMatched: number;
  skipped: number;
  ambiguous: number;
  importedSamples: string[];
  updatedSamples: string[];
  ambiguousSamples: string[];
  riskyDirectiveCount: number;
  riskyDirectiveSamples: string[];
}

function previewSSHConfigImport(
  hosts: Omit<SSHHost, "id">[],
  existingHosts: SSHHost[]
): SSHConfigImportPreview {
  const knownHosts = existingHosts.map((host) => ({ ...host, tags: [...host.tags] }));
  const touchedHostIds = new Set<string>();
  const preview: SSHConfigImportPreview = {
    imported: 0,
    updated: 0,
    nameMatched: 0,
    endpointMatched: 0,
    skipped: 0,
    ambiguous: 0,
    importedSamples: [],
    updatedSamples: [],
    ambiguousSamples: [],
    riskyDirectiveCount: 0,
    riskyDirectiveSamples: [],
  };

  for (const host of hosts) {
    const riskyDirectives = getRiskyDirectiveNames(host);
    if (riskyDirectives.length > 0) {
      preview.riskyDirectiveCount += riskyDirectives.length;
      pushSample(
        preview.riskyDirectiveSamples,
        `${host.name}: ${riskyDirectives.join(", ")}`
      );
    }
    const match = findImportMatch(host, knownHosts, touchedHostIds);
    if (match === "already-touched") {
      preview.skipped++;
      continue;
    }
    if (match === "ambiguous") {
      preview.ambiguous++;
      pushSample(preview.ambiguousSamples, `${host.name} (${formatHostEndpoint(host)})`);
      continue;
    }
    if (match) {
      const updates = createImportedHostUpdates(match.host, host, match.reason);
      Object.assign(match.host, updates);
      touchedHostIds.add(match.host.id);
      preview.updated++;
      if (match.reason === "name") {
        preview.nameMatched++;
      } else {
        preview.endpointMatched++;
      }
      pushSample(preview.updatedSamples, vscode.l10n.t("{source} → {target} ({matchType} match)", {
        source: host.name,
        target: match.host.name,
        matchType: match.reason === "name" ? vscode.l10n.t("name") : vscode.l10n.t("endpoint"),
      }));
      continue;
    }

    preview.imported++;
    const previewHost: SSHHost = {
      ...host,
      id: `preview-${preview.imported}`,
      tags: host.tags ?? [],
    };
    knownHosts.push(previewHost);
    touchedHostIds.add(previewHost.id);
    pushSample(preview.importedSamples, `${host.name} (${formatHostEndpoint(host)})`);
  }

  return preview;
}

async function confirmSSHConfigImport(preview: SSHConfigImportPreview): Promise<boolean> {
  if (
    preview.imported === 0 &&
    preview.updated === 0 &&
    preview.skipped === 0 &&
    preview.ambiguous === 0
  ) {
    vscode.window.showInformationMessage(vscode.l10n.t("No hosts need to be imported or updated."));
    return false;
  }

  const lines = [
    vscode.l10n.t("SSH Config import preview:"),
    preview.imported > 0 ? vscode.l10n.t("  Add {count}", { count: preview.imported }) : "",
    preview.updated > 0
      ? vscode.l10n.t("  Update {count} (name matches: {nameCount}; endpoint matches: {endpointCount})", {
          count: preview.updated,
          nameCount: preview.nameMatched,
          endpointCount: preview.endpointMatched,
        })
      : "",
    preview.skipped > 0 ? vscode.l10n.t("  Skip {count} duplicates", { count: preview.skipped }) : "",
    preview.ambiguous > 0 ? vscode.l10n.t("  Skip {count} ambiguous endpoints requiring manual review", { count: preview.ambiguous }) : "",
    formatPreviewSamples(vscode.l10n.t("Add examples"), preview.importedSamples),
    formatPreviewSamples(vscode.l10n.t("Update examples"), preview.updatedSamples),
    formatPreviewSamples(vscode.l10n.t("Conflict examples"), preview.ambiguousSamples),
    preview.riskyDirectiveCount > 0
      ? vscode.l10n.t(
          "⚠ Found {count} command-capable SSH directives. They will be preserved and may execute local or remote commands when connecting.",
          { count: preview.riskyDirectiveCount }
        )
      : "",
    formatPreviewSamples(
      vscode.l10n.t("Review command-capable directives"),
      preview.riskyDirectiveSamples
    ),
  ].filter(Boolean);

  const importAction = vscode.l10n.t("Import");
  const confirmed = await vscode.window.showInformationMessage(
    lines.join("\n"),
    { modal: true },
    importAction
  );
  return confirmed === importAction;
}

function pushSample(samples: string[], value: string): void {
  if (samples.length < 5) {
    samples.push(value);
  }
}

function formatPreviewSamples(label: string, samples: string[]): string {
  return samples.length > 0 ? `  ${label}: ${samples.join("; ")}` : "";
}

function getRiskyDirectiveNames(host: Omit<SSHHost, "id">): string[] {
  const risky = new Set([
    "proxycommand",
    "localcommand",
    "remotecommand",
    "knownhostscommand",
  ]);
  return Object.keys(host.extraConfig ?? {})
    .filter((key) => risky.has(key.toLocaleLowerCase()))
    .sort((left, right) => left.localeCompare(right));
}

/** Export all hosts to a standalone SSH config selected by the user. */
export async function exportConfig(storage: StorageService): Promise<void> {
  try {
    const hosts = storage.getAllHosts();
    if (hosts.length === 0) {
      vscode.window.showInformationMessage(vscode.l10n.t("There are no hosts to export."));
      return;
    }

    const uri = await vscode.window.showSaveDialog({
      title: vscode.l10n.t("Export SSH Kit hosts"),
      defaultUri: vscode.Uri.file(path.join(os.homedir(), "ssh-kit-hosts.conf")),
      saveLabel: vscode.l10n.t("Export"),
      filters: {
        [vscode.l10n.t("SSH Config")]: ["conf", "config", "txt"],
        [vscode.l10n.t("All files")]: ["*"],
      },
    });
    if (!uri) {return;}

    const effectiveConfig = getEffectiveSSHConfigPath();
    const protectedConfigPaths = [effectiveConfig, getManagedConfigPath()]
      .map(normalizePathForCompare);
    if (protectedConfigPaths.includes(normalizePathForCompare(uri.fsPath))) {
      vscode.window.showErrorMessage(vscode.l10n.t(
        "Choose a separate export file. SSH Kit will not replace your active SSH Config."
      ));
      return;
    }

    const filePath = exportToSSHConfig(hosts, uri.fsPath);
    vscode.window.showInformationMessage(
      vscode.l10n.t("Exported {count} hosts to {path}", { count: hosts.length, path: filePath })
    );
  } catch (err: unknown) {
    vscode.window.showErrorMessage(vscode.l10n.t("Export failed: {error}", { error: getErrorMessage(err) }));
  }
}

function normalizePathForCompare(filePath: string): string {
  const resolved = path.resolve(filePath);
  let comparable = resolved;
  try {
    comparable = fs.realpathSync.native(resolved);
  } catch {
    // Non-existent export targets are compared by their resolved path.
  }
  return process.platform === "win32" ? comparable.toLowerCase() : comparable;
}

/** Open the effective SSH config selected by Remote-SSH. */
export async function openSshConfig(): Promise<void> {
  const configPath = getEffectiveSSHConfigPath();
  if (!fs.existsSync(configPath)) {
    vscode.window.showInformationMessage(
      vscode.l10n.t("SSH Config file does not exist: {path}", { path: configPath })
    );
    return;
  }
  const doc = await vscode.workspace.openTextDocument(configPath);
  await vscode.window.showTextDocument(doc);
}

/** Open SSH Kit's generated projection used by Remote-SSH. */
export async function openManagedSshConfig(): Promise<void> {
  const configPath = getManagedConfigPath();
  if (!fs.existsSync(configPath)) {
    vscode.window.showInformationMessage(
      vscode.l10n.t("SSH Kit managed config does not exist yet: {path}", { path: configPath })
    );
    return;
  }
  const doc = await vscode.workspace.openTextDocument(configPath);
  await vscode.window.showTextDocument(doc);
}

export async function setupRemoteSshIntegration(storage: StorageService): Promise<void> {
  try {
    await setupManagedIntegration(storage.getAllHosts());
  } catch (error) {
    showIntegrationError(error);
  }
}

export async function repairRemoteSshIntegration(storage: StorageService): Promise<void> {
  try {
    await repairManagedIntegration(storage.getAllHosts());
  } catch (error) {
    showIntegrationError(error);
  }
}

export async function removeRemoteSshIntegration(): Promise<void> {
  try {
    await uninstallManagedIntegration();
  } catch (error) {
    showIntegrationError(error);
  }
}

export async function showRemoteSshIntegrationStatus(): Promise<void> {
  try {
    const state = inspectManagedIntegration();
    vscode.window.showInformationMessage([
      state.installed && state.effective
        ? vscode.l10n.t("SSH Kit Remote-SSH integration is enabled.")
        : state.installed
          ? vscode.l10n.t("SSH Kit Remote-SSH integration needs repair because its Include appears after other directives.")
        : vscode.l10n.t("SSH Kit Remote-SSH integration is not enabled."),
      vscode.l10n.t("SSH Config: {path}", { path: state.configPath }),
      vscode.l10n.t("Managed hosts: {path}", { path: state.managedConfigPath }),
      state.legacyAliasCount > 0
        ? vscode.l10n.t("Legacy connection aliases remaining: {count}", { count: state.legacyAliasCount })
        : "",
    ].filter(Boolean).join("\n"));
  } catch (error) {
    showIntegrationError(error);
  }
}

function showIntegrationError(error: unknown): void {
  vscode.window.showErrorMessage(vscode.l10n.t(
    "Remote-SSH integration operation failed: {error}",
    { error: getErrorMessage(error) }
  ));
}

/** Backup SSH Kit data, optionally including associated key files. */
export async function backupKitData(storage: StorageService): Promise<void> {
  const mode = await vscode.window.showQuickPick(
    [
      {
        label: vscode.l10n.t("$(server) Host data only"),
        description: vscode.l10n.t("Does not include private key contents; suitable for routine migration and archiving"),
        includeKeyFiles: false,
      },
      {
        label: vscode.l10n.t("$(lock) Host data and associated keys"),
        description: vscode.l10n.t("Includes Base64-encoded private and public keys; treat the backup as sensitive"),
        includeKeyFiles: true,
      },
    ],
    {
      title: vscode.l10n.t("Choose SSH Kit backup contents"),
      placeHolder: vscode.l10n.t("Host-only backup is recommended; include keys only for a complete migration"),
    }
  );
  if (!mode) {return;}

  if (mode.includeKeyFiles) {
    const continueWithKeys = vscode.l10n.t("Continue with keys");
    const confirmed = await vscode.window.showWarningMessage(
      vscode.l10n.t("The backup will contain SSH private key contents associated with hosts. Save it in an encrypted or access-controlled location and delete it when no longer needed."),
      { modal: true },
      continueWithKeys
    );
    if (confirmed !== continueWithKeys) {return;}
  }

  const defaultUri = vscode.Uri.file(
    path.join(os.homedir(), `ssh-kit-backup-${new Date().toISOString().slice(0, 10)}.json`)
  );
  const uri = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { [vscode.l10n.t("JSON Files")]: ["json"] },
  });
  if (!uri) {return;}

  try {
    const json = storage.exportAllData({ includeKeyFiles: mode.includeKeyFiles });
    fs.writeFileSync(uri.fsPath, json, {
      encoding: "utf-8",
      mode: process.platform === "win32" ? undefined : 0o600,
    });
    protectSensitiveFile(uri.fsPath);
    vscode.window.showInformationMessage(
      mode.includeKeyFiles
        ? vscode.l10n.t("Complete backup saved to {path}", { path: uri.fsPath })
        : vscode.l10n.t("Host data backup saved to {path}", { path: uri.fsPath })
    );
  } catch (err: unknown) {
    vscode.window.showErrorMessage(vscode.l10n.t("Backup failed: {error}", { error: getErrorMessage(err) }));
  }
}

function protectSensitiveFile(filePath: string): void {
  if (process.platform !== "win32") {
    fs.chmodSync(filePath, 0o600);
  }
}

/** Restore SSH Kit data from a JSON backup file */
export async function restoreKitData(
  storage: StorageService,
  tree: HostTreeDataProvider,
  keyTree?: { refresh: () => void }
): Promise<void> {
  const uris = await vscode.window.showOpenDialog({
    filters: { [vscode.l10n.t("JSON Files")]: ["json"] },
    canSelectMany: false,
  });
  if (!uris || uris.length === 0) {return;}

  try {
    if (fs.statSync(uris[0].fsPath).size > MAX_BACKUP_FILE_SIZE) {
      throw new Error(vscode.l10n.t(
        "The selected backup is larger than 64 MB. Choose a smaller SSH Kit backup."
      ));
    }
    const json = fs.readFileSync(uris[0].fsPath, "utf-8");
    const mode = await vscode.window.showQuickPick(
      [
        {
          label: vscode.l10n.t("$(git-merge) Merge with current data"),
          description: vscode.l10n.t("Add missing groups and hosts; keep current items"),
          mode: "merge" as const,
        },
        {
          label: vscode.l10n.t("$(replace-all) Replace current data"),
          description: vscode.l10n.t("Replace current groups and hosts; create an internal snapshot first"),
          mode: "replace" as const,
        },
      ],
      {
        title: vscode.l10n.t("Choose how to restore the SSH Kit backup"),
        placeHolder: vscode.l10n.t("Merge combines data; replace reproduces the selected backup"),
      }
    );
    if (!mode) {return;}

    const mergePreview = mode.mode === "merge" ? storage.previewImport(json) : undefined;
    const replacePreview = mode.mode === "replace" ? storage.previewReplace(json) : undefined;
    const preview = mergePreview ?? replacePreview;
    if (!preview) {return;}
    const keyPlan = await resolveRestoreKeyPlan(json);
    if (!keyPlan) {return;}

    const lines = [
      mode.mode === "replace"
        ? vscode.l10n.t("Replace current data with {hostCount} hosts and {groupCount} groups", {
            hostCount: preview.importedHosts,
            groupCount: preview.importedGroups,
          })
        : vscode.l10n.t("Merge {hostCount} hosts and {groupCount} groups", {
            hostCount: preview.importedHosts,
            groupCount: preview.importedGroups,
          }),
      replacePreview
        ? vscode.l10n.t("Current data being replaced: {hostCount} hosts and {groupCount} groups", {
            hostCount: replacePreview.replacedHosts,
            groupCount: replacePreview.replacedGroups,
          })
        : "",
      mergePreview && mergePreview.skippedHosts > 0
        ? vscode.l10n.t("Skip {count} existing hosts", { count: mergePreview.skippedHosts })
        : "",
      formatRestoreKeyOverview(preview.keyCount, keyPlan),
      formatRestoreKeyPlanSummary(keyPlan),
      formatRestoreKeyTargets(vscode.l10n.t("Key files to write:"), keyPlan.writeTargets),
      formatRestoreKeyTargets(vscode.l10n.t("Matching local keys to reuse (no write or overwrite):"), keyPlan.reuseTargets),
      keyPlan.entries.length === 0 && keyPlan.writeTargets.length === 0 && keyPlan.reuseTargets.length === 0
        ? formatRestoreKeyTargets(vscode.l10n.t("Key names recorded in the backup:"), preview.keyTargets)
        : "",
      mode.mode === "replace"
        ? vscode.l10n.t("SSH Kit will save an internal catalog snapshot before replacing current data.")
        : vscode.l10n.t("Existing items will be skipped and not overwritten."),
      "",
      vscode.l10n.t("⚠ Only restore backups from a trusted source; the file may contain private keys."),
    ].filter(Boolean);

    const restoreAction = mode.mode === "replace"
      ? vscode.l10n.t("Replace and Restore")
      : vscode.l10n.t("Merge and Restore");
    const confirmed = await vscode.window.showInformationMessage(
      lines.join("\n"),
      { modal: true },
      restoreAction
    );
    if (confirmed !== restoreAction) {return;}

    const result = mode.mode === "replace"
      ? await storage.commitReplace(json, keyPlan.entries)
      : await storage.commitImport(json, keyPlan.entries);
    tree.refresh();
    keyTree?.refresh();

    const parts = [mode.mode === "replace"
      ? vscode.l10n.t("Restored {hostCount} hosts and {groupCount} groups by replacement", {
          hostCount: result.importedHosts,
          groupCount: result.importedGroups,
        })
      : vscode.l10n.t("Merged {hostCount} hosts and {groupCount} groups", {
          hostCount: result.importedHosts,
          groupCount: result.importedGroups,
        })];
    if (result.skippedHosts > 0) {
      parts.push(vscode.l10n.t("Skipped {count} existing hosts", { count: result.skippedHosts }));
    }
    if (result.keyFilesRestored > 0) {
      parts.push(vscode.l10n.t("Restored {count} key files to ~/.ssh/", { count: result.keyFilesRestored }));
    }
    if (result.keyFilesReused > 0) {
      parts.push(vscode.l10n.t("Reused {count} existing keys", { count: result.keyFilesReused }));
    }
    if (result.keyFilesSkipped > 0) {
      parts.push(vscode.l10n.t("Skipped {count} existing keys", { count: result.keyFilesSkipped }));
    }
    if (result.keyFilesFailed > 0) {
      parts.push(vscode.l10n.t("Failed to restore {count} keys", { count: result.keyFilesFailed }));
    }
    const viewFailuresAction = vscode.l10n.t("View Failure Details");
    const action = await vscode.window.showInformationMessage(
      parts.join(", "),
      ...(result.keyFileFailures.length > 0 ? [viewFailuresAction] : [])
    );
    if (action === viewFailuresAction) {
      vscode.window.showWarningMessage(
        result.keyFileFailures
          .slice(0, 20)
          .map((failure) => `${failure.name}: ${failure.reason}`)
          .join("\n"),
        { modal: true }
      );
    }
  } catch (err: unknown) {
    vscode.window.showErrorMessage(vscode.l10n.t("Restore failed: {error}", { error: getErrorMessage(err) }));
  }
}

/** Restore a catalog-only internal snapshot created before a destructive operation. */
export async function restoreCatalogSnapshot(
  storage: StorageService,
  tree: HostTreeDataProvider
): Promise<void> {
  const snapshots = storage.getCatalogSnapshots();
  if (snapshots.length === 0) {
    await vscode.window.showInformationMessage(
      vscode.l10n.t("No internal snapshots are available. SSH Kit creates them before deleting a group, moving hosts to or from the recycle bin, permanently deleting recycle-bin items, restoring data, or restoring another snapshot."),
      { modal: true }
    );
    return;
  }

  const picked = await vscode.window.showQuickPick(
    snapshots.map((snapshot) => ({
      label: `$(history) ${new Date(snapshot.createdAt).toLocaleString()}`,
      description: vscode.l10n.t("{hostCount} hosts · {groupCount} groups · revision {revision}", {
        hostCount: snapshot.hostCount,
        groupCount: snapshot.groupCount,
        revision: snapshot.revision,
      }),
      detail: snapshot.path,
      snapshot,
    })),
    {
      title: vscode.l10n.t("Restore an SSH Kit Internal Snapshot"),
      placeHolder: vscode.l10n.t("Snapshots contain host catalog data only, never private key contents"),
      matchOnDescription: true,
    }
  );
  if (!picked) {return;}

  const restoreAction = vscode.l10n.t("Restore Snapshot");
  const confirmed = await vscode.window.showWarningMessage(
    vscode.l10n.t(
      "Replace the current host catalog with this snapshot? SSH Kit will snapshot the current catalog first."
    ),
    { modal: true },
    restoreAction
  );
  if (confirmed !== restoreAction) {return;}

  try {
    const restored = await storage.restoreCatalogSnapshot(picked.snapshot.path);
    tree.refresh();
    vscode.window.showInformationMessage(vscode.l10n.t(
      "Restored internal snapshot: {hostCount} hosts and {groupCount} groups.",
      { hostCount: restored.hosts.length, groupCount: restored.groups.length }
    ));
  } catch (error) {
    vscode.window.showErrorMessage(vscode.l10n.t(
      "Failed to restore internal snapshot: {error}",
      { error: getErrorMessage(error) }
    ));
  }
}

interface RestoreKeyPlan {
  entries: KeyFileImportPlan[];
  writeTargets: string[];
  reuseTargets: string[];
  conflicts: number;
  renamed: number;
  customRenamed: number;
  reused: number;
  skipped: number;
}

async function resolveRestoreKeyPlan(json: string): Promise<RestoreKeyPlan | undefined> {
  const source = JSON.parse(json) as { keyFiles?: unknown[] };
  const keyFiles = (source.keyFiles ?? []).filter(isKeyFileEntry);
  const plan: RestoreKeyPlan = {
    entries: [],
    writeTargets: [],
    reuseTargets: [],
    conflicts: 0,
    renamed: 0,
    customRenamed: 0,
    reused: 0,
    skipped: 0,
  };

  for (const entry of keyFiles) {
    const originalTarget = getImportKeyTargetPath(entry.name);
    if (!originalTarget) {
      plan.entries.push({ sourceName: entry.name, skip: true });
      plan.skipped++;
      continue;
    }

    const existingSameKeyPath = findExistingKeyFilePath(entry, originalTarget);
    if (existingSameKeyPath) {
      plan.entries.push({ sourceName: entry.name, reusePath: existingSameKeyPath });
      plan.reuseTargets.push(formatKeyTargetPath(existingSameKeyPath));
      plan.reused++;
      continue;
    }

    if (!keyPairTargetExists(originalTarget)) {
      plan.entries.push({ sourceName: entry.name, targetName: entry.name });
      plan.writeTargets.push(formatHomeRelativeKeyTarget(entry.name));
      continue;
    }

    plan.conflicts++;
    const targetName = await resolveConflictingRestoreKeyName(entry.name);
    if (targetName === undefined) {
      return undefined;
    }
    if (targetName === null) {
      plan.entries.push({ sourceName: entry.name, skip: true });
      plan.skipped++;
      continue;
    }

    plan.entries.push({ sourceName: entry.name, targetName });
    plan.writeTargets.push(formatHomeRelativeKeyTarget(targetName));
    if (targetName === makeAvailableRestoreKeyName(entry.name)) {
      plan.renamed++;
    } else {
      plan.customRenamed++;
    }
  }

  return plan;
}

function isKeyFileEntry(entry: unknown): entry is KeyFileEntry {
  if (!entry || typeof entry !== "object") {return false;}
  const value = entry as Partial<KeyFileEntry>;
  return typeof value.name === "string" &&
    typeof value.type === "string" &&
    typeof value.privateKey === "string" &&
    (value.publicKey === undefined || typeof value.publicKey === "string");
}

async function resolveConflictingRestoreKeyName(sourceName: string): Promise<string | null | undefined> {
  const autoName = makeAvailableRestoreKeyName(sourceName);
  const autoRenameAction = vscode.l10n.t("Rename Automatically");
  const customNameAction = vscode.l10n.t("Choose a Custom Name");
  const skipAction = vscode.l10n.t("Skip Key");
  const cancelAction = vscode.l10n.t("Cancel Import");
  const choice = await vscode.window.showWarningMessage(
    [
      vscode.l10n.t("The backup key “{name}” is not the same SSH key as the local file with that name under ~/.ssh/.", { name: sourceName }),
      vscode.l10n.t("Rename the imported key to avoid overwriting the local key. Imported host identity paths will be updated automatically."),
      vscode.l10n.t("If you skip the key, imported hosts that reference it will have no identity file, preventing accidental use of the different local key."),
      vscode.l10n.t("Automatic target: ~/.ssh/{name}", { name: autoName }),
    ].join("\n"),
    { modal: true },
    autoRenameAction,
    customNameAction,
    skipAction,
    cancelAction
  );

  if (choice === autoRenameAction) {return autoName;}
  if (choice === skipAction) {return null;}
  if (choice === customNameAction) {
    return promptCustomRestoreKeyName(sourceName);
  }
  return undefined;
}

async function promptCustomRestoreKeyName(sourceName: string): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    prompt: vscode.l10n.t("Enter the new file name for imported key “{name}” (written under ~/.ssh/)", { name: sourceName }),
    placeHolder: makeAvailableRestoreKeyName(sourceName),
    validateInput: (input) => {
      const trimmed = input.trim();
      if (!trimmed) {return vscode.l10n.t("File name is required");}
      const safeName = sanitizeKeyFileName(trimmed);
      if (safeName !== trimmed) {return vscode.l10n.t("Enter only a file name, without a path, spaces, or special characters");}
      const targetPath = getImportKeyTargetPath(safeName);
      if (!targetPath) {return vscode.l10n.t("File name is invalid");}
      if (keyPairTargetExists(targetPath)) {return vscode.l10n.t("Target file already exists: ~/.ssh/{name}", { name: safeName });}
      return undefined;
    },
  });
  return value?.trim();
}

function makeAvailableRestoreKeyName(sourceName: string): string {
  const safeName = sanitizeKeyFileName(sourceName) || "id_imported";
  const baseName = `${safeName}.ssh-kit-imported`;
  for (let index = 1; index <= 999; index++) {
    const candidate = index === 1 ? baseName : `${baseName}-${index}`;
    const targetPath = getImportKeyTargetPath(candidate);
    if (targetPath && !keyPairTargetExists(targetPath)) {
      return candidate;
    }
  }
  return `${baseName}-${Date.now()}`;
}

function keyPairTargetExists(privatePath: string): boolean {
  return fs.existsSync(privatePath) || fs.existsSync(`${privatePath}.pub`);
}

function formatHomeRelativeKeyTarget(name: string): string {
  return `~/.ssh/${sanitizeKeyFileName(name)}`;
}

function formatKeyTargetPath(filePath: string): string {
  const sshDir = path.resolve(os.homedir(), ".ssh");
  const resolved = path.resolve(filePath);
  const normalizedSshDir = process.platform === "win32" ? sshDir.toLowerCase() : sshDir;
  const normalizedResolved = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  if (normalizedResolved.startsWith(normalizedSshDir + path.sep)) {
    return `~/.ssh/${path.relative(sshDir, resolved).replace(/\\/g, "/")}`;
  }
  return filePath;
}

function formatRestoreKeyPlanSummary(plan: RestoreKeyPlan): string {
  const parts = [
    plan.conflicts > 0 ? vscode.l10n.t("Detected {count} same-name keys with different contents", { count: plan.conflicts }) : "",
    plan.renamed > 0 ? vscode.l10n.t("Automatically renamed {count}", { count: plan.renamed }) : "",
    plan.customRenamed > 0 ? vscode.l10n.t("Custom-renamed {count}", { count: plan.customRenamed }) : "",
    plan.reused > 0 ? vscode.l10n.t("Reused {count} local keys", { count: plan.reused }) : "",
    plan.skipped > 0 ? vscode.l10n.t("Skipped {count} keys", { count: plan.skipped }) : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "";
}

function formatRestoreKeyOverview(keyCount: number, plan: RestoreKeyPlan): string {
  if (keyCount === 0) {return "";}
  const parts = [
    plan.writeTargets.length > 0 ? vscode.l10n.t("write {count}", { count: plan.writeTargets.length }) : "",
    plan.reuseTargets.length > 0 ? vscode.l10n.t("reuse {count} local keys", { count: plan.reuseTargets.length }) : "",
    plan.skipped > 0 ? vscode.l10n.t("skip {count}", { count: plan.skipped }) : "",
  ].filter(Boolean);
  return parts.length > 0
    ? vscode.l10n.t("Contains {count} backup keys ({summary})", { count: keyCount, summary: parts.join(", ") })
    : vscode.l10n.t("Contains {count} key records (no restorable private key contents)", { count: keyCount });
}

function formatRestoreKeyTargets(title: string, targets: string[]): string {
  if (targets.length === 0) {return "";}
  const visible = targets.slice(0, 8).map((target) => `  - ${target}`);
  const suffix = targets.length > visible.length
    ? vscode.l10n.t("  …and {count} more", { count: targets.length - visible.length })
    : "";
  return [title, ...visible, suffix].filter(Boolean).join("\n");
}
