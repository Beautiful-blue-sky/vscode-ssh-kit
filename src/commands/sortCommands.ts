import * as vscode from "vscode";
import { StorageService } from "../core/storage";
import { HostSortMode } from "../core/types";
import { HostTreeDataProvider } from "../views/treeView";

interface HostSortItem extends vscode.QuickPickItem {
  mode: HostSortMode;
}

export async function sortHosts(
  storage: StorageService,
  tree: HostTreeDataProvider
): Promise<void> {
  const current = storage.getHostSortMode();
  const items: HostSortItem[] = [
    {
      label: vscode.l10n.t("Name (A to Z)"),
      description: vscode.l10n.t("Natural order, so node2 appears before node10"),
      mode: "nameAsc",
    },
    {
      label: vscode.l10n.t("Name (Z to A)"),
      description: vscode.l10n.t("Reverse natural name order"),
      mode: "nameDesc",
    },
    {
      label: vscode.l10n.t("Address"),
      description: vscode.l10n.t("HostName or IP, followed by port and name"),
      mode: "addressAsc",
    },
    {
      label: vscode.l10n.t("Recently connected"),
      description: vscode.l10n.t("Most recently connected hosts first; other hosts remain in name order"),
      mode: "recent",
    },
  ];
  for (const item of items) {
    if (item.mode === current) {
      item.label = `$(check) ${item.label}`;
      item.description = `${vscode.l10n.t("Current")} · ${item.description}`;
    }
  }

  const selected = await vscode.window.showQuickPick(items, {
    title: vscode.l10n.t("Sort hosts"),
    placeHolder: vscode.l10n.t("Choose how hosts are ordered inside each group"),
  });
  if (!selected || selected.mode === current) {return;}

  await storage.setHostSortMode(selected.mode);
  tree.refresh();
  vscode.window.setStatusBarMessage(
    vscode.l10n.t("$(check) SSH Kit host order: {mode}", { mode: stripCodicon(selected.label) }),
    3000
  );
}

function stripCodicon(label: string): string {
  return label.replace(/^\$\([^)]*\)\s*/, "");
}
