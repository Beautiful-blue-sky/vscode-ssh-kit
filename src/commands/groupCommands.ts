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
    prompt: vscode.l10n.t("Group name"),
    placeHolder: vscode.l10n.t("For example, Cloud Production"),
    validateInput: (v) => (v.trim() ? undefined : vscode.l10n.t("Name is required")),
  });
  if (!name) {return;}

  await storage.addGroup(name.trim());
  tree.refresh();
  vscode.window.showInformationMessage(vscode.l10n.t("Added group: {name}", { name }));
}

/** Rename a group */
export async function renameGroup(
  groupItem: GroupItem,
  storage: StorageService,
  tree: HostTreeDataProvider
): Promise<void> {
  const name = await vscode.window.showInputBox({
    prompt: vscode.l10n.t("New group name"),
    value: groupItem.group.name,
    validateInput: (v) => (v.trim() ? undefined : vscode.l10n.t("Name is required")),
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
      ? vscode.l10n.t("Delete group “{name}”? Its {count} hosts will be moved to Ungrouped.", {
          name: groupItem.group.name,
          count: hostCount,
        })
      : vscode.l10n.t("Delete group “{name}”?", { name: groupItem.group.name });

  const deleteAction = vscode.l10n.t("Delete");

  const confirmed = await vscode.window.showWarningMessage(
    message,
    { modal: true },
    deleteAction
  );
  if (confirmed !== deleteAction) {return;}

  await storage.deleteGroup(groupItem.group.id);
  tree.refresh();
}
