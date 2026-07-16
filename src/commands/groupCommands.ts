// SSH Kit — Group management commands
import * as vscode from "vscode";
import { GroupMoveDirection, StorageService } from "../core/storage";
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

export async function moveGroup(
  groupItem: GroupItem | undefined,
  storage: StorageService,
  tree: HostTreeDataProvider,
  direction: GroupMoveDirection
): Promise<void> {
  if (!groupItem) {
    vscode.window.showInformationMessage(vscode.l10n.t("Run this command from a host group."));
    return;
  }
  if (await storage.moveGroup(groupItem.group.id, direction)) {
    tree.refresh();
  }
}

export async function sortGroupsByName(
  storage: StorageService,
  tree: HostTreeDataProvider
): Promise<void> {
  const collator = new Intl.Collator(vscode.env.language || undefined, {
    numeric: true,
    sensitivity: "base",
  });
  const groups = storage.getGroups();
  const sortedIds = [...groups]
    .sort((left, right) => collator.compare(left.name, right.name) || left.order - right.order)
    .map((group) => group.id);
  if (await storage.setGroupOrder(sortedIds)) {
    tree.refresh();
    vscode.window.setStatusBarMessage(vscode.l10n.t("$(check) SSH Kit groups sorted by name"), 3000);
  }
}
