// SSH Kit — SSH config import/export (zero external dependencies)
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as vscode from "vscode";
import { resolveHostAuthMode, SSHHost, SSHGroup } from "../core/types";
import {
  assertSingleLineSSHConfigValue,
  formatSSHConfigWord,
  formatSSHDirectiveKey,
  formatSSHIdentityFile,
  splitSSHConfigWords,
} from "./configText";

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

    const parsed = parseDirectiveLine(trimmed);
    if (!parsed) {continue;}
    const { directive, value } = parsed;

    if (directive === "host") {
      // New Host section starts; save the previous one
      if (current) {sections.push(current);}
      current = {
        aliases: splitSSHConfigWords(value),
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

    const hostname = getFirstDirectiveWord(section.props, "hostname") ?? concreteAliases[0];
    const parsedPort = Number.parseInt(getFirstDirectiveWord(section.props, "port") ?? "22", 10);
    const port = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535
      ? parsedPort
      : 22;
    const username = getFirstDirectiveWord(section.props, "user") ?? "";
    const identityFile = getFirstDirectiveWord(section.props, "identityfile");
    const extraConfig = toExtraConfig(section.props);
    const authMode = resolveHostAuthMode({
      identityFile,
      extraConfig,
    });

    for (const alias of concreteAliases) {
      hosts.push({
        name: alias,
        hostname,
        port,
        username,
        authMode,
        identityFile: authMode === "identityFile" ? identityFile : undefined,
        tags: [],
        extraConfig,
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
  visited = new Set<string>(),
  includedFile = false
): string {
  const resolvedPath = path.resolve(filePath);
  const resolved = fs.realpathSync.native(resolvedPath);
  const visitKey = process.platform === "win32"
    ? resolved.toLocaleLowerCase()
    : resolved;
  if (visited.has(visitKey)) {return "";} // Prevent circular references and symlink aliases
  visited.add(visitKey);

  const content = fs.readFileSync(resolved, "utf-8");
  if (
    includedFile &&
    content.startsWith("# This file is generated by SSH Kit. Manual changes will be overwritten.")
  ) {
    return "";
  }
  return content
    .split(/\r?\n/)
    .map((line) => {
      const parsed = parseDirectiveLine(line);
      if (parsed?.directive !== "include") {return line;}

      const includePatterns = splitSSHConfigWords(parsed.value);
      return includePatterns
        .map((includePattern) => resolveIncludeFiles(includePattern, visited))
        .join("\n");
    })
    .join("\n");
}

/** Resolve Include pattern to matching files and recursively read them */
function resolveIncludeFiles(
  pattern: string,
  visited: Set<string>
): string {
  const expanded = pattern.startsWith("~")
    ? path.join(os.homedir(), pattern.slice(1))
    : pattern;

  const fullPattern = path.isAbsolute(expanded)
    ? expanded
    // OpenSSH resolves relative user-config Includes from ~/.ssh, including
    // when the root config was selected with -F / remote.SSH.configFile.
    : path.resolve(path.join(os.homedir(), ".ssh"), expanded);

  if (fs.existsSync(fullPattern) && fs.statSync(fullPattern).isFile()) {
    return readConfigWithIncludes(fullPattern, visited, true);
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
    .map((f: string) => readConfigWithIncludes(f, visited, true))
    .join("\n");
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
  const authMode = resolveHostAuthMode(host);
  const lines: string[] = [];
  lines.push(`Host ${formatSSHConfigWord(host.name)}`);
  lines.push(`  HostName ${formatSSHConfigWord(host.hostname)}`);
  if (host.port && host.port !== 22) {
    lines.push(`  Port ${host.port}`);
  }
  if (host.username) {
    lines.push(`  User ${formatSSHConfigWord(host.username)}`);
  }
  if (authMode === "identityFile" && host.identityFile) {
    lines.push(`  IdentityFile ${formatSSHIdentityFile(host.identityFile)}`);
    lines.push("  IdentitiesOnly yes");
  } else if (authMode === "password") {
    lines.push("  PubkeyAuthentication no");
    lines.push("  PreferredAuthentications keyboard-interactive,password");
  }
  // Preserve additional config directives
  if (host.extraConfig) {
    for (const [key, value] of Object.entries(host.extraConfig)) {
      const kl = key.toLowerCase();
      if (isCoreHostDirective(kl) || (
        authMode !== "auto" && isManagedAuthenticationDirective(kl)
      )) {continue;}
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) {
        assertSingleLineSSHConfigValue(item);
        lines.push(`  ${formatSSHDirectiveKey(key)} ${item}`);
      }
    }
  }
  return lines.join("\n");
}

function isCoreHostDirective(key: string): boolean {
  return ["host", "hostname", "port", "user", "identityfile"].includes(key);
}

function isManagedAuthenticationDirective(key: string): boolean {
  return [
    "identitiesonly",
    "preferredauthentications",
    "pubkeyauthentication",
  ].includes(key);
}

function getFirstDirective(
  props: Record<string, string[]>,
  key: string
): string | undefined {
  const values = props[key.toLowerCase()];
  return values?.[0];
}

function getFirstDirectiveWord(
  props: Record<string, string[]>,
  key: string
): string | undefined {
  const value = getFirstDirective(props, key);
  return value ? splitSSHConfigWords(value)[0] : undefined;
}

function parseDirectiveLine(
  line: string
): { directive: string; value: string } | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {return undefined;}
  const match = trimmed.match(/^([A-Za-z][A-Za-z0-9]*)\s*(?:=\s*|\s+)(.*)$/);
  if (!match) {return undefined;}
  return {
    directive: match[1].toLowerCase(),
    value: match[2].trim(),
  };
}

function toExtraConfig(props: Record<string, string[]>): Record<string, string | string[]> {
  const extraConfig: Record<string, string | string[]> = {};
  for (const [key, values] of Object.entries(props)) {
    extraConfig[key] = values.length === 1 ? values[0] : [...values];
  }
  return extraConfig;
}

/**
 * Export the current SSH Kit host list to an explicit standalone file.
 * @returns path of the written file
 */
export function exportToSSHConfig(
  hosts: SSHHost[],
  configPath: string
): string {
  if (hosts.length === 0) {
    throw new Error(vscode.l10n.t("There are no hosts to export."));
  }

  const resolvedPath = path.resolve(configPath);
  const targetPath = fs.existsSync(resolvedPath) && fs.lstatSync(resolvedPath).isSymbolicLink()
    ? fs.realpathSync.native(resolvedPath)
    : resolvedPath;
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tempPath = path.join(
    dir,
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`
  );
  try {
    fs.writeFileSync(tempPath, stringifyHosts(hosts), "utf-8");
    fs.renameSync(tempPath, targetPath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
  return resolvedPath;
}

/**
 * Format hosts as SSH Config text without writing a file (used for previews).
 */
export function stringifyHosts(hosts: SSHHost[]): string {
  if (hosts.length === 0) {return "";}

  return hosts.map(formatHostSection).join("\n\n") + "\n";
}
