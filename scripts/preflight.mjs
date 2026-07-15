#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const expectedPackageFiles = [
  "CHANGELOG.md",
  "CHANGELOG.zh-CN.md",
  "LICENSE",
  "README.md",
  "README.zh-CN.md",
  "dist/extension.js",
  "icon.png",
  "l10n/bundle.l10n.json",
  "l10n/bundle.l10n.zh-cn.json",
  "package.json",
  "package.nls.json",
  "package.nls.zh-cn.json",
];

const forbiddenPackageRules = [
  { label: ".vscode/**", matches: (file) => file.startsWith(".vscode/") },
  { label: "node_modules/**", matches: (file) => file.startsWith("node_modules/") },
  { label: "scripts/**", matches: (file) => file.startsWith("scripts/") },
  { label: "src/**", matches: (file) => file.startsWith("src/") },
  { label: "dist/**/*.map", matches: (file) => file.startsWith("dist/") && file.endsWith(".map") },
  { label: "*.vsix", matches: (file) => file.endsWith(".vsix") },
  { label: "icon.svg", matches: (file) => file === "icon.svg" },
  { label: "pnpm-lock.yaml", matches: (file) => file === "pnpm-lock.yaml" },
  { label: "pnpm-workspace.yaml", matches: (file) => file === "pnpm-workspace.yaml" },
  { label: "tsconfig.json", matches: (file) => file === "tsconfig.json" },
  { label: "esbuild.js", matches: (file) => file === "esbuild.js" },
  { label: "eslint.config.mjs", matches: (file) => file === "eslint.config.mjs" },
  { label: ".gitignore", matches: (file) => file === ".gitignore" },
  { label: ".vscodeignore", matches: (file) => file === ".vscodeignore" },
];

const manifest = readJson("package.json");
const nlsEn = readJson("package.nls.json");
const nlsZh = readJson("package.nls.zh-cn.json");
const readmeEn = readFileSync(join(root, "README.md"), "utf8");
const readmeZh = readFileSync(join(root, "README.zh-CN.md"), "utf8");
const packageFiles = getVscePackageFiles();
const checks = [];

addCheck("Marketplace identity", "publisher", "lixiaoyu", manifest.publisher);
addCheck("Marketplace identity", "name", "ssh-kit", manifest.name);
addCheck("Marketplace identity", "extension id", "lixiaoyu.ssh-kit", `${manifest.publisher}.${manifest.name}`);
addCheck("Marketplace identity", "version", "semver x.y.z", manifest.version, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version ?? ""));
addCheck("Marketplace identity", "category", "Other", (manifest.categories ?? []).join(", "));
addCheck("Marketplace identity", "repository", "github.com/Beautiful-blue-sky/vscode-ssh-kit", manifest.repository?.url ?? "", (manifest.repository?.url ?? "").includes("github.com/Beautiful-blue-sky/vscode-ssh-kit"));
addCheck("Marketplace identity", "extension kind", "ui", (manifest.extensionKind ?? []).join(", "), (manifest.extensionKind ?? []).includes("ui"));
addCheck("Marketplace identity", "startup activation", "*", (manifest.activationEvents ?? []).join(", "), (manifest.activationEvents ?? []).includes("*"));

addCheck("Localized manifest", "displayName placeholder", "%displayName%", manifest.displayName);
addCheck("Localized manifest", "description placeholder", "%description%", manifest.description);
addCheck("Localized manifest", "en displayName", "SSH Kit", nlsEn.displayName);
addCheck("Localized manifest", "en description", "non-empty", nlsEn.description, Boolean(nlsEn.description));
addCheck("Localized manifest", "zh displayName", "SSH Kit", nlsZh.displayName);
addCheck("Localized manifest", "zh description", "non-empty", nlsZh.description, Boolean(nlsZh.description));
addCheck("Localized manifest", "runtime bundle path", "./l10n", manifest.l10n);

addCheck("Runtime assets", "main", "./dist/extension.js", manifest.main);
addCheck("Runtime assets", "main exists", "present", fileStatus(manifest.main));
addCheck("Runtime assets", "icon", "icon.png", manifest.icon);
addCheck("Runtime assets", "icon exists", "present", fileStatus(manifest.icon));

const iconSize = readPngSize(manifest.icon);
addCheck(
  "Runtime assets",
  "icon size",
  "128x128",
  iconSize ? `${iconSize.width}x${iconSize.height}` : "unreadable",
  iconSize?.width === 128 && iconSize?.height === 128,
);

const contributedCommands = manifest.contributes?.commands ?? [];
const contributedCommandIds = new Set(contributedCommands.map((command) => command.command));
const undefinedMenuCommands = menuCommandReferences()
  .filter((command) => command.startsWith("sshKit.") && !contributedCommandIds.has(command));
const hiddenCommandPaletteCommands = new Set(
  (manifest.contributes?.menus?.commandPalette ?? [])
    .filter((item) => item.when === "false")
    .map((item) => item.command),
);
const contextOnlyCommands = [
  "sshKit.connectHostInCurrentWindow",
  "sshKit.connectHostInNewWindow",
  "sshKit.connectInExternalTerminal",
  "sshKit.editHost",
  "sshKit.deleteHost",
  "sshKit.renameGroup",
  "sshKit.deleteGroup",
  "sshKit.copyHostName",
  "sshKit.copyHostDetail",
  "sshKit.testConnection",
  "sshKit.copyKeyPublic",
  "sshKit.copyKeyDetail",
  "sshKit.deleteKey",
  "sshKit.renameKey",
  "sshKit.showKeyDetail",
  "sshKit.openKeyFile",
  "sshKit.openPrivateKey",
];
const commandsMissingCategory = contributedCommands
  .filter((command) => command.category !== "%commands.category%")
  .map((command) => command.command);
const visibleContextCommands = contextOnlyCommands.filter((command) => !hiddenCommandPaletteCommands.has(command));
const commandPaletteCommands = contributedCommands
  .filter((command) => !hiddenCommandPaletteCommands.has(command.command));
const readmeCommandsEn = commandLabelsFromReadme(readmeEn);
const readmeCommandsZh = commandLabelsFromReadme(readmeZh);
const missingReadmeCommandsEn = commandPaletteCommands
  .map((command) => commandLabel(command, nlsEn))
  .filter((label) => !readmeCommandsEn.has(label));
const missingReadmeCommandsZh = commandPaletteCommands
  .map((command) => commandLabel(command, nlsZh))
  .filter((label) => !readmeCommandsZh.has(label));
const allowedInlineReadmeCommandsEn = new Set(["SSH Kit: Search Hosts"]);
const allowedInlineReadmeCommandsZh = new Set(["SSH Kit: 搜索主机"]);
const visibleCommandLabelsEn = new Set(commandPaletteCommands.map((command) => commandLabel(command, nlsEn)));
const visibleCommandLabelsZh = new Set(commandPaletteCommands.map((command) => commandLabel(command, nlsZh)));
const extraReadmeCommandsEn = [...readmeCommandsEn]
  .filter((label) => !visibleCommandLabelsEn.has(label) && !allowedInlineReadmeCommandsEn.has(label));
const extraReadmeCommandsZh = [...readmeCommandsZh]
  .filter((label) => !visibleCommandLabelsZh.has(label) && !allowedInlineReadmeCommandsZh.has(label));
addCheck("Contribution surface", "commands", "non-empty", String(contributedCommands.length), contributedCommands.length > 0);
addCheck(
  "Contribution surface",
  "menu command references",
  "defined commands",
  undefinedMenuCommands.length > 0 ? [...new Set(undefinedMenuCommands)].join(", ") : "defined commands",
  undefinedMenuCommands.length === 0,
);
addCheck(
  "Contribution surface",
  "command category",
  "all commands categorized as SSH Kit",
  commandsMissingCategory.length > 0 ? commandsMissingCategory.join(", ") : "all categorized",
  commandsMissingCategory.length === 0,
);
addCheck(
  "Contribution surface",
  "context-only command palette",
  "hidden",
  visibleContextCommands.length > 0 ? visibleContextCommands.join(", ") : "hidden",
  visibleContextCommands.length === 0,
);
addCheck(
  "Contribution surface",
  "README command table (en)",
  "covers visible commands",
  missingReadmeCommandsEn.length > 0 ? missingReadmeCommandsEn.join(", ") : "covers visible commands",
  missingReadmeCommandsEn.length === 0,
);
addCheck(
  "Contribution surface",
  "README command extras (en)",
  "no nonexistent commands",
  extraReadmeCommandsEn.length > 0 ? extraReadmeCommandsEn.join(", ") : "no nonexistent commands",
  extraReadmeCommandsEn.length === 0,
);
addCheck(
  "Contribution surface",
  "README command table (zh)",
  "covers visible commands",
  missingReadmeCommandsZh.length > 0 ? missingReadmeCommandsZh.join(", ") : "covers visible commands",
  missingReadmeCommandsZh.length === 0,
);
addCheck(
  "Contribution surface",
  "README command extras (zh)",
  "no nonexistent commands",
  extraReadmeCommandsZh.length > 0 ? extraReadmeCommandsZh.join(", ") : "no nonexistent commands",
  extraReadmeCommandsZh.length === 0,
);
addCheck("Contribution surface", "activity bar container", "sshKit", manifest.contributes?.viewsContainers?.activitybar?.[0]?.id ?? "");
addCheck("Contribution surface", "hosts view", "sshKit.hosts", viewIds().includes("sshKit.hosts") ? "sshKit.hosts" : viewIds().join(", "));
addCheck("Contribution surface", "keys view", "sshKit.keys", viewIds().includes("sshKit.keys") ? "sshKit.keys" : viewIds().join(", "));

for (const file of expectedPackageFiles) {
  addCheck("VSIX package files", `include ${file}`, "included", packageFiles.includes(file) ? "included" : "missing");
}

for (const rule of forbiddenPackageRules) {
  const matches = packageFiles.filter(rule.matches);
  addCheck(
    "VSIX package files",
    `exclude ${rule.label}`,
    "absent",
    matches.length > 0 ? matches.join(", ") : "absent",
    matches.length === 0,
  );
}

const unexpectedFiles = packageFiles.filter((file) => !expectedPackageFiles.includes(file));
addCheck(
  "VSIX package files",
  "unexpected extras",
  "none",
  unexpectedFiles.length > 0 ? unexpectedFiles.join(", ") : "none",
  unexpectedFiles.length === 0,
);

printChecks(checks);
printPackageFileList(packageFiles);

const failedChecks = checks.filter((check) => !check.ok);
if (failedChecks.length > 0) {
  console.error(`\nPreflight failed: ${failedChecks.length} check(s) need attention.`);
  process.exit(1);
}

console.log("\nPreflight passed. The local package metadata and VSIX file set match the expected release shape.");

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), "utf8"));
}

function fileStatus(relativePath) {
  if (!relativePath) {
    return "missing";
  }

  const normalized = relativePath.startsWith("./") ? relativePath.slice(2) : relativePath;
  return existsSync(join(root, normalized)) ? "present" : "missing";
}

function readPngSize(relativePath) {
  if (!relativePath) {
    return undefined;
  }

  const iconPath = join(root, relativePath);
  if (!existsSync(iconPath)) {
    return undefined;
  }

  const buffer = readFileSync(iconPath);
  const pngSignature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== pngSignature || buffer.length < 24) {
    return undefined;
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function viewIds() {
  return Object.values(manifest.contributes?.views ?? {})
    .flat()
    .map((view) => view.id);
}

function menuCommandReferences() {
  return Object.values(manifest.contributes?.menus ?? {})
    .flat()
    .map((item) => item.command)
    .filter(Boolean);
}

function commandLabelsFromReadme(content) {
  const labels = new Set();
  const regex = /`(SSH Kit: [^`]+)`/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    labels.add(match[1]);
  }
  return labels;
}

function commandLabel(command, nls) {
  return `${resolveNls(command.category, nls)}: ${resolveNls(command.title, nls)}`;
}

function resolveNls(value, nls) {
  const match = /^%(.+)%$/.exec(value ?? "");
  return match ? nls[match[1]] : value;
}

function getVscePackageFiles() {
  const vsceBin = join(root, "node_modules", ".bin", process.platform === "win32" ? "vsce.cmd" : "vsce");
  if (!existsSync(vsceBin)) {
    throw new Error("Missing local vsce binary. Run pnpm install first.");
  }

  const result = spawnSync(vsceBin, ["ls", "--no-dependencies"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "vsce ls failed");
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim().replaceAll("\\", "/"))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function addCheck(section, item, expected, actual, ok = actual === expected) {
  checks.push({
    section,
    item,
    expected: String(expected ?? ""),
    actual: String(actual ?? ""),
    ok,
  });
}

function printChecks(items) {
  let lastSection = "";
  for (const item of items) {
    if (item.section !== lastSection) {
      lastSection = item.section;
      console.log(`\n== ${lastSection} ==`);
      printTableHeader();
    }

    printTableRow([
      item.ok ? "ok" : "fail",
      item.item,
      item.expected,
      item.actual,
    ]);
  }
}

function printTableHeader() {
  printTableRow(["status", "item", "expected", "actual"]);
  printTableRow(["------", "----", "--------", "------"]);
}

function printTableRow(values) {
  const widths = [6, 32, 48, 72];
  console.log(values.map((value, index) => padCell(value, widths[index])).join("  "));
}

function padCell(value, width) {
  const singleLine = value.replace(/\s+/g, " ");
  return singleLine.padEnd(Math.max(width, singleLine.length), " ");
}

function printPackageFileList(files) {
  console.log(`\n== VSIX package file list (${files.length}) ==`);
  for (const file of files) {
    console.log(`- ${file}`);
  }
}
