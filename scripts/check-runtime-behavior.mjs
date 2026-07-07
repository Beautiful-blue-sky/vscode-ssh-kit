#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const originalHome = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
};
const tempHomes = [];

try {
  await runCheck("SSH Config import ignores SSH Kit connect aliases and preserves repeated directives", checkSSHConfigImport);
  await runCheck("SSH Config export prompts for an explicit backup", checkSSHConfigExportBackupPrompt);
  await runCheck("AI host tool returns filtered metadata without private key material", checkAIHostTool);
  await runCheck("Backup restore preview deduplicates hosts and reports key failures", checkBackupRestore);
  await runCheck("Backup restore rewrites hosts to renamed or reused key files", checkBackupRestoreKeyConflicts);
  await runCheck("Backup restore clears host key links when conflicting keys are skipped", checkBackupRestoreSkippedKeyClearsHostLink);
  await runCheck("Restore command prompts for key conflicts and rewrites imported hosts", checkRestoreCommandKeyConflictFlow);
  await runCheck("Key discovery detects generated keys and can regenerate missing public keys", checkKeyManagement);
  await runCheck("Batch host key changes update selected hosts only", checkBatchHostKeyChange);
  await runCheck("Connection status ignores stale window cache outside Remote-SSH", checkConnectionStatusCacheGate);
  await runCheck("Remote-SSH window context claims matching aliases only", checkRemoteWindowContextStorage);
  await runCheck("Remote-SSH alias refreshes stale identity files before connecting", checkRemoteAliasRefreshesIdentityFile);
  await runCheck("Remote-SSH alias preserves native host names and is accepted by OpenSSH config parsing", checkRemoteAlias);
  console.log("\nRuntime behavior checks passed.");
} finally {
  restoreHome();
  for (const home of tempHomes) {
    rmSync(home, { recursive: true, force: true });
  }
}

async function runCheck(label, fn) {
  await fn();
  console.log(`ok - ${label}`);
}

function loadTsModule(relativePath, mocks = {}) {
  const result = esbuild.buildSync({
    entryPoints: [join(root, relativePath)],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    external: Object.keys(mocks),
    write: false,
    logLevel: "silent",
  });

  const module = { exports: {} };
  const localRequire = (id) => {
    if (Object.prototype.hasOwnProperty.call(mocks, id)) {
      return mocks[id];
    }
    return require(id);
  };
  localRequire.resolve = (id) => (
    Object.prototype.hasOwnProperty.call(mocks, id) ? id : require.resolve(id)
  );

  new Function("require", "module", "exports", result.outputFiles[0].text)(
    localRequire,
    module,
    module.exports,
  );
  return module.exports;
}

function makeTempHome(label) {
  const home = mkdtempSync(join(tmpdir(), `ssh-kit-${label}-`));
  mkdirSync(join(home, ".ssh"), { recursive: true });
  tempHomes.push(home);
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return home;
}

function restoreHome() {
  restoreEnv("HOME", originalHome.HOME);
  restoreEnv("USERPROFILE", originalHome.USERPROFILE);
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function checkCommandExists(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) {
    throw new Error(`Missing required command: ${command}`);
  }
}

function checkSSHConfigImport() {
  const home = makeTempHome("config");
  const configPath = join(home, ".ssh", "config");
  writeFileSync(configPath, [
    "# SSH Kit connect alias stale-host begin",
    "Host \"SSH Kit: stale host | 192.0.2.1:22\"",
    "  HostName 192.0.2.1",
    "  User root",
    "# SSH Kit connect alias stale-host end",
    "",
    "Host multi",
    "  HostName 10.0.0.5",
    "  User root",
    "  Port 2222",
    "  IdentityFile ~/.ssh/id_multi",
    "  LocalForward 127.0.0.1:8080 127.0.0.1:80",
    "  LocalForward 127.0.0.1:8443 127.0.0.1:443",
    "  SendEnv LANG",
    "  SendEnv LC_*",
    "",
  ].join("\n"));

  const { analyzeExport, exportToSSHConfig, importFromSSHConfig, stringifyHosts } = loadTsModule("src/ssh/sshConfig.ts");
  const { hosts } = importFromSSHConfig(configPath);
  assert(hosts.length === 1, `Expected one imported host, got ${hosts.length}`);
  assert(hosts[0].name === "multi", `Expected host "multi", got "${hosts[0].name}"`);
  assert(Array.isArray(hosts[0].extraConfig.localforward), "Expected repeated LocalForward values to be an array");
  assert(hosts[0].extraConfig.localforward.length === 2, "Expected two LocalForward directives");
  assert(Array.isArray(hosts[0].extraConfig.sendenv), "Expected repeated SendEnv values to be an array");

  const exported = stringifyHosts([{ ...hosts[0], id: "multi-id" }]);
  assert((exported.match(/LocalForward/g) ?? []).length === 2, "Expected stringifyHosts to keep both LocalForward directives");
  assert((exported.match(/SendEnv/g) ?? []).length === 2, "Expected stringifyHosts to keep both SendEnv directives");

  const exportedWithSpace = stringifyHosts([{ ...hosts[0], id: "space-id", name: "space host" }]);
  assert(exportedWithSpace.includes('Host "space host"'), "Expected Host aliases with spaces to be quoted");

  const exportPath = join(home, ".ssh", "export_config");
  writeFileSync(exportPath, [
    "Host 175.27.233.248_AIMS010-Nginx_10.100.1.4",
    "  HostName 175.27.233.248",
    "  Port 35264",
    "  User root",
    "  IdentityFile ~/.ssh/id_rsa",
    "  # SSH Kit managed",
    "",
    "Host AIMS010-Nginx_10.100.1.4",
    "  HostName 175.27.233.248",
    "  Port 35264",
    "  User root",
    "  IdentityFile ~/.ssh/id_rsa",
    "  # SSH Kit managed",
    "",
    "# SSH Kit connect alias mqggfb9qc991lz begin",
    "Host AIMS010-Nginx_10.100.1.4｜175.27.233.248：35264",
    "  HostName 175.27.233.248",
    "  Port 35264",
    "  User root",
    "# SSH Kit connect alias mqggfb9qc991lz end",
    "",
  ].join("\n"));
  const managedHost = {
    id: "managed-endpoint",
    name: "AIMS010-Nginx_10.100.1.4",
    hostname: "175.27.233.248",
    port: 35264,
    username: "root",
    identityFile: "~/.ssh/id_rsa",
    tags: [],
  };
  const exportStats = analyzeExport([managedHost], exportPath);
  assert(exportStats.synced === 1, `Expected endpoint-matched managed blocks to count as one sync, got ${exportStats.synced}`);
  assert(exportStats.conflicts.length === 0, "Expected managed endpoint duplicates not to be reported as conflicts");
  assert(exportStats.removedAliases === 1, `Expected one generated connection alias to be removed, got ${exportStats.removedAliases}`);
  exportToSSHConfig([managedHost], exportPath);
  const merged = readFileSync(exportPath, "utf8");
  assert(!merged.includes("Host 175.27.233.248_AIMS010-Nginx_10.100.1.4"), "Expected old same-endpoint managed alias to be replaced");
  assert((merged.match(/^Host AIMS010-Nginx_10\.100\.1\.4$/gm) ?? []).length === 1, "Expected one generated managed Host block");
  assert(!merged.includes("# SSH Kit connect alias mqggfb9qc991lz begin"), "Expected generated connection alias blocks to be removed during export");

  const conflictPath = join(home, ".ssh", "conflict_config");
  writeFileSync(conflictPath, [
    "Host legacy-AIMS010",
    "  HostName 175.27.233.248",
    "  Port 35264",
    "  User deploy",
    "",
    "Host unrelated",
    "  HostName 203.0.113.10",
    "  Port 22",
    "  User root",
    "",
  ].join("\n"));
  const conflictStats = analyzeExport([managedHost], conflictPath);
  assert(conflictStats.conflicts.includes("legacy-AIMS010"), "Expected same HostName/Port unmanaged alias to require takeover confirmation");
  let takeoverRequired = false;
  try {
    exportToSSHConfig([managedHost], conflictPath);
  } catch {
    takeoverRequired = true;
  }
  assert(takeoverRequired, "Expected unmanaged same-target export to require overwriteUnmanaged");
  exportToSSHConfig([managedHost], conflictPath, { overwriteUnmanaged: true });
  const conflictMerged = readFileSync(conflictPath, "utf8");
  assert(!conflictMerged.includes("Host legacy-AIMS010"), "Expected unmanaged same-target alias to be replaced after takeover");
  assert(conflictMerged.includes("Host unrelated"), "Expected unrelated Host blocks to be preserved");
  assert((conflictMerged.match(/^Host AIMS010-Nginx_10\.100\.1\.4$/gm) ?? []).length === 1, "Expected one SSH Kit Host block after takeover");
}

async function checkSSHConfigExportBackupPrompt() {
  const home = makeTempHome("export-backup");
  const configPath = join(home, ".ssh", "config");
  const backupPath = join(home, "chosen-ssh-config-backup");
  writeFileSync(configPath, [
    "Host old-dev",
    "  HostName 10.0.0.5",
    "  Port 22",
    "  User root",
    "",
  ].join("\n"));

  const vscode = createVSCodeMock();
  vscode.__saveDialogUri = { fsPath: backupPath };
  vscode.__infoHandler = (message) => (
    String(message).includes("即将写入") ? "确认写入" : undefined
  );
  vscode.__warningHandler = (message) => (
    String(message).includes("备份当前配置文件") ? "选择备份位置" : "接管并覆盖"
  );

  const { StorageService } = loadTsModule("src/core/storage.ts", { vscode });
  const { exportConfig } = loadTsModule("src/commands/ioCommands.ts", { vscode });
  const storage = new StorageService(createExtensionContext({
    groups: [],
    hosts: [{
      id: "h-managed",
      name: "managed-dev",
      hostname: "10.0.0.5",
      port: 22,
      username: "root",
      tags: [],
    }],
    groupCollapsedState: {},
    recentConnections: [],
  }));

  await exportConfig(storage);

  assert(existsSync(backupPath), "Expected export command to create the user-selected backup file");
  assert(readFileSync(backupPath, "utf8").includes("Host old-dev"), "Expected backup file to contain the original SSH config");
  assert(!readdirSync(join(home, ".ssh")).some((name) => /^config\.bak\./.test(name)), "Expected export command not to create silent config.bak.* files");

  const merged = readFileSync(configPath, "utf8");
  assert(!merged.includes("Host old-dev"), "Expected confirmed takeover to replace same-target unmanaged Host");
  assert(merged.includes("Host managed-dev"), "Expected SSH Kit Host to be written");
  assert(merged.includes("# SSH Kit managed"), "Expected written Host to include the SSH Kit marker");
}

function checkAIHostTool() {
  const vscode = createVSCodeMock();
  const { StorageService } = loadTsModule("src/core/storage.ts", { vscode });
  const { buildHostToolResult } = loadTsModule("src/ai/hostTool.ts", { vscode });
  const storage = new StorageService(createExtensionContext({
    groups: [{ id: "g-prod", name: "prod", order: 0 }],
    hosts: [
      {
        id: "h-prod",
        name: "api-prod",
        hostname: "10.0.0.10",
        port: 2222,
        username: "root",
        groupId: "g-prod",
        tags: ["api", "linux"],
        identityFile: "~/.ssh/id_prod",
      },
      {
        id: "h-dev",
        name: "worker-dev",
        hostname: "10.0.0.11",
        port: 22,
        username: "ubuntu",
        tags: ["worker"],
      },
    ],
    groupCollapsedState: {},
    recentConnections: [],
  }));

  const filtered = buildHostToolResult(storage, { query: "prod" });
  assert(filtered.total === 1, `Expected one filtered host, got ${filtered.total}`);
  assert(filtered.hosts[0].name === "api-prod", "Expected query to match host name/group/tag metadata");
  assert(filtered.hosts[0].hasIdentityFile === true, "Expected AI host tool to expose key presence");
  assert(filtered.hosts[0].identityFile === undefined, "Expected AI host tool to hide key paths by default");

  const withPath = buildHostToolResult(storage, { query: "prod", includeIdentityFilePath: true });
  assert(withPath.hosts[0].identityFile === "~/.ssh/id_prod", "Expected AI host tool to include key paths only when requested");
  assert(!JSON.stringify(withPath).includes("PRIVATE KEY"), "Expected AI host tool result not to include private key material");
}

async function checkBackupRestore() {
  const home = makeTempHome("restore");
  const vscode = createVSCodeMock();
  const { StorageService } = loadTsModule("src/core/storage.ts", { vscode });
  const context = createExtensionContext({
    groups: [{ id: "g-existing", name: "prod", order: 0 }],
    hosts: [{
      id: "h-existing",
      name: "prod-old",
      hostname: "10.0.0.1",
      port: 22,
      username: "root",
      groupId: "g-existing",
      tags: [],
    }],
    groupCollapsedState: {},
    recentConnections: ["h-existing"],
  });
  const storage = new StorageService(context);
  const backup = JSON.stringify({
    groups: [
      { id: "g-source-prod", name: "prod", order: 0 },
      { id: "g-source-stage", name: "staging", order: 1 },
    ],
    hosts: [
      {
        id: "h-source-existing",
        name: "prod-renamed",
        hostname: "10.0.0.1",
        port: 22,
        username: "root",
        groupId: "g-source-prod",
        tags: [],
      },
      {
        id: "h-source-new",
        name: "stage-box",
        hostname: "10.0.0.2",
        port: 2222,
        username: "deploy",
        groupId: "g-source-stage",
        identityFile: "C:\\Users\\22073\\.ssh\\id_restore",
        tags: ["stage"],
      },
    ],
    groupCollapsedState: {},
    recentConnections: [],
    keyMetadata: [{ name: "id_restore" }],
    keyFiles: [{
      name: "id_restore",
      type: "unknown",
      privateKey: Buffer.from("not a private key").toString("base64"),
    }],
  });

  const preview = storage.previewImport(backup);
  assert(preview.importedHosts === 1, `Expected one new host, got ${preview.importedHosts}`);
  assert(preview.skippedHosts === 1, `Expected one skipped duplicate host, got ${preview.skippedHosts}`);
  assert(preview.importedGroups === 1, `Expected one new group, got ${preview.importedGroups}`);
  assert(preview.keyTargets.includes("~/.ssh/id_restore"), "Expected key restore target preview");

  const result = await storage.commitImport(backup);
  assert(result.importedHosts === 1, `Expected one committed host, got ${result.importedHosts}`);
  assert(result.skippedHosts === 1, `Expected one skipped committed duplicate, got ${result.skippedHosts}`);
  assert(result.importedGroups === 1, `Expected one committed group, got ${result.importedGroups}`);
  assert(result.keyFilesFailed === 1, `Expected one key failure, got ${result.keyFilesFailed}`);
  assert(result.keyFileFailures[0].name === "id_restore", "Expected failed key detail");

  const saved = context.globalState.get("sshKit.data");
  const staging = saved.groups.find((group) => group.name === "staging");
  const addedHost = saved.hosts.find((host) => host.name === "stage-box");
  assert(staging, "Expected staging group to be saved");
  assert(addedHost?.groupId === staging.id, "Expected imported host groupId to map to the restored group");
  assert(addedHost?.identityFile === undefined, "Expected failed key restore to clear imported host source-machine identity path");
  assert(!existsSync(join(home, ".ssh", "id_restore")), "Invalid private key should not be written");
}

async function checkBackupRestoreKeyConflicts() {
  const home = makeTempHome("restore-conflict");
  const vscode = createVSCodeMock();
  const { StorageService } = loadTsModule("src/core/storage.ts", { vscode });
  const existingPrivate = fakePrivateKey("existing");
  const importedPrivate = fakePrivateKey("imported");
  const aliasedPrivate = fakePrivateKey("aliased-existing");
  const writtenPrivate = fakePrivateKey("written-absolute");
  writeFileSync(join(home, ".ssh", "id_conflict"), existingPrivate);
  writeFileSync(join(home, ".ssh", "id_same"), importedPrivate);
  writeFileSync(join(home, ".ssh", "id_existing_reuse"), aliasedPrivate);

  const context = createExtensionContext({
    groups: [],
    hosts: [],
    groupCollapsedState: {},
    recentConnections: [],
  });
  const storage = new StorageService(context);
  const backup = JSON.stringify({
    groups: [],
    hosts: [
      {
        id: "h-conflict",
        name: "conflict-host",
        hostname: "10.20.0.1",
        port: 22,
        username: "root",
        identityFile: "~/.ssh/id_conflict",
        tags: [],
      },
      {
        id: "h-existing-reuse",
        name: "existing-reuse-host",
        hostname: "10.20.0.3",
        port: 22,
        username: "root",
        identityFile: "~/.ssh/id_reuse_alias",
        tags: [],
      },
      {
        id: "h-same",
        name: "same-host",
        hostname: "10.20.0.2",
        port: 22,
        username: "root",
        identityFile: "id_same",
        tags: [],
      },
      {
        id: "h-written-absolute",
        name: "written-absolute-host",
        hostname: "10.20.0.4",
        port: 22,
        username: "root",
        identityFile: "C:\\Users\\22073\\.ssh\\id_written_abs",
        tags: [],
      },
    ],
    groupCollapsedState: {},
    recentConnections: [],
    keyFiles: [
      {
        name: "id_reuse_alias",
        type: "unknown",
        privateKey: Buffer.from(aliasedPrivate).toString("base64"),
      },
      {
        name: "id_conflict",
        type: "unknown",
        privateKey: Buffer.from(importedPrivate).toString("base64"),
      },
      {
        name: "id_same",
        type: "unknown",
        privateKey: Buffer.from(importedPrivate).toString("base64"),
      },
      {
        name: "id_written_abs",
        type: "unknown",
        privateKey: Buffer.from(writtenPrivate).toString("base64"),
      },
    ],
  });

  const result = await storage.commitImport(backup, [{
    sourceName: "id_conflict",
    targetName: "id_conflict.ssh-kit-imported",
  }]);
  const conflictTarget = join(home, ".ssh", "id_conflict.ssh-kit-imported");
  const existingReuseTarget = join(home, ".ssh", "id_existing_reuse");
  const duplicateReuseTarget = join(home, ".ssh", "id_reuse_alias");
  const sameTarget = join(home, ".ssh", "id_same");
  const writtenTarget = join(home, ".ssh", "id_written_abs");
  assert(result.keyFilesRestored === 2, `Expected one renamed key and one new key restore, got ${result.keyFilesRestored}`);
  assert(result.keyFilesReused === 2, `Expected two same-content key reuses, got ${result.keyFilesReused}`);
  assert(readFileSync(join(home, ".ssh", "id_conflict"), "utf8") === existingPrivate, "Expected existing conflicting key to remain unchanged");
  assert(readFileSync(conflictTarget, "utf8") === importedPrivate, "Expected conflicting key to be restored under the planned new name");
  assert(!existsSync(duplicateReuseTarget), "Expected restore to reuse same-content key under a different name instead of writing a duplicate");

  const saved = context.globalState.get("sshKit.data");
  assert(saved.hosts.find((host) => host.name === "conflict-host")?.identityFile === conflictTarget, "Expected conflict host to point at renamed key path");
  assert(saved.hosts.find((host) => host.name === "existing-reuse-host")?.identityFile === existingReuseTarget, "Expected host to point at existing same-content key with a different name");
  assert(saved.hosts.find((host) => host.name === "same-host")?.identityFile === sameTarget, "Expected same-content host to point at reused key path");
  assert(saved.hosts.find((host) => host.name === "written-absolute-host")?.identityFile === writtenTarget, "Expected imported host source-machine absolute identity path to point at newly written local key path");

  const aliasHome = makeTempHome("restore-conflict-reuse-alias");
  const sourceIdRsaPrivate = fakePrivateKey("source-id-rsa");
  const localIdRsaPrivate = fakePrivateKey("local-id-rsa-different");
  const samePublicKey = fakePublicKey("source-id-rsa");
  const sourceWindowsIdRsaPath = "C:\\Users\\22073\\.ssh\\id_rsa";
  writeFileSync(join(aliasHome, ".ssh", "id_rsa"), localIdRsaPrivate);
  writeFileSync(join(aliasHome, ".ssh", "id_rsa_ivy"), fakePrivateKey("same-public-different-private-bytes"));
  writeFileSync(join(aliasHome, ".ssh", "id_rsa_ivy.pub"), samePublicKey);
  const aliasContext = createExtensionContext({
    groups: [],
    hosts: [],
    groupCollapsedState: {},
    recentConnections: [],
  });
  const aliasStorage = new StorageService(aliasContext);
  const aliasBackup = JSON.stringify({
    groups: [],
    hosts: [{
      id: "h-id-ras",
      name: "id-rsa-host",
      hostname: "10.20.1.1",
      port: 22,
      username: "root",
      identityFile: sourceWindowsIdRsaPath,
      tags: [],
    }],
    groupCollapsedState: {},
    recentConnections: [],
    keyFiles: [{
      name: "id_rsa",
      type: "unknown",
      privateKey: Buffer.from(sourceIdRsaPrivate).toString("base64"),
      publicKey: Buffer.from(samePublicKey).toString("base64"),
    }],
  });
  const aliasResult = await aliasStorage.commitImport(aliasBackup);
  const aliasTarget = join(aliasHome, ".ssh", "id_rsa_ivy");
  const aliasSaved = aliasContext.globalState.get("sshKit.data");
  assert(aliasResult.keyFilesReused === 1, `Expected id_rsa backup to reuse id_rsa_ivy, got ${aliasResult.keyFilesReused}`);
  assert(readFileSync(join(aliasHome, ".ssh", "id_rsa"), "utf8") === localIdRsaPrivate, "Expected local same-name id_rsa to remain unchanged when content differs");
  assert(aliasSaved.hosts.find((host) => host.name === "id-rsa-host")?.identityFile === aliasTarget, "Expected imported host source-machine absolute identity path to be rewritten from id_rsa to id_rsa_ivy");
}

async function checkBackupRestoreSkippedKeyClearsHostLink() {
  const home = makeTempHome("restore-skip-conflict");
  const vscode = createVSCodeMock();
  const { StorageService } = loadTsModule("src/core/storage.ts", { vscode });
  writeFileSync(join(home, ".ssh", "id_conflict"), fakePrivateKey("existing-skip"));

  const context = createExtensionContext({
    groups: [],
    hosts: [],
    groupCollapsedState: {},
    recentConnections: [],
  });
  const storage = new StorageService(context);
  const backup = JSON.stringify({
    groups: [],
    hosts: [{
      id: "h-skip-conflict",
      name: "skip-conflict-host",
      hostname: "10.25.0.1",
      port: 22,
      username: "root",
      identityFile: "~/.ssh/id_conflict",
      tags: [],
    }],
    groupCollapsedState: {},
    recentConnections: [],
    keyFiles: [{
      name: "id_conflict",
      type: "unknown",
      privateKey: Buffer.from(fakePrivateKey("imported-skip")).toString("base64"),
    }],
  });

  const result = await storage.commitImport(backup, [{
    sourceName: "id_conflict",
    skip: true,
  }]);
  const saved = context.globalState.get("sshKit.data");
  assert(result.keyFilesSkipped === 1, `Expected one skipped conflicting key, got ${result.keyFilesSkipped}`);
  assert(saved.hosts.find((host) => host.name === "skip-conflict-host")?.identityFile === undefined, "Expected skipped conflicting key to clear imported host identity path");

  const defaultSkipHome = makeTempHome("restore-default-skip-conflict");
  writeFileSync(join(defaultSkipHome, ".ssh", "id_conflict"), fakePrivateKey("existing-default-skip"));
  const defaultSkipContext = createExtensionContext({
    groups: [],
    hosts: [],
    groupCollapsedState: {},
    recentConnections: [],
  });
  const defaultSkipStorage = new StorageService(defaultSkipContext);
  const defaultSkipResult = await defaultSkipStorage.commitImport(backup);
  const defaultSkipSaved = defaultSkipContext.globalState.get("sshKit.data");
  assert(defaultSkipResult.keyFilesSkipped === 1, `Expected default conflict skip to count one skipped key, got ${defaultSkipResult.keyFilesSkipped}`);
  assert(defaultSkipSaved.hosts.find((host) => host.name === "skip-conflict-host")?.identityFile === undefined, "Expected default conflicting key skip to clear imported host identity path");
}

async function checkRestoreCommandKeyConflictFlow() {
  const home = makeTempHome("restore-command-conflict");
  const vscode = createVSCodeMock();
  const { StorageService } = loadTsModule("src/core/storage.ts", { vscode });
  const { restoreKitData } = loadTsModule("src/commands/ioCommands.ts", { vscode });
  const existingPrivate = fakePrivateKey("existing-command");
  const importedPrivate = fakePrivateKey("imported-command");
  const aliasedPrivate = fakePrivateKey("aliased-command");
  const sourceIdRsaPrivate = fakePrivateKey("source-id-rsa-command");
  const sourceIdRsaPublic = fakePublicKey("source-id-rsa-command");
  writeFileSync(join(home, ".ssh", "id_conflict"), existingPrivate);
  writeFileSync(join(home, ".ssh", "id_existing_reuse"), aliasedPrivate);
  writeFileSync(join(home, ".ssh", "id_rsa"), fakePrivateKey("local-id-rsa-command-different"));
  writeFileSync(join(home, ".ssh", "id_rsa_ivy"), fakePrivateKey("source-id-rsa-command-different-private-bytes"));
  writeFileSync(join(home, ".ssh", "id_rsa_ivy.pub"), sourceIdRsaPublic);

  const context = createExtensionContext({
    groups: [],
    hosts: [],
    groupCollapsedState: {},
    recentConnections: [],
  });
  const storage = new StorageService(context);
  const backupPath = join(home, "ssh-kit-backup.json");
  writeFileSync(backupPath, JSON.stringify({
    groups: [],
    hosts: [
      {
        id: "h-command-conflict",
        name: "command-conflict-host",
        hostname: "10.30.0.1",
        port: 22,
        username: "root",
        identityFile: "~/.ssh/id_conflict",
        tags: [],
      },
      {
        id: "h-command-reuse",
        name: "command-reuse-host",
        hostname: "10.30.0.2",
        port: 22,
        username: "root",
        identityFile: "~/.ssh/id_reuse_alias",
        tags: [],
      },
      {
        id: "h-command-public-reuse",
        name: "command-public-reuse-host",
        hostname: "10.30.0.3",
        port: 22,
        username: "root",
        identityFile: "~/.ssh/id_rsa",
        tags: [],
      },
    ],
    groupCollapsedState: {},
    recentConnections: [],
    keyFiles: [
      {
        name: "id_conflict",
        type: "unknown",
        privateKey: Buffer.from(importedPrivate).toString("base64"),
      },
      {
        name: "id_reuse_alias",
        type: "unknown",
        privateKey: Buffer.from(aliasedPrivate).toString("base64"),
      },
      {
        name: "id_rsa",
        type: "unknown",
        privateKey: Buffer.from(sourceIdRsaPrivate).toString("base64"),
        publicKey: Buffer.from(sourceIdRsaPublic).toString("base64"),
      },
    ],
  }));

  let treeRefreshes = 0;
  let keyRefreshes = 0;
  let restoreConfirmMessage = "";
  vscode.__openDialogUris = [{ fsPath: backupPath }];
  vscode.__warningHandler = (message) => {
    const text = String(message);
    if (text.includes("id_rsa")) {
      throw new Error("Expected id_rsa to reuse id_rsa_ivy by public key instead of prompting for a same-name conflict");
    }
    return text.includes("id_conflict") ? "自动重命名" : undefined;
  };
  vscode.__infoHandler = (message) => {
    const text = String(message);
    if (text.includes("即将导入")) {
      restoreConfirmMessage = text;
      return "确认导入";
    }
    return undefined;
  };

  await restoreKitData(
    storage,
    { refresh() { treeRefreshes++; } },
    { refresh() { keyRefreshes++; } },
  );

  const expectedTarget = join(home, ".ssh", "id_conflict.ssh-kit-imported");
  const expectedReuseTarget = join(home, ".ssh", "id_existing_reuse");
  const expectedPublicReuseTarget = join(home, ".ssh", "id_rsa_ivy");
  const saved = context.globalState.get("sshKit.data");
  assert(restoreConfirmMessage.includes("含 3 个备份密钥（将写入 1 个，复用本机已有 2 个）"), "Expected restore confirmation to summarize written and reused keys separately");
  assert(!restoreConfirmMessage.includes("密钥恢复目标"), "Expected restore confirmation not to call existing reused keys restore targets");
  assert(restoreConfirmMessage.includes("将写入密钥文件："), "Expected restore confirmation to label keys that will be written");
  assert(restoreConfirmMessage.includes("匹配到本机已有密钥（不会写入/覆盖）："), "Expected restore confirmation to label reused local keys clearly");
  assert(restoreConfirmMessage.includes("~/.ssh/id_rsa_ivy"), "Expected restore confirmation to list reused id_rsa_ivy as an existing local key");
  assert(readFileSync(join(home, ".ssh", "id_conflict"), "utf8") === existingPrivate, "Expected restore command to preserve existing conflicting key");
  assert(readFileSync(expectedTarget, "utf8") === importedPrivate, "Expected restore command to write renamed conflicting key");
  assert(!existsSync(join(home, ".ssh", "id_reuse_alias")), "Expected restore command to reuse same-content key with a different name instead of writing a duplicate");
  assert(saved.hosts.find((host) => host.name === "command-conflict-host")?.identityFile === expectedTarget, "Expected restore command to rewrite imported host identity path");
  assert(saved.hosts.find((host) => host.name === "command-reuse-host")?.identityFile === expectedReuseTarget, "Expected restore command to rewrite imported host to existing same-content key path");
  assert(saved.hosts.find((host) => host.name === "command-public-reuse-host")?.identityFile === expectedPublicReuseTarget, "Expected restore command to rewrite imported id_rsa host to existing id_rsa_ivy with matching public key");
  assert(treeRefreshes === 1, `Expected host tree to refresh once, got ${treeRefreshes}`);
  assert(keyRefreshes === 1, `Expected key tree to refresh once, got ${keyRefreshes}`);
}

function fakePrivateKey(label) {
  return [
    "-----BEGIN OPENSSH PRIVATE KEY-----",
    label,
    "-----END OPENSSH PRIVATE KEY-----",
    "",
  ].join("\n");
}

function fakePublicKey(label) {
  return `ssh-rsa ${Buffer.from(`ssh-kit-public-${label}`).toString("base64")} ${label}\n`;
}

function checkKeyManagement() {
  checkCommandExists("ssh-keygen", ["-?"]);
  const home = makeTempHome("keys");
  const keyManager = loadTsModule("src/keys/keyManager.ts");
  const keyName = "custom_runtime_key";
  const generated = keyManager.generateKeyPair({
    type: "ed25519",
    name: keyName,
    comment: "ssh-kit-runtime-check",
  });

  const discovered = keyManager.listKeys().find((key) => key.name === keyName);
  assert(discovered, "Expected generated key to be discovered");
  assert(discovered.type === "ed25519", `Expected public key type ed25519, got ${discovered.type}`);

  renameSync(generated.publicKeyPath, `${generated.publicKeyPath}.bak`);
  const withoutPublic = keyManager.listKeys().find((key) => key.name === keyName);
  assert(withoutPublic, "Expected private key to remain discoverable without .pub");
  assert(withoutPublic.publicKeyPath === undefined, "Expected missing public key to be reported");
  assert(withoutPublic.type === "unknown", `Expected name fallback to be unknown, got ${withoutPublic.type}`);

  keyManager.populateFingerprints([withoutPublic]);
  assert(withoutPublic.type === "ed25519", `Expected fingerprint fallback type ed25519, got ${withoutPublic.type}`);

  const publicKeyPath = keyManager.regeneratePublicKey(generated.privateKeyPath);
  assert(existsSync(publicKeyPath), "Expected public key to be regenerated");

  const invalidImport = keyManager.importKeyFiles([{
    name: "../bad key",
    type: "unknown",
    privateKey: Buffer.from("not a key").toString("base64"),
  }]);
  assert(invalidImport.written === 0, "Invalid key import should not write files");
  assert(invalidImport.failed.length === 1, "Invalid key import should report a failure");
}

async function checkBatchHostKeyChange() {
  const home = makeTempHome("batch-key");
  const keyPath = join(home, ".ssh", "id_batch");
  writeFileSync(keyPath, "placeholder");

  const vscode = createVSCodeMock();
  const { StorageService } = loadTsModule("src/core/storage.ts", { vscode });
  const { batchChangeHostKey, changeHostKey } = loadTsModule("src/commands/hostCommands.ts", { vscode });
  const context = createExtensionContext({
    groups: [{ id: "g-prod", name: "prod", order: 0 }],
    hosts: [
      {
        id: "h-batch-1",
        name: "batch-one",
        hostname: "10.10.0.1",
        port: 22,
        username: "root",
        groupId: "g-prod",
        tags: [],
      },
      {
        id: "h-batch-2",
        name: "batch-two",
        hostname: "10.10.0.2",
        port: 22,
        username: "root",
        groupId: "g-prod",
        tags: [],
      },
      {
        id: "h-batch-3",
        name: "batch-three",
        hostname: "10.10.0.3",
        port: 22,
        username: "root",
        tags: [],
      },
    ],
    groupCollapsedState: {},
    recentConnections: [],
  });
  const storage = new StorageService(context);
  let refreshCount = 0;
  const tree = {
    refresh() {
      refreshCount++;
    },
  };

  vscode.__warningChoice = "确认修改";
  vscode.__quickPickHandler = (items, options) => {
    if (options?.canPickMany) {
      return items.filter((item) => item._hostId === "h-batch-1" || item._hostId === "h-batch-2");
    }
    return items.find((item) => item.detail === keyPath);
  };
  await batchChangeHostKey(storage, tree);

  let saved = context.globalState.get("sshKit.data");
  assert(saved.hosts.find((host) => host.id === "h-batch-1")?.identityFile === keyPath, "Expected first selected host key to update");
  assert(saved.hosts.find((host) => host.id === "h-batch-2")?.identityFile === keyPath, "Expected second selected host key to update");
  assert(saved.hosts.find((host) => host.id === "h-batch-3")?.identityFile === undefined, "Expected unselected host key to remain unchanged");
  assert(refreshCount === 1, `Expected one tree refresh after batch change, got ${refreshCount}`);

  let accidentalArgSelectionPickCount = 0;
  vscode.__quickPickHandler = (items, options) => {
    if (options?.canPickMany) {
      accidentalArgSelectionPickCount++;
      return items.filter((item) => item._hostId === "h-batch-3");
    }
    return items.find((item) => item.action === "clear");
  };
  await batchChangeHostKey(storage, tree, saved.hosts.find((host) => host.id === "h-batch-1"));
  saved = context.globalState.get("sshKit.data");
  assert(accidentalArgSelectionPickCount === 1, "Expected batch key change to open host picker even if VS Code passes a focused tree item");
  assert(saved.hosts.find((host) => host.id === "h-batch-1")?.identityFile === keyPath, "Expected accidental focused host argument not to make batch change single-host only");
  assert(saved.hosts.find((host) => host.id === "h-batch-2")?.identityFile === keyPath, "Expected other selected host key to remain unchanged after accidental argument");
  assert(saved.hosts.find((host) => host.id === "h-batch-3")?.identityFile === undefined, "Expected explicitly selected host to be the only host affected by accidental-argument batch flow");

  vscode.__quickPickHandler = (items) => items.find((item) => item.action === "clear");
  await changeHostKey(saved.hosts.find((host) => host.id === "h-batch-1"), storage, tree);
  saved = context.globalState.get("sshKit.data");
  assert(saved.hosts.find((host) => host.id === "h-batch-1")?.identityFile === undefined, "Expected single-host key change to clear identity file");
  assert(saved.hosts.find((host) => host.id === "h-batch-2")?.identityFile === keyPath, "Expected other selected host key to remain unchanged");
}

function checkConnectionStatusCacheGate() {
  const { canUseCachedSshKitWindowConnection } = loadTsModule("src/core/connectionState.ts");
  assert(canUseCachedSshKitWindowConnection("ssh-remote"), "Expected Remote-SSH windows to use cached SSH Kit window state");
  assert(!canUseCachedSshKitWindowConnection(undefined), "Expected local windows to ignore stale SSH Kit window state");
  assert(!canUseCachedSshKitWindowConnection("wsl"), "Expected non-SSH remote windows to ignore SSH Kit window state");
}

async function checkRemoteWindowContextStorage() {
  const vscode = createVSCodeMock();
  const { StorageService } = loadTsModule("src/core/storage.ts", { vscode });
  const context = createExtensionContext({
    groups: [],
    hosts: [],
    groupCollapsedState: {},
    recentConnections: [],
  });
  const storage = new StorageService(context);

  await storage.addPendingWindowConnection("host-one", "host-one-alias");
  await storage.addPendingWindowConnection("host-two", "host-two-alias");
  const claimedTwo = await storage.claimPendingWindowConnection("host-two-alias");
  assert(claimedTwo?.hostId === "host-two", "Expected an authority-scoped claim to pick the matching pending host");
  assert(storage.getWindowConnection()?.hostId === "host-two", "Expected claimed host to become the window connection");
  assert(storage.getRemoteAuthorityConnection("host-two-alias")?.hostId === "host-two", "Expected claimed host to be indexed by remote authority");

  const claimedOne = await storage.claimPendingWindowConnection();
  assert(claimedOne?.hostId === "host-one", "Expected unmatched pending host to remain queued after alias-scoped claim");
  assert(await storage.claimPendingWindowConnection() === undefined, "Expected pending queue to be empty after both claims");
}

async function checkRemoteAliasRefreshesIdentityFile() {
  const home = makeTempHome("remote-stale-key");
  const vscode = createVSCodeMock();
  const { connectHostInNewWindow } = loadTsModule("src/commands/connectCommands.ts", { vscode });
  const configPath = join(home, ".ssh", "config");
  const newKeyPath = join(home, ".ssh", "id_rsa_ivynow");
  const otherNewKeyPath = join(home, ".ssh", "id_rsa_other_now");
  const oldSourceKeyPath = "C:\\Users\\source\\.ssh\\id_rsa";
  writeFileSync(newKeyPath, "placeholder");
  writeFileSync(otherNewKeyPath, "placeholder");
  writeFileSync(configPath, [
    "# SSH Kit connect alias old-source-host begin",
    "Host 103.184.47.185_dev",
    "  HostName 103.184.47.185",
    "  Port 27488",
    "  User root",
    `  IdentityFile ${oldSourceKeyPath}`,
    "# SSH Kit connect alias old-source-host end",
    "",
    "Host unmanaged-dev",
    "  HostName 103.184.47.186",
    "  Port 27489",
    "  User root",
    `  IdentityFile ${oldSourceKeyPath}`,
    `  IdentityFile ${otherNewKeyPath}`,
    "",
  ].join("\n"));

  const restoredHost = {
    id: "h-restored-dev",
    name: "103.184.47.185_dev",
    hostname: "103.184.47.185",
    port: 27488,
    username: "root",
    identityFile: newKeyPath,
    tags: [],
  };
  const unmanagedAliasHost = {
    id: "h-unmanaged-dev",
    name: "unmanaged-dev",
    hostname: "103.184.47.186",
    port: 27489,
    username: "root",
    identityFile: otherNewKeyPath,
    tags: [],
  };
  const hosts = [restoredHost, unmanagedAliasHost];
  const storage = createConnectionStorageMock(hosts, vscode);

  await connectHostInNewWindow(restoredHost, storage);
  const restoredCommand = lastCommand(vscode, "opensshremotes.openEmptyWindow");
  let config = readFileSync(configPath, "utf8");
  assert(restoredCommand?.args.host === restoredHost.name, `Expected restored host to keep its alias after stale SSH Kit block cleanup, got ${restoredCommand?.args.host}`);
  assert(!config.includes("old-source-host"), "Expected stale SSH Kit connect alias block from deleted host to be removed before connecting");
  assert(config.includes("# SSH Kit connect alias h-restored-dev begin"), "Expected current host connect alias block to be written");
  assert(config.includes(`  IdentityFile ${newKeyPath}`), "Expected current host connect alias to use restored local identity file");
  assert(!findHostBlockText(config, restoredHost.name)?.includes(oldSourceKeyPath), "Expected restored host alias block not to keep the old source identity file");

  await connectHostInNewWindow(unmanagedAliasHost, storage);
  const unmanagedCommand = lastCommand(vscode, "opensshremotes.openEmptyWindow");
  const expectedAlias = "unmanaged-dev｜103.184.47.186：27489";
  config = readFileSync(configPath, "utf8");
  assert(unmanagedCommand?.args.host === expectedAlias, `Expected unmanaged stale alias to be avoided, got ${unmanagedCommand?.args.host}`);
  assert(findHostBlockText(config, "unmanaged-dev")?.includes(oldSourceKeyPath), "Expected unmanaged user Host block to be preserved");
  assert(findHostBlockText(config, "unmanaged-dev")?.includes(otherNewKeyPath), "Expected unmanaged user Host block with mixed keys to be preserved");
  assert(findHostBlockText(config, expectedAlias)?.includes(`IdentityFile ${otherNewKeyPath}`), "Expected generated fallback alias to use the current identity file");
}

async function checkRemoteAlias() {
  checkCommandExists("ssh", ["-V"]);
  const home = makeTempHome("remote");
  const vscode = createVSCodeMock();
  const {
    connectHostInCurrentWindow,
    connectHostInNewWindow,
    connectInVSCodeTerminal,
    findHostByRemoteSshAlias,
  } = loadTsModule("src/commands/connectCommands.ts", { vscode });
  const host = {
    id: "h-remote",
    name: "10.0.1.11_nginx+redis+safeline",
    hostname: "211.154.20.113",
    port: 15578,
    username: "root",
    tags: [],
  };
  const hosts = [host];
  const storage = {
    async addRecentConnection(hostId) {
      assert(hosts.some((item) => item.id === hostId), "Expected recent connection to use the host id");
    },
    getAllHosts() {
      return hosts;
    },
    async setCurrentConnection(hostId, alias) {
      assert(hosts.some((item) => item.id === hostId), "Expected current connection to use the host id");
      assert(alias, "Expected current connection alias to be recorded");
      vscode.__events.push(`current:${alias}`);
    },
    async setWindowConnection(hostId, alias) {
      assert(hosts.some((item) => item.id === hostId), "Expected window connection to use the host id");
      assert(alias, "Expected window connection alias to be recorded");
      vscode.__events.push(`window:${alias}`);
    },
    getWindowConnection() {
      return undefined;
    },
    async setRemoteAuthorityConnection(hostId, alias) {
      assert(hosts.some((item) => item.id === hostId), "Expected remote authority connection to use the host id");
      assert(alias, "Expected remote authority alias to be recorded");
      vscode.__events.push(`authority:${alias}`);
    },
    getRemoteAuthorityConnection() {
      return undefined;
    },
    async clearRemoteAuthorityConnection(hostId) {
      assert(hosts.some((item) => item.id === hostId), "Expected remote authority cleanup to use the host id");
      vscode.__events.push(`clear-authority:${hostId}`);
    },
    async addPendingWindowConnection(hostId, alias) {
      assert(hosts.some((item) => item.id === hostId), "Expected pending connection to use the host id");
      assert(alias, "Expected pending connection alias to be recorded");
      vscode.__events.push(`pending:${alias}`);
    },
    async claimPendingWindowConnection() {
      return undefined;
    },
    async clearCurrentConnection(hostId) {
      assert(hosts.some((item) => item.id === hostId), "Expected current connection cleanup to use the host id");
      vscode.__events.push(`clear:${hostId}`);
    },
    async clearWindowConnection(hostId) {
      assert(hosts.some((item) => item.id === hostId), "Expected window connection cleanup to use the host id");
      vscode.__events.push(`clear-window:${hostId}`);
    },
    async clearPendingWindowConnection(hostId) {
      assert(hosts.some((item) => item.id === hostId), "Expected pending connection cleanup to use the host id");
      vscode.__events.push(`clear-pending:${hostId}`);
    },
  };

  await connectHostInNewWindow(host, storage);
  const command = lastCommand(vscode, "opensshremotes.openEmptyWindow");
  assert(command, "Expected Remote-SSH openEmptyWindow to be called");
  const alias = "10.0.1.11_nginx+redis+safeline";
  assert(command.args.host === alias, `Unexpected Remote-SSH host argument: ${command.args.host}`);
  assert(!vscode.__events.includes(`current:${alias}`), "Expected new-window connections not to overwrite global current connection");
  assert(
    vscode.__events.indexOf(`pending:${alias}`) < vscode.__events.indexOf("command:opensshremotes.openEmptyWindow"),
    "Expected new-window connection context to be queued before opening Remote-SSH"
  );
  assert(
    vscode.__events.indexOf(`authority:${alias}`) < vscode.__events.indexOf("command:opensshremotes.openEmptyWindow"),
    "Expected new-window connection authority to be indexed before opening Remote-SSH"
  );
  assert(!vscode.__events.includes(`window:${alias}`), "Expected new-window connections not to overwrite the current window state");
  assertRemoteAliasScpSafe(alias);
  assert(`${alias}:/root/.vscode-server`.indexOf(":") === alias.length, "scp target parsing must see only the host/path separator colon");

  const configPath = join(home, ".ssh", "config");
  const config = readFileSync(configPath, "utf8");
  assert(config.includes(`Host ${alias}`), "Expected SSH Kit alias Host block in SSH config");

  const result = spawnSync("ssh", ["-G", "-F", configPath, alias], {
    encoding: "utf8",
  });
  assert(result.status === 0, result.stderr || "ssh -G failed");
  const settings = result.stdout.toLowerCase();
  assert(settings.includes("hostname 211.154.20.113"), "Expected OpenSSH to resolve HostName from the alias block");
  assert(settings.includes("port 15578"), "Expected OpenSSH to resolve Port from the alias block");
  assert(settings.includes("user root"), "Expected OpenSSH to resolve User from the alias block");

  const ipv6Host = {
    id: "h-remote-ipv6",
    name: "prod/api#1 \"blue\"+root",
    hostname: "2001:db8::1",
    port: 2222,
    username: "deploy",
    tags: [],
  };
  hosts.push(ipv6Host);
  await connectHostInNewWindow(ipv6Host, storage);
  const ipv6Command = lastCommand(vscode, "opensshremotes.openEmptyWindow");
  const ipv6Alias = "prod api 1 blue +root";
  assert(ipv6Command, "Expected Remote-SSH openEmptyWindow to be called for IPv6 host");
  assert(ipv6Command.args.host === ipv6Alias, `Unexpected IPv6 Remote-SSH host argument: ${ipv6Command.args.host}`);
  assertRemoteAliasScpSafe(ipv6Alias);

  const ipv6Result = spawnSync("ssh", ["-G", "-F", configPath, ipv6Alias], {
    encoding: "utf8",
  });
  assert(ipv6Result.status === 0, ipv6Result.stderr || "ssh -G failed for IPv6 alias");
  const ipv6Settings = ipv6Result.stdout.toLowerCase();
  assert(ipv6Settings.includes("hostname 2001:db8::1"), "Expected OpenSSH to resolve IPv6 HostName from the alias block");
  assert(ipv6Settings.includes("port 2222"), "Expected OpenSSH to resolve IPv6 Port from the alias block");
  assert(ipv6Settings.includes("user deploy"), "Expected OpenSSH to resolve IPv6 User from the alias block");

  const duplicateNameHost = {
    id: "h-remote-duplicate",
    name: host.name,
    hostname: "211.154.20.114",
    port: 10274,
    username: "root",
    tags: [],
  };
  hosts.push(duplicateNameHost);
  await connectHostInNewWindow(duplicateNameHost, storage);
  const duplicateCommand = lastCommand(vscode, "opensshremotes.openEmptyWindow");
  const duplicateAlias = "10.0.1.11_nginx+redis+safeline｜211.154.20.114：10274";
  assert(duplicateCommand, "Expected Remote-SSH openEmptyWindow to be called for duplicate-name host");
  assert(duplicateCommand.args.host === duplicateAlias, `Unexpected duplicate Remote-SSH host argument: ${duplicateCommand.args.host}`);
  assert(findHostByRemoteSshAlias(duplicateAlias, hosts)?.id === duplicateNameHost.id, "Expected duplicate-name authority alias to resolve to the endpoint-qualified host");
  assertRemoteAliasScpSafe(duplicateAlias);

  const currentWindowEventStart = vscode.__events.length;
  await connectHostInCurrentWindow(host, storage);
  const currentCommand = lastCommand(vscode, "opensshremotes.openEmptyWindowInCurrentWindow");
  const currentEvents = vscode.__events.slice(currentWindowEventStart);
  const currentAlias = "10.0.1.11_nginx+redis+safeline｜211.154.20.113：15578";
  assert(currentCommand, "Expected Remote-SSH current-window command to be called");
  assert(currentCommand.args.host === currentAlias, `Unexpected current-window host argument: ${currentCommand.args.host}`);
  assert(
    currentEvents.indexOf(`current:${currentAlias}`) < currentEvents.indexOf("command:opensshremotes.openEmptyWindowInCurrentWindow"),
    "Expected current-window connections to record global current before opening Remote-SSH"
  );
  assert(
    currentEvents.indexOf(`window:${currentAlias}`) < currentEvents.indexOf("command:opensshremotes.openEmptyWindowInCurrentWindow"),
    "Expected current-window connections to record this window before opening Remote-SSH"
  );
  assert(
    currentEvents.indexOf(`pending:${currentAlias}`) < currentEvents.indexOf("command:opensshremotes.openEmptyWindowInCurrentWindow"),
    "Expected current-window connections to queue context before the remote side reloads the window"
  );
  assert(
    currentEvents.indexOf(`authority:${currentAlias}`) < currentEvents.indexOf("command:opensshremotes.openEmptyWindowInCurrentWindow"),
    "Expected current-window connections to index the Remote-SSH authority before opening"
  );

  const terminalKeyPath = join(home, ".ssh", "id_terminal");
  writeFileSync(terminalKeyPath, "placeholder");
  const terminalHost = {
    id: "h-terminal",
    name: "terminal-host",
    hostname: "203.0.113.10",
    port: 2222,
    username: "deploy",
    identityFile: "id_terminal",
    tags: [],
  };
  hosts.push(terminalHost);
  await connectInVSCodeTerminal(terminalHost, storage);
  const terminal = lastTerminal(vscode);
  assert(terminal, "Expected VS Code terminal to be created");
  assertIncludesSequence(terminal.shellArgs, ["-o", "StrictHostKeyChecking=accept-new"], "Expected integrated terminal SSH to auto-accept new host keys");
  assertIncludesSequence(terminal.shellArgs, ["-i", terminalKeyPath], "Expected relative identity files to resolve under ~/.ssh");

  const missingKeyHost = {
    ...terminalHost,
    id: "h-terminal-missing-key",
    name: "terminal-missing-key",
    identityFile: "missing_key",
  };
  hosts.push(missingKeyHost);
  vscode.__warningChoice = "继续连接";
  await connectInVSCodeTerminal(missingKeyHost, storage);
  const missingKeyTerminal = lastTerminal(vscode);
  assert(missingKeyTerminal, "Expected terminal to be created after confirming missing key");
  assert(!missingKeyTerminal.shellArgs.includes("-i"), "Expected missing identity file to be skipped for terminal SSH");

  vscode.env.remoteName = "ssh-remote";
  vscode.__warningChoice = "在本机 VS Code 终端打开";
  await connectInVSCodeTerminal(terminalHost, storage);
  const localTerminalCommand = lastCommand(vscode, "workbench.action.terminal.newLocal");
  const sendSequenceCommand = lastCommand(vscode, "workbench.action.terminal.sendSequence");
  assert(localTerminalCommand, "Expected remote windows to create a local VS Code terminal");
  assert(sendSequenceCommand, "Expected SSH command to be sent to the local VS Code terminal");
  assert(sendSequenceCommand.args.text.includes("ssh "), "Expected local terminal command text to contain ssh");
  assert(sendSequenceCommand.args.text.includes("StrictHostKeyChecking=accept-new"), "Expected local VS Code terminal SSH to auto-accept new host keys");
  assert(sendSequenceCommand.args.text.includes("deploy@203.0.113.10"), "Expected local VS Code terminal SSH target");
  vscode.env.remoteName = undefined;
  vscode.__warningChoice = undefined;
}

function createConnectionStorageMock(hosts, vscode) {
  return {
    async addRecentConnection(hostId) {
      assert(hosts.some((item) => item.id === hostId), "Expected recent connection to use the host id");
    },
    getAllHosts() {
      return hosts;
    },
    async setCurrentConnection(hostId, alias) {
      assert(hosts.some((item) => item.id === hostId), "Expected current connection to use the host id");
      assert(alias, "Expected current connection alias to be recorded");
      vscode.__events.push(`current:${alias}`);
    },
    async setWindowConnection(hostId, alias) {
      assert(hosts.some((item) => item.id === hostId), "Expected window connection to use the host id");
      assert(alias, "Expected window connection alias to be recorded");
      vscode.__events.push(`window:${alias}`);
    },
    getWindowConnection() {
      return undefined;
    },
    async setRemoteAuthorityConnection(hostId, alias) {
      assert(hosts.some((item) => item.id === hostId), "Expected remote authority connection to use the host id");
      assert(alias, "Expected remote authority alias to be recorded");
      vscode.__events.push(`authority:${alias}`);
    },
    getRemoteAuthorityConnection() {
      return undefined;
    },
    async clearRemoteAuthorityConnection(hostId) {
      assert(hosts.some((item) => item.id === hostId), "Expected remote authority cleanup to use the host id");
      vscode.__events.push(`clear-authority:${hostId}`);
    },
    async addPendingWindowConnection(hostId, alias) {
      assert(hosts.some((item) => item.id === hostId), "Expected pending connection to use the host id");
      assert(alias, "Expected pending connection alias to be recorded");
      vscode.__events.push(`pending:${alias}`);
    },
    async claimPendingWindowConnection() {
      return undefined;
    },
    async clearCurrentConnection(hostId) {
      assert(hosts.some((item) => item.id === hostId), "Expected current connection cleanup to use the host id");
      vscode.__events.push(`clear:${hostId}`);
    },
    async clearWindowConnection(hostId) {
      assert(hosts.some((item) => item.id === hostId), "Expected window connection cleanup to use the host id");
      vscode.__events.push(`clear-window:${hostId}`);
    },
    async clearPendingWindowConnection(hostId) {
      assert(hosts.some((item) => item.id === hostId), "Expected pending connection cleanup to use the host id");
      vscode.__events.push(`clear-pending:${hostId}`);
    },
  };
}

function findHostBlockText(config, alias) {
  const sectionRegex = /^Host\s+(.+)$/gim;
  let match;
  const sections = [];
  while ((match = sectionRegex.exec(config)) !== null) {
    sections.push({ alias: match[1].trim().replace(/^"|"$/g, ""), start: match.index });
  }
  const index = sections.findIndex((section) => section.alias === alias);
  if (index < 0) {return undefined;}
  const start = sections[index].start;
  const end = sections[index + 1]?.start ?? config.length;
  return config.slice(start, end);
}

function assertRemoteAliasScpSafe(alias) {
  assert(!/[:/\\#"'<>|*?%]/.test(alias), `Remote-SSH alias contains unsafe ASCII separators: ${alias}`);
}

function lastCommand(vscode, command) {
  return vscode.__commands.filter((entry) => entry.command === command).at(-1);
}

function lastTerminal(vscode) {
  return vscode.__terminals.at(-1);
}

function assertIncludesSequence(values, sequence, message) {
  assert(
    values.some((value, index) =>
      sequence.every((part, offset) => values[index + offset] === part)
    ),
    message
  );
}

function createExtensionContext(initialData) {
  const values = new Map([["sshKit.data", initialData]]);
  const workspaceValues = new Map();
  return {
    globalState: {
      get(key, defaultValue) {
        return values.has(key) ? values.get(key) : defaultValue;
      },
      async update(key, value) {
        if (value === undefined) {
          values.delete(key);
        } else {
          values.set(key, value);
        }
      },
    },
    workspaceState: {
      get(key, defaultValue) {
        return workspaceValues.has(key) ? workspaceValues.get(key) : defaultValue;
      },
      async update(key, value) {
        if (value === undefined) {
          workspaceValues.delete(key);
        } else {
          workspaceValues.set(key, value);
        }
      },
    },
  };
}

function createVSCodeMock() {
  const commands = [];
  const events = [];
  const messages = [];
  const terminals = [];
  const mock = {
    __commands: commands,
    __events: events,
    __messages: messages,
    __terminals: terminals,
    __infoHandler: undefined,
    __openDialogUris: undefined,
    __saveDialogUri: undefined,
    __quickPickHandler: undefined,
    __warningHandler: undefined,
    __warningChoice: undefined,
    window: {
      terminals: [],
      createTerminal(options) {
        terminals.push(options);
        return {
          show() {
            events.push("terminal.show");
          },
        };
      },
      setStatusBarMessage(message, timeout) {
        messages.push({ type: "status", message, timeout });
        return { dispose() {} };
      },
      async showInformationMessage(message, ...items) {
        messages.push({ type: "info", message, items });
        if (typeof mock.__infoHandler === "function") {
          return mock.__infoHandler(message, items);
        }
        return undefined;
      },
      async showOpenDialog() {
        return mock.__openDialogUris;
      },
      async showSaveDialog() {
        return mock.__saveDialogUri;
      },
      async showQuickPick(items, options) {
        if (typeof mock.__quickPickHandler === "function") {
          return mock.__quickPickHandler(items, options);
        }
        return undefined;
      },
      async showWarningMessage(message, ...items) {
        messages.push({ type: "warning", message, items });
        if (typeof mock.__warningHandler === "function") {
          return mock.__warningHandler(message, items);
        }
        return mock.__warningChoice;
      },
      async showInputBox() {
        return undefined;
      },
      async showErrorMessage(message, ...items) {
        messages.push({ type: "error", message, items });
        throw new Error(String(message));
      },
    },
    workspace: {
      workspaceFolders: undefined,
    },
    env: {
      remoteName: undefined,
    },
    commands: {
      async executeCommand(command, args) {
        commands.push({ command, args });
        events.push(`command:${command}`);
      },
    },
    Uri: {
      file(fsPath) {
        return { fsPath };
      },
    },
  };
  return mock;
}
