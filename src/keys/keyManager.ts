// SSH Kit — SSH key management module (scan, generate, fingerprint, export)
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as cp from "child_process";
import * as vscode from "vscode";

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
      type: detectKeyType(entry, hasPublicKey ? publicKeyPath : undefined),
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

/** Detect key type from public key content first, then fall back to file name. */
function detectKeyType(name: string, publicKeyPath?: string): string {
  const fromPublicKey = publicKeyPath ? detectKeyTypeFromPublicKey(publicKeyPath) : undefined;
  if (fromPublicKey) {return fromPublicKey;}

  const normalizedName = name.toLowerCase();
  if (normalizedName.includes("ed25519_sk")) {return "ed25519-sk";}
  if (normalizedName.includes("ed25519")) {return "ed25519";}
  if (normalizedName.includes("ecdsa_sk")) {return "ecdsa-sk";}
  if (normalizedName.includes("ecdsa")) {return "ecdsa";}
  if (normalizedName.includes("rsa")) {return "rsa";}
  if (normalizedName.includes("dsa")) {return "dsa";}
  return "unknown";
}

function detectKeyTypeFromPublicKey(publicKeyPath: string): string | undefined {
  try {
    const algorithm = fs.readFileSync(publicKeyPath, "utf-8").trim().split(/\s+/)[0];
    return normalizeKeyAlgorithm(algorithm);
  } catch {
    return undefined;
  }
}

function normalizeKeyAlgorithm(algorithm: string | undefined): string | undefined {
  switch (algorithm) {
    case "ed25519":
    case "ssh-ed25519":
      return "ed25519";
    case "ed25519-sk":
    case "sk-ssh-ed25519@openssh.com":
      return "ed25519-sk";
    case "rsa":
    case "ssh-rsa":
      return "rsa";
    case "dsa":
    case "ssh-dss":
      return "dsa";
    case "ecdsa":
      return "ecdsa";
    case "ecdsa-sk":
    case "sk-ecdsa-sha2-nistp256@openssh.com":
      return "ecdsa-sk";
    default:
      return algorithm?.startsWith("ecdsa-sha2-") ? "ecdsa" : undefined;
  }
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
    if (key.type === "unknown") {
      key.type = detectKeyTypeFromFingerprint(key.fingerprint) ?? key.type;
    }
  }
}

function detectKeyTypeFromFingerprint(fingerprint: string | undefined): string | undefined {
  const match = fingerprint?.match(/\(([^)]+)\)\s*$/);
  return normalizeKeyAlgorithm(match?.[1]?.toLowerCase());
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
    throw new Error(vscode.l10n.t("Key file already exists: {path}", { path: keyPath }));
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
    throw new Error(stderr || vscode.l10n.t("ssh-keygen failed"));
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
    throw new Error(vscode.l10n.t("Key file does not exist: {path}", { path: privateKeyPath }));
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
    throw new Error(vscode.l10n.t("Key file does not exist: {path}", { path: oldPrivatePath }));
  }
  const dir = path.dirname(oldPrivatePath);
  const safeName = newName.replace(/[\\/:"*?<>| ]/g, "_");
  const newPrivatePath = path.join(dir, safeName);
  const newPublicPath = newPrivatePath + ".pub";

  if (fs.existsSync(newPrivatePath)) {
    throw new Error(vscode.l10n.t("Target file already exists: {path}", { path: newPrivatePath }));
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
    throw new Error(vscode.l10n.t("Public key file does not exist: {path}", { path: publicKeyPath }));
  }
  return fs.readFileSync(publicKeyPath, "utf-8").trim();
}

/** Regenerate a public key file from a private key using ssh-keygen -y. */
export function regeneratePublicKey(privateKeyPath: string, overwrite = false): string {
  if (!fs.existsSync(privateKeyPath)) {
    throw new Error(vscode.l10n.t("Private key file does not exist: {path}", { path: privateKeyPath }));
  }

  const publicKeyPath = privateKeyPath + ".pub";
  if (fs.existsSync(publicKeyPath) && !overwrite) {
    throw new Error(vscode.l10n.t("Public key file already exists: {path}", { path: publicKeyPath }));
  }

  const result = cp.spawnSync("ssh-keygen", ["-y", "-f", privateKeyPath], {
    encoding: "utf-8",
    timeout: 10000,
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    const stderr = result.stderr?.trim() || "";
    throw new Error(stderr || vscode.l10n.t("ssh-keygen could not derive a public key from the private key; a passphrase may be required."));
  }

  fs.writeFileSync(publicKeyPath, result.stdout.trim() + "\n", {
    mode: process.platform === "win32" ? undefined : 0o644,
  });
  return publicKeyPath;
}

// ─── Key import/export (for backup/restore) ────────────────────────────────

/** Serialized key file entry */
export interface KeyFileEntry {
  name: string;
  type: string;
  privateKey: string;  // Base64-encoded
  publicKey?: string;   // Base64-encoded
}

export interface ImportKeyFilesResult {
  written: number;
  skipped: number;
  reused: number;
  failed: Array<{ name: string; reason: string }>;
  restoredPaths: Array<{ sourceName: string; targetPath: string }>;
  skippedSourceNames: string[];
  failedSourceNames: string[];
}

export interface KeyFileImportPlan {
  sourceName: string;
  targetName?: string;
  reusePath?: string;
  skip?: boolean;
}

export function sanitizeKeyFileName(name: string): string {
  return name.replace(/[\\/:"*?<>| ]/g, "_").replace(/\.\./g, "");
}

export function getImportKeyTargetPath(name: string): string | undefined {
  const safeName = sanitizeKeyFileName(name);
  return safeName ? path.join(os.homedir(), ".ssh", safeName) : undefined;
}

export function keyFileEntryMatchesPath(entry: KeyFileEntry, privatePath: string): boolean {
  const privateKey = decodeBase64(entry.privateKey);
  if (!privateKey || !fs.existsSync(privatePath)) {return false;}

  if (keyFileEntryMatchesPublicIdentity(entry, privateKey, privatePath)) {
    return true;
  }

  try {
    return fs.readFileSync(privatePath).equals(privateKey);
  } catch {
    return false;
  }
}

export function findExistingKeyFilePath(entry: KeyFileEntry, preferredPath?: string): string | undefined {
  const candidates = new Set<string>();
  if (preferredPath) {
    candidates.add(preferredPath);
  }
  for (const key of listKeys()) {
    candidates.add(key.privateKeyPath);
  }

  return [...candidates].find((candidate) =>
    isPathUnderSshDir(candidate) && keyFileEntryMatchesPath(entry, candidate)
  );
}

/** Export referenced key files as base64 for backup. Pass no paths to export all discovered keys. */
export function exportKeyFiles(identityFiles?: string[]): KeyFileEntry[] {
  const keys = listKeys();
  const selectedKeys = identityFiles === undefined
    ? keys
    : keys.filter((key) => identityFiles.some((identityFile) =>
      areIdentityPathsEquivalent(identityFile, key.privateKeyPath)
    ));

  return selectedKeys.map((k) => ({
      name: k.name,
      type: k.type,
      privateKey: fs.readFileSync(k.privateKeyPath).toString("base64"),
      publicKey: k.publicKeyPath
        ? fs.readFileSync(k.publicKeyPath).toString("base64")
        : undefined,
    }));
}

/** Restore key files from backup to ~/.ssh/ according to an optional conflict plan. */
export function importKeyFiles(entries: KeyFileEntry[], plan: KeyFileImportPlan[] = []): ImportKeyFilesResult {
  const sshDir = path.join(os.homedir(), ".ssh");
  if (!fs.existsSync(sshDir)) {
    fs.mkdirSync(sshDir, { mode: 0o700 });
  }

  // Windows does not support Unix permission model; only set on POSIX
  const isWindows = process.platform === "win32";
  const privateMode = isWindows ? undefined : 0o600;
  const publicMode = isWindows ? undefined : 0o644;

  let written = 0;
  let skipped = 0;
  let reused = 0;
  const failed: ImportKeyFilesResult["failed"] = [];
  const restoredPaths: ImportKeyFilesResult["restoredPaths"] = [];
  const skippedSourceNames: string[] = [];
  const failedSourceNames: string[] = [];
  const plansByName = new Map(plan.map((entry) => [entry.sourceName, entry]));
  for (const entry of entries) {
    const planned = plansByName.get(entry.name);
    if (planned?.skip) {
      skipped++;
      skippedSourceNames.push(entry.name);
      continue;
    }

    if (planned?.reusePath) {
      if (isPathUnderSshDir(planned.reusePath) && keyFileEntryMatchesPath(entry, planned.reusePath)) {
        reused++;
        restoredPaths.push({ sourceName: entry.name, targetPath: planned.reusePath });
      } else {
        failed.push({ name: entry.name, reason: vscode.l10n.t("The key planned for reuse does not exist or is not the same SSH key: {path}", { path: planned.reusePath }) });
        failedSourceNames.push(entry.name);
      }
      continue;
    }

    // Sanitize: reject path traversal, replace illegal characters
    const targetName = planned?.targetName ?? entry.name;
    const safeName = sanitizeKeyFileName(targetName);
    if (!safeName) {
      failed.push({ name: entry.name || "(empty)", reason: vscode.l10n.t("File name is invalid") });
      failedSourceNames.push(entry.name);
      continue;
    }
    const privatePath = path.join(sshDir, safeName);
    const publicPath = privatePath + ".pub";

    if (!planned?.targetName) {
      const existingSameKeyPath = findExistingKeyFilePath(entry, privatePath);
      if (existingSameKeyPath) {
        reused++;
        restoredPaths.push({ sourceName: entry.name, targetPath: existingSameKeyPath });
        continue;
      }
    }

    if (fs.existsSync(privatePath)) {
      if (keyFileEntryMatchesPath(entry, privatePath)) {
        reused++;
        restoredPaths.push({ sourceName: entry.name, targetPath: privatePath });
      } else if (planned?.targetName) {
        failed.push({ name: entry.name, reason: vscode.l10n.t("The target key already exists and is not the same SSH key: {path}", { path: privatePath }) });
        failedSourceNames.push(entry.name);
      } else {
        skipped++;
        skippedSourceNames.push(entry.name);
      }
      continue;
    }

    const privateKey = decodeBase64(entry.privateKey);
    if (!privateKey) {
      failed.push({ name: entry.name, reason: vscode.l10n.t("Private key contents are not valid Base64") });
      failedSourceNames.push(entry.name);
      continue;
    }
    if (!isLikelySSHPrivateKey(privateKey)) {
      failed.push({ name: entry.name, reason: vscode.l10n.t("Private key contents are not a supported SSH private key format") });
      failedSourceNames.push(entry.name);
      continue;
    }

    let publicKey: Buffer | undefined;
    if (entry.publicKey) {
      publicKey = decodeBase64(entry.publicKey);
      if (!publicKey) {
        failed.push({ name: entry.name, reason: vscode.l10n.t("Public key contents are not valid Base64") });
        failedSourceNames.push(entry.name);
        continue;
      }
    }

    try {
      fs.writeFileSync(privatePath, privateKey, { mode: privateMode });
      written++;
      restoredPaths.push({ sourceName: entry.name, targetPath: privatePath });

      if (publicKey) {
        fs.writeFileSync(publicPath, publicKey, { mode: publicMode });
      }
    } catch (error) {
      failed.push({
        name: entry.name,
        reason: error instanceof Error ? error.message : String(error),
      });
      failedSourceNames.push(entry.name);
    }
  }
  return { written, skipped, reused, failed, restoredPaths, skippedSourceNames, failedSourceNames };
}

function decodeBase64(value: string | undefined): Buffer | undefined {
  if (!value) {return undefined;}
  const normalized = value.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    return undefined;
  }
  const decoded = Buffer.from(normalized, "base64");
  return decoded.length > 0 ? decoded : undefined;
}

function isLikelySSHPrivateKey(value: Buffer): boolean {
  const head = value.toString("utf-8", 0, Math.min(value.length, 256));
  return [
    "-----BEGIN OPENSSH PRIVATE KEY-----",
    "-----BEGIN RSA PRIVATE KEY-----",
    "-----BEGIN DSA PRIVATE KEY-----",
    "-----BEGIN EC PRIVATE KEY-----",
    "-----BEGIN ECDSA PRIVATE KEY-----",
    "-----BEGIN PRIVATE KEY-----",
    "-----BEGIN ENCRYPTED PRIVATE KEY-----",
  ].some((marker) => head.includes(marker));
}

function keyFileEntryMatchesPublicIdentity(
  entry: KeyFileEntry,
  privateKey: Buffer,
  privatePath: string
): boolean {
  const sourceIdentities = getKeyFileEntryPublicIdentities(entry, privateKey);
  if (sourceIdentities.length === 0) {return false;}

  const targetIdentities = getPrivatePathPublicIdentities(privatePath);
  if (hasAnyPublicIdentityMatch(sourceIdentities, targetIdentities)) {
    return true;
  }

  const derivedTargetIdentity = derivePublicKeyIdentityFromPrivateKeyFile(privatePath);
  return derivedTargetIdentity ? sourceIdentities.includes(derivedTargetIdentity) : false;
}

function getKeyFileEntryPublicIdentities(entry: KeyFileEntry, privateKey: Buffer): string[] {
  const identities = new Set<string>();
  const publicKey = decodeBase64(entry.publicKey);
  if (publicKey) {
    addPublicIdentity(identities, publicKey);
  }
  if (identities.size === 0) {
    addPublicIdentity(identities, derivePublicKeyIdentityFromPrivateKey(privateKey));
  }
  return [...identities];
}

function getPrivatePathPublicIdentities(privatePath: string): string[] {
  const identities = new Set<string>();
  const publicPath = privatePath + ".pub";
  if (fs.existsSync(publicPath)) {
    try {
      addPublicIdentity(identities, fs.readFileSync(publicPath));
    } catch {
      // Fall back to deriving from the private key below.
    }
  }
  if (identities.size === 0) {
    addPublicIdentity(identities, derivePublicKeyIdentityFromPrivateKeyFile(privatePath));
  }
  return [...identities];
}

function hasAnyPublicIdentityMatch(left: string[], right: string[]): boolean {
  return left.some((identity) => right.includes(identity));
}

function addPublicIdentity(identities: Set<string>, value: Buffer | string | undefined): void {
  const identity = normalizeSSHPublicKeyIdentity(value);
  if (identity) {
    identities.add(identity);
  }
}

function normalizeSSHPublicKeyIdentity(value: Buffer | string | undefined): string | undefined {
  if (!value) {return undefined;}
  const text = Buffer.isBuffer(value) ? value.toString("utf-8") : value;
  for (const line of text.replace(/\r/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {continue;}

    const parts = trimmed.split(/\s+/);
    const algorithm = parts[0];
    const keyBlob = parts[1];
    if (isSupportedPublicKeyAlgorithm(algorithm) && isBase64Token(keyBlob)) {
      return `${algorithm} ${keyBlob}`;
    }
  }
  return undefined;
}

function isSupportedPublicKeyAlgorithm(algorithm: string | undefined): boolean {
  if (!algorithm) {return false;}
  return (
    algorithm === "ssh-rsa" ||
    algorithm === "ssh-dss" ||
    algorithm === "ssh-ed25519" ||
    algorithm.startsWith("ecdsa-sha2-") ||
    algorithm.startsWith("sk-ssh-") ||
    algorithm.startsWith("sk-ecdsa-")
  );
}

function isBase64Token(value: string | undefined): boolean {
  return value ? /^[A-Za-z0-9+/]+={0,2}$/.test(value) : false;
}

function derivePublicKeyIdentityFromPrivateKey(value: Buffer): string | undefined {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ssh-kit-key-"));
  const privatePath = path.join(tempDir, "id_import");
  try {
    fs.writeFileSync(privatePath, value, {
      mode: process.platform === "win32" ? undefined : 0o600,
    });
    return derivePublicKeyIdentityFromPrivateKeyFile(privatePath);
  } catch {
    return undefined;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function derivePublicKeyIdentityFromPrivateKeyFile(privatePath: string): string | undefined {
  try {
    const result = cp.spawnSync("ssh-keygen", ["-y", "-f", privatePath], {
      encoding: "utf-8",
      input: "\n",
      timeout: 5000,
    });
    if (result.status !== 0 || !result.stdout.trim()) {return undefined;}
    return normalizeSSHPublicKeyIdentity(result.stdout);
  } catch {
    return undefined;
  }
}

export function areIdentityPathsEquivalent(left: string, right: string): boolean {
  const leftCandidates = identityPathCompareCandidates(left);
  const rightCandidates = identityPathCompareCandidates(right);
  return leftCandidates.some((candidate) => rightCandidates.includes(candidate));
}

function isPathUnderSshDir(filePath: string): boolean {
  const sshDir = path.resolve(os.homedir(), ".ssh");
  const resolved = path.resolve(filePath);
  const normalizedSshDir = process.platform === "win32" ? sshDir.toLowerCase() : sshDir;
  const normalizedResolved = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  return normalizedResolved === normalizedSshDir ||
    normalizedResolved.startsWith(normalizedSshDir + path.sep);
}

function identityPathCompareCandidates(filePath: string): string[] {
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

  return [...candidates].map(normalizeIdentityPathForCompare);
}

function normalizeIdentityPathForCompare(filePath: string): string {
  const normalized = path.normalize(filePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
