// SSH Kit —— 连接 / 搜索 / 连通性测试命令
import * as cp from "child_process";
import * as vscode from "vscode";
import { SSHHost } from "../core/types";
import { StorageService } from "../core/storage";
import { getErrorMessage } from "../core/utils";

// ─── 连接 ──────────────────────────────────────────────────────────────────

/** 调起 Remote-SSH 连接 —— 在当前窗口打开 */
export async function connectHostInCurrentWindow(
  host: SSHHost,
  storage: StorageService
): Promise<void> {
  await doConnect(host, storage, false);
}

/** 调起 Remote-SSH 连接 —— 在新窗口打开 */
export async function connectHostInNewWindow(
  host: SSHHost,
  storage: StorageService
): Promise<void> {
  await doConnect(host, storage, true);
}

/** 执行 Remote-SSH 连接的公共实现 */
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
      // 回退：Remote-SSH 原生命令
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

// ─── 连通性测试 ────────────────────────────────────────────────────────────

/**
 * 测试 SSH 连通性（ssh -o ConnectTimeout=5 -o BatchMode=yes）。
 * 成功时显示耗时，失败时提取 SSH 错误信息的前 3 行关键内容。
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

/** 展示连通性测试结果（成功/失败） */
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

/** 展示连接测试异常（超时等非正常退出） */
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

// ─── 搜索 ──────────────────────────────────────────────────────────────────

/** 搜索/过滤主机（QuickPick 模糊匹配） */
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

// ─── 外部终端连接 ──────────────────────────────────────────────────────────

/**
 * 在系统外部终端中通过 SSH 连接到主机。
 * 按平台选择最合适的终端模拟器：Windows 用 start cmd，
 * macOS 用 Terminal.app，Linux 按优先级探测 gnome-terminal / konsole / xterm。
 */
export async function connectInExternalTerminal(
  host: SSHHost,
  storage: StorageService
): Promise<void> {
  // 构造 ssh 命令片段（平台差异在于引号和外层终端包装）
  const sshParts = ["ssh"];
  sshParts.push("-p", String(host.port));
  if (host.identityFile) {
    sshParts.push("-i", host.identityFile);
  }
  sshParts.push(`${host.username}@${host.hostname}`);

  // Unix: 含空格参数用双引号包裹
  const sshCmdUnix = sshParts
    .map((p) => (/\s/.test(p) ? `"${p}"` : p))
    .join(" ");
  // Windows: 含空格参数用双引号包裹（cmd /k 内层引号需反斜杠转义）
  const sshCmdWin = sshParts
    .map((p) => (/\s/.test(p) ? `\\"${p}\\"` : p))
    .join(" ");

  // 主机名中的双引号转义，避免破坏 start 标题
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
