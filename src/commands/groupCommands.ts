// SSH Kit — Group management commands
import * as vscode from "vscode";
import { StorageService } from "../core/storage";
import { GroupItem, HostTreeDataProvider } from "../views/treeView";

/** Add a new group */
export async function addGroup(
  storage: StorageService,
  tree: HostTreeDataProvider
): Promise<void> {
  const name = await vscode.window.showInputBox({
    prompt: "分组名称",
    placeHolder: "如 武当云-生产",
    validateInput: (v) => (v.trim() ? undefined : "名称不能为空"),
  });
  if (!name) {return;}

  await storage.addGroup(name.trim());
  tree.refresh();
  vscode.window.showInformationMessage(`已添加分组：${name}`);
}

/** Rename a group */
export async function renameGroup(
  groupItem: GroupItem,
  storage: StorageService,
  tree: HostTreeDataProvider
): Promise<void> {
  const name = await vscode.window.showInputBox({
    prompt: "新分组名称",
    value: groupItem.group.name,
    validateInput: (v) => (v.trim() ? undefined : "名称不能为空"),
  });
  if (!name) {return;}

  await storage.updateGroup(groupItem.group.id, name.trim());
  tree.refresh();
}

/** Delete a group */
export async function deleteGroup(
  groupItem: GroupItem,
  storage: StorageService,
  tree: HostTreeDataProvider
): Promise<void> {
  const hostCount = storage.getHostsByGroup(groupItem.group.id).length;
  const message =
    hostCount > 0
      ? `确定删除分组「${groupItem.group.name}」？组内 ${hostCount} 台主机将移入「未分组」。`
      : `确定删除分组「${groupItem.group.name}」？`;

  const confirmed = await vscode.window.showWarningMessage(
    message,
    { modal: true },
    "删除"
  );
  if (confirmed !== "删除") {return;}

  await storage.deleteGroup(groupItem.group.id);
  tree.refresh();
}
