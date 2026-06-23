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

  let content = fs.readFileSync(resolved, "utf-8");
  const includeRegex = /^\s*Include\s+(.+)$/gm;

  let match: RegExpExecArray | null;
  while ((match = includeRegex.exec(content)) !== null) {
    const includePattern = match[1].trim();
    const includedContent = resolveIncludeFiles(includePattern, resolved, visited);
    content = content.replace(match[0], includedContent);
  }

  return content;
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

  const regex = new RegExp(
    "^" + filename.replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
  );

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
  synced: number;       // Already managed (present in config with SSH Kit marker)
  preserved: number;    // Non-Kit sections left untouched
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
  let preserved = 0;
  let synced = 0;

  if (fs.existsSync(resolvedPath)) {
    const existing = fs.readFileSync(resolvedPath, "utf-8");
    const sections = parseSections(existing);
    for (const section of sections) {
      const key = section.aliases[0];
      if (kitNames.has(key)) {
        const block = formatHostSectionFromSections(section);
        if (block.includes(MANAGED_MARKER)) {
          synced++;
        }
      } else {
        preserved++;
      }
    }
  }

  const added = hosts.length - synced;
  return { added, synced, preserved };
}

/**
 * Merge hosts into the SSH config file.
 * Safety strategy:
 * 1. Back up original as config.bak.YYYYMMDD-HHmmss
 * 2. Preserve non-Kit Host sections untouched
 * 3. Only update or append SSH Kit-managed hosts
 * 4. Append the managed marker line at the end of each section
 * @returns path of the written file
 */
export function exportToSSHConfig(
  hosts: SSHHost[],
  configPath?: string
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

  const kitNames = new Set(hosts.map((h) => h.name));
  const parts: string[] = [];

  // 保留非 SSH Kit 托管的已有段落
  if (fs.existsSync(resolvedPath)) {
    const existing = fs.readFileSync(resolvedPath, "utf-8");
    const sections = parseSections(existing);
    for (const section of sections) {
      const key = section.aliases[0];
      if (!kitNames.has(key)) {
        parts.push(formatHostSectionFromSections(section));
      }
    }
  }

  // 追加 SSH Kit 主机（带标记）
  for (const host of hosts) {
    parts.push(formatHostSection(host) + "\n  " + MANAGED_MARKER);
  }

  const merged = parts.join("\n\n") + (parts.length > 0 ? "\n" : "");
  fs.writeFileSync(resolvedPath, merged, "utf-8");
  return resolvedPath;
}

/** 从 HostSection 格式化为文本（兼容旧 parse 输出） */
function formatHostSectionFromSections(section: HostSection): string {
  const lines: string[] = [];
  lines.push(`Host ${section.aliases.join(" ")}`);
  for (const [key, value] of Object.entries(section.props)) {
    lines.push(`  ${key} ${value}`);
  }
  return lines.join("\n");
}

/**
 * 将主机列表格式化为 SSH config 文本（不写文件，预览用）
 */
export function stringifyHosts(hosts: SSHHost[]): string {
  if (hosts.length === 0) {return "";}

  return hosts.map(formatHostSection).join("\n\n") + "\n";
}
