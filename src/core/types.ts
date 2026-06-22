// SSH Kit 数据模型类型定义

/** 主机配置 */
export interface SSHHost {
  id: string;
  name: string;            // 显示名称
  hostname: string;        // IP 或域名
  port: number;            // SSH 端口，默认 22
  username: string;        // 登录用户名
  identityFile?: string;   // 关联私钥路径
  groupId?: string;        // 所属分组 ID（undefined 表示未分组）
  tags: string[];          // 标签
  extraConfig?: Record<string, string>; // 其他 SSH config 选项
}

/** 分组 */
export interface SSHGroup {
  id: string;
  name: string;
  order: number;           // 排序序号
}

/** 扩展完整存储结构 */
export interface SSHKitData {
  groups: SSHGroup[];
  hosts: SSHHost[];
  groupCollapsedState: Record<string, boolean>; // 分组 ID → 是否折叠
  recentConnections: string[];                   // 最近连接的主机 ID 列表
}

/** 默认空数据 */
export function createDefaultData(): SSHKitData {
  return {
    groups: [],
    hosts: [],
    groupCollapsedState: {},
    recentConnections: [],
  };
}

/** 生成简短唯一 ID */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ─── 公共回调类型 ─────────────────────────────────────────────────────────

import type { StorageService } from "./storage";

/** 新建/编辑主机的多步输入回调签名 */
export type PromptNewHostFn = (
  storage: StorageService,
  prefill?: Partial<SSHHost>
) => Promise<Omit<SSHHost, "id"> | undefined>;
