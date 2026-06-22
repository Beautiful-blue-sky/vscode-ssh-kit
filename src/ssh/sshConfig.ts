// SSH Kit —— SSH config 导入/导出工具（自研 parser，零外部依赖）
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { SSHHost, SSHGroup } from "../core/types";

/** 默认 SSH config 路径 */
function defaultConfigPath(): string {
  return path.join(os.homedir(), ".ssh", "config");
}

// ─── 数据结构 ─────────────────────────────────────────────────────────────

/** 解析后的 Host 段 */
interface HostSection {
  aliases: string[];                 // Host 别名列表
  props: Record<string, string>;     // 配置键值对（directive → value）
}

// ─── 解析器 ───────────────────────────────────────────────────────────────

/**
 * 解析 SSH config 文本为 Host 段列表
 * 处理续行符（\）、注释行（#）
 */
function parseSections(rawText: string): HostSection[] {
  const lines = normalizeLines(rawText);
  const sections: HostSection[] = [];
  let current: HostSection | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    // 跳过空行和注释
    if (!trimmed || trimmed.startsWith("#")) {continue;}

    // 解析 directive value
    const spaceIdx = trimmed.search(/\s/);
    if (spaceIdx === -1) {continue;}
    const directive = trimmed.slice(0, spaceIdx).toLowerCase();
    const value = trimmed.slice(spaceIdx + 1).trim();

    if (directive === "host") {
      // 新 Host 段开始，保存上一个
      if (current) {sections.push(current);}
      current = {
        aliases: value.split(/\s+/).filter(Boolean),
        props: {},
      };
    } else if (current) {
      // 段内配置项（key 存小写以便查找）
      current.props[directive] = value;
    }
    // 段外的顶层指令（如全局 IdentityFile）暂忽略，Phase 1 只处理 Host 段
  }

  if (current) {sections.push(current);}
  return sections;
}

/**
 * 将原始文本规范化为行数组（处理续行符 \）
 */
function normalizeLines(rawText: string): string[] {
  // 合并续行：行尾 \ 表示下一行是续行
  const merged = rawText.replace(/\\\r?\n\s*/g, " ");
  return merged.split(/\r?\n/);
}

// ─── 导入 ─────────────────────────────────────────────────────────────────

/**
 * 从 SSH config 文件导入主机列表。
 * 支持 Include 指令的递归解析。
 *
 * **已知限制**：忽略 Host 段外的全局指令（如全局 IdentityFile），
 * 也暂不解析分组信息（groups 始终为空数组）。
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
    // 跳过通配符 Host *
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

// ─── Include 递归解析 ─────────────────────────────────────────────────────

/** 读取 SSH config 并递归解析 Include 指令 */
function readConfigWithIncludes(
  filePath: string,
  visited = new Set<string>()
): string {
  const resolved = path.resolve(filePath);
  if (visited.has(resolved)) {return "";} // 防止循环引用
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

/** 解析 Include 模式匹配的文件并递归读取 */
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

  // glob 匹配（支持 * 通配符）
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

// ─── 导出 ─────────────────────────────────────────────────────────────────

/**
 * 将单台主机格式化为 SSH config 段文本
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
  // 保留额外配置项
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

/** 已导出的 SSH Kit 标记 */
const MANAGED_MARKER = "# SSH Kit managed";

/** 导出统计 */
export interface ExportStats {
  added: number;        // 新增（config 中不存在的）
  synced: number;       // 已同步（config 中已存在且有 SSH Kit 标记）
  preserved: number;    // 非 SSH Kit 段落保留不动
}

/**
 * 分析导出影响，不实际写入。
 * 已带 SSH Kit 标记的段落视为"已同步"而非"新增"。
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
 * 将主机列表合并写入 SSH config。
 * 安全策略：
 * 1. 备份原文件为 config.bak.YYYYMMDD-HHmmss
 * 2. 保留非 SSH Kit 管理的已有 Host 段落不动
 * 3. 仅更新或追加 SSH Kit 管理的主机
 * 4. 段落末尾追加标记行
 * @returns 写入的文件路径
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
