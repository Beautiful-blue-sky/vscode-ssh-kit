// SSH Kit — Host CRUD commands (add, edit, delete, copy, deduplicate, batch delete)
import * as vscode from "vscode";
import { SSHHost, PromptNewHostFn, PromptEditHostFn } from "../core/types";
import { DuplicateHostGroup, findDuplicateEndpointGroups } from "../core/hostMatching";
import { StorageService } from "../core/storage";
import { HostTreeDataProvider } from "../views/treeView";

type KeepDuplicatePick = vscode.QuickPickItem & {
  host?: SSHHost;
  skip?: boolean;
};

/** Add a host */
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

/** Edit a host */
export async function editHost(
  host: SSHHost,
  storage: StorageService,
  tree: HostTreeDataProvider,
  promptEditHost: PromptEditHostFn
): Promise<void> {
  const updates = await promptEditHost(storage, host);
  if (!updates) {return;}

  await storage.updateHost(host.id, updates);
  tree.refresh();
  vscode.window.showInformationMessage(
    `已更新主机：${updates.name ?? host.name}`
  );
}

/** Delete a single host */
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

/** Copy hostname to clipboard */
export async function copyHostName(host: SSHHost): Promise<void> {
  await vscode.env.clipboard.writeText(host.hostname);
  vscode.window.showInformationMessage(`已复制：${host.hostname}`);
}

/** Copy an expanded host detail field to clipboard */
export async function copyHostDetail(label: string, value: string): Promise<void> {
  await vscode.env.clipboard.writeText(value);
  vscode.window.showInformationMessage(`已复制${label}：${value}`);
}

/** Remove duplicate hosts by actual SSH endpoint after the user chooses which item to keep. */
export async function deduplicateHosts(
  storage: StorageService,
  tree: HostTreeDataProvider
): Promise<void> {
  const hosts = storage.getAllHosts();
  const duplicates = findDuplicateEndpointGroups(hosts);
  if (duplicates.length === 0) {
    vscode.window.showInformationMessage("没有相同地址、端口和用户的重复主机，无需清理。");
    return;
  }

  const groupNames = new Map(storage.getGroups().map((g) => [g.id, g.name]));
  const deleteIds = new Set<string>();
  let skipped = 0;

  for (let index = 0; index < duplicates.length; index++) {
    const keep = await promptHostToKeep(duplicates[index], groupNames, index + 1, duplicates.length);
    if (keep === undefined) {
      break;
    }
    if (keep === "skip") {
      skipped++;
      continue;
    }

    for (const host of duplicates[index].hosts) {
      if (host.id !== keep.id) {
        deleteIds.add(host.id);
      }
    }
  }

  if (deleteIds.size === 0) {
    const suffix = skipped > 0 ? `，已跳过 ${skipped} 组` : "";
    vscode.window.showInformationMessage(`未删除任何重复主机${suffix}。`);
    return;
  }

  const toDelete = hosts.filter((host) => deleteIds.has(host.id));
  const preview = toDelete.slice(0, 8).map((host) => `「${host.name}」`).join("、");
  const more = toDelete.length > 8 ? ` 等 ${toDelete.length} 台` : "";
  const confirmed = await vscode.window.showWarningMessage(
    `将删除 ${toDelete.length} 台重复主机：${preview}${more}。此操作不可撤销。`,
    { modal: true },
    "确认删除"
  );
  if (confirmed !== "确认删除") {return;}

  for (const host of toDelete) {
    await storage.deleteHost(host.id);
  }
  tree.refresh();
  vscode.window.showInformationMessage(`已清理 ${toDelete.length} 台重复主机。`);
}

async function promptHostToKeep(
  duplicateGroup: DuplicateHostGroup,
  groupNames: Map<string, string>,
  index: number,
  total: number
): Promise<SSHHost | "skip" | undefined> {
  const sortedHosts = [...duplicateGroup.hosts].sort((a, b) => {
    const groupA = a.groupId ? 0 : 1;
    const groupB = b.groupId ? 0 : 1;
    return groupA - groupB;
  });
  const endpoint = formatEndpoint(sortedHosts[0]);
  const items: KeepDuplicatePick[] = [
    ...sortedHosts.map((host) => ({
      label: host.name,
      description: `[${getGroupName(host, groupNames)}] ${formatEndpoint(host)}`,
      detail: [
        host.identityFile ? `密钥：${host.identityFile}` : "密钥：未关联",
        host.tags.length > 0 ? `标签：${host.tags.join(", ")}` : "",
      ].filter(Boolean).join("  "),
      host,
    })),
    {
      label: "$(debug-step-over) 跳过这一组",
      description: endpoint,
      skip: true,
    },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    matchOnDescription: true,
    matchOnDetail: true,
    placeHolder: `重复目标 ${index}/${total}：选择要保留的主机，其余同目标主机将删除`,
  });
  if (!picked) {return undefined;}
  if (picked.skip) {return "skip";}
  return picked.host;
}

function getGroupName(host: SSHHost, groupNames: Map<string, string>): string {
  return host.groupId ? groupNames.get(host.groupId) ?? "未知分组" : "未分组";
}

function formatEndpoint(host: SSHHost): string {
  return `${host.username}@${host.hostname}:${host.port}`;
}

/** Batch delete hosts via multi-select QuickPick. Note: canPickMany checkbox flickering is a VS Code platform limitation. */
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
