// SSH Kit — Key tree view
import * as vscode from "vscode";
import { listKeys, populateFingerprints, KeyInfo } from "../keys/keyManager";

/** Detail child node for key properties */
export class KeyDetailItem extends vscode.TreeItem {
  constructor(
    public readonly detailLabel: string,
    public readonly detailValue: string,
    icon: string,
    command?: vscode.Command,
    copyable = true
  ) {
    const label = detailLabel;
    const value = detailValue;
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = value;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = copyable && value ? "keyDetail" : "keyDetailReadonly";
    this.tooltip = command
      ? vscode.l10n.t("{label}: {value}", { label, value })
      : copyable && value
        ? vscode.l10n.t("Click to copy {label}: {value}", { label, value })
        : label;
    this.command = command ?? (copyable && value
      ? {
          command: "sshKit.copyKeyDetail",
          title: vscode.l10n.t("Copy {label}", { label }),
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
      vscode.l10n.t("Type: {type}", { type: formatKeyType(key) }),
      key.publicKeyPath ? "" : vscode.l10n.t("Public key file is missing"),
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
      children.push(new KeyDetailItem(vscode.l10n.t("Type"), formatKeyType(k), "symbol-keyword"));
      if (k.type === "unknown") {
        children.push(new KeyDetailItem(
          vscode.l10n.t("Hint"),
          vscode.l10n.t("Key type could not be detected. Try regenerating the public key."),
          "warning"
        ));
      }

      // Fingerprint
      if (k.fingerprint) {
        children.push(new KeyDetailItem(vscode.l10n.t("Fingerprint"), k.fingerprint, "fingerprint"));
      }

      // Private key path — click to copy
      children.push(new KeyDetailItem(
        vscode.l10n.t("Private key"), k.privateKeyPath, "lock"
      ));
      children.push(new KeyDetailItem(
        vscode.l10n.t("Private key contents"),
        vscode.l10n.t("Click to open"),
        "go-to-file",
        {
          command: "sshKit.openPrivateKey",
          title: vscode.l10n.t("View private key contents"),
          arguments: [element],
        },
        false
      ));

      // Public key path — click to copy
      if (k.publicKeyPath) {
        children.push(new KeyDetailItem(
          vscode.l10n.t("Public key"), k.publicKeyPath, "key"
        ));
        children.push(new KeyDetailItem(
          vscode.l10n.t("Public key contents"),
          vscode.l10n.t("Click to open"),
          "go-to-file",
          {
            command: "sshKit.openKeyFile",
            title: vscode.l10n.t("View public key contents"),
            arguments: [element],
          },
          false
        ));
      } else {
        children.push(new KeyDetailItem(
          vscode.l10n.t("Public key"),
          vscode.l10n.t("Public key file is missing; right-click to regenerate it"),
          "warning"
        ));
      }

      return children;
    }

    return [];
  }
}

function formatKeySummary(key: KeyInfo): string {
  const parts = [formatKeyType(key)];
  if (!key.publicKeyPath) {
    parts.push(vscode.l10n.t("No public key"));
  }
  return parts.join(" · ");
}

function formatKeyType(key: KeyInfo): string {
  return key.type === "unknown" ? vscode.l10n.t("Unknown") : key.type;
}
