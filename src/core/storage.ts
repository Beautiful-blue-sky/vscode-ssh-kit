// SSH Kit — File-backed catalog with VS Code Memento for preferences and window state
import * as vscode from "vscode";
import {
  SSHKitData,
  SSHHost,
  SSHGroup,
  HostSortMode,
  generateId,
  resolveHostAuthMode,
  stripManagedAuthenticationConfig,
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
  deleteKeyPair,
  sanitizeKeyFileName,
} from "../keys/keyManager";
import {
  createImportedHostUpdates,
  findImportMatch,
  ImportedHost,
} from "./hostMatching";
import {
  CURRENT_DATA_SCHEMA_VERSION,
  migrateStoredData,
  toCatalog,
  ValidatedBackupData,
  validateBackupData,
} from "./dataSchema";
import {
  CatalogRepository,
  CatalogSnapshotInfo,
  mergeCatalogWithLegacyState,
} from "./catalogRepository";
import { ensureUniqueSSHHostAlias } from "./sshAlias";

/** Key used in globalState storage */
const DATA_KEY = "sshKit.data";
const WINDOW_CONNECTION_KEY = "sshKit.windowConnection";
const PENDING_CONNECTIONS_KEY = "sshKit.pendingConnections";
const REMOTE_AUTHORITY_CONNECTIONS_KEY = "sshKit.remoteAuthorityConnections";
const PREFERENCES_KEY = "sshKit.preferences";
const CURRENT_CONNECTION_KEY = "sshKit.currentConnection";
const catalogRevisions = new WeakMap<object, number>();

interface StoredPreferences {
  groupCollapsedState: SSHKitData["groupCollapsedState"];
  recentConnections: SSHKitData["recentConnections"];
  sortPreferences: SSHKitData["sortPreferences"];
}

export type GroupMoveDirection = "top" | "up" | "down" | "bottom";

/**
 * Storage service for the durable host catalog and lightweight VS Code state.
 */
export class StorageService {
  private readonly catalog: CatalogRepository;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  constructor(private context: vscode.ExtensionContext) {
    this.catalog = new CatalogRepository(context);
    this.initializeSplitState();
  }

  /** Read all data; return default empty data if none exists */
  getData(): SSHKitData {
    const raw = this.context.globalState.get<unknown>(DATA_KEY);
    const migrated = migrateStoredData(raw);
    if (migrated.changed && !this.catalog.isFileBacked) {
      void this.context.globalState.update(DATA_KEY, migrated.data);
    }
    const preferences = this.context.globalState.get<StoredPreferences>(
      PREFERENCES_KEY,
      toPreferences(migrated.data)
    );
    const currentConnection = this.context.globalState.get<SSHKitData["currentConnection"]>(
      CURRENT_CONNECTION_KEY,
      migrated.data.currentConnection
    );
    const catalog = this.catalog.read();
    const data = mergeCatalogWithLegacyState(catalog, {
      ...migrated.data,
      ...preferences,
      ...(currentConnection ? { currentConnection } : {}),
    });
    catalogRevisions.set(data, catalog.revision);
    return data;
  }

  /** Persist all data */
  private async saveData(
    data: SSHKitData,
    options: { snapshot?: boolean } = {}
  ): Promise<void> {
    data.schemaVersion = Math.max(data.schemaVersion, CURRENT_DATA_SCHEMA_VERSION);
    const expectedRevision = catalogRevisions.get(data);
    const saved = await this.catalog.replace(toCatalog(data), {
      snapshot: options.snapshot,
      expectedRevision,
    });
    data.schemaVersion = saved.schemaVersion;
    if (this.catalog.isFileBacked) {
      // The Catalog is authoritative. Auxiliary Memento failures must not make
      // callers roll back key files after the catalog commit already succeeded.
      await Promise.allSettled([
        this.savePreferences(data),
        this.context.globalState.update(CURRENT_CONNECTION_KEY, data.currentConnection),
        // Keep a schema-v4 mirror for one release so downgrades retain a rollback path.
        this.context.globalState.update(DATA_KEY, data),
      ]);
    } else {
      // In fallback mode globalState remains the authoritative persistence layer.
      await this.savePreferences(data);
      await this.context.globalState.update(CURRENT_CONNECTION_KEY, data.currentConnection);
      await this.context.globalState.update(DATA_KEY, data);
    }
    this.changeEmitter.fire();
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

  /** Move a group within the persisted manual order. */
  async moveGroup(id: string, direction: GroupMoveDirection): Promise<boolean> {
    const data = this.getData();
    const groups = [...data.groups].sort((left, right) => left.order - right.order);
    const currentIndex = groups.findIndex((group) => group.id === id);
    if (currentIndex < 0) {return false;}

    const targetIndex = direction === "top"
      ? 0
      : direction === "bottom"
        ? groups.length - 1
        : direction === "up"
          ? Math.max(0, currentIndex - 1)
          : Math.min(groups.length - 1, currentIndex + 1);
    if (targetIndex === currentIndex) {return false;}

    const [group] = groups.splice(currentIndex, 1);
    groups.splice(targetIndex, 0, group);
    data.groups = normalizeGroupOrder(groups);
    await this.saveData(data);
    return true;
  }

  /** Move a group to another group's position, or to the end when no target is supplied. */
  async moveGroupToTarget(id: string, targetId?: string): Promise<boolean> {
    if (id === targetId) {return false;}
    const data = this.getData();
    const groups = [...data.groups].sort((left, right) => left.order - right.order);
    const currentIndex = groups.findIndex((group) => group.id === id);
    if (currentIndex < 0) {return false;}

    const originalTargetIndex = targetId
      ? groups.findIndex((candidate) => candidate.id === targetId)
      : groups.length;
    if (targetId && originalTargetIndex < 0) {return false;}

    const [group] = groups.splice(currentIndex, 1);
    const targetIndex = targetId
      ? groups.findIndex((candidate) => candidate.id === targetId)
      : groups.length;
    const insertionIndex = targetId && currentIndex < originalTargetIndex
      ? targetIndex + 1
      : targetIndex;
    groups.splice(insertionIndex, 0, group);

    const reordered = normalizeGroupOrder(groups);
    const changed = reordered.some((candidate) =>
      candidate.order !== data.groups.find((existing) => existing.id === candidate.id)?.order
    );
    if (!changed) {return false;}
    data.groups = reordered;
    await this.saveData(data);
    return true;
  }

  /** Replace the persisted manual order when every current group is present exactly once. */
  async setGroupOrder(groupIds: readonly string[]): Promise<boolean> {
    const data = this.getData();
    const current = [...data.groups].sort((left, right) => left.order - right.order);
    if (groupIds.length !== current.length || new Set(groupIds).size !== current.length) {return false;}

    const groupsById = new Map(current.map((group) => [group.id, group]));
    const reordered = groupIds.flatMap((id) => {
      const group = groupsById.get(id);
      return group ? [group] : [];
    });
    if (reordered.length !== current.length) {return false;}
    if (reordered.every((group, index) => group.id === current[index].id)) {return false;}

    data.groups = normalizeGroupOrder(reordered);
    await this.saveData(data);
    return true;
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
    data.groups = normalizeGroupOrder(data.groups.filter((g) => g.id !== id));
    // Unlink hosts from the deleted group
    for (const host of data.hosts) {
      if (host.groupId === id) {
        host.groupId = undefined;
      }
    }
    await this.saveData(data, { snapshot: true });
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

  getHostSortMode(): HostSortMode {
    return this.getData().sortPreferences.hostSort;
  }

  async setHostSortMode(mode: HostSortMode): Promise<void> {
    const data = this.getData();
    if (data.sortPreferences.hostSort === mode) {return;}
    data.sortPreferences.hostSort = mode;
    await this.savePreferences(data);
    await this.updateLegacyMirror(data);
    this.changeEmitter.fire();
  }

  /** Find a host by name (used for import deduplication) */
  getHostByName(name: string): SSHHost | undefined {
    return this.getData().hosts.find((h) => h.name === name);
  }

  /** Add a host */
  async addHost(host: Omit<SSHHost, "id">): Promise<SSHHost> {
    const data = this.getData();
    const newHost = createStoredHost(data, host);
    data.hosts.push(newHost);
    await this.saveData(data);
    return newHost;
  }

  /** Update a host */
  async updateHost(id: string, updates: Partial<Omit<SSHHost, "id">>): Promise<void> {
    const data = this.getData();
    const host = data.hosts.find((h) => h.id === id);
    if (host) {
      applyStoredHostUpdates(data, host, updates);
      await this.saveData(data);
    }
  }

  /** Apply one confirmed SSH Config import as a single catalog transaction. */
  async importSSHConfigHosts(hosts: ImportedHost[]): Promise<{
    imported: number;
    updated: number;
    endpointMatched: number;
    skipped: number;
    ambiguous: number;
  }> {
    const data = this.getData();
    const touchedHostIds = new Set<string>();
    let imported = 0;
    let updated = 0;
    let endpointMatched = 0;
    let skipped = 0;
    let ambiguous = 0;

    for (const importedHost of hosts) {
      const match = findImportMatch(importedHost, data.hosts, touchedHostIds);
      if (match === "already-touched") {
        skipped++;
        continue;
      }
      if (match === "ambiguous") {
        ambiguous++;
        continue;
      }
      if (match) {
        applyStoredHostUpdates(
          data,
          match.host,
          createImportedHostUpdates(match.host, importedHost, match.reason)
        );
        touchedHostIds.add(match.host.id);
        updated++;
        if (match.reason === "endpoint") {endpointMatched++;}
        continue;
      }

      const added = createStoredHost(data, importedHost);
      data.hosts.push(added);
      touchedHostIds.add(added.id);
      imported++;
    }

    if (imported > 0 || updated > 0) {
      await this.saveData(data);
    }
    return { imported, updated, endpointMatched, skipped, ambiguous };
  }

  /** Update the associated identity file for multiple hosts in one save. */
  async updateHostsIdentityFile(hostIds: string[], identityFile?: string): Promise<number> {
    const ids = new Set(hostIds);
    if (ids.size === 0) {return 0;}

    const data = this.getData();
    let updated = 0;
    for (const host of data.hosts) {
      if (!ids.has(host.id)) {continue;}
      const previousAuthMode = resolveHostAuthMode(host);
      if (identityFile) {
        host.identityFile = identityFile;
        host.authMode = "identityFile";
      } else {
        delete host.identityFile;
        host.authMode = "auto";
      }
      if (resolveHostAuthMode(host) !== previousAuthMode) {
        host.extraConfig = stripManagedAuthenticationConfig(host.extraConfig);
      }
      updated++;
    }

    if (updated > 0) {
      await this.saveData(data);
    }
    return updated;
  }

  /** Soft-delete a host into the SSH Kit recycle bin. */
  async deleteHost(id: string): Promise<void> {
    await this.deleteHosts([id]);
  }

  /** Soft-delete multiple hosts in one catalog revision and one snapshot. */
  async deleteHosts(hostIds: Iterable<string>): Promise<number> {
    const data = this.getData();
    const ids = new Set(hostIds);
    if (ids.size === 0) {return 0;}
    const hosts = data.hosts.filter((host) => ids.has(host.id));
    if (hosts.length === 0) {return 0;}
    const groupNames = new Map(data.groups.map((group) => [group.id, group.name]));
    const deletedAt = new Date().toISOString();
    data.deletedHosts = [
      ...(data.deletedHosts ?? []).filter((entry) => !ids.has(entry.host.id)),
      ...hosts.map((host) => {
        const groupName = host.groupId ? groupNames.get(host.groupId) : undefined;
        return {
          host: globalThis.structuredClone(host),
          deletedAt,
          ...(groupName ? { groupName } : {}),
        };
      }),
    ];
    data.hosts = data.hosts.filter((host) => !ids.has(host.id));
    data.recentConnections = data.recentConnections.filter((id) => !ids.has(id));
    await this.saveData(data, { snapshot: true });
    return hosts.length;
  }

  getDeletedHosts(): NonNullable<SSHKitData["deletedHosts"]> {
    return [...(this.getData().deletedHosts ?? [])]
      .sort((left, right) => right.deletedAt.localeCompare(left.deletedAt));
  }

  async restoreDeletedHost(hostId: string): Promise<SSHHost | undefined> {
    const data = this.getData();
    const deleted = data.deletedHosts?.find((entry) => entry.host.id === hostId);
    if (!deleted) {return undefined;}

    const restored = globalThis.structuredClone(deleted.host);
    if (restored.groupId && !data.groups.some((group) => group.id === restored.groupId)) {
      restored.groupId = deleted.groupName
        ? data.groups.find((group) => group.name === deleted.groupName)?.id
        : undefined;
    }
    restored.sshAlias = ensureUniqueSSHHostAlias(
      restored.sshAlias || restored.name,
      restored,
      data.hosts.map((host) => host.sshAlias || host.name)
    );
    data.hosts.push(restored);
    data.deletedHosts = data.deletedHosts?.filter((entry) => entry.host.id !== hostId);
    await this.saveData(data, { snapshot: true });
    return restored;
  }

  async permanentlyDeleteHost(hostId: string): Promise<boolean> {
    const data = this.getData();
    const previousLength = data.deletedHosts?.length ?? 0;
    data.deletedHosts = data.deletedHosts?.filter((entry) => entry.host.id !== hostId);
    if ((data.deletedHosts?.length ?? 0) === previousLength) {return false;}
    await this.saveData(data, { snapshot: true });
    return true;
  }

  async emptyRecycleBin(): Promise<number> {
    const data = this.getData();
    const count = data.deletedHosts?.length ?? 0;
    if (count === 0) {return 0;}
    data.deletedHosts = [];
    await this.saveData(data, { snapshot: true });
    return count;
  }

  getCatalogSnapshots(): CatalogSnapshotInfo[] {
    return this.catalog.getSnapshotInfo();
  }

  async restoreCatalogSnapshot(snapshotPath: string): Promise<SSHKitData> {
    const current = this.getData();
    const catalog = await this.catalog.restoreSnapshot(
      snapshotPath,
      catalogRevisions.get(current)
    );
    const restored = mergeCatalogWithLegacyState(catalog, current);
    catalogRevisions.set(restored, catalog.revision);
    await this.updateLegacyMirror(restored);
    this.changeEmitter.fire();
    return restored;
  }

  // ─── Auxiliary operations ───────────────────────────────────────────

  /** Get the group collapsed state snapshot */
  getGroupCollapsedState(): Record<string, boolean> {
    return { ...this.getData().groupCollapsedState };
  }

  async setGroupCollapsedState(groupId: string, collapsed: boolean): Promise<void> {
    const data = this.getData();
    data.groupCollapsedState[groupId] = collapsed;
    await this.savePreferences(data);
    await this.updateLegacyMirror(data);
  }

  /** Record a recent connection */
  async addRecentConnection(hostId: string): Promise<void> {
    const data = this.getData();
    // Deduplicate, insert at front, keep the most recent 20
    data.recentConnections = [
      hostId,
      ...data.recentConnections.filter((rid) => rid !== hostId),
    ].slice(0, 20);
    await this.savePreferences(data);
    await this.updateLegacyMirror(data);
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

  getRecentConnectionIds(): string[] {
    return [...this.getData().recentConnections];
  }

  async setCurrentConnection(hostId: string, alias: string): Promise<void> {
    const data = this.getData();
    data.currentConnection = {
      hostId,
      alias,
      connectedAt: new Date().toISOString(),
    };
    await this.context.globalState.update(CURRENT_CONNECTION_KEY, data.currentConnection);
    await this.updateLegacyMirror(data);
  }

  getCurrentConnection(): SSHKitData["currentConnection"] {
    return this.getData().currentConnection;
  }

  async clearCurrentConnection(hostId?: string): Promise<void> {
    const data = this.getData();
    if (!data.currentConnection) {return;}
    if (hostId && data.currentConnection.hostId !== hostId) {return;}
    delete data.currentConnection;
    await this.context.globalState.update(CURRENT_CONNECTION_KEY, undefined);
    await this.updateLegacyMirror(data);
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
  exportAllData(options: { includeKeyFiles?: boolean } = {}): string {
    const includeKeyFiles = options.includeKeyFiles ?? true;
    const keys = includeKeyFiles ? listKeys() : [];
    if (includeKeyFiles) {populateFingerprints(keys);}
    const data = this.getData();
    const catalogHosts = [
      ...data.hosts,
      ...(data.deletedHosts ?? []).map((entry) => entry.host),
    ];
    const keyFiles = includeKeyFiles
      ? exportKeyFiles(catalogHosts.map((host) => host.identityFile).filter(Boolean) as string[])
      : [];

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
      containsPrivateKeys: keyFiles.length > 0,
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
    const source = parseBackupData(json);

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

  /** Preview a replacement restore without mutating current data. */
  previewReplace(json: string): {
    importedHosts: number;
    importedGroups: number;
    replacedHosts: number;
    replacedGroups: number;
    keyCount: number;
    keyTargets: string[];
  } {
    const source = parseBackupData(json);

    const current = this.getData();
    const keyNames = extractKeyNames(source);
    return {
      importedHosts: source.hosts.length,
      importedGroups: source.groups.length,
      replacedHosts: current.hosts.length,
      replacedGroups: current.groups.length,
      keyCount: keyNames.length,
      keyTargets: keyNames
        .map((name) => sanitizeKeyFileName(name))
        .filter(Boolean)
        .map((name) => `~/.ssh/${name}`),
    };
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
    const source = parseBackupData(json);

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
    let writtenKeyPaths: string[] = [];
    const identityRewriteTargets: Array<{ sourceName: string; targetPath?: string; clear?: boolean }> = [];

    if (source.keyFiles && source.keyFiles.length > 0) {
      const keyResult = importKeyFiles(source.keyFiles, keyFilePlan);
      keyFilesRestored = keyResult.written;
      keyFilesReused = keyResult.reused;
      keyFilesSkipped = keyResult.skipped;
      keyFilesFailed = keyResult.failed.length;
      keyFileFailures = keyResult.failed;
      writtenKeyPaths = keyResult.writtenPaths;
      identityRewriteTargets.push(...keyResult.restoredPaths);
      identityRewriteTargets.push(
        ...[...keyResult.skippedSourceNames, ...keyResult.failedSourceNames]
          .map((sourceName) => ({ sourceName, clear: true }))
      );
    }

    const existingGroupsByName = new Map(data.groups.map((g) => [g.name, g]));
    const sourceGroups = [...source.groups].sort((left, right) =>
      (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER)
    );
    for (const g of sourceGroups) {
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

      const rewrittenIdentityFile = rewriteImportedIdentityFile(
        h.identityFile,
        identityRewriteTargets
      );
      const host: SSHHost = {
        ...h,
        id: generateId(),
        groupId: h.groupId ? groupIdMap.get(h.groupId) : undefined,
        identityFile: rewrittenIdentityFile,
        tags: h.tags ?? [],
      };
      normalizeHostAuthentication(host);
      data.hosts.push(host);
      touchedHostIds.add(host.id);
      importedHosts++;
    }

    const usedHostIds = new Set([
      ...data.hosts.map((host) => host.id),
      ...(data.deletedHosts ?? []).map((entry) => entry.host.id),
    ]);
    for (const entry of source.deletedHosts ?? []) {
      const rewrittenIdentityFile = rewriteImportedIdentityFile(
        entry.host.identityFile,
        identityRewriteTargets
      );
      let id = entry.host.id;
      while (usedHostIds.has(id)) {id = generateId();}
      usedHostIds.add(id);
      const host: SSHHost = {
        ...entry.host,
        id,
        groupId: entry.host.groupId
          ? groupIdMap.get(entry.host.groupId)
          : undefined,
        identityFile: rewrittenIdentityFile,
        tags: entry.host.tags ?? [],
      };
      normalizeHostAuthentication(host);
      data.deletedHosts = [
        ...(data.deletedHosts ?? []),
        {
          host,
          deletedAt: entry.deletedAt,
          ...(entry.groupName ? { groupName: entry.groupName } : {}),
        },
      ];
    }

    if (source.sortPreferences?.hostSort) {
      data.sortPreferences.hostSort = source.sortPreferences.hostSort;
    }

    try {
      await this.saveData(data, { snapshot: true });
    } catch (error) {
      for (const privateKeyPath of [...writtenKeyPaths].reverse()) {
        try {
          deleteKeyPair(privateKeyPath);
        } catch {
          // Preserve the storage failure; rollback is best effort and never removes reused keys.
        }
      }
      throw error;
    }

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

  /** Replace the current catalog and preferences with a validated backup. */
  async commitReplace(
    json: string,
    keyFilePlan: KeyFileImportPlan[] = []
  ): Promise<{
    importedHosts: number;
    importedGroups: number;
    skippedHosts: number;
    keyFilesRestored: number;
    keyFilesReused: number;
    keyFilesSkipped: number;
    keyFilesFailed: number;
    keyFileFailures: Array<{ name: string; reason: string }>;
  }> {
    const source = parseBackupData(json);

    const current = this.getData();
    const currentConnection = current.currentConnection;
    const replacement = migrateStoredData(source).data;
    replacement.currentConnection = currentConnection;
    const expectedRevision = catalogRevisions.get(current);
    if (expectedRevision !== undefined) {
      catalogRevisions.set(replacement, expectedRevision);
    }

    let keyFilesRestored = 0;
    let keyFilesReused = 0;
    let keyFilesSkipped = 0;
    let keyFilesFailed = 0;
    let keyFileFailures: Array<{ name: string; reason: string }> = [];
    let writtenKeyPaths: string[] = [];
    const identityRewriteTargets: Array<{
      sourceName: string;
      targetPath?: string;
      clear?: boolean;
    }> = [];

    if (source.keyFiles && source.keyFiles.length > 0) {
      const keyResult = importKeyFiles(source.keyFiles, keyFilePlan);
      keyFilesRestored = keyResult.written;
      keyFilesReused = keyResult.reused;
      keyFilesSkipped = keyResult.skipped;
      keyFilesFailed = keyResult.failed.length;
      keyFileFailures = keyResult.failed;
      writtenKeyPaths = keyResult.writtenPaths;
      identityRewriteTargets.push(...keyResult.restoredPaths);
      identityRewriteTargets.push(
        ...[...keyResult.skippedSourceNames, ...keyResult.failedSourceNames]
          .map((sourceName) => ({ sourceName, clear: true }))
      );
    }

    const replacementHosts = [
      ...replacement.hosts,
      ...(replacement.deletedHosts ?? []).map((entry) => entry.host),
    ];
    for (const host of replacementHosts) {
      host.identityFile = rewriteImportedIdentityFile(
        host.identityFile,
        identityRewriteTargets
      );
      normalizeHostAuthentication(host);
    }

    try {
      await this.saveData(replacement, { snapshot: true });
    } catch (error) {
      for (const privateKeyPath of [...writtenKeyPaths].reverse()) {
        try {
          deleteKeyPair(privateKeyPath);
        } catch {
          // Preserve the catalog failure; rollback is best effort.
        }
      }
      throw error;
    }

    return {
      importedHosts: replacement.hosts.length,
      importedGroups: replacement.groups.length,
      skippedHosts: 0,
      keyFilesRestored,
      keyFilesReused,
      keyFilesSkipped,
      keyFilesFailed,
      keyFileFailures,
    };
  }

  private initializeSplitState(): void {
    const legacy = migrateStoredData(this.context.globalState.get<unknown>(DATA_KEY)).data;
    if (this.context.globalState.get(PREFERENCES_KEY) === undefined) {
      void this.context.globalState.update(PREFERENCES_KEY, toPreferences(legacy));
    }
    if (
      legacy.currentConnection &&
      this.context.globalState.get(CURRENT_CONNECTION_KEY) === undefined
    ) {
      void this.context.globalState.update(CURRENT_CONNECTION_KEY, legacy.currentConnection);
    }
  }

  private async savePreferences(data: SSHKitData): Promise<void> {
    await this.context.globalState.update(PREFERENCES_KEY, toPreferences(data));
  }

  private async updateLegacyMirror(data: SSHKitData): Promise<void> {
    const update = this.context.globalState.update(DATA_KEY, data);
    if (this.catalog.isFileBacked) {
      await Promise.allSettled([update]);
      return;
    }
    await update;
  }
}

function toPreferences(data: SSHKitData): StoredPreferences {
  return {
    groupCollapsedState: data.groupCollapsedState,
    recentConnections: data.recentConnections,
    sortPreferences: data.sortPreferences,
  };
}

function normalizeGroupOrder(groups: SSHGroup[]): SSHGroup[] {
  return groups.map((group, index) => ({ ...group, order: index }));
}

function createStoredHost(
  data: SSHKitData,
  host: Omit<SSHHost, "id">
): SSHHost {
  const stored: SSHHost = {
    ...host,
    id: generateId(),
    tags: host.tags ?? [],
  };
  stored.sshAlias = ensureUniqueSSHHostAlias(
    host.sshAlias || host.name,
    stored,
    data.hosts.map((candidate) => candidate.sshAlias || candidate.name)
  );
  normalizeHostAuthentication(stored);
  return stored;
}

function applyStoredHostUpdates(
  data: SSHKitData,
  host: SSHHost,
  updates: Partial<Omit<SSHHost, "id">>
): void {
  const stableAlias = host.sshAlias;
  const previousAuthMode = resolveHostAuthMode(host);
  Object.assign(host, updates);
  if (
    updates.authMode !== undefined &&
    resolveHostAuthMode(host) !== previousAuthMode
  ) {
    host.extraConfig = stripManagedAuthenticationConfig(host.extraConfig);
  }
  host.sshAlias = updates.sshAlias
    ? ensureUniqueSSHHostAlias(
        updates.sshAlias,
        host,
        data.hosts
          .filter((candidate) => candidate.id !== host.id)
          .map((candidate) => candidate.sshAlias || candidate.name)
      )
    : stableAlias;
  normalizeHostAuthentication(host);
}

function parseBackupData(
  json: string
): ValidatedBackupData & { keyFiles?: KeyFileEntry[] } {
  let source: ValidatedBackupData & { keyFiles?: KeyFileEntry[] };
  try {
    source = JSON.parse(json);
  } catch {
    throw new Error(vscode.l10n.t("Invalid backup file: could not parse JSON."));
  }
  validateBackupData(source);
  if (
    source.schemaVersion !== undefined &&
    (
      !Number.isInteger(source.schemaVersion) ||
      source.schemaVersion < 0
    )
  ) {
    throw new Error(vscode.l10n.t("Invalid SSH Kit backup schema version."));
  }
  if (
    source.schemaVersion !== undefined &&
    source.schemaVersion > CURRENT_DATA_SCHEMA_VERSION
  ) {
    throw new Error(vscode.l10n.t(
      "This backup was created by a newer SSH Kit data format. Update SSH Kit before restoring it."
    ));
  }
  return source;
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

function normalizeHostAuthentication(host: SSHHost): void {
  const authMode = resolveHostAuthMode(host);
  if (authMode === "identityFile" && host.identityFile) {
    host.authMode = authMode;
    return;
  }

  host.authMode = authMode === "identityFile" ? "auto" : authMode;
  delete host.identityFile;
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
