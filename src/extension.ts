// SSH Kit — Entry point (activation, helpers, command registration)
import * as vscode from "vscode";
import { SSHHost, SSHGroup } from "./core/types";
import { StorageService } from "./core/storage";
import { GroupItem, HostItem, HostTreeDataProvider, HostDragAndDropController } from "./views/treeView";
import { KeyTreeDataProvider, KeyItem } from "./views/keyTreeView";
import { readPublicKey, deleteKeyPair, renameKeyPair } from "./keys/keyManager";
import { getErrorMessage } from "./core/utils";
import { connectHostInCurrentWindow, connectHostInNewWindow, promptTerminalConnect, testConnection, searchHosts } from "./commands/connectCommands";
import { addHost, editHost, deleteHost, copyHostName, deduplicateHosts, batchDeleteHosts } from "./commands/hostCommands";
import { addGroup, renameGroup, deleteGroup } from "./commands/groupCommands";
import { importConfig, exportConfig, openSshConfig, backupKitData, restoreKitData } from "./commands/ioCommands";
import { showKeyList, generateKey } from "./commands/keyCommands";
import { listKeys } from "./keys/keyManager";

// ─── Interaction helpers ──────────────────────────────────────────────────

/** Single-step input configuration */
interface InputStep {
  prompt: string;
  placeHolder: string;
  value?: string;
  validate: (v: string) => string | undefined;
}

/** Generic single-step input: returns undefined on cancel */
async function promptInput(step: InputStep): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt: step.prompt,
    placeHolder: step.placeHolder,
    value: step.value,
    validateInput: step.validate,
  });
}

/** Multi-step input collection: create or edit a host */
async function promptNewHost(
  storage: StorageService,
  prefill?: Partial<SSHHost>
): Promise<Omit<SSHHost, "id"> | undefined> {
  const name = await promptInput({
    prompt: "主机显示名称",
    placeHolder: "如 es-node1",
    value: prefill?.name,
    validate: (v) => (v.trim() ? undefined : "名称不能为空"),
  });
  if (name === undefined) {return;}

  const hostname = await promptInput({
    prompt: "主机地址（IP 或域名）",
    placeHolder: "如 10.0.1.11 或 my.server.com",
    value: prefill?.hostname,
    validate: (v) => {
      const t = v.trim();
      if (!t) {return "地址不能为空";}
      if (/\s/.test(t)) {return "地址不能包含空格";}
      // IPv4
      const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
      const m = t.match(ipv4);
      if (m) {
        if (m.slice(1).some((o) => +o > 255)) {return "IP 每段不超过 255";}
        return undefined;
      }
      // Hostname or domain (alphanumeric, hyphens, dots)
      if (/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(t)) {
        return undefined;
      }
      return "请输入合法的 IP 地址或域名";
    },
  });
  if (hostname === undefined) {return;}

  const portStr = await promptInput({
    prompt: "SSH 端口",
    placeHolder: "22",
    value: String(prefill?.port ?? 22),
    validate: (v) => {
      if (!/^\d+$/.test(v)) {return "请输入数字";}
      const p = parseInt(v, 10);
      if (p < 1 || p > 65535) {return "端口范围 1-65535";}
      return undefined;
    },
  });
  if (portStr === undefined) {return;}

  const username = await promptInput({
    prompt: "登录用户名",
    placeHolder: "如 root",
    value: prefill?.username ?? "root",
    validate: (v) => {
      const t = v.trim();
      if (!t) {return "用户名不能为空";}
      // SSH username convention: lowercase letters, digits, underscores, hyphens only
      if (!/^[a-z_][a-z0-9_-]*$/.test(t)) {
        return "仅允许小写字母、数字、下划线、连字符（字母开头）";
      }
      return undefined;
    },
  });
  if (username === undefined) {return;}

  // Select group (optional)
  const groupId = await promptGroup(storage, prefill?.groupId);
  if (groupId === null) {return;} // User cancelled

  // Select associated key (optional)
  const identityFile = await promptIdentityFile(prefill?.identityFile);
  if (identityFile === null) {return;}

  return {
    name: name.trim(),
    hostname: hostname.trim(),
    port: parseInt(portStr, 10),
    username: username.trim(),
    groupId: groupId || undefined,
    identityFile: identityFile || undefined,
    tags: prefill?.tags ?? [],
  };
}

/**
 * Key selection step.
 * @returns null on cancel, "" for no key, private key path when selected
 */
async function promptIdentityFile(
  prefillPath?: string
): Promise<string | null> {
  const keys = listKeys();
  if (keys.length === 0) {return prefillPath ?? "";}

  const items: (vscode.QuickPickItem & { path?: string })[] = [
    { label: "$(circle-slash) 不关联密钥", path: "" },
    ...keys.map((k) => ({
      label: `$(key) ${k.name}`,
      description: k.type,
      detail: k.privateKeyPath,
      path: k.privateKeyPath,
    })),
  ];

  // Pre-select currently associated key when editing
  let activeItem: (typeof items)[number] | undefined;
  if (prefillPath) {
    activeItem = items.find((it) => it.path === prefillPath);
  }

  const quickPick = vscode.window.createQuickPick<(typeof items)[number]>();
  quickPick.items = items;
  if (activeItem) { quickPick.activeItems = [activeItem]; }
  quickPick.placeholder = "选择关联密钥（可选）";

  const picked = await new Promise<(typeof items)[number] | undefined>((resolve) => {
    let resolved = false;
    quickPick.onDidAccept(() => {
      resolved = true;
      quickPick.hide();
      resolve(quickPick.selectedItems[0]);
    });
    quickPick.onDidHide(() => {
      quickPick.dispose();
      if (!resolved) {resolve(undefined);}
    });
    quickPick.show();
  });

  if (picked === undefined) {return null;} // Cancel
  return picked.path ?? "";
}

/**
 * Group selection step.
 * @returns null on cancel, "" for no group, group ID when selected
 */
async function promptGroup(
  storage: StorageService,
  prefillGroupId?: string
): Promise<string | null> {
  const groups = storage.getGroups();
  if (groups.length === 0) {return prefillGroupId ?? "";}

  const items: (vscode.QuickPickItem & { group?: SSHGroup })[] = [
    { label: "$(circle-slash) 不分组", group: undefined },
    ...groups.map((g) => ({ label: `$(folder) ${g.name}`, group: g })),
  ];

  // Pre-select current group when editing
  let activeItem: (typeof items)[number] | undefined;
  if (prefillGroupId) {
    activeItem = items.find((it) => it.group?.id === prefillGroupId);
  }

  const quickPick = vscode.window.createQuickPick<(typeof items)[number]>();
  quickPick.items = items;
  if (activeItem) { quickPick.activeItems = [activeItem]; }
  quickPick.placeholder = "选择分组（可选）";

  const picked = await new Promise<(typeof items)[number] | undefined>((resolve) => {
    let resolved = false;
    quickPick.onDidAccept(() => {
      resolved = true;
      quickPick.hide();
      resolve(quickPick.selectedItems[0]);
    });
    quickPick.onDidHide(() => {
      quickPick.dispose();
      if (!resolved) {resolve(undefined);}
    });
    quickPick.show();
  });

  if (picked === undefined) {return null;} // User cancelled
  return picked.group?.id ?? ""; // undefined → "" (no group)
}

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
  console.log("SSH Kit activated");

  const storage = new StorageService(context);
  const treeDataProvider = new HostTreeDataProvider(storage);
  const keyTreeDataProvider = new KeyTreeDataProvider();
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

  // Persist group collapse state
  context.subscriptions.push(
    treeView.onDidCollapseElement((e) => {
      if (e.element instanceof GroupItem) {
        storage.setGroupCollapsedState(e.element.group.id, true);
      }
    }),
    treeView.onDidExpandElement((e) => {
      if (e.element instanceof GroupItem) {
        storage.setGroupCollapsedState(e.element.group.id, false);
      }
    })
  );

  // Register commands by category
  registerCoreCommands(context, treeDataProvider, keyTreeDataProvider);
  registerHostCommands(context, storage, treeDataProvider);
  registerGroupCommands(context, storage, treeDataProvider);
  registerConnectCommands(context, storage);
  registerIOCommands(context, storage, treeDataProvider, keyTreeDataProvider);
  registerKeyCommands(context, keyTreeDataProvider);
}

/** Core command: refresh */
function registerCoreCommands(
  context: vscode.ExtensionContext,
  tree: HostTreeDataProvider,
  keyTree: KeyTreeDataProvider
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("sshKit.refresh", () => {
      tree.refresh();
      keyTree.refresh();
    })
  );
}

/** Host CRUD, dedup, and batch delete */
function registerHostCommands(
  context: vscode.ExtensionContext,
  storage: StorageService,
  tree: HostTreeDataProvider
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("sshKit.addHost", () =>
      addHost(storage, tree, promptNewHost)
    ),
    vscode.commands.registerCommand(
      "sshKit.editHost",
      (arg: HostItem | SSHHost) =>
        editHost(unwrapHost(arg), storage, tree, promptNewHost)
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
    vscode.commands.registerCommand("sshKit.deduplicateHosts", () =>
      deduplicateHosts(storage, tree)
    ),
    vscode.commands.registerCommand("sshKit.batchDeleteHosts", () =>
      batchDeleteHosts(storage, tree)
    )
  );
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
  storage: StorageService
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "sshKit.connectHostInCurrentWindow",
      (arg: HostItem | SSHHost) =>
        connectHostInCurrentWindow(unwrapHost(arg), storage)
    ),
    vscode.commands.registerCommand(
      "sshKit.connectHostInNewWindow",
      (arg: HostItem | SSHHost) =>
        connectHostInNewWindow(unwrapHost(arg), storage)
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

    // View details (for context menu)
    vscode.commands.registerCommand(
      "sshKit.showKeyDetail",
      (item: KeyItem) => {
        const k = item.key;
        const lines = [
          `密钥：${k.name}`,
          `类型：${k.type}`,
          k.fingerprint ? `指纹：${k.fingerprint}` : "",
          `私钥：${k.privateKeyPath}`,
          k.publicKeyPath ? `公钥：${k.publicKeyPath}` : "⚠ 缺少公钥文件",
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
          vscode.window.showErrorMessage("该密钥没有公钥文件。");
          return;
        }
        try {
          const pubKey = readPublicKey(key.publicKeyPath);
          await vscode.env.clipboard.writeText(pubKey);
          vscode.window.showInformationMessage(`已复制 ${key.name} 的公钥。`);
        } catch (err: unknown) {
          vscode.window.showErrorMessage(`复制失败：${getErrorMessage(err)}`);
        }
      }
    ),

    // Delete key
    vscode.commands.registerCommand(
      "sshKit.deleteKey",
      async (item: KeyItem) => {
        const key = item.key;
        const confirmed = await vscode.window.showWarningMessage(
          `确定删除密钥「${key.name}」？此操作不可撤销。`,
          { modal: true },
          "删除"
        );
        if (confirmed !== "删除") {return;}
        try {
          deleteKeyPair(key.privateKeyPath);
          keyTree.refresh();
          vscode.window.showInformationMessage(`已删除密钥：${key.name}`);
        } catch (err: unknown) {
          vscode.window.showErrorMessage(`删除失败：${getErrorMessage(err)}`);
        }
      }
    ),

    // Rename key
    vscode.commands.registerCommand(
      "sshKit.renameKey",
      async (item: KeyItem) => {
        const key = item.key;
        const newName = await vscode.window.showInputBox({
          prompt: "新文件名（不含路径）",
          value: key.name,
          validateInput: (v) => {
            if (!v.trim()) {return "文件名不能为空";}
            if (/[\\/:"*?<>| ]/.test(v)) {return "文件名包含非法字符（含空格）";}
            return undefined;
          },
        });
        if (!newName || newName.trim() === key.name) {return;}
        try {
          renameKeyPair(key.privateKeyPath, newName.trim());
          keyTree.refresh();
          vscode.window.showInformationMessage(`已重命名：${key.name} → ${newName.trim()}`);
        } catch (err: unknown) {
          vscode.window.showErrorMessage(`重命名失败：${getErrorMessage(err)}`);
        }
      }
    ),

    // Command Palette entry (keep QuickPick approach)
    vscode.commands.registerCommand("sshKit.listKeys", () => showKeyList(keyTree)),
    vscode.commands.registerCommand("sshKit.generateKey", () => generateKey(keyTree))
  );
}

export function deactivate() {}
