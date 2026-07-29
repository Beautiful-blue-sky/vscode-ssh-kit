import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  createDefaultCatalog,
  SSHKitCatalog,
  SSHKitData,
} from "./types";
import {
  CURRENT_DATA_SCHEMA_VERSION,
  migrateStoredData,
  toCatalog,
  validateCatalog,
} from "./dataSchema";

const CATALOG_FILE = "catalog.json";
const CATALOG_PREVIOUS_FILE = "catalog.previous.json";
const CATALOG_LOCK_FILE = "catalog.lock";
const LEGACY_BACKUP_KEY = "sshKit.legacyDataBackup";
const MIGRATION_KEY = "sshKit.catalogMigration";
const LOCK_WAIT_MS = 2_000;
const LOCK_STALE_MS = 30_000;

interface MigrationState {
  schemaVersion: number;
  migratedAt: string;
}

class UnsupportedCatalogVersionError extends Error {}

export interface CatalogSnapshotInfo {
  path: string;
  createdAt: string;
  revision: number;
  hostCount: number;
  groupCount: number;
}

/**
 * File-backed catalog repository. Production uses globalStorageUri; tests and
 * unusual hosts without a file-backed URI fall back to the legacy Memento.
 */
export class CatalogRepository {
  private readonly directory?: string;
  private readonly catalogPath?: string;
  private readonly previousPath?: string;
  private readonly lockPath?: string;
  private fileBackedReady = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    const storagePath = context.globalStorageUri?.fsPath;
    if (storagePath) {
      this.directory = storagePath;
      this.catalogPath = path.join(storagePath, CATALOG_FILE);
      this.previousPath = path.join(storagePath, CATALOG_PREVIOUS_FILE);
      this.lockPath = path.join(storagePath, CATALOG_LOCK_FILE);
      try {
        this.initializeFileCatalog();
        this.fileBackedReady = true;
      } catch {
        // Keep legacy globalState readable and writable. A later activation can
        // retry migration after a transient filesystem or permission failure.
        this.fileBackedReady = false;
      }
    }
  }

  get isFileBacked(): boolean {
    return this.fileBackedReady;
  }

  read(): SSHKitCatalog {
    if (!this.catalogPath || !this.fileBackedReady) {
      return toCatalog(migrateStoredData(this.context.globalState.get<unknown>("sshKit.data")).data);
    }
    return this.readFileCatalog();
  }

  async mutate(
    update: (catalog: SSHKitCatalog) => SSHKitCatalog | void,
    options: { snapshot?: boolean } = {}
  ): Promise<SSHKitCatalog> {
    if (!this.catalogPath || !this.lockPath || !this.fileBackedReady) {
      const current = this.read();
      const working = globalThis.structuredClone(current);
      const updated = update(working) ?? working;
      updated.schemaVersion = Math.max(updated.schemaVersion, CURRENT_DATA_SCHEMA_VERSION);
      updated.revision = Math.max(current.revision + 1, updated.revision);
      validateCatalog(updated);
      return updated;
    }

    return this.withLock(() => {
      const current = this.readFileCatalog();
      const working = globalThis.structuredClone(current);
      const updated = update(working) ?? working;
      updated.schemaVersion = Math.max(updated.schemaVersion, CURRENT_DATA_SCHEMA_VERSION);
      updated.revision = current.revision + 1;
      validateCatalog(updated);
      if (options.snapshot) {
        this.writeSnapshot(current);
      }
      this.writeCatalog(updated);
      return updated;
    });
  }

  async replace(
    catalog: SSHKitCatalog,
    options: { snapshot?: boolean; expectedRevision?: number } = {}
  ): Promise<SSHKitCatalog> {
    return this.mutate((current) => {
      if (
        options.expectedRevision !== undefined &&
        current.revision !== options.expectedRevision
      ) {
        throw new Error(vscode.l10n.t("SSH Kit data changed in another window. Reload and try again."));
      }
      return globalThis.structuredClone(catalog);
    }, options);
  }

  listSnapshots(): string[] {
    if (!this.directory || !this.fileBackedReady) {return [];}
    const backupDir = path.join(this.directory, "backups");
    if (!fs.existsSync(backupDir)) {return [];}
    return fs.readdirSync(backupDir)
      .filter((name) => /^catalog-\d{8}T\d{6}-r\d+\.json$/.test(name))
      .sort()
      .reverse()
      .map((name) => path.join(backupDir, name));
  }

  getSnapshotInfo(): CatalogSnapshotInfo[] {
    return this.listSnapshots().flatMap((snapshotPath) => {
      try {
        const catalog: unknown = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
        validateCatalog(catalog);
        return [{
          path: snapshotPath,
          createdAt: fs.statSync(snapshotPath).mtime.toISOString(),
          revision: catalog.revision,
          hostCount: catalog.hosts.length,
          groupCount: catalog.groups.length,
        }];
      } catch {
        return [];
      }
    });
  }

  async restoreSnapshot(
    snapshotPath: string,
    expectedRevision?: number
  ): Promise<SSHKitCatalog> {
    if (!this.fileBackedReady) {
      throw new Error(vscode.l10n.t("The selected SSH Kit snapshot is not available."));
    }
    const allowed = new Set(this.listSnapshots().map(normalizeComparePath));
    if (!allowed.has(normalizeComparePath(snapshotPath))) {
      throw new Error(vscode.l10n.t("The selected SSH Kit snapshot is not available."));
    }
    const catalog: unknown = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
    validateCatalog(catalog);
    return this.replace(catalog, { snapshot: true, expectedRevision });
  }

  private initializeFileCatalog(): void {
    if (!this.directory || !this.catalogPath) {return;}
    fs.mkdirSync(this.directory, { recursive: true });
    if (fs.existsSync(this.catalogPath)) {
      this.readFileCatalog();
      return;
    }

    const legacyRaw = this.context.globalState.get<unknown>("sshKit.data");
    const migrated = migrateStoredData(legacyRaw);
    if (migrated.data.schemaVersion > CURRENT_DATA_SCHEMA_VERSION) {
      throw new UnsupportedCatalogVersionError(
        "A newer SSH Kit data schema is already present."
      );
    }
    const catalog = toCatalog(migrated.data);
    validateCatalog(catalog);
    this.writeCatalog(catalog);

    if (legacyRaw !== undefined && this.context.globalState.get(LEGACY_BACKUP_KEY) === undefined) {
      void this.context.globalState.update(LEGACY_BACKUP_KEY, legacyRaw);
    }
    const migration: MigrationState = {
      schemaVersion: CURRENT_DATA_SCHEMA_VERSION,
      migratedAt: new Date().toISOString(),
    };
    void this.context.globalState.update(MIGRATION_KEY, migration);
  }

  private readFileCatalog(): SSHKitCatalog {
    if (!this.catalogPath) {return createDefaultCatalog();}
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(this.catalogPath, "utf8"));
      validateCatalog(parsed);
      if (parsed.schemaVersion > CURRENT_DATA_SCHEMA_VERSION) {
        throw new UnsupportedCatalogVersionError(
          "A newer SSH Kit catalog schema is already present."
        );
      }
      return parsed;
    } catch (error) {
      if (error instanceof UnsupportedCatalogVersionError) {
        throw error;
      }
      if (this.previousPath && fs.existsSync(this.previousPath)) {
        const previous: unknown = JSON.parse(fs.readFileSync(this.previousPath, "utf8"));
        validateCatalog(previous);
        if (previous.schemaVersion > CURRENT_DATA_SCHEMA_VERSION) {
          throw new UnsupportedCatalogVersionError(
            "A newer SSH Kit catalog schema is already present."
          );
        }
        this.writeCatalogFile(previous, false);
        return previous;
      }
      throw error;
    }
  }

  private writeCatalog(catalog: SSHKitCatalog): void {
    this.writeCatalogFile(catalog, true);
  }

  private writeCatalogFile(
    catalog: SSHKitCatalog,
    preserveCurrent: boolean
  ): void {
    if (!this.catalogPath || !this.directory) {return;}
    fs.mkdirSync(this.directory, { recursive: true });
    const tempPath = path.join(
      this.directory,
      `catalog.${process.pid}.${Date.now()}.tmp`
    );
    try {
      fs.writeFileSync(tempPath, `${JSON.stringify(catalog, null, 2)}\n`, {
        encoding: "utf8",
        mode: process.platform === "win32" ? undefined : 0o600,
      });
      if (preserveCurrent && fs.existsSync(this.catalogPath) && this.previousPath) {
        try {
          const current: unknown = JSON.parse(fs.readFileSync(this.catalogPath, "utf8"));
          validateCatalog(current);
          fs.copyFileSync(this.catalogPath, this.previousPath);
        } catch {
          // Never replace a known-good previous catalog with a corrupt current file.
        }
      }
      fs.renameSync(tempPath, this.catalogPath);
    } finally {
      fs.rmSync(tempPath, { force: true });
    }
  }

  private writeSnapshot(catalog: SSHKitCatalog): void {
    if (!this.directory) {return;}
    const backupDir = path.join(this.directory, "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "");
    const snapshotPath = path.join(
      backupDir,
      `catalog-${stamp}-r${catalog.revision}.json`
    );
    fs.writeFileSync(snapshotPath, `${JSON.stringify(catalog, null, 2)}\n`, {
      encoding: "utf8",
      mode: process.platform === "win32" ? undefined : 0o600,
    });

    for (const stale of this.listSnapshots().slice(10)) {
      fs.rmSync(stale, { force: true });
    }
  }

  private async withLock<T>(operation: () => T): Promise<T> {
    if (!this.lockPath) {return operation();}
    const deadline = Date.now() + LOCK_WAIT_MS;
    let descriptor: number | undefined;
    while (descriptor === undefined) {
      try {
        const candidate = fs.openSync(
          this.lockPath,
          "wx",
          process.platform === "win32" ? undefined : 0o600
        );
        try {
          fs.writeFileSync(candidate, JSON.stringify({
            pid: process.pid,
            createdAt: Date.now(),
          }));
          descriptor = candidate;
        } catch (error) {
          fs.closeSync(candidate);
          fs.rmSync(this.lockPath, { force: true });
          throw error;
        }
      } catch (error) {
        if (!isAlreadyExistsError(error)) {throw error;}
        this.removeStaleLock();
        if (Date.now() >= deadline) {
          throw new Error(vscode.l10n.t("SSH Kit data is being updated in another window. Try again."));
        }
        await sleep(25);
      }
    }

    try {
      return operation();
    } finally {
      fs.closeSync(descriptor);
      fs.rmSync(this.lockPath, { force: true });
    }
  }

  private removeStaleLock(): void {
    if (!this.lockPath) {return;}
    try {
      const age = Date.now() - fs.statSync(this.lockPath).mtimeMs;
      if (age > LOCK_STALE_MS) {
        fs.rmSync(this.lockPath, { force: true });
      }
    } catch (error) {
      if (!isFileNotFoundError(error)) {throw error;}
    }
  }
}

export function mergeCatalogWithLegacyState(
  catalog: SSHKitCatalog,
  legacy: SSHKitData
): SSHKitData {
  return {
    ...legacy,
    schemaVersion: catalog.schemaVersion,
    groups: catalog.groups,
    hosts: catalog.hosts,
    deletedHosts: catalog.deletedHosts,
  };
}

function isAlreadyExistsError(
  error: unknown
): error is Error & { code: string } {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isFileNotFoundError(
  error: unknown
): error is Error & { code: string } {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function normalizeComparePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLocaleLowerCase() : resolved;
}
