// SSH Kit — Entry point (activation, helpers, command registration)
import * as vscode from "vscode";
import { SSHHost } from "./core/types";
import { StorageService } from "./core/storage";
import { GroupItem, HostDetailItem, HostItem, HostTreeDataProvider, HostDragAndDropController, RECENT_GROUP_ID } from "./views/treeView";
import { KeyTreeDataProvider, KeyItem, KeyDetailItem } from "./views/keyTreeView";
import { readPublicKey, deleteKeyPair, renameKeyPair, regeneratePublicKey, listKeys, populateFingerprints } from "./keys/keyManager";
import { getErrorMessage } from "./core/utils";
import { ConnectionStatusController } from "./core/connectionStatus";
import { connectHostInCurrentWindow, connectHostInNewWindow, promptTerminalConnect, testConnection, searchHosts, cleanupRemoteSshAliases } from "./commands/connectCommands";
import { addHost, editHost, deleteHost, copyHostName, copyHostDetail, deduplicateHosts, batchDeleteHosts, batchChangeHostKey, changeHostKey } from "./commands/hostCommands";
import { addGroup, renameGroup, deleteGroup } from "./commands/groupCommands";
import { importConfig, exportConfig, openSshConfig, backupKitData, restoreKitData } from "./commands/ioCommands";
import { showKeyList, generateKey } from "./commands/keyCommands";
import { registerAIHostTools } from "./ai/hostTool";
import { promptEditHost, promptNewHost } from "./commands/hostPrompts";

// ─── Utility functions ────────────────────────────────────────────────────

/**
 * Extract SSHHost from TreeView callback arguments.
 * Context menus / inline buttons pass HostItem (TreeItem);
 * Command Palette may pass SSHHost directly. Unwrap uniformly.
 */
function unwrapHost(arg: HostItem | SSHHost): SSHHost {
  return arg instanceof HostItem ? arg.host : arg;
}

// ─── Extension activation ─────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  const storage = new StorageService(context);
  const treeDataProvider = new HostTreeDataProvider(storage);
  const keyTreeDataProvider = new KeyTreeDataProvider();
  const connectionStatus = new ConnectionStatusController(storage, treeDataProvider);
  const dragController = new HostDragAndDropController(storage, () => treeDataProvider.refresh());

  const treeView = vscode.window.createTreeView("sshKit.hosts", {
    treeDataProvider,
    showCollapseAll: true,
    dragAndDropController: dragController,
  });
  context.subscriptions.push(treeView);

  const keyTreeView = vscode.window.createTreeView("sshKit.keys", {
    treeDataProvider: keyTreeDataProvider,
  });
  context.subscriptions.push(keyTreeView);
  context.subscriptions.push(connectionStatus);

  // Persist group collapse state
  context.subscriptions.push(
    treeView.onDidCollapseElement((e) => {
      if (e.element instanceof GroupItem && e.element.group.id !== RECENT_GROUP_ID) {
        storage.setGroupCollapsedState(e.element.group.id, true);
      }
    }),
    treeView.onDidExpandElement((e) => {
      if (e.element instanceof GroupItem && e.element.group.id !== RECENT_GROUP_ID) {
        storage.setGroupCollapsedState(e.element.group.id, false);
      }
    })
  );

  // Register commands by category
  registerCoreCommands(context, treeDataProvider, keyTreeDataProvider, connectionStatus);
  registerHostCommands(context, storage, treeDataProvider, treeView);
  registerGroupCommands(context, storage, treeDataProvider);
  registerConnectCommands(context, storage, connectionStatus);
  registerIOCommands(context, storage, treeDataProvider, keyTreeDataProvider);
  registerKeyCommands(context, keyTreeDataProvider);
  registerAIHostTools(context, storage);
}

/** Core command: refresh */
function registerCoreCommands(
  context: vscode.ExtensionContext,
  tree: HostTreeDataProvider,
  keyTree: KeyTreeDataProvider,
  connectionStatus: ConnectionStatusController
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("sshKit.refresh", () => {
      void connectionStatus.refresh();
      tree.refresh();
      keyTree.refresh();
    })
  );
}

/** Host CRUD, dedup, and batch delete */
function registerHostCommands(
  context: vscode.ExtensionContext,
  storage: StorageService,
  tree: HostTreeDataProvider,
  treeView: vscode.TreeView<vscode.TreeItem>
): void {
  context.subscriptions.push(
    tree.onDidChangeTreeData(() => updateHostFilterMessage(tree, treeView)),
    vscode.commands.registerCommand("sshKit.addHost", () =>
      addHost(storage, tree, promptNewHost)
    ),
    vscode.commands.registerCommand(
      "sshKit.editHost",
      (arg: HostItem | SSHHost) =>
        editHost(unwrapHost(arg), storage, tree, promptEditHost)
    ),
    vscode.commands.registerCommand(
      "sshKit.deleteHost",
      (arg: HostItem | SSHHost) =>
        deleteHost(unwrapHost(arg), storage, tree)
    ),
    vscode.commands.registerCommand(
      "sshKit.copyHostName",
      (arg: HostItem | SSHHost) => copyHostName(unwrapHost(arg))
    ),
    vscode.commands.registerCommand(
      "sshKit.copyHostDetail",
      (item: HostDetailItem | undefined) => {
        if (!item) {
          vscode.window.showInformationMessage(vscode.l10n.t("Use Copy on a host detail item."));
          return;
        }
        return copyHostDetail(item.detailLabel, item.detailValue);
      }
    ),
    vscode.commands.registerCommand("sshKit.deduplicateHosts", () =>
      deduplicateHosts(storage, tree)
    ),
    vscode.commands.registerCommand("sshKit.batchDeleteHosts", () =>
      batchDeleteHosts(storage, tree)
    ),
    vscode.commands.registerCommand("sshKit.batchChangeHostKey", () =>
      batchChangeHostKey(storage, tree)
    ),
    vscode.commands.registerCommand("sshKit.filterHosts", async () => {
      const query = await vscode.window.showInputBox({
        title: vscode.l10n.t("Filter SSH hosts"),
        prompt: vscode.l10n.t("Match host alias, IP / HostName, user, port, group, or tags. Separate multiple terms with spaces."),
        placeHolder: vscode.l10n.t("For example: 10.0.1 prod or nginx root"),
        value: tree.getFilterQuery(),
      });
      if (query === undefined) {return;}
      await applyHostFilter(query, tree, treeView);
    }),
    vscode.commands.registerCommand("sshKit.clearHostFilter", () =>
      applyHostFilter("", tree, treeView)
    ),
    vscode.commands.registerCommand(
      "sshKit.changeHostKey",
      (arg?: HostItem | SSHHost) => {
        if (!arg) {
          vscode.window.showInformationMessage(vscode.l10n.t("Run this command on a host, or use the batch identity-file command."));
          return;
        }
        return changeHostKey(unwrapHost(arg), storage, tree);
      }
    )
  );
}

async function applyHostFilter(
  query: string,
  tree: HostTreeDataProvider,
  treeView: vscode.TreeView<vscode.TreeItem>
): Promise<void> {
  tree.setFilterQuery(query);
  updateHostFilterMessage(tree, treeView);
  await vscode.commands.executeCommand("setContext", "sshKit.hostFilterActive", Boolean(tree.getFilterQuery()));
}

function updateHostFilterMessage(
  tree: HostTreeDataProvider,
  treeView: vscode.TreeView<vscode.TreeItem>
): void {
  const normalized = tree.getFilterQuery();
  const count = tree.getFilteredHostCount();
  treeView.message = normalized
    ? count > 0
      ? vscode.l10n.t("Filter “{query}”: {count} hosts", { query: normalized, count })
      : vscode.l10n.t("Filter “{query}”: no matching hosts", { query: normalized })
    : undefined;
}

/** Group management */
function registerGroupCommands(
  context: vscode.ExtensionContext,
  storage: StorageService,
  tree: HostTreeDataProvider
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("sshKit.addGroup", () =>
      addGroup(storage, tree)
    ),
    vscode.commands.registerCommand(
      "sshKit.renameGroup",
      (group: GroupItem) => renameGroup(group, storage, tree)
    ),
    vscode.commands.registerCommand(
      "sshKit.deleteGroup",
      (group: GroupItem) => deleteGroup(group, storage, tree)
    )
  );
}

/** Connection, connectivity test, and search */
function registerConnectCommands(
  context: vscode.ExtensionContext,
  storage: StorageService,
  connectionStatus: ConnectionStatusController
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "sshKit.connectHostInCurrentWindow",
      async (arg: HostItem | SSHHost) => {
        await connectHostInCurrentWindow(unwrapHost(arg), storage);
        await connectionStatus.refresh();
      }
    ),
    vscode.commands.registerCommand(
      "sshKit.connectHostInNewWindow",
      async (arg: HostItem | SSHHost) => {
        await connectHostInNewWindow(unwrapHost(arg), storage);
        await connectionStatus.refresh({ claimPending: false });
      }
    ),
    vscode.commands.registerCommand(
      "sshKit.testConnection",
      (arg: HostItem | SSHHost) => testConnection(unwrapHost(arg))
    ),
    vscode.commands.registerCommand(
      "sshKit.connectInExternalTerminal",
      (arg: HostItem | SSHHost) =>
        promptTerminalConnect(unwrapHost(arg), storage)
    ),
    vscode.commands.registerCommand("sshKit.searchHosts", () =>
      searchHosts(storage)
    ),
    vscode.commands.registerCommand("sshKit.showCurrentConnection", () =>
      connectionStatus.showDetails()
    )
  );
}

/** SSH Config import/export and backup/restore */
function registerIOCommands(
  context: vscode.ExtensionContext,
  storage: StorageService,
  tree: HostTreeDataProvider,
  keyTree: KeyTreeDataProvider
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("sshKit.importConfig", () =>
      importConfig(storage, tree)
    ),
    vscode.commands.registerCommand("sshKit.exportConfig", () =>
      exportConfig(storage)
    ),
    vscode.commands.registerCommand("sshKit.openSshConfig", () =>
      openSshConfig()
    ),
    vscode.commands.registerCommand("sshKit.backupData", () =>
      backupKitData(storage)
    ),
    vscode.commands.registerCommand("sshKit.restoreData", () =>
      restoreKitData(storage, tree, keyTree)
    ),
    vscode.commands.registerCommand("sshKit.cleanupAliases", () =>
      cleanupRemoteSshAliases(storage)
    )
  );
}

/** Key management */
function registerKeyCommands(
  context: vscode.ExtensionContext,
  keyTree: KeyTreeDataProvider
): void {
  context.subscriptions.push(
    // Open key file on click (prefer public key)
    vscode.commands.registerCommand(
      "sshKit.openKeyFile",
      async (item: KeyItem) => {
        const filePath = item.key.publicKeyPath ?? item.key.privateKeyPath;
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc);
      }
    ),

    // View private key (for context menu)
    vscode.commands.registerCommand(
      "sshKit.openPrivateKey",
      async (item: KeyItem) => {
        const doc = await vscode.workspace.openTextDocument(item.key.privateKeyPath);
        await vscode.window.showTextDocument(doc);
      }
    ),

    vscode.commands.registerCommand(
      "sshKit.copyKeyDetail",
      async (item: KeyDetailItem | undefined) => {
        if (!item) {
          vscode.window.showInformationMessage(vscode.l10n.t("Use Copy on a key detail item."));
          return;
        }
        await vscode.env.clipboard.writeText(item.detailValue);
        vscode.window.showInformationMessage(vscode.l10n.t("Copied {label}: {value}", {
          label: item.detailLabel,
          value: item.detailValue,
        }));
      }
    ),

    // View details (for context menu)
    vscode.commands.registerCommand(
      "sshKit.showKeyDetail",
      (item: KeyItem) => {
        const k = item.key;
        const lines = [
          vscode.l10n.t("Key: {name}", { name: k.name }),
          vscode.l10n.t("Type: {type}", { type: k.type }),
          k.fingerprint ? vscode.l10n.t("Fingerprint: {fingerprint}", { fingerprint: k.fingerprint }) : "",
          vscode.l10n.t("Private key: {path}", { path: k.privateKeyPath }),
          k.publicKeyPath
            ? vscode.l10n.t("Public key: {path}", { path: k.publicKeyPath })
            : vscode.l10n.t("⚠ Public key file is missing"),
        ].filter(Boolean);
        vscode.window.showInformationMessage(lines.join("\n"), { modal: false });
      }
    ),

    // Copy public key (shared by inline button and context menu)
    vscode.commands.registerCommand(
      "sshKit.copyKeyPublic",
      async (item: KeyItem) => {
        const key = item.key;
        if (!key.publicKeyPath) {
          vscode.window.showErrorMessage(vscode.l10n.t("This key has no public key file."));
          return;
        }
        try {
          const pubKey = readPublicKey(key.publicKeyPath);
          await vscode.env.clipboard.writeText(pubKey);
          vscode.window.showInformationMessage(vscode.l10n.t("Copied the public key for {name}.", { name: key.name }));
        } catch (err: unknown) {
          vscode.window.showErrorMessage(vscode.l10n.t("Copy failed: {error}", { error: getErrorMessage(err) }));
        }
      }
    ),

    vscode.commands.registerCommand(
      "sshKit.regenerateKeyPublic",
      async (item?: KeyItem) => {
        const keyItem = item ?? await pickKeyForPublicRegeneration();
        if (!keyItem) {return;}

        const key = keyItem.key;
        const hasPublicKey = Boolean(key.publicKeyPath);
        if (hasPublicKey) {
          const regenerateAction = vscode.l10n.t("Regenerate");
          const confirmed = await vscode.window.showWarningMessage(
            vscode.l10n.t("The public key file already exists. Regenerate and overwrite “{name}.pub”?", { name: key.name }),
            { modal: true },
            regenerateAction
          );
          if (confirmed !== regenerateAction) {return;}
        }
        try {
          const publicKeyPath = regeneratePublicKey(key.privateKeyPath, hasPublicKey);
          keyTree.refresh();
          vscode.window.showInformationMessage(vscode.l10n.t("Generated public key: {path}", { path: publicKeyPath }));
        } catch (err: unknown) {
          vscode.window.showErrorMessage(vscode.l10n.t("Public key generation failed: {error}", { error: getErrorMessage(err) }));
        }
      }
    ),

    // Delete key
    vscode.commands.registerCommand(
      "sshKit.deleteKey",
      async (item: KeyItem) => {
        const key = item.key;
        const deleteAction = vscode.l10n.t("Delete");
        const confirmed = await vscode.window.showWarningMessage(
          vscode.l10n.t("Delete key “{name}”? This cannot be undone.", { name: key.name }),
          { modal: true },
          deleteAction
        );
        if (confirmed !== deleteAction) {return;}
        try {
          deleteKeyPair(key.privateKeyPath);
          keyTree.refresh();
          vscode.window.showInformationMessage(vscode.l10n.t("Deleted key: {name}", { name: key.name }));
        } catch (err: unknown) {
          vscode.window.showErrorMessage(vscode.l10n.t("Delete failed: {error}", { error: getErrorMessage(err) }));
        }
      }
    ),

    // Rename key
    vscode.commands.registerCommand(
      "sshKit.renameKey",
      async (item: KeyItem) => {
        const key = item.key;
        const newName = await vscode.window.showInputBox({
          prompt: vscode.l10n.t("New file name (without a path)"),
          value: key.name,
          validateInput: (v) => {
            if (!v.trim()) {return vscode.l10n.t("File name is required");}
            if (/[\\/:"*?<>| ]/.test(v)) {return vscode.l10n.t("File name contains invalid characters or spaces");}
            return undefined;
          },
        });
        if (!newName || newName.trim() === key.name) {return;}
        try {
          renameKeyPair(key.privateKeyPath, newName.trim());
          keyTree.refresh();
          vscode.window.showInformationMessage(vscode.l10n.t("Renamed: {oldName} → {newName}", {
            oldName: key.name,
            newName: newName.trim(),
          }));
        } catch (err: unknown) {
          vscode.window.showErrorMessage(vscode.l10n.t("Rename failed: {error}", { error: getErrorMessage(err) }));
        }
      }
    ),

    // Command Palette entry (keep QuickPick approach)
    vscode.commands.registerCommand("sshKit.listKeys", () => showKeyList(keyTree)),
    vscode.commands.registerCommand("sshKit.generateKey", () => generateKey(keyTree))
  );
}

async function pickKeyForPublicRegeneration(): Promise<KeyItem | undefined> {
  const keys = listKeys();
  if (keys.length === 0) {
    vscode.window.showInformationMessage(vscode.l10n.t("No SSH keys were found. Run “SSH Kit: Generate SSH Key” to create one."));
    return undefined;
  }

  populateFingerprints(keys);
  const picked = await vscode.window.showQuickPick(
    keys.map((key) => ({
      label: `$(key) ${key.name}`,
      description: [
        key.type === "unknown" ? vscode.l10n.t("Unknown") : key.type,
        key.publicKeyPath ? vscode.l10n.t("Public key available") : vscode.l10n.t("Public key missing"),
      ].join(" · "),
      detail: key.privateKeyPath,
      key,
    })),
    {
      matchOnDescription: true,
      matchOnDetail: true,
      placeHolder: vscode.l10n.t("Choose a key whose public key should be regenerated"),
    }
  );

  return picked ? new KeyItem(picked.key) : undefined;
}

export function deactivate() {}
