// SSH Kit — Key tree view
import * as vscode from "vscode";
import { listKeys, populateFingerprints, KeyInfo } from "../keys/keyManager";

/** Detail child node for key properties */
export class KeyDetailItem extends vscode.TreeItem {
  constructor(
    public readonly detailLabel: string,
    public readonly detailValue: string,
    icon: string,
    command?: vscode.Command
  ) {
    const label = detailLabel;
    const value = detailValue;
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = value;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = value ? "keyDetail" : "keyDetailReadonly";
    this.tooltip = value ? `点击复制${label}：${value}` : label;
    this.command = command ?? (value
      ? {
          command: "sshKit.copyKeyDetail",
          title: `复制${label}`,
          arguments: [this],
        }
      : undefined);
  }
}

/** Key tree node — expand to view details, inline button to copy public key */
export class KeyItem extends vscode.TreeItem {
  constructor(public readonly key: KeyInfo) {
    super(key.name, vscode.TreeItemCollapsibleState.Collapsed);

    this.iconPath = key.publicKeyPath
      ? new vscode.ThemeIcon("key")
      : new vscode.ThemeIcon("warning");

    this.description = formatKeySummary(key);

    this.contextValue = "key";
    this.tooltip = [
      `类型：${formatKeyType(key)}`,
      key.publicKeyPath ? "" : "缺少公钥文件",
      key.privateKeyPath,
    ].filter(Boolean).join("\n");
  }
}

/** Key tree DataProvider */
export class KeyTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      const keys = listKeys();
      populateFingerprints(keys);
      return keys.map((k) => new KeyItem(k));
    }

    if (element instanceof KeyItem) {
      const k = element.key;
      const children: KeyDetailItem[] = [];

      // Key type
      children.push(new KeyDetailItem("类型", formatKeyType(k), "symbol-keyword"));
      if (k.type === "unknown") {
        children.push(new KeyDetailItem("提示", "无法识别密钥类型，可尝试重新生成公钥", "warning"));
      }

      // Fingerprint
      if (k.fingerprint) {
        children.push(new KeyDetailItem("指纹", k.fingerprint, "fingerprint"));
      }

      // Private key path — click to copy
      children.push(new KeyDetailItem(
        "私钥", k.privateKeyPath, "lock"
      ));

      // Public key path — click to copy
      if (k.publicKeyPath) {
        children.push(new KeyDetailItem(
          "公钥", k.publicKeyPath, "key"
        ));
      } else {
        children.push(new KeyDetailItem("公钥", "缺少公钥文件，可右键重新生成", "warning"));
      }

      return children;
    }

    return [];
  }
}

function formatKeySummary(key: KeyInfo): string {
  const parts = [formatKeyType(key)];
  if (!key.publicKeyPath) {
    parts.push("缺公钥");
  }
  return parts.join(" · ");
}

function formatKeyType(key: KeyInfo): string {
  return key.type === "unknown" ? "无法识别" : key.type;
}
