// SSH Kit — Connection, search, and connectivity test commands
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { SSHHost } from "../core/types";
import { StorageService } from "../core/storage";
import { getErrorMessage } from "../core/utils";

// ─── VS Code Remote-SSH connection ────────────────────────────────────────

/** Open Remote-SSH connection in the current window. */
export async function connectHostInCurrentWindow(
  host: SSHHost,
  storage: StorageService
): Promise<void> {
  await doConnect(host, storage, false);
}

/** Open Remote-SSH connection in a new window */
export async function connectHostInNewWindow(
  host: SSHHost,
  storage: StorageService
): Promise<void> {
  await doConnect(host, storage, true);
}

/** Shared Remote-SSH connection implementation */
async function doConnect(
  host: SSHHost,
  storage: StorageService,
  forceNewWindow: boolean
): Promise<void> {
  const windowTarget = await resolveWindowTarget(forceNewWindow);
  if (!windowTarget) {return;}

  const openInNewWindow = windowTarget.openInNewWindow;
  const hostSpec = formatHostSpec(host);
  const remoteDisplayLabel = buildRemoteDisplayLabel(host);
  const windowLabel = openInNewWindow ? "新窗口" : "当前窗口";
  const status = vscode.window.setStatusBarMessage(
    `$(sync~spin) SSH Kit: 正在打开 ${remoteDisplayLabel} (${hostSpec}) [${windowLabel} · 空窗口]...`
  );
  if (windowTarget.reason) {
    vscode.window.setStatusBarMessage(
      `$(info) SSH Kit: ${windowTarget.reason}`,
      7000
    );
  }

  await storage.addRecentConnection(host.id);

  try {
    if (!openInNewWindow) {
      await prepareCurrentWindowForRemoteReuse();
    }
    await openVSCodeRemoteEmptyWindow(host, openInNewWindow);
    showRemoteOpenSuccess(remoteDisplayLabel, windowLabel);
  } catch {
    try {
      await openRemoteSSHEmptyWindow(host, openInNewWindow);
      showRemoteOpenSuccess(remoteDisplayLabel, windowLabel);
    } catch {
      vscode.window.showErrorMessage(
        "无法调起 Remote-SSH 连接。请确认已安装 Remote-SSH 扩展。"
      );
    }
  } finally {
    status.dispose();
  }
}

interface WindowTarget {
  openInNewWindow: boolean;
  reason?: string;
}

/** Reusing a local workspace window can make VS Code carry local cwd state into the remote side. */
async function resolveWindowTarget(forceNewWindow: boolean): Promise<WindowTarget | undefined> {
  if (forceNewWindow) {
    return { openInNewWindow: true };
  }

  const risks = getCurrentWindowReuseRisks();
  if (risks.length === 0) {
    return { openInNewWindow: false };
  }

  const hasTerminals = vscode.window.terminals.length > 0;
  const continueCurrent = hasTerminals ? "关闭终端并继续当前窗口" : "继续当前窗口";
  const message = hasTerminals
    ? [
        `当前窗口已有${risks.join("、")}，复用窗口连接 Remote-SSH 前需要先关闭本窗口终端。`,
        "这样可以避免 VS Code 在远程端恢复本地 cwd，导致 Starting directory (cwd) 不存在。",
      ].join("\n")
    : [
        `当前窗口已有${risks.join("、")}，复用窗口连接 Remote-SSH 可能让远程端继承本地窗口状态。`,
        "低配置服务器建议改用新窗口，避免工作区索引和终端状态影响远程连接。",
      ].join("\n");

  const choice = await vscode.window.showWarningMessage(
    message,
    { modal: true },
    continueCurrent,
    "改用新窗口"
  );

  if (choice === continueCurrent) {
    return { openInNewWindow: false };
  }
  if (choice === "改用新窗口") {
    return {
      openInNewWindow: true,
      reason: "已按选择改用新窗口，避免远程 cwd 报错。",
    };
  }
  return undefined;
}

function getCurrentWindowReuseRisks(): string[] {
  const risks: string[] = [];
  if ((vscode.workspace.workspaceFolders?.length ?? 0) > 0) {
    risks.push("工作区");
  }
  if (vscode.window.terminals.length > 0) {
    risks.push("终端");
  }
  return risks;
}

/** Clear local terminal state before reusing the current window as a remote window. */
async function prepareCurrentWindowForRemoteReuse(): Promise<void> {
  const terminals = [...vscode.window.terminals];
  for (const terminal of terminals) {
    terminal.dispose();
  }

  try {
    await vscode.commands.executeCommand("workbench.action.terminal.killAll");
  } catch {
    // Older VS Code builds or restricted environments may not expose this command.
  }

  if (terminals.length > 0) {
    await new Promise((resolve) => globalThis.setTimeout(resolve, 150));
  }
}

/** Show a short, auto-disappearing status after VS Code accepts the remote open request. */
function showRemoteOpenSuccess(hostName: string, windowLabel: string): void {
  vscode.window.setStatusBarMessage(
    `$(check) SSH Kit: 已打开 ${hostName} [${windowLabel} · 空窗口]`,
    5000
  );
}

// ─── Connectivity test ────────────────────────────────────────────────────

/**
 * Test SSH connectivity using `ssh -o ConnectTimeout=5 -o BatchMode=yes`.
 * Shows elapsed time on success; extracts the first 3 relevant error lines on failure.
 */
export async function testConnection(host: SSHHost): Promise<void> {
  const args = [
    "-o", "ConnectTimeout=5",
    "-o", "StrictHostKeyChecking=no",
    "-o", "BatchMode=yes",
    ...buildSSHArgs(host),
    "exit",
  ];

  vscode.window.showInformationMessage(
    `正在测试 ${host.name} (${host.hostname}:${host.port})...`
  );

  try {
    const startTime = Date.now();
    const result = cp.spawnSync("ssh", args, {
      encoding: "utf-8",
      timeout: 8000,
    });
    showTestResult(host, result.status, result.stderr?.trim() || "", Date.now() - startTime);
  } catch (err: unknown) {
    showTestError(host, getErrorMessage(err));
  }
}

/** Display connectivity test result (success or failure) */
function showTestResult(
  host: SSHHost,
  exitCode: number | null,
  stderr: string,
  elapsed: number
): void {
  if (exitCode === 0) {
    vscode.window.showInformationMessage(
      `✅ ${host.name} 连通正常 (${elapsed}ms)`,
      "确定"
    );
    return;
  }

  const errorLines = stderr
    .split("\n")
    .filter((l) => !l.startsWith("debug") && !l.startsWith("OpenSSH") && l.trim())
    .slice(0, 3);
  const errorMsg = errorLines.length > 0
    ? errorLines.join("\n")
    : `退出码 ${exitCode}`;

  vscode.window.showErrorMessage(
    `❌ ${host.name} 连接失败 (${elapsed}ms)\n${errorMsg}`,
    { modal: false }
  );
}

/** Display connectivity test exceptions (timeout, etc.) */
function showTestError(host: SSHHost, message: string): void {
  if (message.includes("ETIMEDOUT") || message.includes("timed out")) {
    vscode.window.showErrorMessage(
      `❌ ${host.name} 连接超时（>8s）`,
      { modal: false }
    );
  } else {
    vscode.window.showErrorMessage(
      `❌ ${host.name} 连接测试异常：${message}`,
      { modal: false }
    );
  }
}

// ─── Host search ──────────────────────────────────────────────────────────

/** Search/filter hosts via QuickPick fuzzy matching */
export async function searchHosts(storage: StorageService): Promise<void> {
  const hosts = storage.getAllHosts();
  if (hosts.length === 0) {
    vscode.window.showInformationMessage("暂无主机，请先添加。");
    return;
  }

  const items = hosts.map((h) => ({
    label: `$(server) ${h.name}`,
    description: `${h.username}@${h.hostname}:${h.port}`,
    detail: h.tags.length > 0 ? h.tags.join(", ") : undefined,
    host: h,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    matchOnDescription: true,
    matchOnDetail: true,
    placeHolder: "搜索主机（按名称、地址或标签过滤）...",
  });

  if (picked) {
    await connectHostInCurrentWindow(picked.host, storage);
  }
}

// ─── External terminal connection ──────────────────────────────────────────

/**
 * Connect via SSH in a system-native terminal.
 * Platform-specific launcher: Windows opens a detached cmd.exe, macOS uses
 * Terminal.app, Linux probes gnome-terminal -> konsole -> xterm ->
 * x-terminal-emulator.
 */
export async function connectInExternalTerminal(
  host: SSHHost,
  storage: StorageService
): Promise<void> {
  vscode.window.showInformationMessage(
    `正在外部终端连接 ${host.name} (${host.username}@${host.hostname}:${host.port})...`
  );

  try {
    await launchExternalTerminal(host);
    await storage.addRecentConnection(host.id);
  } catch (err: unknown) {
    vscode.window.showErrorMessage(
      `启动外部终端失败：${getErrorMessage(err)}`
    );
  }
}

/** Open an empty Remote-SSH window via the extension command as a fallback. */
async function openRemoteSSHEmptyWindow(host: SSHHost, openInNewWindow: boolean): Promise<void> {
  const command = openInNewWindow
    ? "opensshremotes.openEmptyWindow"
    : "opensshremotes.openEmptyWindowInCurrentWindow";

  try {
    await vscode.commands.executeCommand(command, {
      host: ensureRemoteSshAlias(host),
    });
  } catch {
    await vscode.commands.executeCommand(command, {
      host: host.hostname,
      userName: host.username,
      port: host.port,
    });
  }
}

/** Open a remote empty window without invoking Remote-SSH's host picker UI. */
async function openVSCodeRemoteEmptyWindow(host: SSHHost, openInNewWindow: boolean): Promise<void> {
  const alias = ensureRemoteSshAlias(host);
  await vscode.commands.executeCommand("vscode.newWindow", {
    remoteAuthority: `ssh-remote+${alias}`,
    reuseWindow: !openInNewWindow,
  });
}

function formatHostSpec(host: SSHHost): string {
  return `${host.username}@${host.hostname}:${host.port}`;
}

function buildRemoteDisplayLabel(host: SSHHost): string {
  return buildRemoteSshAlias(host);
}

function ensureRemoteSshAlias(host: SSHHost): string {
  const alias = buildRemoteSshAlias(host);
  const configPath = getSSHConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existing = fs.existsSync(configPath)
    ? fs.readFileSync(configPath, "utf-8")
    : "";
  const block = formatRemoteSshAliasBlock(host, alias);
  const markerPattern = new RegExp(
    `^${escapeRegExp(aliasBlockBegin(host.id))}\\r?\\n[\\s\\S]*?^${escapeRegExp(aliasBlockEnd(host.id))}\\r?\\n?`,
    "m"
  );
  const updated = markerPattern.test(existing)
    ? existing.replace(markerPattern, block + "\n")
    : joinConfigText(existing, block);

  if (updated !== existing) {
    fs.writeFileSync(configPath, updated, "utf-8");
  }
  return alias;
}

function buildRemoteSshAlias(host: SSHHost): string {
  const prefix = "SSH Kit: ";
  const separator = " | ";
  const endpoint = formatDisplayEndpoint(host);
  const maxLength = 120;
  const maxNameLength = Math.max(8, maxLength - prefix.length - separator.length - endpoint.length);
  const name = truncateText(sanitizeRemoteAliasText(host.name), maxNameLength) || "host";
  return `${prefix}${name}${separator}${endpoint}`;
}

function sanitizeRemoteAliasText(value: string): string {
  return value
    .trim()
    .replace(/[\r\n\t]+/g, " ")
    .replace(/["\\#]/g, "_")
    .replace(/\s+/g, " ");
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {return value;}
  return value.slice(0, maxLength).trimEnd();
}

function formatDisplayEndpoint(host: SSHHost): string {
  const hostname = host.hostname.includes(":") && !host.hostname.startsWith("[")
    ? `[${host.hostname}]`
    : host.hostname;
  return `${hostname}:${host.port}`;
}

function getSSHConfigPath(): string {
  return path.join(os.homedir(), ".ssh", "config");
}

function formatRemoteSshAliasBlock(host: SSHHost, alias: string): string {
  const lines = [
    aliasBlockBegin(host.id),
    `Host ${formatSSHHostPattern(alias)}`,
    `  HostName ${host.hostname}`,
  ];
  if (host.port && host.port !== 22) {
    lines.push(`  Port ${host.port}`);
  }
  if (host.username) {
    lines.push(`  User ${host.username}`);
  }
  if (host.identityFile) {
    lines.push(`  IdentityFile ${host.identityFile}`);
  }
  if (host.extraConfig) {
    for (const [key, value] of Object.entries(host.extraConfig)) {
      const lowerKey = key.toLowerCase();
      if (["host", "hostname", "port", "user", "identityfile"].includes(lowerKey)) {continue;}
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) {
        lines.push(`  ${formatSSHDirectiveKey(key)} ${item}`);
      }
    }
  }
  lines.push(aliasBlockEnd(host.id));
  return lines.join("\n");
}

function formatSSHHostPattern(alias: string): string {
  if (/[\s#"'\\]/.test(alias)) {
    return `"${alias.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
  }
  return alias;
}

function formatSSHDirectiveKey(key: string): string {
  const canonical: Record<string, string> = {
    addkeystoagent: "AddKeysToAgent",
    certificatefile: "CertificateFile",
    compression: "Compression",
    connecttimeout: "ConnectTimeout",
    forwardagent: "ForwardAgent",
    identitiesonly: "IdentitiesOnly",
    localforward: "LocalForward",
    loglevel: "LogLevel",
    proxycommand: "ProxyCommand",
    proxyjump: "ProxyJump",
    remoteforward: "RemoteForward",
    sendenv: "SendEnv",
    serveralivecountmax: "ServerAliveCountMax",
    serveraliveinterval: "ServerAliveInterval",
    stricthostkeychecking: "StrictHostKeyChecking",
    userknownhostsfile: "UserKnownHostsFile",
  };
  return canonical[key.toLowerCase()] ?? key;
}

function aliasBlockBegin(hostId: string): string {
  return `# SSH Kit connect alias ${hostId} begin`;
}

function aliasBlockEnd(hostId: string): string {
  return `# SSH Kit connect alias ${hostId} end`;
}

function joinConfigText(existing: string, block: string): string {
  const prefix = existing.trimEnd();
  return prefix ? `${prefix}\n\n${block}\n` : `${block}\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Remove SSH Kit connection aliases whose host no longer exists in storage. */
export async function cleanupRemoteSshAliases(storage: StorageService): Promise<void> {
  const configPath = getSSHConfigPath();
  if (!fs.existsSync(configPath)) {
    vscode.window.showInformationMessage("SSH Config 文件不存在，无需清理连接别名。");
    return;
  }

  const existing = fs.readFileSync(configPath, "utf-8");
  const activeHostIds = new Set(storage.getAllHosts().map((host) => host.id));
  const staleAliases: string[] = [];
  const aliasBlockPattern = /^# SSH Kit connect alias ([^\r\n]+) begin\r?\n[\s\S]*?^# SSH Kit connect alias \1 end\r?\n?/gm;
  const updated = existing.replace(aliasBlockPattern, (block, hostId: string) => {
    if (activeHostIds.has(hostId)) {
      return block;
    }
    staleAliases.push(hostId);
    return "";
  });

  if (staleAliases.length === 0) {
    vscode.window.showInformationMessage("没有失效的 SSH Kit 连接别名。");
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    `将从 SSH Config 删除 ${staleAliases.length} 个失效的 SSH Kit 连接别名。此操作只影响 SSH Kit 自动生成的别名块。`,
    { modal: true },
    "确认清理"
  );
  if (confirmed !== "确认清理") {return;}

  fs.writeFileSync(configPath, updated.replace(/\n{3,}/g, "\n\n"), "utf-8");
  vscode.window.showInformationMessage(`已清理 ${staleAliases.length} 个失效的 SSH Kit 连接别名。`);
}

// ─── VS Code built-in terminal connection ──────────────────────────────────

/**
 * Connect via SSH in the VS Code integrated terminal.
 * Creates a named terminal panel and sends the ssh command.
 */
export async function connectInVSCodeTerminal(
  host: SSHHost,
  storage: StorageService
): Promise<void> {
  const terminal = vscode.window.createTerminal({
    name: `SSH: ${host.name}`,
    shellPath: "ssh",
    shellArgs: buildSSHArgs(host),
    hideFromUser: false,
  });
  terminal.show();

  vscode.window.showInformationMessage(
    `已在终端连接 ${host.name} (${host.username}@${host.hostname}:${host.port})`
  );

  await storage.addRecentConnection(host.id);
}

// ─── Terminal connection entry point (choose type) ─────────────────────────

/**
 * Show a QuickPick to let the user choose between VS Code integrated terminal
 * and an external system terminal. Called from inline buttons and Command Palette.
 */
export async function promptTerminalConnect(
  host: SSHHost,
  storage: StorageService
): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    [
      {
        label: "$(terminal) 在 VS Code 终端打开",
        description: "使用内置终端，保持在编辑器内",
        key: "vscode",
      },
      {
        label: "$(remote-explorer) 在外部终端打开",
        description: "打开系统原生终端窗口",
        key: "external",
      },
    ],
    { placeHolder: `选择 ${host.name} 的连接方式` }
  );

  if (!picked) {return;}

  if (picked.key === "external") {
    await connectInExternalTerminal(host, storage);
  } else {
    await connectInVSCodeTerminal(host, storage);
  }
}

/** Build raw ssh arguments shared by test, integrated terminal, and launchers. */
function buildSSHArgs(host: SSHHost): string[] {
  const args = ["-p", String(host.port)];
  if (host.identityFile) {
    args.push("-i", resolveIdentityFileForSSHArg(host.identityFile));
  }
  args.push(`${host.username}@${host.hostname}`);
  return args;
}

/** Resolve user-friendly IdentityFile forms before passing them as raw process args. */
function resolveIdentityFileForSSHArg(identityFile: string): string {
  const cleaned = stripWrappingQuotes(identityFile.trim());
  if (!cleaned || cleaned.includes("%")) {return identityFile;}

  if (cleaned.startsWith("~/") || cleaned.startsWith("~\\")) {
    return path.join(os.homedir(), cleaned.slice(2));
  }
  if (path.isAbsolute(cleaned)) {
    return cleaned;
  }

  const sshDirCandidate = path.resolve(os.homedir(), ".ssh", cleaned);
  if (fs.existsSync(sshDirCandidate)) {
    return sshDirCandidate;
  }

  const homeCandidate = path.resolve(os.homedir(), cleaned);
  return fs.existsSync(homeCandidate) ? homeCandidate : cleaned;
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

/** Launch the platform-native terminal with an ssh command. */
async function launchExternalTerminal(host: SSHHost): Promise<void> {
  if (process.platform === "win32") {
    await launchWindowsTerminal(host);
    return;
  }

  const sshCommand = ["ssh", ...buildSSHArgs(host)].map(quoteForPosixShell).join(" ");
  if (process.platform === "darwin") {
    const script = `tell application "Terminal" to do script "${escapeAppleScriptString(sshCommand)}"`;
    await spawnDetached("osascript", ["-e", script]);
    return;
  }

  await launchLinuxTerminal(sshCommand);
}

/** Launch cmd.exe in its own console window and keep it open after ssh exits. */
async function launchWindowsTerminal(host: SSHHost): Promise<void> {
  const commandLine = ["ssh", ...buildSSHArgs(host)]
    .map((arg, index) => index === 0 ? arg : quoteForCmdArg(arg))
    .join(" ");

  await spawnDetached("cmd.exe", ["/d", "/k", commandLine], {
    windowsHide: false,
  });
}

/** Probe common Linux terminal emulators and launch the first available one. */
async function launchLinuxTerminal(sshCommand: string): Promise<void> {
  const shellCommand = `${sshCommand}; exec bash`;
  const candidates: Array<{ command: string; args: string[] }> = [
    { command: "gnome-terminal", args: ["--", "bash", "-lc", shellCommand] },
    { command: "konsole", args: ["-e", "bash", "-lc", shellCommand] },
    { command: "xterm", args: ["-e", "bash", "-lc", shellCommand] },
    { command: "x-terminal-emulator", args: ["-e", "bash", "-lc", shellCommand] },
  ];

  for (const candidate of candidates) {
    if (commandExists(candidate.command)) {
      await spawnDetached(candidate.command, candidate.args);
      return;
    }
  }

  throw new Error("未找到可用的 Linux 终端（gnome-terminal / konsole / xterm / x-terminal-emulator）。");
}

/** Check whether a command exists on PATH. */
function commandExists(command: string): boolean {
  const checker = process.platform === "win32" ? "where" : "which";
  const result = cp.spawnSync(checker, [command], { stdio: "ignore" });
  return result.status === 0;
}

/** Spawn a process detached from the extension host. */
function spawnDetached(
  command: string,
  args: string[],
  options: cp.SpawnOptions = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      ...options,
    });

    let settled = false;
    child.once("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once("spawn", () => {
      if (!settled) {
        settled = true;
        child.unref();
        resolve();
      }
    });
  });
}

/** Quote a value for a POSIX shell command string. */
function quoteForPosixShell(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Quote a value that will be parsed by cmd.exe. */
function quoteForCmdArg(value: string): string {
  if (!/[ \t&()^|<>"]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

/** Escape text for an AppleScript double-quoted string. */
function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
