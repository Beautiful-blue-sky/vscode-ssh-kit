// SSH Kit —— 主机 CRUD 命令（增/改/删/复制/去重/批量删除）
import * as vscode from "vscode";
import { SSHHost, PromptNewHostFn } from "../core/types";
import { StorageService } from "../core/storage";
import { HostTreeDataProvider } from "../views/treeView";

/** 添加主机 */
export async function addHost(
  storage: StorageService,
  tree: HostTreeDataProvider,
  promptNewHost: PromptNewHostFn
): Promise<void> {
  const host = await promptNewHost(storage);
  if (!host) {return;}

  await storage.addHost(host);
  tree.refresh();
  vscode.window.showInformationMessage(
    `已添加主机：${host.name} (${host.hostname}:${host.port})`
  );
}

/** 编辑主机 */
export async function editHost(
  host: SSHHost,
  storage: StorageService,
  tree: HostTreeDataProvider,
  promptNewHost: PromptNewHostFn
): Promise<void> {
  const updates = await promptNewHost(storage, host);
  if (!updates) {return;}

  await storage.updateHost(host.id, updates);
  tree.refresh();
  vscode.window.showInformationMessage(
    `已更新主机：${updates.name} (${updates.hostname}:${updates.port})`
  );
}

/** 单台删除主机 */
export async function deleteHost(
  host: SSHHost,
  storage: StorageService,
  tree: HostTreeDataProvider
): Promise<void> {
  const confirmed = await vscode.window.showWarningMessage(
    `确定删除主机「${host.name}」(${host.hostname}:${host.port})？此操作不可撤销。`,
    { modal: true },
    "删除"
  );
  if (confirmed !== "删除") {return;}

  await storage.deleteHost(host.id);
  tree.refresh();
  vscode.window.showInformationMessage(
    `已删除主机：${host.name} (${host.hostname}:${host.port})`
  );
}

/** 复制主机地址到剪贴板 */
export async function copyHostName(host: SSHHost): Promise<void> {
  await vscode.env.clipboard.writeText(host.hostname);
  vscode.window.showInformationMessage(`已复制：${host.hostname}`);
}

/** 删除重复主机（按名称去重，保留第一个） */
export async function deduplicateHosts(
  storage: StorageService,
  tree: HostTreeDataProvider
): Promise<void> {
  const removed = await storage.deduplicateHosts();
  if (removed === 0) {
    vscode.window.showInformationMessage("没有重复主机，无需清理。");
  } else {
    tree.refresh();
    vscode.window.showInformationMessage(`已清理 ${removed} 台重复主机。`);
  }
}

/** 批量删除主机（QuickPick 多选，注意：canPickMany 有 VS Code 原生 checkbox 闪烁，属平台限制） */
export async function batchDeleteHosts(
  storage: StorageService,
  tree: HostTreeDataProvider
): Promise<void> {
  const hosts = storage.getAllHosts();
  if (hosts.length === 0) {
    vscode.window.showInformationMessage("暂无主机。");
    return;
  }

  const groups = storage.getGroups();
  const items: (vscode.QuickPickItem & { _hostId?: string })[] = [];
  const pushed = new Set<string>();

  for (const group of groups) {
    for (const h of storage.getHostsByGroup(group.id)) {
      items.push({
        label: h.name,
        description: `[${group.name}] ${h.username}@${h.hostname}:${h.port}`,
        _hostId: h.id,
      });
      pushed.add(h.id);
    }
  }

  for (const h of hosts.filter((h) => !pushed.has(h.id))) {
    items.push({
      label: h.name,
      description: `[未分组] ${h.username}@${h.hostname}:${h.port}`,
      _hostId: h.id,
    });
  }

  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    matchOnDescription: false,
    matchOnDetail: false,
    placeHolder: "选择要删除的主机（可多选）...",
  });

  if (!picked || picked.length === 0) {return;}

  const ids = new Set(picked.map((p) => p._hostId).filter(Boolean) as string[]);
  const toDelete = hosts.filter((h) => ids.has(h.id));
  if (toDelete.length === 0) {return;}

  const confirmed = await vscode.window.showWarningMessage(
    `确定删除选中的 ${toDelete.length} 台主机？此操作不可撤销。`,
    { modal: true },
    "删除"
  );
  if (confirmed !== "删除") {return;}

  for (const host of toDelete) {
    await storage.deleteHost(host.id);
  }
  tree.refresh();
  vscode.window.showInformationMessage(`已批量删除 ${toDelete.length} 台主机。`);
}
