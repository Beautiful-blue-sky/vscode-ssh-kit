// SSH Kit — Key tree view
import * as vscode from "vscode";
import { listKeys, populateFingerprints, KeyInfo } from "../keys/keyManager";

/** Detail child node for key properties */
class KeyDetailItem extends vscode.TreeItem {
  constructor(label: string, value: string, icon: string, command?: vscode.Command) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = value;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.command = command;
  }
}

/** Key tree node — expand to view details, inline button to copy public key */
export class KeyItem extends vscode.TreeItem {
  constructor(public readonly key: KeyInfo) {
    super(key.name, vscode.TreeItemCollapsibleState.Collapsed);

    this.iconPath = key.publicKeyPath
      ? new vscode.ThemeIcon("key")
      : new vscode.ThemeIcon("warning");

    this.description = key.publicKeyPath ? "" : "缺公钥";

    this.contextValue = "key";
    this.tooltip = "点击展开查看详情";
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
      children.push(new KeyDetailItem("类型", k.type, "symbol-keyword"));

      // Fingerprint
      if (k.fingerprint) {
        children.push(new KeyDetailItem("指纹", k.fingerprint, "fingerprint"));
      }

      // Private key — click to open
      children.push(new KeyDetailItem(
        "私钥", k.privateKeyPath, "lock",
        {
          command: "sshKit.openPrivateKey",
          title: "打开私钥",
          arguments: [element],
        }
      ));

      // Public key — click to open
      if (k.publicKeyPath) {
        children.push(new KeyDetailItem(
          "公钥", k.publicKeyPath, "key",
          {
            command: "sshKit.openKeyFile",
            title: "打开公钥",
            arguments: [element],
          }
        ));
      } else {
        children.push(new KeyDetailItem("公钥", "⚠ 缺少公钥文件", "warning"));
      }

      return children;
    }

    return [];
  }
}
