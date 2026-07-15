// SSH Kit — SSH Config import/export commands
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { SSHHost } from "../core/types";
import { createImportedHostUpdates, findImportMatch } from "../core/hostMatching";
import { StorageService } from "../core/storage";
import { getErrorMessage } from "../core/utils";
import { importFromSSHConfig, exportToSSHConfig, analyzeExport } from "../ssh/sshConfig";
import { HostTreeDataProvider } from "../views/treeView";
import {
  KeyFileEntry,
  KeyFileImportPlan,
  findExistingKeyFilePath,
  getImportKeyTargetPath,
  sanitizeKeyFileName,
} from "../keys/keyManager";

/** Import hosts from SSH config */
export async function importConfig(
  storage: StorageService,
  tree: HostTreeDataProvider
): Promise<void> {
  try {
    const { hosts } = importFromSSHConfig();
    if (hosts.length === 0) {
      vscode.window.showInformationMessage(vscode.l10n.t("No importable hosts were found in SSH Config."));
      return;
    }

    const preview = previewSSHConfigImport(hosts, storage.getAllHosts());
    const confirmed = await confirmSSHConfigImport(preview);
    if (!confirmed) {return;}

    let imported = 0;
    let updated = 0;
    let endpointMatched = 0;
    let skipped = 0;
    let ambiguous = 0;
    const touchedHostIds = new Set<string>();
    const knownHosts = storage.getAllHosts();

    for (const host of hosts) {
      const match = findImportMatch(host, knownHosts, touchedHostIds);
      if (match === "already-touched") {
        skipped++;
        continue;
      }
      if (match === "ambiguous") {
        ambiguous++;
        continue;
      }
      if (match) {
        const updates = createImportedHostUpdates(match.host, host, match.reason);
        await storage.updateHost(match.host.id, updates);
        Object.assign(match.host, updates);
        touchedHostIds.add(match.host.id);
        updated++;
        if (match.reason === "endpoint") {endpointMatched++;}
        continue;
      }

      const added = await storage.addHost(host);
      knownHosts.push(added);
      touchedHostIds.add(added.id);
      imported++;
    }

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
  };

  for (const host of hosts) {
    const match = findImportMatch(host, knownHosts, touchedHostIds);
    if (match === "already-touched") {
      preview.skipped++;
      continue;
    }
    if (match === "ambiguous") {
      preview.ambiguous++;
      pushSample(preview.ambiguousSamples, `${host.name} (${host.username}@${host.hostname}:${host.port})`);
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
    pushSample(preview.importedSamples, `${host.name} (${host.username}@${host.hostname}:${host.port})`);
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

/** Export all hosts to SSH config with change preview and confirmation */
export async function exportConfig(storage: StorageService): Promise<void> {
  try {
    const hosts = storage.getAllHosts();
    if (hosts.length === 0) {
      vscode.window.showInformationMessage(vscode.l10n.t("There are no hosts to write."));
      return;
    }

    const stats = analyzeExport(hosts);
    if (!stats) {
      vscode.window.showErrorMessage(vscode.l10n.t("Could not analyze the pending SSH Config changes."));
      return;
    }

    let overwriteUnmanaged = false;
    if (stats.conflicts.length > 0) {
      const preview = stats.conflicts.slice(0, 8).join(", ");
      const more = stats.conflicts.length > 8 ? vscode.l10n.t(" and {count} total", { count: stats.conflicts.length }) : "";
      const takeoverAction = vscode.l10n.t("Take Over and Overwrite");
      const takeover = await vscode.window.showWarningMessage(
        [
          vscode.l10n.t("Found {count} existing Host blocks with the same alias or connection endpoint that are not managed by SSH Kit:", { count: stats.conflicts.length }),
          `${preview}${more}`,
          "",
          vscode.l10n.t("SSH Kit identifies the same connection target by Host alias or HostName/Port."),
          vscode.l10n.t("After takeover, these Host blocks will be regenerated from the current SSH Kit host list."),
        ].join("\n"),
        { modal: true },
        takeoverAction
      );
      if (takeover !== takeoverAction) {return;}
      overwriteUnmanaged = true;
    }

    const lines = [
      vscode.l10n.t("Write {count} hosts to ~/.ssh/config:", { count: hosts.length }),
      stats.added > 0 ? vscode.l10n.t("  Add {count}", { count: stats.added }) : "",
      stats.synced > 0 ? vscode.l10n.t("  Sync {count} existing hosts", { count: stats.synced }) : "",
      stats.conflicts.length > 0 ? vscode.l10n.t("  Take over {count} Host blocks with matching aliases or endpoints", { count: stats.conflicts.length }) : "",
      stats.removedAliases > 0 ? vscode.l10n.t("  Remove {count} temporary SSH Kit connection aliases", { count: stats.removedAliases }) : "",
      stats.preserved > 0 ? vscode.l10n.t("  Preserve {count} unrelated existing hosts", { count: stats.preserved }) : "",
      "",
      vscode.l10n.t("If SSH Config already exists, you must choose a backup location before writing. Cancelling the backup cancels the write."),
    ].filter(Boolean);

    const writeAction = vscode.l10n.t("Write");
    const confirmed = await vscode.window.showInformationMessage(
      lines.join("\n"),
      { modal: true },
      writeAction
    );
    if (confirmed !== writeAction) {return;}

    const backupPath = await backupSSHConfigBeforeWrite();
    if (backupPath === null) {return;}

    const filePath = exportToSSHConfig(hosts, undefined, { overwriteUnmanaged });
    vscode.window.showInformationMessage(backupPath
      ? vscode.l10n.t("Wrote {count} hosts to {path}. Backup: {backup}", { count: hosts.length, path: filePath, backup: backupPath })
      : vscode.l10n.t("Wrote {count} hosts to {path}", { count: hosts.length, path: filePath }));
  } catch (err: unknown) {
    vscode.window.showErrorMessage(vscode.l10n.t("Write failed: {error}", { error: getErrorMessage(err) }));
  }
}

async function backupSSHConfigBeforeWrite(): Promise<string | null | undefined> {
  const configPath = path.join(os.homedir(), ".ssh", "config");
  if (!fs.existsSync(configPath)) {
    return undefined;
  }

  const chooseBackupAction = vscode.l10n.t("Choose Backup Location");
  const confirmed = await vscode.window.showWarningMessage(
    [
      vscode.l10n.t("The current SSH Config must be backed up before writing."),
      vscode.l10n.t("Choose a backup location you can find later. Cancelling the backup cancels the write."),
    ].join("\n"),
    { modal: true },
    chooseBackupAction
  );
  if (confirmed !== chooseBackupAction) {return null;}

  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(os.homedir(), `ssh-config-backup-${formatBackupTimestamp()}`)),
    saveLabel: vscode.l10n.t("Back Up and Continue"),
    title: vscode.l10n.t("Save SSH Config Backup"),
  });
  if (!uri) {return null;}

  const normalizedSource = normalizePathForCompare(configPath);
  const normalizedTarget = normalizePathForCompare(uri.fsPath);
  if (normalizedSource === normalizedTarget) {
    vscode.window.showErrorMessage(vscode.l10n.t("The backup location cannot be the SSH Config file itself."));
    return null;
  }

  fs.copyFileSync(configPath, uri.fsPath);
  protectSensitiveFile(uri.fsPath);
  return uri.fsPath;
}

function formatBackupTimestamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
}

function normalizePathForCompare(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** Open the SSH config file (~/.ssh/config) */
export async function openSshConfig(): Promise<void> {
  const configPath = path.join(os.homedir(), ".ssh", "config");
  if (!fs.existsSync(configPath)) {
    vscode.window.showInformationMessage(
      vscode.l10n.t("SSH Config file does not exist: {path}", { path: configPath })
    );
    return;
  }
  const doc = await vscode.workspace.openTextDocument(configPath);
  await vscode.window.showTextDocument(doc);
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
    const json = fs.readFileSync(uris[0].fsPath, "utf-8");
    const preview = storage.previewImport(json);
    const keyPlan = await resolveRestoreKeyPlan(json);
    if (!keyPlan) {return;}

    const lines = [
      vscode.l10n.t("Import {hostCount} hosts and {groupCount} groups", {
        hostCount: preview.importedHosts,
        groupCount: preview.importedGroups,
      }),
      preview.skippedHosts > 0 ? vscode.l10n.t("Skip {count} existing hosts", { count: preview.skippedHosts }) : "",
      formatRestoreKeyOverview(preview.keyCount, keyPlan),
      formatRestoreKeyPlanSummary(keyPlan),
      formatRestoreKeyTargets(vscode.l10n.t("Key files to write:"), keyPlan.writeTargets),
      formatRestoreKeyTargets(vscode.l10n.t("Matching local keys to reuse (no write or overwrite):"), keyPlan.reuseTargets),
      keyPlan.entries.length === 0 && keyPlan.writeTargets.length === 0 && keyPlan.reuseTargets.length === 0
        ? formatRestoreKeyTargets(vscode.l10n.t("Key names recorded in the backup:"), preview.keyTargets)
        : "",
      vscode.l10n.t("Existing items will be skipped and not overwritten."),
      "",
      vscode.l10n.t("⚠ Only restore backups from a trusted source; the file may contain private keys."),
    ].filter(Boolean);

    const importAction = vscode.l10n.t("Import");
    const confirmed = await vscode.window.showInformationMessage(
      lines.join("\n"),
      { modal: true },
      importAction
    );
    if (confirmed !== importAction) {return;}

    const result = await storage.commitImport(json, keyPlan.entries);
    tree.refresh();
    keyTree?.refresh();

    const parts = [vscode.l10n.t("Imported {hostCount} hosts and {groupCount} groups", {
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

    if (!fs.existsSync(originalTarget)) {
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
      if (fs.existsSync(targetPath)) {return vscode.l10n.t("Target file already exists: ~/.ssh/{name}", { name: safeName });}
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
    if (targetPath && !fs.existsSync(targetPath)) {
      return candidate;
    }
  }
  return `${baseName}-${Date.now()}`;
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
