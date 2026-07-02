// SSH Kit — Entry point (activation, helpers, command registration)
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { SSHHost, SSHGroup } from "./core/types";
import { StorageService } from "./core/storage";
import { GroupItem, HostDetailItem, HostItem, HostTreeDataProvider, HostDragAndDropController, RECENT_GROUP_ID } from "./views/treeView";
import { KeyTreeDataProvider, KeyItem, KeyDetailItem } from "./views/keyTreeView";
import { readPublicKey, deleteKeyPair, renameKeyPair, regeneratePublicKey, listKeys, populateFingerprints } from "./keys/keyManager";
import { getErrorMessage } from "./core/utils";
import { findHostByRemoteSshAlias, connectHostInCurrentWindow, connectHostInNewWindow, promptTerminalConnect, testConnection, searchHosts, cleanupRemoteSshAliases } from "./commands/connectCommands";
import { addHost, editHost, deleteHost, copyHostName, copyHostDetail, deduplicateHosts, batchDeleteHosts, batchChangeHostKey } from "./commands/hostCommands";
import { addGroup, renameGroup, deleteGroup } from "./commands/groupCommands";
import { importConfig, exportConfig, openSshConfig, backupKitData, restoreKitData } from "./commands/ioCommands";
import { showKeyList, generateKey } from "./commands/keyCommands";

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

function validateRequiredName(v: string): string | undefined {
  return v.trim() ? undefined : "名称不能为空";
}

function validateHostAddress(v: string): string | undefined {
  const t = v.trim();
  if (!t) {return "地址不能为空";}
  if (/\s/.test(t)) {return "地址不能包含空格";}

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const m = t.match(ipv4);
  if (m) {
    if (m.slice(1).some((o) => +o > 255)) {return "IP 每段不超过 255";}
    return undefined;
  }

  if (/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(t)) {
    return undefined;
  }
  return "请输入合法的 IP 地址或域名";
}

function validatePort(v: string): string | undefined {
  if (!/^\d+$/.test(v)) {return "请输入数字";}
  const p = parseInt(v, 10);
  if (p < 1 || p > 65535) {return "端口范围 1-65535";}
  return undefined;
}

function validateUsername(v: string): string | undefined {
  const t = v.trim();
  if (!t) {return "用户名不能为空";}
  if (!/^[a-z_][a-z0-9_-]*$/.test(t)) {
    return "仅允许小写字母、数字、下划线、连字符（字母开头）";
  }
  return undefined;
}

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
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
    validate: validateRequiredName,
  });
  if (name === undefined) {return;}

  const hostname = await promptInput({
    prompt: "主机地址（IP 或域名）",
    placeHolder: "如 10.0.1.11 或 my.server.com",
    value: prefill?.hostname,
    validate: validateHostAddress,
  });
  if (hostname === undefined) {return;}

  const portStr = await promptInput({
    prompt: "SSH 端口",
    placeHolder: "22",
    value: String(prefill?.port ?? 22),
    validate: validatePort,
  });
  if (portStr === undefined) {return;}

  const username = await promptInput({
    prompt: "登录用户名",
    placeHolder: "如 root",
    value: prefill?.username ?? "root",
    validate: validateUsername,
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
    extraConfig: prefill?.extraConfig,
  };
}

/** Single-field edit flow for an existing host */
async function promptEditHost(
  storage: StorageService,
  host: SSHHost
): Promise<Partial<Omit<SSHHost, "id">> | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: "$(symbol-string) 名称", description: host.name, key: "name" },
      { label: "$(globe) 主机地址", description: host.hostname, key: "hostname" },
      { label: "$(remote) 端口", description: String(host.port), key: "port" },
      { label: "$(person) 用户名", description: host.username, key: "username" },
      {
        label: "$(folder) 分组",
        description: storage.getGroups().find((g) => g.id === host.groupId)?.name ?? "未分组",
        key: "group",
      },
      { label: "$(key) 认证文件", description: host.identityFile ?? "未关联", key: "identityFile" },
      { label: "$(tag) 标签", description: host.tags.length > 0 ? host.tags.join(", ") : "无", key: "tags" },
      { label: "$(edit) 完整编辑", description: "按旧向导逐项检查所有字段", key: "full" },
    ],
    { placeHolder: `选择要修改的字段：${host.name}` }
  );
  if (!picked) {return;}

  switch (picked.key) {
    case "name": {
      const value = await promptInput({
        prompt: "主机显示名称",
        placeHolder: "如 es-node1",
        value: host.name,
        validate: validateRequiredName,
      });
      return value === undefined ? undefined : { name: value.trim() };
    }
    case "hostname": {
      const value = await promptInput({
        prompt: "主机地址（IP 或域名）",
        placeHolder: "如 10.0.1.11 或 my.server.com",
        value: host.hostname,
        validate: validateHostAddress,
      });
      return value === undefined ? undefined : { hostname: value.trim() };
    }
    case "port": {
      const value = await promptInput({
        prompt: "SSH 端口",
        placeHolder: "22",
        value: String(host.port),
        validate: validatePort,
      });
      return value === undefined ? undefined : { port: parseInt(value, 10) };
    }
    case "username": {
      const value = await promptInput({
        prompt: "登录用户名",
        placeHolder: "如 root",
        value: host.username,
        validate: validateUsername,
      });
      return value === undefined ? undefined : { username: value.trim() };
    }
    case "group": {
      const groupId = await promptGroup(storage, host.groupId);
      return groupId === null ? undefined : { groupId: groupId || undefined };
    }
    case "identityFile": {
      const identityFile = await promptIdentityFile(host.identityFile);
      return identityFile === null ? undefined : { identityFile: identityFile || undefined };
    }
    case "tags": {
      const value = await vscode.window.showInputBox({
        prompt: "标签（英文逗号分隔）",
        placeHolder: "如 prod, gpu, cn-shanghai",
        value: host.tags.join(", "),
      });
      return value === undefined ? undefined : { tags: parseTags(value) };
    }
    case "full":
      return promptNewHost(storage, host);
  }
}

/**
 * Key selection step.
 * @returns null on cancel, "" for no key, private key path when selected
 */
async function promptIdentityFile(
  prefillPath?: string
): Promise<string | null> {
  const keys = listKeys();
  if (keys.length === 0 && !prefillPath) {return "";}

  const matchingKey = prefillPath
    ? keys.find((k) => areIdentityPathsEquivalent(prefillPath, k.privateKeyPath))
    : undefined;
  const shouldShowCurrentPath = Boolean(
    prefillPath && (!matchingKey || matchingKey.privateKeyPath !== prefillPath)
  );

  const items: (vscode.QuickPickItem & { path?: string })[] = [
    { label: "$(circle-slash) 不关联密钥", path: "" },
  ];

  let activeItem: (typeof items)[number] | undefined;
  if (prefillPath && shouldShowCurrentPath) {
    activeItem = {
      label: "$(key) 当前配置",
      description: "保留原路径",
      detail: prefillPath,
      path: prefillPath,
    };
    items.push(activeItem);
  }

  const keyItems = keys.map((k) => ({
      label: `$(key) ${k.name}`,
      description: matchingKey?.privateKeyPath === k.privateKeyPath ? `${k.type} · 匹配当前配置` : k.type,
      detail: k.privateKeyPath,
      path: k.privateKeyPath,
    }));
  items.push(...keyItems);

  // Pre-select currently associated key when editing
  if (!activeItem && matchingKey) {
    activeItem = items.find((it) => it.path === matchingKey.privateKeyPath);
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
      resolve(quickPick.selectedItems[0] ?? quickPick.activeItems[0]);
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

function areIdentityPathsEquivalent(left: string, right: string): boolean {
  const leftCandidates = identityPathCompareCandidates(left);
  const rightCandidates = identityPathCompareCandidates(right);
  return leftCandidates.some((candidate) => rightCandidates.includes(candidate));
}

function identityPathCompareCandidates(filePath: string): string[] {
  const cleaned = stripWrappingQuotes(filePath.trim());
  if (!cleaned) {return [];}

  const candidates = new Set<string>();
  if (cleaned.startsWith("~/") || cleaned.startsWith("~\\")) {
    candidates.add(path.join(os.homedir(), cleaned.slice(2)));
  } else if (path.isAbsolute(cleaned)) {
    candidates.add(cleaned);
  } else {
    candidates.add(path.resolve(os.homedir(), cleaned));
    candidates.add(path.resolve(os.homedir(), ".ssh", cleaned));
  }

  return [...candidates].map(normalizeIdentityPathForCompare);
}

function normalizeIdentityPathForCompare(filePath: string): string {
  const normalized = path.normalize(filePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
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
      resolve(quickPick.selectedItems[0] ?? quickPick.activeItems[0]);
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

interface CurrentConnectionInfo {
  host: SSHHost;
  alias: string;
}

class ConnectionStatusController implements vscode.Disposable {
  private readonly statusItem: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  private current: CurrentConnectionInfo | undefined;

  constructor(
    private readonly storage: StorageService,
    private readonly tree: HostTreeDataProvider
  ) {
    this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    this.statusItem.name = "SSH Kit Connection";
    this.disposables.push(
      this.statusItem,
      vscode.workspace.onDidChangeWorkspaceFolders(() => { void this.refresh(); })
    );
    void this.refresh();
  }

  async refresh(options: { claimPending?: boolean } = {}): Promise<void> {
    this.current = await this.resolveCurrentConnection(options.claimPending ?? true);
    this.tree.setConnectedHostId(this.current?.host.id);
    this.updateStatusItem();
  }

  async showDetails(): Promise<void> {
    if (!this.current) {
      vscode.window.showInformationMessage("当前窗口未识别到 SSH Kit 连接。");
      return;
    }

    await vscode.env.clipboard.writeText(this.formatConnectionDetails(this.current.host, this.current.alias));
    vscode.window.setStatusBarMessage("$(check) SSH Kit: 已复制当前连接信息", 3000);
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private updateStatusItem(): void {
    if (!this.current) {
      this.statusItem.hide();
      return;
    }

    const { host, alias } = this.current;
    this.statusItem.text = `$(remote) SSH Kit: ${host.name}`;
    this.statusItem.tooltip = this.buildTooltip(host, alias);
    this.statusItem.show();
  }

  private buildTooltip(host: SSHHost, alias: string): vscode.MarkdownString {
    const details = this.formatConnectionDetails(host, alias);
    const tooltip = new vscode.MarkdownString(undefined, true);
    tooltip.supportThemeIcons = true;
    tooltip.appendMarkdown("$(remote) **SSH Kit 当前连接**\n\n");
    tooltip.appendCodeblock(details);
    return tooltip;
  }

  private formatConnectionDetails(host: SSHHost, alias: string): string {
    const connection = `${host.username}@${host.hostname}:${host.port}`;
    const groupName = host.groupId
      ? this.storage.getGroups().find((group) => group.id === host.groupId)?.name
      : undefined;
    return [
      `名称: ${host.name}`,
      `连接: ${connection}`,
      `地址: ${host.hostname}`,
      `端口: ${host.port}`,
      `用户: ${host.username}`,
      groupName ? `分组: ${groupName}` : "",
      host.identityFile ? `密钥: ${host.identityFile}` : "",
      host.tags.length > 0 ? `标签: ${host.tags.join(", ")}` : "",
      alias !== host.name ? `SSH Host: ${alias}` : "",
    ].filter(Boolean).join("\n");
  }

  private async resolveCurrentConnection(claimPending: boolean): Promise<CurrentConnectionInfo | undefined> {
    const hosts = this.storage.getAllHosts();
    const authority = getCurrentRemoteSshAuthority();
    if (authority) {
      const matchedByAuthority = findHostByRemoteAuthority(authority, hosts);
      if (matchedByAuthority) {
        await this.storage.setWindowConnection(matchedByAuthority.host.id, matchedByAuthority.alias);
        await this.storage.clearPendingWindowConnection(matchedByAuthority.host.id, matchedByAuthority.alias);
        return matchedByAuthority;
      }
    }

    if (claimPending && vscode.env.remoteName === "ssh-remote") {
      const claimed = await this.storage.claimPendingWindowConnection();
      const claimedHost = claimed ? hosts.find((item) => item.id === claimed.hostId) : undefined;
      if (claimedHost && claimed) {
        return { host: claimedHost, alias: claimed.alias };
      }
    }

    const windowConnection = this.storage.getWindowConnection();
    const windowHost = windowConnection
      ? hosts.find((item) => item.id === windowConnection.hostId)
      : undefined;
    if (windowHost && windowConnection) {
      return { host: windowHost, alias: windowConnection.alias };
    }

    return undefined;
  }
}

function getCurrentRemoteSshAuthority(): string | undefined {
  const remoteFolder = vscode.workspace.workspaceFolders?.find((folder) =>
    folder.uri.scheme === "vscode-remote" && folder.uri.authority.startsWith("ssh-remote+")
  );
  if (remoteFolder) {
    return decodeRemoteSshAuthority(remoteFolder.uri.authority);
  }

  const workspaceFile = vscode.workspace.workspaceFile;
  if (workspaceFile?.scheme === "vscode-remote" && workspaceFile.authority.startsWith("ssh-remote+")) {
    return decodeRemoteSshAuthority(workspaceFile.authority);
  }

  return undefined;
}

function decodeRemoteSshAuthority(authority: string): string {
  const raw = authority.slice("ssh-remote+".length);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function findHostByRemoteAuthority(
  alias: string,
  hosts: SSHHost[]
): CurrentConnectionInfo | undefined {
  const host = findHostByRemoteSshAlias(alias, hosts);
  return host ? { host, alias } : undefined;
}

// ─── Extension activation ─────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  console.log("SSH Kit activated");

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
  registerHostCommands(context, storage, treeDataProvider);
  registerGroupCommands(context, storage, treeDataProvider);
  registerConnectCommands(context, storage, connectionStatus);
  registerIOCommands(context, storage, treeDataProvider, keyTreeDataProvider);
  registerKeyCommands(context, keyTreeDataProvider);
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
  tree: HostTreeDataProvider
): void {
  context.subscriptions.push(
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
          vscode.window.showInformationMessage("请在主机详情项上使用复制。");
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
    vscode.commands.registerCommand(
      "sshKit.batchChangeHostKey",
      (arg?: HostItem | SSHHost) =>
        batchChangeHostKey(storage, tree, arg ? unwrapHost(arg) : undefined)
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
          vscode.window.showInformationMessage("请在密钥详情项上使用复制。");
          return;
        }
        await vscode.env.clipboard.writeText(item.detailValue);
        vscode.window.showInformationMessage(`已复制${item.detailLabel}：${item.detailValue}`);
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

    vscode.commands.registerCommand(
      "sshKit.regenerateKeyPublic",
      async (item?: KeyItem) => {
        const keyItem = item ?? await pickKeyForPublicRegeneration();
        if (!keyItem) {return;}

        const key = keyItem.key;
        const hasPublicKey = Boolean(key.publicKeyPath);
        if (hasPublicKey) {
          const confirmed = await vscode.window.showWarningMessage(
            `公钥文件已存在，确定重新生成并覆盖「${key.name}.pub」？`,
            { modal: true },
            "重新生成"
          );
          if (confirmed !== "重新生成") {return;}
        }
        try {
          const publicKeyPath = regeneratePublicKey(key.privateKeyPath, hasPublicKey);
          keyTree.refresh();
          vscode.window.showInformationMessage(`已生成公钥：${publicKeyPath}`);
        } catch (err: unknown) {
          vscode.window.showErrorMessage(`生成公钥失败：${getErrorMessage(err)}`);
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

async function pickKeyForPublicRegeneration(): Promise<KeyItem | undefined> {
  const keys = listKeys();
  if (keys.length === 0) {
    vscode.window.showInformationMessage("未找到 SSH 密钥。可以先使用「SSH Kit: 生成 SSH 密钥」新建。");
    return undefined;
  }

  populateFingerprints(keys);
  const picked = await vscode.window.showQuickPick(
    keys.map((key) => ({
      label: `$(key) ${key.name}`,
      description: [
        key.type === "unknown" ? "无法识别" : key.type,
        key.publicKeyPath ? "已有公钥" : "缺少公钥",
      ].join(" · "),
      detail: key.privateKeyPath,
      key,
    })),
    {
      matchOnDescription: true,
      matchOnDetail: true,
      placeHolder: "选择要重新生成公钥的密钥",
    }
  );

  return picked ? new KeyItem(picked.key) : undefined;
}

export function deactivate() {}
