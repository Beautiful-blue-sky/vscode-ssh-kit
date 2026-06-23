// SSH Kit — SSH key management module (scan, generate, fingerprint, export)
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as cp from "child_process";

/** Well-known SSH private key file names (without .pub suffix) */
const KNOWN_KEY_NAMES = new Set([
  "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519", "id_ed25519_sk",
  "id_ecdsa_sk", "identity",
]);

/** Key metadata */
export interface KeyInfo {
  /** File name (without path) */
  name: string;
  /** Absolute path to private key */
  privateKeyPath: string;
  /** Absolute path to public key (if present) */
  publicKeyPath?: string;
  /** Key type: rsa / ed25519 / ecdsa / dsa / unknown */
  type: string;
  /** Fingerprint (ssh-keygen -lf output) */
  fingerprint?: string;
}

// ─── Key discovery ────────────────────────────────────────────────────────

/** Scan ~/.ssh/ and list all SSH private keys */
export function listKeys(): KeyInfo[] {
  const sshDir = path.join(os.homedir(), ".ssh");
  if (!fs.existsSync(sshDir)) {
    return [];
  }

  const entries = fs.readdirSync(sshDir);
  const keys: KeyInfo[] = [];

  for (const entry of entries) {
    const fullPath = path.join(sshDir, entry);
    // statSync may throw on permission errors; silently skip
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

  // Sort well-known key names first
  keys.sort((a, b) => {
    const aKnown = KNOWN_KEY_NAMES.has(a.name) ? 0 : 1;
    const bKnown = KNOWN_KEY_NAMES.has(b.name) ? 0 : 1;
    return aKnown - bKnown || a.name.localeCompare(b.name);
  });

  return keys;
}

/** Guess key type from file name */
function detectKeyType(name: string): string {
  if (name.includes("ed25519_sk")) {return "ed25519-sk";}
  if (name.includes("ed25519")) {return "ed25519";}
  if (name.includes("ecdsa_sk")) {return "ecdsa-sk";}
  if (name.includes("ecdsa")) {return "ecdsa";}
  if (name.includes("rsa")) {return "rsa";}
  if (name.includes("dsa")) {return "dsa";}
  return "unknown";
}

/** Skip known non-key SSH files (pub, config, known_hosts, backups, etc.) */
function isSkippableSSHFile(entry: string): boolean {
  if (entry.endsWith(".pub")) {return true;}
  // Well-known non-key files
  const known = ["config", "known_hosts", "known_hosts.old", "authorized_keys", "environment"];
  if (known.includes(entry)) {return true;}
  // Config backup files (config.bak.YYYYMMDD-HHmmss)
  if (entry.startsWith("config.bak.")) {return true;}
  // Common non-key file extensions
  const ext = path.extname(entry).toLowerCase();
  const nonKeyExts = [".zip", ".tar", ".gz", ".7z", ".bak", ".old", ".txt", ".md", ".ppk"];
  if (nonKeyExts.includes(ext)) {return true;}
  return false;
}

// ─── Fingerprint lookup ───────────────────────────────────────────────────

/** Get key fingerprint via ssh-keygen -lf */
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

/** Populate fingerprints for a list of keys (sequential, concurrency-safe) */
export function populateFingerprints(keys: KeyInfo[]): void {
  for (const key of keys) {
    key.fingerprint = getKeyFingerprint(key.privateKeyPath);
  }
}

// ─── Key generation ───────────────────────────────────────────────────────

/** Supported key types */
export type KeyType = "ed25519" | "rsa" | "ecdsa";

/** Key generation options */
export interface KeyGenOptions {
  type: KeyType;
  name: string;
  comment?: string;
  bits?: number;       // RSA only, default 4096
  passphrase?: string; // Empty string = no passphrase
}

/**
 * Generate a key pair using ssh-keygen.
 * Illegal characters (including spaces) in the file name are replaced with underscores.
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

/** Generate an ed25519 key pair (convenience wrapper for legacy API) */
export function generateEd25519Key(
  name: string,
  comment?: string
): { privateKeyPath: string; publicKeyPath: string } {
  return generateKeyPair({ type: "ed25519", name, comment });
}

// ─── Key management operations ────────────────────────────────────────────

/** Delete a key pair (private key + public key) */
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

/** Rename a key pair (stays in the same directory) */
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

// ─── Public key reading ───────────────────────────────────────────────────

/** Read public key file content */
export function readPublicKey(publicKeyPath: string): string {
  if (!fs.existsSync(publicKeyPath)) {
    throw new Error(`公钥文件不存在：${publicKeyPath}`);
  }
  return fs.readFileSync(publicKeyPath, "utf-8").trim();
}

// ─── Key import/export (for backup/restore) ────────────────────────────────

/** Serialized key file entry */
export interface KeyFileEntry {
  name: string;
  type: string;
  privateKey: string;  // Base64-encoded
  publicKey?: string;   // Base64-encoded
}

/** Export all key files as base64 for backup */
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

/** Restore key files from backup to ~/.ssh/, skipping existing ones */
export function importKeyFiles(entries: KeyFileEntry[]): number {
  const sshDir = path.join(os.homedir(), ".ssh");
  if (!fs.existsSync(sshDir)) {
    fs.mkdirSync(sshDir, { mode: 0o700 });
  }

  // Windows does not support Unix permission model; only set on POSIX
  const isWindows = process.platform === "win32";
  const privateMode = isWindows ? undefined : 0o600;
  const publicMode = isWindows ? undefined : 0o644;

  let written = 0;
  for (const entry of entries) {
    // Sanitize: reject path traversal, replace illegal characters
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
