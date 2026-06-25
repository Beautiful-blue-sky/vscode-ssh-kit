#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
  await runCheck("Backup restore preview deduplicates hosts and reports key failures", checkBackupRestore);
  await runCheck("Key discovery detects generated keys and can regenerate missing public keys", checkKeyManagement);
  await runCheck("Remote-SSH alias uses the display label and is accepted by OpenSSH config parsing", checkRemoteAlias);
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

  const { importFromSSHConfig, stringifyHosts } = loadTsModule("src/ssh/sshConfig.ts");
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
  assert(!existsSync(join(home, ".ssh", "id_restore")), "Invalid private key should not be written");
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

async function checkRemoteAlias() {
  checkCommandExists("ssh", ["-V"]);
  const home = makeTempHome("remote");
  const vscode = createVSCodeMock();
  const { connectHostInNewWindow } = loadTsModule("src/commands/connectCommands.ts", { vscode });
  const host = {
    id: "h-remote",
    name: "103.184.47.185_dev",
    hostname: "103.184.47.185",
    port: 27488,
    username: "root",
    tags: [],
  };
  const storage = {
    async addRecentConnection(hostId) {
      assert(hostId === host.id, "Expected recent connection to use the host id");
    },
    getAllHosts() {
      return [host];
    },
  };

  await connectHostInNewWindow(host, storage);
  const command = vscode.__commands.find((entry) => entry.command === "vscode.newWindow");
  assert(command, "Expected vscode.newWindow to be called");
  const alias = "SSH Kit: 103.184.47.185_dev | 103.184.47.185:27488";
  assert(command.args.remoteAuthority === `ssh-remote+${alias}`, `Unexpected remoteAuthority: ${command.args.remoteAuthority}`);

  const configPath = join(home, ".ssh", "config");
  const config = readFileSync(configPath, "utf8");
  assert(config.includes(`Host "${alias}"`), "Expected quoted SSH Kit alias Host block in SSH config");

  const result = spawnSync("ssh", ["-G", "-F", configPath, alias], {
    encoding: "utf8",
  });
  assert(result.status === 0, result.stderr || "ssh -G failed");
  const settings = result.stdout.toLowerCase();
  assert(settings.includes("hostname 103.184.47.185"), "Expected OpenSSH to resolve HostName from the alias block");
  assert(settings.includes("port 27488"), "Expected OpenSSH to resolve Port from the alias block");
  assert(settings.includes("user root"), "Expected OpenSSH to resolve User from the alias block");
}

function createExtensionContext(initialData) {
  const values = new Map([["sshKit.data", initialData]]);
  return {
    globalState: {
      get(key) {
        return values.get(key);
      },
      async update(key, value) {
        values.set(key, value);
      },
    },
  };
}

function createVSCodeMock() {
  const commands = [];
  const messages = [];
  return {
    __commands: commands,
    __messages: messages,
    window: {
      terminals: [],
      setStatusBarMessage(message, timeout) {
        messages.push({ type: "status", message, timeout });
        return { dispose() {} };
      },
      async showInformationMessage(message, ...items) {
        messages.push({ type: "info", message, items });
        return undefined;
      },
      async showWarningMessage(message, ...items) {
        messages.push({ type: "warning", message, items });
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
    commands: {
      async executeCommand(command, args) {
        commands.push({ command, args });
      },
    },
  };
}
