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
  const { connectHostInNewWindow, connectInVSCodeTerminal } = loadTsModule("src/commands/connectCommands.ts", { vscode });
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
    async clearCurrentConnection(hostId) {
      assert(hosts.some((item) => item.id === hostId), "Expected current connection cleanup to use the host id");
      vscode.__events.push(`clear:${hostId}`);
    },
  };

  await connectHostInNewWindow(host, storage);
  const command = lastCommand(vscode, "opensshremotes.openEmptyWindow");
  assert(command, "Expected Remote-SSH openEmptyWindow to be called");
  const alias = "10.0.1.11_nginx+redis+safeline";
  assert(command.args.host === alias, `Unexpected Remote-SSH host argument: ${command.args.host}`);
  assert(
    vscode.__events.indexOf(`current:${alias}`) < vscode.__events.indexOf("command:opensshremotes.openEmptyWindow"),
    "Expected current connection to be recorded before opening Remote-SSH"
  );
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
  assertRemoteAliasScpSafe(duplicateAlias);

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
  const events = [];
  const messages = [];
  const terminals = [];
  const mock = {
    __commands: commands,
    __events: events,
    __messages: messages,
    __terminals: terminals,
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
        return undefined;
      },
      async showWarningMessage(message, ...items) {
        messages.push({ type: "warning", message, items });
        return mock.__warningChoice;
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
  };
  return mock;
}
