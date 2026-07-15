// SSH Kit — SSH config import/export (zero external dependencies)
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as vscode from "vscode";
import { SSHHost, SSHGroup } from "../core/types";

/** Default SSH config file path */
function defaultConfigPath(): string {
  return path.join(os.homedir(), ".ssh", "config");
}

// ─── Data structures ──────────────────────────────────────────────────────

/** Parsed Host section */
interface HostSection {
  aliases: string[];                 // Host alias list
  props: Record<string, string[]>;   // Directive → values map
}

/** Raw Host block with source text offsets, used to preserve user config text */
interface HostBlock {
  aliases: string[];
  text: string;
  start: number;
  end: number;
  managed: boolean;
  connectAlias: boolean;
  endpointKey?: string;
  addressKey?: string;
}

// ─── Parser ───────────────────────────────────────────────────────────────

/**
 * Parse SSH config text into Host sections.
 * Handles line continuation (\) and comment lines (#).
 */
function parseSections(rawText: string): HostSection[] {
  const lines = normalizeLines(rawText);
  const sections: HostSection[] = [];
  let current: HostSection | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip blank lines and comments
    if (!trimmed || trimmed.startsWith("#")) {continue;}

    // Parse directive and value
    const spaceIdx = trimmed.search(/\s/);
    if (spaceIdx === -1) {continue;}
    const directive = trimmed.slice(0, spaceIdx).toLowerCase();
    const value = trimmed.slice(spaceIdx + 1).trim();

    if (directive === "host") {
      // New Host section starts; save the previous one
      if (current) {sections.push(current);}
      current = {
        aliases: splitSSHWords(value),
        props: {},
      };
    } else if (directive === "match") {
      // Match starts a different conditional section. Its directives must not
      // leak into the preceding Host block.
      if (current) {sections.push(current);}
      current = null;
    } else if (current) {
      // Section-level directive (stored lowercase for lookup)
      current.props[directive] = [...(current.props[directive] ?? []), value];
    }
    // Top-level directives outside Host sections (e.g. global IdentityFile) are ignored for now
  }

  if (current) {sections.push(current);}
  return sections;
}

/**
 * Normalize raw text into an array of lines (handle line continuation \).
 */
function normalizeLines(rawText: string): string[] {
  // Merge continuation lines: trailing \ means next line continues
  const merged = rawText.replace(/\\\r?\n\s*/g, " ");
  return merged.split(/\r?\n/);
}

// ─── Import ───────────────────────────────────────────────────────────────

/**
 * Import host list from an SSH config file.
 * Supports recursive Include directive resolution.
 *
 * Known limitation: ignores global directives outside Host sections
 * (e.g. global IdentityFile). Groups are always returned as an empty array.
 */
export function importFromSSHConfig(
  configPath?: string
): { hosts: Omit<SSHHost, "id">[]; groups: SSHGroup[] } {
  const resolvedPath = configPath ?? defaultConfigPath();
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(vscode.l10n.t("SSH Config file does not exist: {path}", { path: resolvedPath }));
  }

  const rawText = stripConnectAliasBlocks(readConfigWithIncludes(resolvedPath));
  const sections = parseSections(rawText);

  const hosts: Omit<SSHHost, "id">[] = [];

  for (const section of sections) {
    const concreteAliases = section.aliases.filter(isConcreteHostAlias);
    if (concreteAliases.length === 0) {continue;}

    const hostname = getLastDirective(section.props, "hostname") ?? concreteAliases[0];
    const port = parseInt(getLastDirective(section.props, "port") ?? "22", 10);
    const username = getLastDirective(section.props, "user") ?? "";
    const identityFile = getLastDirective(section.props, "identityfile");

    for (const alias of concreteAliases) {
      hosts.push({
        name: alias,
        hostname,
        port,
        username,
        identityFile: identityFile || undefined,
        tags: [],
        extraConfig: toExtraConfig(section.props),
      });
    }
  }

  return { hosts, groups: [] };
}

/** OpenSSH Host patterns are rules, not concrete connection entries. */
function isConcreteHostAlias(alias: string): boolean {
  return Boolean(alias) && !alias.startsWith("!") && !/[?*]/.test(alias);
}

// ─── Include recursive resolution ─────────────────────────────────────────

/** Read SSH config and recursively resolve Include directives */
function readConfigWithIncludes(
  filePath: string,
  visited = new Set<string>()
): string {
  const resolved = path.resolve(filePath);
  if (visited.has(resolved)) {return "";} // Prevent circular references
  visited.add(resolved);

  const content = fs.readFileSync(resolved, "utf-8");
  const includeRegex = /^\s*Include\s+(.+)$/i;

  return content
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(includeRegex);
      if (!match) {return line;}

      const includePatterns = splitSSHWords(match[1].trim());
      return includePatterns
        .map((includePattern) => resolveIncludeFiles(includePattern, resolved, visited))
        .join("\n");
    })
    .join("\n");
}

/** Resolve Include pattern to matching files and recursively read them */
function resolveIncludeFiles(
  pattern: string,
  basePath: string,
  visited: Set<string>
): string {
  const expanded = pattern.startsWith("~")
    ? path.join(os.homedir(), pattern.slice(1))
    : pattern;

  const fullPattern = path.isAbsolute(expanded)
    ? expanded
    : path.resolve(path.dirname(basePath), expanded);

  if (fs.existsSync(fullPattern) && fs.statSync(fullPattern).isFile()) {
    return readConfigWithIncludes(fullPattern, visited);
  }

  // Glob matching (supports * wildcard)
  const dir = path.dirname(fullPattern);
  const filename = path.basename(fullPattern);

  if (!fs.existsSync(dir)) {return "";}

  const regex = globPatternToRegex(filename);

  const files = fs
    .readdirSync(dir)
    .filter((f: string) => regex.test(f))
    .sort()
    .map((f: string) => path.join(dir, f))
    .filter((f: string) => fs.statSync(f).isFile());

  return files
    .map((f: string) => readConfigWithIncludes(f, visited))
    .join("\n");
}

/** Split SSH config word lists (quotes preserve spaces). */
function splitSSHWords(value: string): string[] {
  const words: string[] = [];
  const tokenRegex = /"([^"]+)"|'([^']+)'|(\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(value)) !== null) {
    words.push(match[1] ?? match[2] ?? match[3]);
  }

  return words;
}

function stripConnectAliasBlocks(rawText: string): string {
  return rawText.replace(
    /^# SSH Kit connect alias ([^\r\n]+) begin\r?\n[\s\S]*?^# SSH Kit connect alias \1 end\r?\n?/gm,
    ""
  );
}

/** Convert a simple SSH Include glob pattern to a regex. */
function globPatternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

// ─── Export ───────────────────────────────────────────────────────────────

/**
 * Format a single host as an SSH config block.
 */
function formatHostSection(host: SSHHost): string {
  const lines: string[] = [];
  lines.push(`Host ${formatHostPattern(host.name)}`);
  lines.push(`  HostName ${host.hostname}`);
  if (host.port && host.port !== 22) {
    lines.push(`  Port ${host.port}`);
  }
  if (host.username) {
    lines.push(`  User ${host.username}`);
  }
  if (host.identityFile) {
    lines.push(`  IdentityFile ${host.identityFile}`);
  }
  // Preserve additional config directives
  if (host.extraConfig) {
    for (const [key, value] of Object.entries(host.extraConfig)) {
      const kl = key.toLowerCase();
      if (
        kl === "host" ||
        kl === "hostname" ||
        kl === "port" ||
        kl === "user" ||
        kl === "identityfile"
      ) {continue;}
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) {
        lines.push(`  ${formatDirectiveKey(key)} ${item}`);
      }
    }
  }
  return lines.join("\n");
}

function getLastDirective(
  props: Record<string, string[]>,
  key: string
): string | undefined {
  const values = props[key.toLowerCase()];
  return values?.[values.length - 1];
}

function toExtraConfig(props: Record<string, string[]>): Record<string, string | string[]> {
  const extraConfig: Record<string, string | string[]> = {};
  for (const [key, values] of Object.entries(props)) {
    extraConfig[key] = values.length === 1 ? values[0] : [...values];
  }
  return extraConfig;
}

function formatDirectiveKey(key: string): string {
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

function formatHostPattern(pattern: string): string {
  if (/[\s#"'\\]/.test(pattern)) {
    return `"${pattern.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
  }
  return pattern;
}

/** Marker for SSH Kit managed blocks */
const MANAGED_MARKER = "# SSH Kit managed";

/** Export statistics */
export interface ExportStats {
  added: number;        // New hosts (not present in config)
  synced: number;       // Existing matching hosts that will be updated
  preserved: number;    // Non-Kit sections left untouched
  removedAliases: number; // Generated SSH Kit connection alias blocks that will be removed
  conflicts: string[];  // Existing unmanaged Host aliases that need confirmation
}

/** Export behavior options */
export interface ExportOptions {
  overwriteUnmanaged?: boolean; // Allow taking over same-name or same-target Host blocks without the marker
}

/**
 * Analyze export impact without writing.
 * Sections already tagged as SSH Kit managed count as "synced" rather than "added".
 */
export function analyzeExport(
  hosts: SSHHost[],
  configPath?: string
): ExportStats | null {
  const resolvedPath = configPath ?? defaultConfigPath();
  const kitNames = new Set(hosts.map((h) => h.name));
  const kitTargets = buildHostTargetMaps(hosts);
  const syncedNames = new Set<string>();
  const conflictHostNames = new Set<string>();
  const conflictAliases = new Set<string>();
  let preserved = 0;
  let removedAliases = 0;

  if (fs.existsSync(resolvedPath)) {
    const existing = fs.readFileSync(resolvedPath, "utf-8");
    const blocks = findHostBlocks(existing);
    for (const block of blocks) {
      if (block.connectAlias) {
        removedAliases++;
        continue;
      }

      const matchedNames = getMatchedKitHostNames(block, kitNames, kitTargets);
      if (matchedNames.length > 0) {
        const targetSet = block.managed ? syncedNames : conflictHostNames;
        for (const name of matchedNames) {
          targetSet.add(name);
        }
        if (!block.managed) {
          conflictAliases.add(block.aliases.join(" "));
        }
      } else {
        preserved++;
      }
    }
  }

  const added = hosts.filter((h) => !syncedNames.has(h.name) && !conflictHostNames.has(h.name)).length;
  return {
    added,
    synced: syncedNames.size,
    preserved,
    removedAliases,
    conflicts: [...conflictAliases].sort(),
  };
}

/**
 * Merge hosts into the SSH config file.
 * Safety strategy:
 * 1. Caller backs up the original file before writing
 * 2. Preserve unrelated raw config text untouched
 * 3. Remove generated SSH Kit connection aliases
 * 4. Update matching Host blocks and append current SSH Kit hosts
 * 5. Append the managed marker line at the end of each section
 * @returns path of the written file
 */
export function exportToSSHConfig(
  hosts: SSHHost[],
  configPath?: string,
  options: ExportOptions = {}
): string {
  if (hosts.length === 0) {
    throw new Error(vscode.l10n.t("There are no hosts to export."));
  }

  const resolvedPath = configPath ?? defaultConfigPath();
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existing = fs.existsSync(resolvedPath)
    ? fs.readFileSync(resolvedPath, "utf-8")
    : "";
  const existingBlocks = findHostBlocks(existing);
  const kitNames = new Set(hosts.map((h) => h.name));
  const kitTargets = buildHostTargetMaps(hosts);
  const conflicts = findUnmanagedConflicts(existingBlocks, kitNames, kitTargets);
  if (conflicts.length > 0 && !options.overwriteUnmanaged) {
    throw new Error(vscode.l10n.t("Found Host blocks with matching aliases or endpoints that are not managed by SSH Kit: {hosts}. Confirm takeover before writing.", {
      hosts: conflicts.join(", "),
    }));
  }
  let preservedText = "";

  // Preserve existing text outside matching Host blocks. This keeps comments,
  // Include directives, Match sections, and unrelated Host blocks intact.
  if (fs.existsSync(resolvedPath)) {
    let cursor = 0;
    for (const block of existingBlocks) {
      preservedText += existing.slice(cursor, block.start);
      const matchesKitHost = !block.connectAlias &&
        getMatchedKitHostNames(block, kitNames, kitTargets).length > 0;
      if (matchesKitHost && (block.managed || options.overwriteUnmanaged)) {
        // Matching blocks are replaced by the generated SSH Kit block below.
      } else if (block.connectAlias) {
        // Generated Remote-SSH helper aliases are transient and should not
        // survive a full SSH Kit write-back.
      } else {
        preservedText += block.text;
      }
      cursor = block.end;
    }
    preservedText += existing.slice(cursor);
  }

  const managedParts: string[] = [];
  for (const host of hosts) {
    managedParts.push(formatHostSection(host) + "\n  " + MANAGED_MARKER);
  }

  const merged = joinConfigParts(preservedText, managedParts.join("\n\n"));
  fs.writeFileSync(resolvedPath, merged, "utf-8");
  return resolvedPath;
}

/**
 * Format hosts as SSH Config text without writing a file (used for previews).
 */
export function stringifyHosts(hosts: SSHHost[]): string {
  if (hosts.length === 0) {return "";}

  return hosts.map(formatHostSection).join("\n\n") + "\n";
}

/** Find raw Host blocks while treating Host and Match as section boundaries. */
function findHostBlocks(rawText: string): HostBlock[] {
  const sectionRegex = /^\s*(Host|Match)\s+(.+)$/gim;
  const sections: Array<{ kind: string; value: string; start: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = sectionRegex.exec(rawText)) !== null) {
    const kind = match[1].toLowerCase();
    sections.push({
      kind,
      value: match[2].trim(),
      start: kind === "host" ? getConnectAliasBlockStart(rawText, match.index) : match.index,
    });
  }

  const blocks: HostBlock[] = [];
  for (let index = 0; index < sections.length; index++) {
    const section = sections[index];
    if (section.kind !== "host") {continue;}

    const end = sections[index + 1]?.start ?? rawText.length;
    const text = rawText.slice(section.start, end);
    const aliases = splitSSHWords(section.value);
    blocks.push({
      aliases,
      text,
      start: section.start,
      end,
      managed: text.includes(MANAGED_MARKER),
      connectAlias: isConnectAliasBlock(text),
      endpointKey: getHostBlockEndpointKey(text, aliases),
      addressKey: getHostBlockAddressKey(text, aliases),
    });
  }

  return blocks;
}

function isConnectAliasBlock(text: string): boolean {
  return /^# SSH Kit connect alias [^\r\n]+ end\s*$/m.test(text);
}

function getConnectAliasBlockStart(rawText: string, hostStart: number): number {
  const prefix = rawText.slice(0, hostStart);
  const previousLineEnd = prefix.endsWith("\r\n")
    ? prefix.length - 2
    : prefix.endsWith("\n")
      ? prefix.length - 1
      : prefix.length;
  const previousLineStart = prefix.lastIndexOf("\n", Math.max(0, previousLineEnd - 1)) + 1;
  const previousLine = rawText.slice(previousLineStart, previousLineEnd).trim();
  return /^# SSH Kit connect alias [^\r\n]+ begin$/.test(previousLine)
    ? previousLineStart
    : hostStart;
}

/** Find same-name or same-endpoint Host aliases that exist but are not managed by SSH Kit. */
function findUnmanagedConflicts(
  blocks: HostBlock[],
  kitNames: Set<string>,
  kitTargets: HostTargetMaps
): string[] {
  const conflicts = new Set<string>();
  for (const block of blocks) {
    if (block.managed || block.connectAlias) {continue;}
    const matchedNames = getMatchedKitHostNames(block, kitNames, kitTargets);
    if (matchedNames.length > 0) {
      conflicts.add(block.aliases.join(" "));
    }
  }
  return [...conflicts].sort();
}

function getMatchedKitHostNames(
  block: HostBlock,
  kitNames: Set<string>,
  kitTargets: HostTargetMaps
): string[] {
  const matchedNames = new Set<string>();
  for (const alias of block.aliases) {
    if (kitNames.has(alias)) {
      matchedNames.add(alias);
    }
  }
  if (block.endpointKey) {
    for (const name of kitTargets.byEndpoint.get(block.endpointKey) ?? []) {
      matchedNames.add(name);
    }
  }
  if (block.addressKey) {
    for (const name of kitTargets.byAddress.get(block.addressKey) ?? []) {
      matchedNames.add(name);
    }
  }
  return [...matchedNames];
}

interface HostTargetMaps {
  byEndpoint: Map<string, string[]>;
  byAddress: Map<string, string[]>;
}

function buildHostTargetMaps(hosts: SSHHost[]): HostTargetMaps {
  const byEndpoint = new Map<string, string[]>();
  const byAddress = new Map<string, string[]>();
  for (const host of hosts) {
    const endpointKey = getHostEndpointKey(host);
    const addressKey = getHostAddressKey(host);
    byEndpoint.set(endpointKey, [...(byEndpoint.get(endpointKey) ?? []), host.name]);
    byAddress.set(addressKey, [...(byAddress.get(addressKey) ?? []), host.name]);
  }
  return { byEndpoint, byAddress };
}

function getHostEndpointKey(host: SSHHost): string {
  return formatEndpointKey(host.hostname, host.port, host.username);
}

function getHostAddressKey(host: SSHHost): string {
  return formatAddressKey(host.hostname, host.port);
}

function getHostBlockEndpointKey(text: string, aliases: string[]): string | undefined {
  const target = getHostBlockTarget(text, aliases);
  return target ? formatEndpointKey(target.hostname, target.port, target.username) : undefined;
}

function getHostBlockAddressKey(text: string, aliases: string[]): string | undefined {
  const target = getHostBlockTarget(text, aliases);
  return target ? formatAddressKey(target.hostname, target.port) : undefined;
}

function getHostBlockTarget(
  text: string,
  aliases: string[]
): { hostname: string; port: number; username: string } | undefined {
  const section = parseSections(text)[0];
  if (!section) {return undefined;}
  const hostname = getLastDirective(section.props, "hostname") ?? aliases[0];
  const port = parseInt(getLastDirective(section.props, "port") ?? "22", 10);
  const username = getLastDirective(section.props, "user") ?? "";
  return {
    hostname,
    port: Number.isFinite(port) ? port : 22,
    username,
  };
}

function formatEndpointKey(hostname: string, port: number, username: string): string {
  return [
    hostname.trim().toLowerCase(),
    String(port || 22),
    username.trim().toLowerCase(),
  ].join("\u0000");
}

function formatAddressKey(hostname: string, port: number): string {
  return [
    hostname.trim().toLowerCase(),
    String(port || 22),
  ].join("\u0000");
}

/** Join preserved user config and generated SSH Kit blocks with stable spacing. */
function joinConfigParts(preservedText: string, managedText: string): string {
  const parts = [preservedText.trimEnd(), managedText.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join("\n\n") + "\n" : "";
}
