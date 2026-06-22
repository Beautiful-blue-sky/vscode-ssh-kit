// SSH Kit 数据存储层 —— 基于 VS Code globalState
import * as vscode from "vscode";
import {
  SSHKitData,
  SSHHost,
  SSHGroup,
  createDefaultData,
  generateId,
} from "./types";
import { listKeys, populateFingerprints, exportKeyFiles, importKeyFiles } from "../keys/keyManager";

/** globalState 存储键 */
const DATA_KEY = "sshKit.data";

/**
 * 存储服务 —— 封装 VS Code globalState 的读写操作
 * 所有数据以 JSON 格式持久化，扩展卸载时保留（globalState 不会随卸载清除）
 */
export class StorageService {
  constructor(private context: vscode.ExtensionContext) {}

  /** 读取完整数据，不存在时返回默认空数据 */
  getData(): SSHKitData {
    const raw = this.context.globalState.get<SSHKitData>(DATA_KEY);
    return raw ?? createDefaultData();
  }

  /** 写入完整数据 */
  private async saveData(data: SSHKitData): Promise<void> {
    await this.context.globalState.update(DATA_KEY, data);
  }

  // ─── 分组操作 ──────────────────────────────────────────────────────

  /** 获取所有分组（按 order 排序） */
  getGroups(): SSHGroup[] {
    return [...this.getData().groups].sort((a, b) => a.order - b.order);
  }

  /** 添加分组 */
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

  /** 更新分组名 */
  async updateGroup(id: string, name: string): Promise<void> {
    const data = this.getData();
    const group = data.groups.find((g) => g.id === id);
    if (group) {
      group.name = name;
      await this.saveData(data);
    }
  }

  /** 删除分组（组内主机移到未分组） */
  async deleteGroup(id: string): Promise<void> {
    const data = this.getData();
    data.groups = data.groups.filter((g) => g.id !== id);
    // 组内主机取消分组关联
    for (const host of data.hosts) {
      if (host.groupId === id) {
        host.groupId = undefined;
      }
    }
    await this.saveData(data);
  }

  // ─── 主机操作 ──────────────────────────────────────────────────────

  /** 获取指定分组下的主机（groupId 为 undefined 时返回未分组主机） */
  getHostsByGroup(groupId?: string): SSHHost[] {
    return this.getData().hosts.filter((h) => h.groupId === groupId);
  }

  /** 获取全部主机 */
  getAllHosts(): SSHHost[] {
    return [...this.getData().hosts];
  }

  /** 按名称查找主机（用于导入去重） */
  getHostByName(name: string): SSHHost | undefined {
    return this.getData().hosts.find((h) => h.name === name);
  }

  /**
   * 去重：按名称删除同名主机，保留第一个。
   * 副作用：同步清理 recentConnections 中已删除主机 ID。
   * @returns 删除的重复主机数量
   */
  async deduplicateHosts(): Promise<number> {
    const data = this.getData();
    const seen = new Set<string>();
    const duplicates: string[] = []; // 待删除的主机 ID

    for (const host of data.hosts) {
      if (seen.has(host.name)) {
        duplicates.push(host.id);
      } else {
        seen.add(host.name);
      }
    }

    if (duplicates.length === 0) {return 0;}

    data.hosts = data.hosts.filter((h) => !duplicates.includes(h.id));
    // 同步清理最近连接中的重复 ID
    data.recentConnections = data.recentConnections.filter(
      (rid) => !duplicates.includes(rid)
    );
    await this.saveData(data);
    return duplicates.length;
  }

  /** 添加主机 */
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

  /** 更新主机 */
  async updateHost(id: string, updates: Partial<Omit<SSHHost, "id">>): Promise<void> {
    const data = this.getData();
    const host = data.hosts.find((h) => h.id === id);
    if (host) {
      Object.assign(host, updates);
      await this.saveData(data);
    }
  }

  /** 删除主机 */
  async deleteHost(id: string): Promise<void> {
    const data = this.getData();
    data.hosts = data.hosts.filter((h) => h.id !== id);
    // 同时清理最近连接记录
    data.recentConnections = data.recentConnections.filter((rid) => rid !== id);
    await this.saveData(data);
  }

  // ─── 辅助操作 ──────────────────────────────────────────────────────

  /** 获取/设置分组折叠状态 */
  getGroupCollapsedState(): Record<string, boolean> {
    return { ...this.getData().groupCollapsedState };
  }

  async setGroupCollapsedState(groupId: string, collapsed: boolean): Promise<void> {
    const data = this.getData();
    data.groupCollapsedState[groupId] = collapsed;
    await this.saveData(data);
  }

  /** 记录最近连接 */
  async addRecentConnection(hostId: string): Promise<void> {
    const data = this.getData();
    // 移除已有的同 ID 记录，插入到最前面，保留最近 20 条
    data.recentConnections = [
      hostId,
      ...data.recentConnections.filter((rid) => rid !== hostId),
    ].slice(0, 20);
    await this.saveData(data);
  }

  /** 获取最近连接的主机列表（按连接时间倒序，最多 10 条） */
  getRecentHosts(): SSHHost[] {
    const data = this.getData();
    const hostMap = new Map(data.hosts.map((h) => [h.id, h]));
    return data.recentConnections
      .slice(0, 10)
      .map((id) => hostMap.get(id))
      .filter((h): h is SSHHost => h !== undefined);
  }

  // ─── 备份/恢复 ────────────────────────────────────────────────────

  /** 导出全部数据为 JSON 字符串（含密钥文件 base64） */
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

  /** 预览导入（只解析不写入，用于确认对话框） */
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

  /** 执行导入（写入存储 + 恢复密钥文件） */
  commitImport(json: string): { importedHosts: number; importedGroups: number; keyFilesRestored: number } {
    let source: SSHKitData & { keyFiles?: Array<{ name: string; type: string; privateKey: string; publicKey?: string }> };
    try {
      source = JSON.parse(json);
    } catch {
      throw new Error("备份文件格式无效，无法解析 JSON。");
    }
    if (!source.hosts || !source.groups) {
      throw new Error("无效的备份文件格式。");
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
        // 密钥写入失败，静默记录（主机/分组已成功导入）
      }
    }

    return { importedHosts, importedGroups, keyFilesRestored };
  }
}
