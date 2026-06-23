// SSH Kit — Connection, search, and connectivity test commands
import * as cp from "child_process";
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
    "-p", String(host.port),
    `${host.username}@${host.hostname}`,
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
 * Platform-specific launcher: Windows uses `start cmd`, macOS uses Terminal.app,
 * Linux probes gnome-terminal → konsole → xterm → x-terminal-emulator.
 */
export async function connectInExternalTerminal(
  host: SSHHost,
  storage: StorageService
): Promise<void> {
  // Build ssh argument list (quoting differs per platform)
  const sshParts = ["ssh"];
  sshParts.push("-p", String(host.port));
  if (host.identityFile) {
    sshParts.push("-i", host.identityFile);
  }
  sshParts.push(`${host.username}@${host.hostname}`);

  // Unix: wrap args containing spaces in double quotes
  const sshCmdUnix = sshParts
    .map((p) => (/\s/.test(p) ? `"${p}"` : p))
    .join(" ");
  // Windows: wrap args containing spaces, escaping inner quotes for cmd /k
  const sshCmdWin = sshParts
    .map((p) => (/\s/.test(p) ? `\\"${p}\\"` : p))
    .join(" ");

  // Escape double quotes in host name to avoid breaking the `start` window title
  const safeName = host.name.replace(/"/g, "'");

  let cmd: string;

  if (process.platform === "win32") {
    // Windows：start 打开新 cmd 窗口，/k 保持窗口不关闭
    cmd = `start "SSH: ${safeName}" cmd /k "${sshCmdWin} && pause"`;
  } else if (process.platform === "darwin") {
    // macOS：Terminal.app 新建标签页执行 ssh
    cmd = `osascript -e 'tell app "Terminal" to do script "${sshCmdUnix}"'`;
  } else {
    // Linux：按优先级探测可用终端，最后回退 x-terminal-emulator
    cmd =
      `(gnome-terminal -- bash -c "${sshCmdUnix}; exec bash" 2>/dev/null || ` +
      `konsole -e bash -c "${sshCmdUnix}; exec bash" 2>/dev/null || ` +
      `xterm -e bash -c "${sshCmdUnix}; exec bash" 2>/dev/null || ` +
      `x-terminal-emulator -e bash -c "${sshCmdUnix}; exec bash") &`;
  }

  vscode.window.showInformationMessage(
    `正在外部终端连接 ${host.name} (${host.username}@${host.hostname}:${host.port})...`
  );

  await storage.addRecentConnection(host.id);

  cp.exec(cmd, (error) => {
    if (error) {
      vscode.window.showErrorMessage(
        `启动外部终端失败：${getErrorMessage(error)}`
      );
    }
  });
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
  const sshParts = ["ssh"];
  sshParts.push("-p", String(host.port));
  if (host.identityFile) {
    sshParts.push("-i", host.identityFile);
  }
  sshParts.push(`${host.username}@${host.hostname}`);

  const sshCmd = sshParts
    .map((p) => (/\s/.test(p) ? `"${p}"` : p))
    .join(" ");

  const terminal = vscode.window.createTerminal({
    name: `SSH: ${host.name}`,
    hideFromUser: false,
  });
  terminal.sendText(sshCmd);
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
