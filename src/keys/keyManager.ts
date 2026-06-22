// SSH Kit —— SSH 密钥管理模块（读取/生成/指纹/复制公钥）
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as cp from "child_process";

/** 已知 SSH 私钥文件名模式（不含 .pub 后缀） */
const KNOWN_KEY_NAMES = new Set([
  "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519", "id_ed25519_sk",
  "id_ecdsa_sk", "identity",
]);

/** 密钥信息 */
export interface KeyInfo {
  /** 文件名（不含路径） */
  name: string;
  /** 私钥绝对路径 */
  privateKeyPath: string;
  /** 公钥绝对路径（如果存在） */
  publicKeyPath?: string;
  /** 密钥类型：rsa / ed25519 / ecdsa / dsa / unknown */
  type: string;
  /** 指纹（ssh-keygen -lf 输出） */
  fingerprint?: string;
}

// ─── 密钥发现 ──────────────────────────────────────────────────────────────

/** 扫描 ~/.ssh/ 目录，列出所有 SSH 密钥 */
export function listKeys(): KeyInfo[] {
  const sshDir = path.join(os.homedir(), ".ssh");
  if (!fs.existsSync(sshDir)) {
    return [];
  }

  const entries = fs.readdirSync(sshDir);
  const keys: KeyInfo[] = [];

  for (const entry of entries) {
    const fullPath = path.join(sshDir, entry);
    // statSync 可能因权限问题抛异常，静默跳过
    let isFile = false;
    try { isFile = fs.statSync(fullPath).isFile(); } catch { continue; }
    if (!isFile) {continue;}
    if (isSkippableSSHFile(entry)) {continue;}

    const publicKeyPath = fullPath + ".pub";
    const hasPublicKey = fs.existsSync(publicKeyPath);
    keys.push({
      name: entry,
      privateKeyPath: fullPath,
      publicKeyPath: hasPublicKey ? publicKeyPath : undefined,
      type: detectKeyType(entry),
    });
  }

  // 已知密钥名排前面
  keys.sort((a, b) => {
    const aKnown = KNOWN_KEY_NAMES.has(a.name) ? 0 : 1;
    const bKnown = KNOWN_KEY_NAMES.has(b.name) ? 0 : 1;
    return aKnown - bKnown || a.name.localeCompare(b.name);
  });

  return keys;
}

/** 根据文件名推测密钥类型 */
function detectKeyType(name: string): string {
  if (name.includes("ed25519_sk")) {return "ed25519-sk";}
  if (name.includes("ed25519")) {return "ed25519";}
  if (name.includes("ecdsa_sk")) {return "ecdsa-sk";}
  if (name.includes("ecdsa")) {return "ecdsa";}
  if (name.includes("rsa")) {return "rsa";}
  if (name.includes("dsa")) {return "dsa";}
  return "unknown";
}

/** 跳过非密钥的已知 SSH 文件（公钥/config/known_hosts/备份等） */
function isSkippableSSHFile(entry: string): boolean {
  if (entry.endsWith(".pub")) {return true;}
  // 已知非密钥文件
  const known = ["config", "known_hosts", "known_hosts.old", "authorized_keys", "environment"];
  if (known.includes(entry)) {return true;}
  // config 备份文件 (config.bak.YYYYMMDD-HHmmss)
  if (entry.startsWith("config.bak.")) {return true;}
  // 常见非密钥扩展名
  const ext = path.extname(entry).toLowerCase();
  const nonKeyExts = [".zip", ".tar", ".gz", ".7z", ".bak", ".old", ".txt", ".md", ".ppk"];
  if (nonKeyExts.includes(ext)) {return true;}
  return false;
}

// ─── 指纹查询 ──────────────────────────────────────────────────────────────

/** 通过 ssh-keygen -lf 获取密钥指纹 */
export function getKeyFingerprint(privateKeyPath: string): string | undefined {
  try {
    const result = cp.spawnSync("ssh-keygen", ["-lf", privateKeyPath], {
      encoding: "utf-8",
      timeout: 5000,
    });
    if (result.status !== 0 || !result.stdout) {return undefined;}
    return result.stdout.trim();
  } catch {
    return undefined;
  }
}

/** 批量获取密钥指纹（并发友好，逐个执行） */
export function populateFingerprints(keys: KeyInfo[]): void {
  for (const key of keys) {
    key.fingerprint = getKeyFingerprint(key.privateKeyPath);
  }
}

// ─── 密钥生成 ──────────────────────────────────────────────────────────────

/** 支持的密钥类型 */
export type KeyType = "ed25519" | "rsa" | "ecdsa";

/** 密钥生成选项 */
export interface KeyGenOptions {
  type: KeyType;
  name: string;
  comment?: string;
  bits?: number;       // RSA 专用，默认 4096
  passphrase?: string; // 空字符串 = 无密码
}

/**
 * 使用 ssh-keygen 生成密钥对。
 * 文件名中的非法字符（含空格）会被自动替换为下划线。
 */
export function generateKeyPair(options: KeyGenOptions): { privateKeyPath: string; publicKeyPath: string } {
  const sshDir = path.join(os.homedir(), ".ssh");
  if (!fs.existsSync(sshDir)) {
    fs.mkdirSync(sshDir, { mode: 0o700 });
  }

  const safeName = options.name.replace(/[\\/:"*?<>| ]/g, "_");
  const keyPath = path.join(sshDir, safeName);

  if (fs.existsSync(keyPath)) {
    throw new Error(`密钥文件已存在：${keyPath}`);
  }

  const args: string[] = ["-t", options.type, "-f", keyPath, "-N", options.passphrase ?? ""];
  if (options.type === "rsa") {
    args.push("-b", String(options.bits ?? 4096));
  }
  if (options.comment) {
    args.push("-C", options.comment);
  }

  const result = cp.spawnSync("ssh-keygen", args, {
    encoding: "utf-8",
    timeout: 30000,
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.trim() || "";
    throw new Error(stderr || "ssh-keygen 执行失败");
  }

  return {
    privateKeyPath: keyPath,
    publicKeyPath: keyPath + ".pub",
  };
}

/** 生成 ed25519 密钥对（便捷封装，兼容旧接口） */
export function generateEd25519Key(
  name: string,
  comment?: string
): { privateKeyPath: string; publicKeyPath: string } {
  return generateKeyPair({ type: "ed25519", name, comment });
}

// ─── 密钥管理 ──────────────────────────────────────────────────────────────

/** 删除密钥对（私钥 + 公钥） */
export function deleteKeyPair(privateKeyPath: string): void {
  if (!fs.existsSync(privateKeyPath)) {
    throw new Error(`密钥文件不存在：${privateKeyPath}`);
  }
  fs.unlinkSync(privateKeyPath);
  const pubPath = privateKeyPath + ".pub";
  if (fs.existsSync(pubPath)) {
    fs.unlinkSync(pubPath);
  }
}

/** 重命名密钥对（保持在同一目录） */
export function renameKeyPair(oldPrivatePath: string, newName: string): string {
  if (!fs.existsSync(oldPrivatePath)) {
    throw new Error(`密钥文件不存在：${oldPrivatePath}`);
  }
  const dir = path.dirname(oldPrivatePath);
  const safeName = newName.replace(/[\\/:"*?<>| ]/g, "_");
  const newPrivatePath = path.join(dir, safeName);
  const newPublicPath = newPrivatePath + ".pub";

  if (fs.existsSync(newPrivatePath)) {
    throw new Error(`目标文件已存在：${newPrivatePath}`);
  }

  fs.renameSync(oldPrivatePath, newPrivatePath);
  const oldPubPath = oldPrivatePath + ".pub";
  if (fs.existsSync(oldPubPath)) {
    fs.renameSync(oldPubPath, newPublicPath);
  }
  return newPrivatePath;
}

// ─── 公钥读取 ──────────────────────────────────────────────────────────────

/** 读取公钥文件内容 */
export function readPublicKey(publicKeyPath: string): string {
  if (!fs.existsSync(publicKeyPath)) {
    throw new Error(`公钥文件不存在：${publicKeyPath}`);
  }
  return fs.readFileSync(publicKeyPath, "utf-8").trim();
}

// ─── 密钥导入/导出（备份恢复用）────────────────────────────────────────────

/** 密钥文件序列化结构 */
export interface KeyFileEntry {
  name: string;
  type: string;
  privateKey: string;  // base64
  publicKey?: string;   // base64
}

/** 导出所有密钥文件为 base64 编码（用于备份） */
export function exportKeyFiles(): KeyFileEntry[] {
  const keys = listKeys();
  return keys.map((k) => ({
    name: k.name,
    type: k.type,
    privateKey: fs.readFileSync(k.privateKeyPath).toString("base64"),
    publicKey: k.publicKeyPath
      ? fs.readFileSync(k.publicKeyPath).toString("base64")
      : undefined,
  }));
}

/** 从备份恢复密钥文件到 ~/.ssh/，跳过已存在的 */
export function importKeyFiles(entries: KeyFileEntry[]): number {
  const sshDir = path.join(os.homedir(), ".ssh");
  if (!fs.existsSync(sshDir)) {
    fs.mkdirSync(sshDir, { mode: 0o700 });
  }

  // Windows 不支持 Unix 权限模型，仅在 POSIX 系统设 mode
  const isWindows = process.platform === "win32";
  const privateMode = isWindows ? undefined : 0o600;
  const publicMode = isWindows ? undefined : 0o644;

  let written = 0;
  for (const entry of entries) {
    // 安全清洗：拒绝路径遍历，替换非法字符
    const safeName = entry.name.replace(/[\\/:"*?<>| ]/g, "_").replace(/\.\./g, "");
    if (!safeName) {continue;}
    const privatePath = path.join(sshDir, safeName);
    const publicPath = privatePath + ".pub";

    if (fs.existsSync(privatePath)) {continue;}

    fs.writeFileSync(privatePath, Buffer.from(entry.privateKey, "base64"), { mode: privateMode });
    written++;

    if (entry.publicKey) {
      fs.writeFileSync(publicPath, Buffer.from(entry.publicKey, "base64"), { mode: publicMode });
    }
  }
  return written;
}
