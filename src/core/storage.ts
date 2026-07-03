// SSH Kit — Data storage layer based on VS Code globalState
import * as vscode from "vscode";
import {
  SSHKitData,
  SSHHost,
  SSHGroup,
  createDefaultData,
  generateId,
} from "./types";
import {
  areIdentityPathsEquivalent,
  KeyFileImportPlan,
  KeyFileEntry,
  getImportKeyTargetPath,
  listKeys,
  populateFingerprints,
  exportKeyFiles,
  importKeyFiles,
  sanitizeKeyFileName,
} from "../keys/keyManager";
import { findDuplicateEndpointGroups, findImportMatch } from "./hostMatching";

/** Key used in globalState storage */
const DATA_KEY = "sshKit.data";
const WINDOW_CONNECTION_KEY = "sshKit.windowConnection";
const PENDING_CONNECTIONS_KEY = "sshKit.pendingConnections";
const REMOTE_AUTHORITY_CONNECTIONS_KEY = "sshKit.remoteAuthorityConnections";

/**
 * Storage service — wraps read/write operations on VS Code globalState.
 * All data is persisted as JSON and retained when the extension is uninstalled.
 */
export class StorageService {
  constructor(private context: vscode.ExtensionContext) {}

  /** Read all data; return default empty data if none exists */
  getData(): SSHKitData {
    const raw = this.context.globalState.get<SSHKitData>(DATA_KEY);
    return raw ?? createDefaultData();
  }

  /** Persist all data */
  private async saveData(data: SSHKitData): Promise<void> {
    await this.context.globalState.update(DATA_KEY, data);
  }

  // ─── Group operations ───────────────────────────────────────────────

  /** Get all groups sorted by order */
  getGroups(): SSHGroup[] {
    return [...this.getData().groups].sort((a, b) => a.order - b.order);
  }

  /** Add a new group */
  async addGroup(name: string): Promise<SSHGroup> {
    const data = this.getData();
    const group: SSHGroup = {
      id: generateId(),
      name,
      order: data.groups.length,
    };
    data.groups.push(group);
    await this.saveData(data);
    return group;
  }

  /** Update a group name */
  async updateGroup(id: string, name: string): Promise<void> {
    const data = this.getData();
    const group = data.groups.find((g) => g.id === id);
    if (group) {
      group.name = name;
      await this.saveData(data);
    }
  }

  /** Delete a group (hosts in group are moved to ungrouped) */
  async deleteGroup(id: string): Promise<void> {
    const data = this.getData();
    data.groups = data.groups.filter((g) => g.id !== id);
    // Unlink hosts from the deleted group
    for (const host of data.hosts) {
      if (host.groupId === id) {
        host.groupId = undefined;
      }
    }
    await this.saveData(data);
  }

  // ─── Host operations ────────────────────────────────────────────────

  /** Get hosts in a group (groupId=undefined returns ungrouped hosts) */
  getHostsByGroup(groupId?: string): SSHHost[] {
    return this.getData().hosts.filter((h) => h.groupId === groupId);
  }

  /** Get all hosts */
  getAllHosts(): SSHHost[] {
    return [...this.getData().hosts];
  }

  /** Find a host by name (used for import deduplication) */
  getHostByName(name: string): SSHHost | undefined {
    return this.getData().hosts.find((h) => h.name === name);
  }

  /** Remove duplicate hosts by actual SSH endpoint, keeping the first occurrence. */
  async deduplicateHosts(): Promise<number> {
    const data = this.getData();
    const duplicates = findDuplicateEndpointGroups(data.hosts)
      .flatMap((group) => group.hosts.slice(1).map((host) => host.id));

    if (duplicates.length === 0) {return 0;}

    data.hosts = data.hosts.filter((h) => !duplicates.includes(h.id));
    // Also clean up duplicate IDs from recent connections
    data.recentConnections = data.recentConnections.filter(
      (rid) => !duplicates.includes(rid)
    );
    await this.saveData(data);
    return duplicates.length;
  }

  /** Add a host */
  async addHost(host: Omit<SSHHost, "id">): Promise<SSHHost> {
    const data = this.getData();
    const newHost: SSHHost = {
      ...host,
      id: generateId(),
      tags: host.tags ?? [],
    };
    data.hosts.push(newHost);
    await this.saveData(data);
    return newHost;
  }

  /** Update a host */
  async updateHost(id: string, updates: Partial<Omit<SSHHost, "id">>): Promise<void> {
    const data = this.getData();
    const host = data.hosts.find((h) => h.id === id);
    if (host) {
      Object.assign(host, updates);
      await this.saveData(data);
    }
  }

  /** Update the associated identity file for multiple hosts in one save. */
  async updateHostsIdentityFile(hostIds: string[], identityFile?: string): Promise<number> {
    const ids = new Set(hostIds);
    if (ids.size === 0) {return 0;}

    const data = this.getData();
    let updated = 0;
    for (const host of data.hosts) {
      if (!ids.has(host.id)) {continue;}
      if (identityFile) {
        host.identityFile = identityFile;
      } else {
        delete host.identityFile;
      }
      updated++;
    }

    if (updated > 0) {
      await this.saveData(data);
    }
    return updated;
  }

  /** Delete a host */
  async deleteHost(id: string): Promise<void> {
    const data = this.getData();
    data.hosts = data.hosts.filter((h) => h.id !== id);
    // Also clean up recent connection records
    data.recentConnections = data.recentConnections.filter((rid) => rid !== id);
    await this.saveData(data);
  }

  // ─── Auxiliary operations ───────────────────────────────────────────

  /** Get the group collapsed state snapshot */
  getGroupCollapsedState(): Record<string, boolean> {
    return { ...this.getData().groupCollapsedState };
  }

  async setGroupCollapsedState(groupId: string, collapsed: boolean): Promise<void> {
    const data = this.getData();
    data.groupCollapsedState[groupId] = collapsed;
    await this.saveData(data);
  }

  /** Record a recent connection */
  async addRecentConnection(hostId: string): Promise<void> {
    const data = this.getData();
    // Deduplicate, insert at front, keep the most recent 20
    data.recentConnections = [
      hostId,
      ...data.recentConnections.filter((rid) => rid !== hostId),
    ].slice(0, 20);
    await this.saveData(data);
  }

  /** Get recently connected hosts (reverse chronological, at most 10) */
  getRecentHosts(): SSHHost[] {
    const data = this.getData();
    const hostMap = new Map(data.hosts.map((h) => [h.id, h]));
    return data.recentConnections
      .slice(0, 10)
      .map((id) => hostMap.get(id))
      .filter((h): h is SSHHost => h !== undefined);
  }

  async setCurrentConnection(hostId: string, alias: string): Promise<void> {
    const data = this.getData();
    data.currentConnection = {
      hostId,
      alias,
      connectedAt: new Date().toISOString(),
    };
    await this.saveData(data);
  }

  getCurrentConnection(): SSHKitData["currentConnection"] {
    return this.getData().currentConnection;
  }

  async clearCurrentConnection(hostId?: string): Promise<void> {
    const data = this.getData();
    if (!data.currentConnection) {return;}
    if (hostId && data.currentConnection.hostId !== hostId) {return;}
    delete data.currentConnection;
    await this.saveData(data);
  }

  async setWindowConnection(hostId: string, alias: string): Promise<void> {
    await this.context.workspaceState.update(WINDOW_CONNECTION_KEY, {
      hostId,
      alias,
      connectedAt: new Date().toISOString(),
    });
  }

  getWindowConnection(): SSHKitData["currentConnection"] {
    return this.context.workspaceState.get<SSHKitData["currentConnection"]>(WINDOW_CONNECTION_KEY);
  }

  async clearWindowConnection(hostId?: string): Promise<void> {
    const current = this.getWindowConnection();
    if (!current) {return;}
    if (hostId && current.hostId !== hostId) {return;}
    await this.context.workspaceState.update(WINDOW_CONNECTION_KEY, undefined);
  }

  async setRemoteAuthorityConnection(hostId: string, alias: string): Promise<void> {
    const connections = this.getRemoteAuthorityConnections()
      .filter((item) => item.alias !== alias);
    connections.push({
      hostId,
      alias,
      connectedAt: new Date().toISOString(),
    });
    await this.context.globalState.update(REMOTE_AUTHORITY_CONNECTIONS_KEY, connections.slice(-50));
  }

  getRemoteAuthorityConnection(alias: string): SSHKitData["currentConnection"] {
    return this.getRemoteAuthorityConnections().find((item) => item.alias === alias);
  }

  async clearRemoteAuthorityConnection(hostId: string, alias?: string): Promise<void> {
    const connections = this.getRemoteAuthorityConnections()
      .filter((item) => item.hostId !== hostId || (alias !== undefined && item.alias !== alias));
    await this.context.globalState.update(REMOTE_AUTHORITY_CONNECTIONS_KEY, connections);
  }

  async addPendingWindowConnection(hostId: string, alias: string): Promise<void> {
    const pending = this.getPendingWindowConnections()
      .filter((item) => !(item.hostId === hostId && item.alias === alias));
    pending.push({
      hostId,
      alias,
      connectedAt: new Date().toISOString(),
    });
    await this.context.globalState.update(PENDING_CONNECTIONS_KEY, pending.slice(-10));
  }

  async claimPendingWindowConnection(alias?: string): Promise<SSHKitData["currentConnection"]> {
    const pending = this.getPendingWindowConnections();
    const claimedIndex = alias
      ? pending.findIndex((item) => item.alias === alias)
      : 0;
    if (claimedIndex < 0) {return undefined;}
    const claimed = pending[claimedIndex];
    if (!claimed) {return undefined;}
    await this.context.globalState.update(
      PENDING_CONNECTIONS_KEY,
      pending.filter((_, index) => index !== claimedIndex)
    );
    await this.setWindowConnection(claimed.hostId, claimed.alias);
    await this.setRemoteAuthorityConnection(claimed.hostId, claimed.alias);
    return claimed;
  }

  async clearPendingWindowConnection(hostId: string, alias?: string): Promise<void> {
    const pending = this.getPendingWindowConnections()
      .filter((item) => item.hostId !== hostId || (alias !== undefined && item.alias !== alias));
    await this.context.globalState.update(PENDING_CONNECTIONS_KEY, pending);
  }

  private getPendingWindowConnections(): NonNullable<SSHKitData["currentConnection"]>[] {
    return this.context.globalState.get<NonNullable<SSHKitData["currentConnection"]>[]>(
      PENDING_CONNECTIONS_KEY,
      []
    );
  }

  private getRemoteAuthorityConnections(): NonNullable<SSHKitData["currentConnection"]>[] {
    return this.context.globalState.get<NonNullable<SSHKitData["currentConnection"]>[]>(
      REMOTE_AUTHORITY_CONNECTIONS_KEY,
      []
    );
  }

  // ─── Backup / restore ───────────────────────────────────────────────

  /** Export all data as JSON (including base64-encoded associated key files) */
  exportAllData(): string {
    const keys = listKeys();
    populateFingerprints(keys);
    const data = this.getData();
    const keyFiles = exportKeyFiles(data.hosts.map((host) => host.identityFile).filter(Boolean) as string[]);

    const exportData = {
      ...data,
      keyMetadata: keys
        .filter((key) => keyFiles.some((entry) => entry.name === key.name))
        .map((k) => ({
          name: k.name,
          type: k.type,
          fingerprint: k.fingerprint,
        })),
      keyFiles,
      exportedAt: new Date().toISOString(),
    };

    return JSON.stringify(exportData, null, 2);
  }

  /** Preview an import (parse only, used for the confirmation dialog) */
  previewImport(json: string): {
    importedHosts: number;
    importedGroups: number;
    skippedHosts: number;
    keyCount: number;
    keyTargets: string[];
  } {
    let source: SSHKitData & { keyMetadata?: Array<{ name: string }>; keyFiles?: Array<unknown> };
    try {
      source = JSON.parse(json);
    } catch {
      throw new Error("备份文件格式无效，无法解析 JSON。");
    }
    if (!source.hosts || !source.groups) {
      throw new Error("无效的备份文件格式。");
    }

    const data = this.getData();
    const existingGroupNames = new Set(data.groups.map((g) => g.name));
    const existingHosts = [...data.hosts];
    const touchedHostIds = new Set<string>();
    let importedHosts = 0;
    let skippedHosts = 0;

    const importedGroups = source.groups.filter((g) => !existingGroupNames.has(g.name)).length;
    for (const host of source.hosts) {
      const match = findImportMatch(host, existingHosts, touchedHostIds);
      if (match) {
        skippedHosts++;
        if (typeof match !== "string") {
          touchedHostIds.add(match.host.id);
        }
        continue;
      }
      importedHosts++;
      const previewHost: SSHHost = {
        ...host,
        id: `preview-${importedHosts}`,
        tags: host.tags ?? [],
      };
      existingHosts.push(previewHost);
      touchedHostIds.add(previewHost.id);
    }
    const keyNames = extractKeyNames(source);
    const keyCount = keyNames.length;
    const keyTargets = keyNames
      .map((name) => sanitizeKeyFileName(name))
      .filter(Boolean)
      .map((name) => `~/.ssh/${name}`);

    return { importedHosts, importedGroups, skippedHosts, keyCount, keyTargets };
  }

  /** Execute import (write to storage + restore key files) */
  async commitImport(json: string, keyFilePlan: KeyFileImportPlan[] = []): Promise<{
    importedHosts: number;
    importedGroups: number;
    skippedHosts: number;
    keyFilesRestored: number;
    keyFilesReused: number;
    keyFilesSkipped: number;
    keyFilesFailed: number;
    keyFileFailures: Array<{ name: string; reason: string }>;
  }> {
    let source: SSHKitData & { keyFiles?: KeyFileEntry[] };
    try {
      source = JSON.parse(json);
    } catch {
      throw new Error("Invalid backup file format; unable to parse JSON.");
    }
    if (!source.hosts || !source.groups) {
      throw new Error("Invalid backup file format.");
    }

    const data = this.getData();
    let importedHosts = 0;
    let importedGroups = 0;
    let skippedHosts = 0;
    const groupIdMap = new Map<string, string>();
    let keyFilesRestored = 0;
    let keyFilesReused = 0;
    let keyFilesSkipped = 0;
    let keyFilesFailed = 0;
    let keyFileFailures: Array<{ name: string; reason: string }> = [];
    const identityRewriteTargets: Array<{ sourceName: string; targetPath?: string; clear?: boolean }> = [];

    if (source.keyFiles && source.keyFiles.length > 0) {
      const keyResult = importKeyFiles(source.keyFiles, keyFilePlan);
      keyFilesRestored = keyResult.written;
      keyFilesReused = keyResult.reused;
      keyFilesSkipped = keyResult.skipped;
      keyFilesFailed = keyResult.failed.length;
      keyFileFailures = keyResult.failed;
      identityRewriteTargets.push(...keyResult.restoredPaths);
      identityRewriteTargets.push(
        ...[...keyResult.skippedSourceNames, ...keyResult.failedSourceNames]
          .map((sourceName) => ({ sourceName, clear: true }))
      );
    }

    const existingGroupsByName = new Map(data.groups.map((g) => [g.name, g]));
    for (const g of source.groups) {
      const existing = existingGroupsByName.get(g.name);
      if (existing) {
        groupIdMap.set(g.id, existing.id);
        continue;
      }

      const group: SSHGroup = {
        ...g,
        id: generateId(),
        order: data.groups.length,
      };
      data.groups.push(group);
      existingGroupsByName.set(group.name, group);
      groupIdMap.set(g.id, group.id);
      importedGroups++;
    }

    const touchedHostIds = new Set<string>();
    for (const h of source.hosts) {
      const match = findImportMatch(h, data.hosts, touchedHostIds);
      if (match) {
        skippedHosts++;
        if (typeof match !== "string") {
          touchedHostIds.add(match.host.id);
        }
        continue;
      }

      const host: SSHHost = {
        ...h,
        id: generateId(),
        groupId: h.groupId ? groupIdMap.get(h.groupId) : undefined,
        identityFile: rewriteImportedIdentityFile(h.identityFile, identityRewriteTargets),
        tags: h.tags ?? [],
      };
      data.hosts.push(host);
      touchedHostIds.add(host.id);
      importedHosts++;
    }

    await this.saveData(data);

    return {
      importedHosts,
      importedGroups,
      skippedHosts,
      keyFilesRestored,
      keyFilesReused,
      keyFilesSkipped,
      keyFilesFailed,
      keyFileFailures,
    };
  }
}

function rewriteImportedIdentityFile(
  identityFile: string | undefined,
  targets: Array<{ sourceName: string; targetPath?: string; clear?: boolean }>
): string | undefined {
  if (!identityFile) {return undefined;}

  const matched = targets.find((target) =>
    isIdentityFileForImportedKey(identityFile, target.sourceName)
  );
  if (matched?.clear) {return undefined;}
  return matched?.targetPath ?? identityFile;
}

function isIdentityFileForImportedKey(identityFile: string, keyName: string): boolean {
  if (identityFile === keyName || identityFile === `~/.ssh/${keyName}` || identityFile === `~\\.ssh\\${keyName}`) {
    return true;
  }
  if (getPortablePathBasename(identityFile) === keyName) {
    return true;
  }

  const originalTarget = getImportKeyTargetPath(keyName);
  return originalTarget ? areIdentityPathsEquivalent(identityFile, originalTarget) : false;
}

function getPortablePathBasename(filePath: string): string {
  const cleaned = stripWrappingQuotes(filePath.trim()).replace(/\\/g, "/");
  return cleaned.split("/").filter(Boolean).pop() ?? cleaned;
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function extractKeyNames(source: {
  keyMetadata?: Array<{ name: string }>;
  keyFiles?: Array<unknown>;
}): string[] {
  if (source.keyFiles && source.keyFiles.length > 0) {
    return source.keyFiles
      .map((entry) => typeof entry === "object" && entry !== null && "name" in entry
        ? String((entry as { name?: unknown }).name ?? "")
        : "")
      .filter(Boolean);
  }
  return source.keyMetadata?.map((entry) => entry.name).filter(Boolean) ?? [];
}
