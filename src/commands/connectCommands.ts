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
  const windowLabel = openInNewWindow ? vscode.l10n.t("New Window") : vscode.l10n.t("Current Window");
  const status = vscode.window.setStatusBarMessage(
    vscode.l10n.t("$(sync~spin) SSH Kit: Opening {host} ({spec}) [{window} · empty window]…", {
      host: remoteDisplayLabel,
      spec: hostSpec,
      window: windowLabel,
    })
  );
  if (windowTarget.reason) {
    vscode.window.setStatusBarMessage(
      `$(info) SSH Kit: ${windowTarget.reason}`,
      7000
    );
  }

  let alias: string | undefined;
  try {
    alias = ensureRemoteSshAlias(host, storage.getAllHosts());
    await storage.addRecentConnection(host.id);
    await storage.setRemoteAuthorityConnection(host.id, alias);
    await storage.addPendingWindowConnection(host.id, alias);
    if (!openInNewWindow) {
      await storage.setCurrentConnection(host.id, alias);
      await storage.setWindowConnection(host.id, alias);
    }

    try {
      if (!openInNewWindow) {
        await prepareCurrentWindowForRemoteReuse();
      }
      await openRemoteSSHEmptyWindow(host, alias, openInNewWindow);
      showRemoteOpenSuccess(remoteDisplayLabel, windowLabel);
    } catch {
      try {
        await openVSCodeRemoteEmptyWindow(alias, openInNewWindow);
        showRemoteOpenSuccess(remoteDisplayLabel, windowLabel);
      } catch {
        await clearConnectionLaunchContext(storage, host.id, alias, openInNewWindow);
        vscode.window.showErrorMessage(
          vscode.l10n.t("Could not start a Remote-SSH connection. Make sure the Remote-SSH extension is installed.")
        );
      }
    }
  } catch (err: unknown) {
    if (alias) {
      await clearConnectionLaunchContext(storage, host.id, alias, openInNewWindow);
    }
    vscode.window.showErrorMessage(vscode.l10n.t("Could not prepare the Remote-SSH connection: {error}", {
      error: getErrorMessage(err),
    }));
  } finally {
    status.dispose();
  }
}

async function clearConnectionLaunchContext(
  storage: StorageService,
  hostId: string,
  alias: string,
  openInNewWindow: boolean
): Promise<void> {
  if (openInNewWindow) {
    await storage.clearPendingWindowConnection(hostId, alias);
    await storage.clearRemoteAuthorityConnection(hostId, alias);
    return;
  }

  await storage.clearPendingWindowConnection(hostId, alias);
  await storage.clearRemoteAuthorityConnection(hostId, alias);
  await storage.clearCurrentConnection(hostId);
  await storage.clearWindowConnection(hostId);
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
  const continueCurrent = hasTerminals
    ? vscode.l10n.t("Close terminals and continue in the current window")
    : vscode.l10n.t("Continue in the current window");
  const useNewWindow = vscode.l10n.t("Use a new window");
  const riskText = risks.join(", ");
  const message = hasTerminals
    ? [
        vscode.l10n.t("The current window contains {risks}. Its terminals must be closed before reusing it for Remote-SSH.", { risks: riskText }),
        vscode.l10n.t("This prevents VS Code from restoring a local cwd on the remote host and reporting that the starting directory does not exist."),
      ].join("\n")
    : [
        vscode.l10n.t("The current window contains {risks}. Reusing it for Remote-SSH may carry local window state to the remote host.", { risks: riskText }),
        vscode.l10n.t("For lower-spec servers, use a new window so workspace indexing and terminal state do not affect the remote connection."),
      ].join("\n");

  const choice = await vscode.window.showWarningMessage(
    message,
    { modal: true },
    continueCurrent,
    useNewWindow
  );

  if (choice === continueCurrent) {
    return { openInNewWindow: false };
  }
  if (choice === useNewWindow) {
    return {
      openInNewWindow: true,
      reason: vscode.l10n.t("Using a new window to avoid a remote cwd error."),
    };
  }
  return undefined;
}

function getCurrentWindowReuseRisks(): string[] {
  const risks: string[] = [];
  if ((vscode.workspace.workspaceFolders?.length ?? 0) > 0) {
    risks.push(vscode.l10n.t("a workspace"));
  }
  if (vscode.window.terminals.length > 0) {
    risks.push(vscode.l10n.t("terminals"));
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
    vscode.l10n.t("$(check) SSH Kit: Opened {host} [{window} · empty window]", {
      host: hostName,
      window: windowLabel,
    }),
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
    ...buildSSHArgs(host, {
      batchMode: true,
      connectTimeoutSeconds: 5,
      strictHostKeyChecking: "accept-new",
    }),
    "exit",
  ];

  vscode.window.showInformationMessage(
    vscode.l10n.t("Testing {name} ({address}:{port})…", { name: host.name, address: host.hostname, port: host.port })
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
      vscode.l10n.t("$(check) {name} is reachable ({elapsed} ms)", { name: host.name, elapsed }),
      vscode.l10n.t("OK")
    );
    return;
  }

  const errorLines = stderr
    .split("\n")
    .filter((l) => !l.startsWith("debug") && !l.startsWith("OpenSSH") && l.trim())
    .slice(0, 3);
  const errorMsg = errorLines.length > 0
    ? errorLines.join("\n")
    : vscode.l10n.t("Exit code {code}", { code: exitCode ?? "null" });

  vscode.window.showErrorMessage(
    vscode.l10n.t("$(error) {name} connection failed ({elapsed} ms)\n{error}", { name: host.name, elapsed, error: errorMsg }),
    { modal: false }
  );
}

/** Display connectivity test exceptions (timeout, etc.) */
function showTestError(host: SSHHost, message: string): void {
  if (message.includes("ETIMEDOUT") || message.includes("timed out")) {
    vscode.window.showErrorMessage(
      vscode.l10n.t("$(error) {name} connection timed out (>8 s)", { name: host.name }),
      { modal: false }
    );
  } else {
    vscode.window.showErrorMessage(
      vscode.l10n.t("$(error) {name} connectivity test failed: {error}", { name: host.name, error: message }),
      { modal: false }
    );
  }
}

// ─── Host search ──────────────────────────────────────────────────────────

/** Search/filter hosts via QuickPick fuzzy matching */
export async function searchHosts(storage: StorageService): Promise<void> {
  const hosts = storage.getAllHosts();
  if (hosts.length === 0) {
    vscode.window.showInformationMessage(vscode.l10n.t("No hosts are available. Add a host first."));
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
    placeHolder: vscode.l10n.t("Search hosts by name, address, or tags…"),
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
  const missingIdentity = getMissingIdentityFile(host);
  const skipMissingIdentityFile = Boolean(missingIdentity);
  if (missingIdentity) {
    const shouldContinue = await confirmMissingIdentityFile(host, missingIdentity);
    if (!shouldContinue) {return;}
  }

  vscode.window.showInformationMessage(
    vscode.l10n.t("Connecting to {name} in an external terminal ({target})…", {
      name: host.name,
      target: `${host.username}@${host.hostname}:${host.port}`,
    })
  );

  try {
    await launchExternalTerminal(host, { skipMissingIdentityFile });
    await storage.addRecentConnection(host.id);
  } catch (err: unknown) {
    vscode.window.showErrorMessage(
      vscode.l10n.t("Failed to start an external terminal: {error}", { error: getErrorMessage(err) })
    );
  }
}

/** Open an empty Remote-SSH window via the Remote-SSH extension command. */
async function openRemoteSSHEmptyWindow(
  host: SSHHost,
  alias: string,
  openInNewWindow: boolean
): Promise<void> {
  const command = openInNewWindow
    ? "opensshremotes.openEmptyWindow"
    : "opensshremotes.openEmptyWindowInCurrentWindow";

  try {
    await vscode.commands.executeCommand(command, {
      host: alias,
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
async function openVSCodeRemoteEmptyWindow(
  alias: string,
  openInNewWindow: boolean
): Promise<void> {
  await vscode.commands.executeCommand("vscode.newWindow", {
    remoteAuthority: `ssh-remote+${alias}`,
    reuseWindow: !openInNewWindow,
  });
}

function formatHostSpec(host: SSHHost): string {
  return `${host.username}@${host.hostname}:${host.port}`;
}

function buildRemoteDisplayLabel(host: SSHHost): string {
  return `SSH Kit: ${sanitizeRemoteDisplayText(host.name) || "host"} | ${formatDisplayEndpoint(host)}`;
}

function ensureRemoteSshAlias(host: SSHHost, allHosts: SSHHost[] = [host]): string {
  const configPath = getSSHConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existing = fs.existsSync(configPath)
    ? fs.readFileSync(configPath, "utf-8")
    : "";
  const activeHostIds = new Set(allHosts.map((item) => item.id));
  const existingWithoutStaleBlocks = stripStaleRemoteAliasBlocks(existing, activeHostIds);
  const markerPattern = remoteAliasMarkerPattern(host.id);
  const existingWithoutOwnBlock = existingWithoutStaleBlocks.replace(markerPattern, "");
  const alias = buildAvailableRemoteSshAlias(host, allHosts, existingWithoutOwnBlock);
  const block = formatRemoteSshAliasBlock(host, alias);
  const updated = configAliasMatchesHost(existingWithoutOwnBlock, alias, host)
    ? existingWithoutOwnBlock
    : joinConfigText(existingWithoutOwnBlock, block);

  if (updated !== existing) {
    fs.writeFileSync(configPath, updated, "utf-8");
  }
  return alias;
}

export function buildRemoteSshAlias(host: SSHHost, allHosts: SSHHost[] = [host]): string {
  const candidates = buildRemoteAliasCandidates(host);
  return candidates.find((candidate) => isRemoteAliasUnique(host, candidate, allHosts))
    ?? candidates[candidates.length - 1];
}

/** Find the SSH Kit host that owns a Remote-SSH authority alias. */
export function findHostByRemoteSshAlias(alias: string, allHosts: SSHHost[]): SSHHost | undefined {
  const exactName = allHosts.filter((host) => host.name === alias);
  if (exactName.length === 1) {
    return exactName[0];
  }

  const candidateMatches = allHosts.filter((host) =>
    buildRemoteAliasCandidates(host).includes(alias)
  );
  return candidateMatches.length === 1 ? candidateMatches[0] : undefined;
}

function buildAvailableRemoteSshAlias(
  host: SSHHost,
  allHosts: SSHHost[],
  existingConfig: string
): string {
  const candidates = buildRemoteAliasCandidates(host);
  return candidates.find((candidate) =>
    isRemoteAliasUnique(host, candidate, allHosts) &&
    (!configHasHostAlias(existingConfig, candidate) || configAliasMatchesHost(existingConfig, candidate, host))
  ) ?? candidates[candidates.length - 1];
}

function sanitizeRemoteAliasText(value: string): string {
  return value
    .trim()
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\p{L}\p{N} ._+-]+/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/^[ ._+-]+|[ ._+-]+$/g, "");
}

function isRemoteAliasUnique(host: SSHHost, alias: string, allHosts: SSHHost[]): boolean {
  return !allHosts.some((other) =>
    other.id !== host.id && buildRemoteAliasCandidates(other).includes(alias)
  );
}

function buildRemoteAliasCandidates(host: SSHHost): string[] {
  const maxLength = 120;
  const endpoint = `｜${formatRemoteAliasEndpoint(host)}`;
  const idSuffix = `｜${host.id.slice(-6)}`;
  const fullIdSuffix = `｜${host.id}`;
  const name = truncateText(sanitizeRemoteAliasText(host.name), maxLength) || formatRemoteAliasEndpoint(host);
  const nameWithEndpoint = `${truncateText(name, Math.max(8, maxLength - endpoint.length))}${endpoint}`;
  const nameWithEndpointAndId = `${truncateText(name, Math.max(8, maxLength - endpoint.length - idSuffix.length))}${endpoint}${idSuffix}`;
  const nameWithEndpointAndFullId = `${truncateText(name, Math.max(8, maxLength - endpoint.length - fullIdSuffix.length))}${endpoint}${fullIdSuffix}`;
  return [name, nameWithEndpoint, nameWithEndpointAndId, nameWithEndpointAndFullId];
}

function sanitizeRemoteDisplayText(value: string): string {
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

function formatRemoteAliasEndpoint(host: SSHHost): string {
  const hostname = host.hostname
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "host";
  return `${hostname}：${host.port}`;
}

function configHasHostAlias(rawText: string, alias: string): boolean {
  return Boolean(findHostConfig(rawText, alias));
}

function configAliasMatchesHost(rawText: string, alias: string, host: SSHHost): boolean {
  const props = findHostConfig(rawText, alias);
  if (!props) {return false;}

  const hostname = getLastConfigValue(props, "hostname") ?? alias;
  const port = Number.parseInt(getLastConfigValue(props, "port") ?? "22", 10);
  const user = getLastConfigValue(props, "user") ?? "";
  const identityFiles = props.identityfile ?? [];
  return hostname === host.hostname &&
    port === host.port &&
    (!host.username || user === host.username) &&
    configIdentityFilesMatchHost(identityFiles, host);
}

function configIdentityFilesMatchHost(identityFiles: string[], host: SSHHost): boolean {
  if (!host.identityFile) {
    return identityFiles.length === 0;
  }
  return identityFiles.length === 1 &&
    identityPathsEquivalentForConnect(identityFiles[0], host.identityFile);
}

function identityPathsEquivalentForConnect(left: string, right: string): boolean {
  const leftCandidates = identityPathCompareCandidatesForConnect(left);
  const rightCandidates = identityPathCompareCandidatesForConnect(right);
  return leftCandidates.some((candidate) => rightCandidates.includes(candidate));
}

function identityPathCompareCandidatesForConnect(filePath: string): string[] {
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

  return [...candidates].map((candidate) => {
    const normalized = path.normalize(candidate);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  });
}

function findHostConfig(rawText: string, alias: string): Record<string, string[]> | undefined {
  let currentAliases: string[] = [];
  let currentProps: Record<string, string[]> = {};

  const flush = (): Record<string, string[]> | undefined =>
    currentAliases.includes(alias) ? currentProps : undefined;

  for (const line of rawText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {continue;}

    const sectionMatch = /^(Host|Match)\s+(.+)$/i.exec(trimmed);
    if (sectionMatch) {
      const found = flush();
      if (found) {return found;}
      currentAliases = sectionMatch[1].toLowerCase() === "host"
        ? splitSSHWords(sectionMatch[2])
        : [];
      currentProps = {};
      continue;
    }

    if (currentAliases.length === 0) {continue;}
    const directiveMatch = /^(\S+)\s+(.+)$/.exec(trimmed);
    if (!directiveMatch) {continue;}
    const key = directiveMatch[1].toLowerCase();
    currentProps[key] = [...(currentProps[key] ?? []), directiveMatch[2].trim()];
  }

  return flush();
}

function getLastConfigValue(props: Record<string, string[]>, key: string): string | undefined {
  const values = props[key.toLowerCase()];
  return values?.[values.length - 1];
}

function splitSSHWords(value: string): string[] {
  const words: string[] = [];
  const tokenRegex = /"([^"]+)"|'([^']+)'|(\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(value)) !== null) {
    words.push(match[1] ?? match[2] ?? match[3]);
  }

  return words;
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

function remoteAliasMarkerPattern(hostId: string): RegExp {
  return new RegExp(
    `^${escapeRegExp(aliasBlockBegin(hostId))}\\r?\\n[\\s\\S]*?^${escapeRegExp(aliasBlockEnd(hostId))}\\r?\\n?`,
    "m"
  );
}

function stripStaleRemoteAliasBlocks(rawText: string, activeHostIds: Set<string>): string {
  const aliasBlockPattern = /^# SSH Kit connect alias ([^\r\n]+) begin\r?\n[\s\S]*?^# SSH Kit connect alias \1 end\r?\n?/gm;
  return rawText.replace(aliasBlockPattern, (block, hostId: string) =>
    activeHostIds.has(hostId) ? block : ""
  );
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
    vscode.window.showInformationMessage(vscode.l10n.t("The SSH Config file does not exist; there are no connection aliases to clean up."));
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
    vscode.window.showInformationMessage(vscode.l10n.t("No stale SSH Kit connection aliases were found."));
    return;
  }

  const cleanupAction = vscode.l10n.t("Clean Up");
  const confirmed = await vscode.window.showWarningMessage(
    vscode.l10n.t("Remove {count} stale SSH Kit connection aliases from SSH Config? Only alias blocks generated by SSH Kit are affected.", { count: staleAliases.length }),
    { modal: true },
    cleanupAction
  );
  if (confirmed !== cleanupAction) {return;}

  fs.writeFileSync(configPath, updated.replace(/\n{3,}/g, "\n\n"), "utf-8");
  vscode.window.showInformationMessage(vscode.l10n.t("Removed {count} stale SSH Kit connection aliases.", { count: staleAliases.length }));
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
  const remoteTerminalMode = await resolveRemoteWindowTerminalMode(host, storage);
  if (remoteTerminalMode === "localVSCodeTerminal") {
    await connectInLocalVSCodeTerminal(host, storage);
    return;
  }
  if (remoteTerminalMode === "external") {return;}
  if (remoteTerminalMode === "cancel") {return;}

  const skipMissingIdentityFile = remoteTerminalMode === "remoteTerminal";
  const missingIdentity = skipMissingIdentityFile ? undefined : getMissingIdentityFile(host);
  if (missingIdentity) {
    const shouldContinue = await confirmMissingIdentityFile(host, missingIdentity);
    if (!shouldContinue) {return;}
  }

  const terminal = vscode.window.createTerminal({
    name: `SSH: ${host.name}`,
    shellPath: "ssh",
    shellArgs: buildSSHArgs(host, {
      acceptNewHostKey: true,
      skipMissingIdentityFile: skipMissingIdentityFile || Boolean(missingIdentity),
    }),
    hideFromUser: false,
  });
  terminal.show();

  vscode.window.showInformationMessage(
    vscode.l10n.t("Opened {name} in the terminal ({target})", {
      name: host.name,
      target: `${host.username}@${host.hostname}:${host.port}`,
    })
  );

  await storage.addRecentConnection(host.id);
}

type RemoteWindowTerminalMode =
  | "localWindow"
  | "localVSCodeTerminal"
  | "remoteTerminal"
  | "external"
  | "cancel";

async function resolveRemoteWindowTerminalMode(
  host: SSHHost,
  storage: StorageService
): Promise<RemoteWindowTerminalMode> {
  if (!vscode.env.remoteName) {
    return "localWindow";
  }

  const localTerminalAction = vscode.l10n.t("Open in a local VS Code terminal");
  const externalAction = vscode.l10n.t("Open in a local external terminal");
  const remoteTerminalAction = vscode.l10n.t("Open in the current remote terminal anyway");
  const cancelAction = vscode.l10n.t("Cancel");
  const choice = await vscode.window.showWarningMessage(
    [
      vscode.l10n.t("This VS Code window is already connected to a remote environment, so its integrated terminal runs ssh on that remote host."),
      vscode.l10n.t("To use your local SSH configuration and local keys, use a local VS Code terminal or a local external terminal."),
    ].join("\n"),
    localTerminalAction,
    externalAction,
    remoteTerminalAction,
    cancelAction
  );

  if (choice === localTerminalAction) {
    return "localVSCodeTerminal";
  }
  if (choice === externalAction) {
    await connectInExternalTerminal(host, storage);
    return "external";
  }
  if (choice === remoteTerminalAction) {
    return "remoteTerminal";
  }
  return "cancel";
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
  const isRemoteWindow = Boolean(vscode.env.remoteName);
  const picked = await vscode.window.showQuickPick(
    isRemoteWindow ? [
      {
        label: vscode.l10n.t("$(terminal) Open in a local VS Code terminal"),
        description: vscode.l10n.t("Recommended in a remote window: uses local SSH and local keys"),
        key: "localVscode",
      },
      {
        label: vscode.l10n.t("$(remote-explorer) Open in a local external terminal"),
        description: vscode.l10n.t("Uses a native system terminal window"),
        key: "external",
      },
      {
        label: vscode.l10n.t("$(terminal) Open in the current remote VS Code terminal"),
        description: vscode.l10n.t("Runs ssh on the current remote host and does not use local key files"),
        key: "vscode",
      },
    ] : [
      {
        label: vscode.l10n.t("$(terminal) Open in a VS Code terminal"),
        description: vscode.l10n.t("Uses the integrated terminal and stays inside the editor"),
        key: "vscode",
      },
      {
        label: vscode.l10n.t("$(remote-explorer) Open in an external terminal"),
        description: vscode.l10n.t("Opens a native system terminal window"),
        key: "external",
      },
    ],
    { placeHolder: vscode.l10n.t("Choose how to connect to {name}", { name: host.name }) }
  );

  if (!picked) {return;}

  if (picked.key === "localVscode") {
    await connectInLocalVSCodeTerminal(host, storage);
  } else if (picked.key === "external") {
    await connectInExternalTerminal(host, storage);
  } else {
    await connectInVSCodeTerminal(host, storage);
  }
}

interface BuildSSHArgsOptions {
  acceptNewHostKey?: boolean;
  batchMode?: boolean;
  connectTimeoutSeconds?: number;
  skipMissingIdentityFile?: boolean;
  strictHostKeyChecking?: "accept-new" | "no" | "yes";
}

interface MissingIdentityFile {
  originalPath: string;
  resolvedPath: string;
}

/** Build raw ssh arguments shared by test, integrated terminal, and launchers. */
function buildSSHArgs(host: SSHHost, options: BuildSSHArgsOptions = {}): string[] {
  const args: string[] = [];
  if (options.connectTimeoutSeconds) {
    args.push("-o", `ConnectTimeout=${options.connectTimeoutSeconds}`);
  }
  if (options.strictHostKeyChecking) {
    args.push("-o", `StrictHostKeyChecking=${options.strictHostKeyChecking}`);
  } else if (options.acceptNewHostKey) {
    args.push("-o", "StrictHostKeyChecking=accept-new");
  }
  if (options.batchMode) {
    args.push("-o", "BatchMode=yes");
  }

  args.push("-p", String(host.port));
  if (host.identityFile && !options.skipMissingIdentityFile) {
    args.push("-i", resolveIdentityFileForSSHArg(host.identityFile));
  }
  args.push(`${host.username}@${host.hostname}`);
  return args;
}

async function connectInLocalVSCodeTerminal(
  host: SSHHost,
  storage: StorageService
): Promise<void> {
  const missingIdentity = getMissingIdentityFile(host);
  if (missingIdentity) {
    const shouldContinue = await confirmMissingIdentityFile(host, missingIdentity);
    if (!shouldContinue) {return;}
  }

  const commandLine = buildSSHCommandLine(host, {
    acceptNewHostKey: true,
    skipMissingIdentityFile: Boolean(missingIdentity),
  });

  try {
    await vscode.commands.executeCommand("workbench.action.terminal.newLocal");
    await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
    await vscode.commands.executeCommand("workbench.action.terminal.sendSequence", {
      text: `${commandLine}\r`,
    });
    vscode.window.showInformationMessage(
      vscode.l10n.t("Opened {name} in a local VS Code terminal ({target})", {
        name: host.name,
        target: `${host.username}@${host.hostname}:${host.port}`,
      })
    );
    await storage.addRecentConnection(host.id);
  } catch (err: unknown) {
    const externalAction = vscode.l10n.t("Open a local external terminal");
    const cancelAction = vscode.l10n.t("Cancel");
    const choice = await vscode.window.showWarningMessage(
      [
        vscode.l10n.t("VS Code could not create a local integrated terminal."),
        vscode.l10n.t("Reason: {error}", { error: getErrorMessage(err) }),
        vscode.l10n.t("You can continue in a local external terminal."),
      ].join("\n"),
      externalAction,
      cancelAction
    );
    if (choice === externalAction) {
      await connectInExternalTerminal(host, storage);
    }
  }
}

function buildSSHCommandLine(host: SSHHost, options: BuildSSHArgsOptions = {}): string {
  return ["ssh", ...buildSSHArgs(host, options)]
    .map((arg, index) => index === 0 ? arg : quoteForLocalShellArg(arg))
    .join(" ");
}

async function confirmMissingIdentityFile(
  host: SSHHost,
  missing: MissingIdentityFile
): Promise<boolean> {
  const continueAction = vscode.l10n.t("Continue Connecting");
  const editAction = vscode.l10n.t("Edit Host");
  const cancelAction = vscode.l10n.t("Cancel");
  const choice = await vscode.window.showWarningMessage(
    [
      vscode.l10n.t("The identity file configured for host “{name}” does not exist:", { name: host.name }),
      missing.resolvedPath,
      vscode.l10n.t("If you continue, SSH Kit will omit -i so SSH can use default keys, ssh-agent, or password authentication."),
    ].join("\n"),
    continueAction,
    editAction,
    cancelAction
  );

  if (choice === editAction) {
    await vscode.commands.executeCommand("sshKit.editHost", host);
    return false;
  }
  return choice === continueAction;
}

function quoteForLocalShellArg(value: string): string {
  if (process.platform === "win32") {
    return quoteForCmdArg(value);
  }
  return quoteForPosixShell(value);
}

function getMissingIdentityFile(host: SSHHost): MissingIdentityFile | undefined {
  if (!host.identityFile) {return undefined;}
  const resolvedPath = resolveIdentityFileForSSHArg(host.identityFile);
  if (resolvedPath.includes("%")) {return undefined;}
  return fs.existsSync(resolvedPath)
    ? undefined
    : { originalPath: host.identityFile, resolvedPath };
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
  return fs.existsSync(homeCandidate) ? homeCandidate : sshDirCandidate;
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
async function launchExternalTerminal(
  host: SSHHost,
  options: BuildSSHArgsOptions = {}
): Promise<void> {
  if (process.platform === "win32") {
    await launchWindowsTerminal(host, options);
    return;
  }

  const sshCommand = ["ssh", ...buildSSHArgs(host, {
    ...options,
    acceptNewHostKey: true,
  })].map(quoteForPosixShell).join(" ");
  if (process.platform === "darwin") {
    const script = `tell application "Terminal" to do script "${escapeAppleScriptString(sshCommand)}"`;
    await spawnDetached("osascript", ["-e", script]);
    return;
  }

  await launchLinuxTerminal(sshCommand);
}

/** Launch cmd.exe in its own console window and keep it open after ssh exits. */
async function launchWindowsTerminal(
  host: SSHHost,
  options: BuildSSHArgsOptions = {}
): Promise<void> {
  const commandLine = ["ssh", ...buildSSHArgs(host, {
    ...options,
    acceptNewHostKey: true,
  })]
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

  throw new Error(vscode.l10n.t("No supported Linux terminal was found (gnome-terminal / konsole / xterm / x-terminal-emulator)."));
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
