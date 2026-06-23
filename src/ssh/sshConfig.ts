// SSH Kit — SSH config import/export (zero external dependencies)
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { SSHHost, SSHGroup } from "../core/types";

/** Default SSH config file path */
function defaultConfigPath(): string {
  return path.join(os.homedir(), ".ssh", "config");
}

// ─── Data structures ──────────────────────────────────────────────────────

/** Parsed Host section */
interface HostSection {
  aliases: string[];                 // Host alias list
  props: Record<string, string>;     // Directive → value map
}

/** Raw Host block with source text offsets, used to preserve user config text */
interface HostBlock {
  aliases: string[];
  text: string;
  start: number;
  end: number;
  managed: boolean;
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
        aliases: value.split(/\s+/).filter(Boolean),
        props: {},
      };
    } else if (current) {
      // Section-level directive (stored lowercase for lookup)
      current.props[directive] = value;
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
    throw new Error(`SSH config 文件不存在：${resolvedPath}`);
  }

  const rawText = readConfigWithIncludes(resolvedPath);
  const sections = parseSections(rawText);

  const hosts: Omit<SSHHost, "id">[] = [];

  for (const section of sections) {
    // Skip wildcard Host *
    if (section.aliases.length === 1 && section.aliases[0] === "*") {continue;}

    const hostname = section.props.hostname ?? section.aliases[0];
    const port = parseInt(section.props.port ?? "22", 10);
    const username = section.props.user ?? "";
    const identityFile = section.props.identityfile;

    for (const alias of section.aliases) {
      hosts.push({
        name: alias,
        hostname,
        port,
        username,
        identityFile: identityFile || undefined,
        tags: [],
        extraConfig: section.props,
      });
    }
  }

  return { hosts, groups: [] };
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

      const includePatterns = splitIncludePatterns(match[1].trim());
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

/** Split an Include directive into path patterns (quotes preserve spaces). */
function splitIncludePatterns(value: string): string[] {
  const patterns: string[] = [];
  const tokenRegex = /"([^"]+)"|'([^']+)'|(\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(value)) !== null) {
    patterns.push(match[1] ?? match[2] ?? match[3]);
  }

  return patterns;
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
  lines.push(`Host ${host.name}`);
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
      lines.push(`  ${key} ${value}`);
    }
  }
  return lines.join("\n");
}

/** Marker for SSH Kit managed blocks */
const MANAGED_MARKER = "# SSH Kit managed";

/** Export statistics */
export interface ExportStats {
  added: number;        // New hosts (not present in config)
  synced: number;       // Existing matching hosts that will be updated
  preserved: number;    // Non-Kit sections left untouched
  conflicts: string[];  // Existing unmanaged Host aliases that need confirmation
}

/** Export behavior options */
export interface ExportOptions {
  overwriteUnmanaged?: boolean; // Allow taking over same-name Host blocks without the marker
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
  const syncedNames = new Set<string>();
  const conflictNames = new Set<string>();
  let preserved = 0;

  if (fs.existsSync(resolvedPath)) {
    const existing = fs.readFileSync(resolvedPath, "utf-8");
    const blocks = findHostBlocks(existing);
    for (const block of blocks) {
      const matchedAliases = block.aliases.filter((alias) => kitNames.has(alias));
      if (matchedAliases.length > 0) {
        const targetSet = block.managed ? syncedNames : conflictNames;
        for (const alias of matchedAliases) {
          targetSet.add(alias);
        }
      } else {
        preserved++;
      }
    }
  }

  const added = hosts.filter((h) => !syncedNames.has(h.name) && !conflictNames.has(h.name)).length;
  return {
    added,
    synced: syncedNames.size,
    preserved,
    conflicts: [...conflictNames].sort(),
  };
}

/**
 * Merge hosts into the SSH config file.
 * Safety strategy:
 * 1. Back up original as config.bak.YYYYMMDD-HHmmss
 * 2. Preserve unrelated raw config text untouched
 * 3. Update matching Host blocks and append new SSH Kit hosts
 * 4. Append the managed marker line at the end of each section
 * @returns path of the written file
 */
export function exportToSSHConfig(
  hosts: SSHHost[],
  configPath?: string,
  options: ExportOptions = {}
): string {
  if (hosts.length === 0) {
    throw new Error("没有可导出的主机。");
  }

  const resolvedPath = configPath ?? defaultConfigPath();
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 备份原文件（精确到秒）
  if (fs.existsSync(resolvedPath)) {
    const now = new Date();
    const ts = now.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
    const bakPath = resolvedPath + ".bak." + ts;
    fs.copyFileSync(resolvedPath, bakPath);
  }

  const existing = fs.existsSync(resolvedPath)
    ? fs.readFileSync(resolvedPath, "utf-8")
    : "";
  const existingBlocks = findHostBlocks(existing);
  const kitNames = new Set(hosts.map((h) => h.name));
  const conflicts = findUnmanagedConflicts(existingBlocks, kitNames);
  if (conflicts.length > 0 && !options.overwriteUnmanaged) {
    throw new Error(
      `发现同名但非 SSH Kit 托管的 Host：${conflicts.join(", ")}。请确认接管后再写入。`
    );
  }
  let preservedText = "";

  // Preserve existing text outside matching Host blocks. This keeps comments,
  // Include directives, Match sections, and unrelated Host blocks intact.
  if (fs.existsSync(resolvedPath)) {
    let cursor = 0;
    for (const block of existingBlocks) {
      preservedText += existing.slice(cursor, block.start);
      const matchesKitHost = block.aliases.some((alias) => kitNames.has(alias));
      if (matchesKitHost && (block.managed || options.overwriteUnmanaged)) {
        // Matching blocks are replaced by the generated SSH Kit block below.
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
 * 将主机列表格式化为 SSH config 文本（不写文件，预览用）
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
    sections.push({
      kind: match[1].toLowerCase(),
      value: match[2].trim(),
      start: match.index,
    });
  }

  const blocks: HostBlock[] = [];
  for (let index = 0; index < sections.length; index++) {
    const section = sections[index];
    if (section.kind !== "host") {continue;}

    const end = sections[index + 1]?.start ?? rawText.length;
    const text = rawText.slice(section.start, end);
    blocks.push({
      aliases: section.value.split(/\s+/).filter(Boolean),
      text,
      start: section.start,
      end,
      managed: text.includes(MANAGED_MARKER),
    });
  }

  return blocks;
}

/** Find same-name Host aliases that exist but are not managed by SSH Kit. */
function findUnmanagedConflicts(blocks: HostBlock[], kitNames: Set<string>): string[] {
  const conflicts = new Set<string>();
  for (const block of blocks) {
    if (block.managed) {continue;}
    for (const alias of block.aliases) {
      if (kitNames.has(alias)) {
        conflicts.add(alias);
      }
    }
  }
  return [...conflicts].sort();
}

/** Join preserved user config and generated SSH Kit blocks with stable spacing. */
function joinConfigParts(preservedText: string, managedText: string): string {
  const parts = [preservedText.trimEnd(), managedText.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join("\n\n") + "\n" : "";
}
