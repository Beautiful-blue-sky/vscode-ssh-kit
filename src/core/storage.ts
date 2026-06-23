// SSH Kit — Data storage layer based on VS Code globalState
import * as vscode from "vscode";
import {
  SSHKitData,
  SSHHost,
  SSHGroup,
  createDefaultData,
  generateId,
} from "./types";
import { listKeys, populateFingerprints, exportKeyFiles, importKeyFiles } from "../keys/keyManager";

/** Key used in globalState storage */
const DATA_KEY = "sshKit.data";

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

  /**
   * Remove duplicate hosts by name, keeping the first occurrence.
   * Side effect: also cleans up deleted host IDs from recentConnections.
   * @returns number of duplicates removed
   */
  async deduplicateHosts(): Promise<number> {
    const data = this.getData();
    const seen = new Set<string>();
    const duplicates: string[] = []; // Host IDs to delete

    for (const host of data.hosts) {
      if (seen.has(host.name)) {
        duplicates.push(host.id);
      } else {
        seen.add(host.name);
      }
    }

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

  // ─── Backup / restore ───────────────────────────────────────────────

  /** Export all data as JSON (including base64-encoded key files) */
  exportAllData(): string {
    const keys = listKeys();
    populateFingerprints(keys);

    const exportData = {
      ...this.getData(),
      keyMetadata: keys.map((k) => ({
        name: k.name,
        type: k.type,
        fingerprint: k.fingerprint,
      })),
      keyFiles: exportKeyFiles(),
      exportedAt: new Date().toISOString(),
    };

    return JSON.stringify(exportData, null, 2);
  }

  /** Preview an import (parse only, used for the confirmation dialog) */
  previewImport(json: string): { importedHosts: number; importedGroups: number; keyCount: number } {
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
    const existingHostNames = new Set(data.hosts.map((h) => h.name));

    const importedGroups = source.groups.filter((g) => !existingGroupNames.has(g.name)).length;
    const importedHosts = source.hosts.filter((h) => !existingHostNames.has(h.name)).length;
    const keyCount = source.keyMetadata?.length ?? 0;

    return { importedHosts, importedGroups, keyCount };
  }

  /** Execute import (write to storage + restore key files) */
  commitImport(json: string): { importedHosts: number; importedGroups: number; keyFilesRestored: number } {
    let source: SSHKitData & { keyFiles?: Array<{ name: string; type: string; privateKey: string; publicKey?: string }> };
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

    const existingGroupNames = new Set(data.groups.map((g) => g.name));
    for (const g of source.groups) {
      if (!existingGroupNames.has(g.name)) {
        data.groups.push(g);
        importedGroups++;
      }
    }

    const existingHostNames = new Set(data.hosts.map((h) => h.name));
    for (const h of source.hosts) {
      if (!existingHostNames.has(h.name)) {
        data.hosts.push(h);
        importedHosts++;
      }
    }

    this.saveData(data);

    // 密钥写入可能部分失败，不影响已导入的主机/分组
    let keyFilesRestored = 0;
    if (source.keyFiles && source.keyFiles.length > 0) {
      try {
        keyFilesRestored = importKeyFiles(source.keyFiles);
      } catch {
        // Key file write failed, silently recorded (hosts/groups already imported)
      }
    }

    return { importedHosts, importedGroups, keyFilesRestored };
  }
}
