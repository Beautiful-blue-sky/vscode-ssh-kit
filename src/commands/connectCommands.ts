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

/** Open Remote-SSH connection in the current window */
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
  const hostSpec = `${host.username}@${host.hostname}:${host.port}`;
  const windowLabel = forceNewWindow ? "新窗口" : "当前窗口";
  vscode.window.showInformationMessage(
    `正在连接 ${host.name} (${hostSpec}) [${windowLabel}]...`
  );

  await storage.addRecentConnection(host.id);

  const remoteUri = vscode.Uri.parse(
    `vscode-remote://ssh-remote+${hostSpec}/`
  );

  try {
    await vscode.commands.executeCommand(
      "vscode.openFolder",
      remoteUri,
      forceNewWindow ? { forceNewWindow: true } : undefined
    );
  } catch {
    try {
      // Fallback: Remote-SSH native command
      await vscode.commands.executeCommand(
        "openssh-remotes.openEmptyWindow",
        { host: hostSpec }
      );
    } catch {
      vscode.window.showErrorMessage(
        "无法调起 Remote-SSH 连接。请确认已安装 Remote-SSH 扩展。"
      );
    }
  }
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
