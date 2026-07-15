#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const basePath = join(root, "l10n", "bundle.l10n.json");
const zhPath = join(root, "l10n", "bundle.l10n.zh-cn.json");
const messages = collectMessages(join(root, "src"));
const expectedBase = Object.fromEntries([...messages].sort().map((message) => [message, message]));

if (process.argv.includes("--check")) {
  const base = readJson(basePath);
  const zh = readJson(zhPath);
  const baseKeys = Object.keys(expectedBase);
  const missingBase = baseKeys.filter((key) => base[key] !== key);
  const missingZh = baseKeys.filter((key) => typeof zh[key] !== "string" || !zh[key].trim());
  const staleBase = Object.keys(base).filter((key) => !messages.has(key));
  const staleZh = Object.keys(zh).filter((key) => !messages.has(key));
  const invalidZhPlaceholders = baseKeys.filter((key) =>
    typeof zh[key] === "string" && placeholderSignature(key) !== placeholderSignature(zh[key])
  );
  if (missingBase.length || missingZh.length || staleBase.length || staleZh.length || invalidZhPlaceholders.length) {
    const parts = [
      formatIssue("missing base messages", missingBase),
      formatIssue("missing zh-cn translations", missingZh),
      formatIssue("stale base messages", staleBase),
      formatIssue("stale zh-cn translations", staleZh),
      formatIssue("zh-cn placeholder mismatches", invalidZhPlaceholders),
    ].filter(Boolean);
    throw new Error(`Localization bundles are out of date:\n${parts.join("\n")}`);
  }
  console.log(`Localization bundles cover ${baseKeys.length} runtime messages.`);
} else {
  writeFileSync(basePath, `${JSON.stringify(expectedBase, null, 2)}\n`, "utf8");
  console.log(`Generated ${basePath} with ${messages.size} messages.`);
}

function collectMessages(directory) {
  const result = new Set();
  for (const filePath of walk(directory)) {
    const sourceText = readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
    visit(sourceFile, sourceFile, result);
  }
  return result;
}

function visit(node, sourceFile, result) {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "t" &&
    ts.isPropertyAccessExpression(node.expression.expression) &&
    node.expression.expression.name.text === "l10n" &&
    ts.isIdentifier(node.expression.expression.expression) &&
    node.expression.expression.expression.text === "vscode"
  ) {
    const message = node.arguments[0];
    if (message && (ts.isStringLiteral(message) || ts.isNoSubstitutionTemplateLiteral(message))) {
      result.add(message.text);
    } else {
      const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      throw new Error(`vscode.l10n.t requires a static message at ${sourceFile.fileName}:${location.line + 1}`);
    }
  }
  ts.forEachChild(node, (child) => visit(child, sourceFile, result));
}

function* walk(directory) {
  for (const name of readdirSync(directory)) {
    const filePath = join(directory, name);
    if (statSync(filePath).isDirectory()) {
      yield* walk(filePath);
    } else if (filePath.endsWith(".ts")) {
      yield filePath;
    }
  }
}

function readJson(filePath) {
  if (!existsSync(filePath)) {return {};}
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function formatIssue(label, values) {
  if (values.length === 0) {return "";}
  const preview = values.slice(0, 8).map((value) => `  - ${value}`).join("\n");
  const suffix = values.length > 8 ? `\n  ...and ${values.length - 8} more` : "";
  return `${label} (${values.length}):\n${preview}${suffix}`;
}

function placeholderSignature(value) {
  return [...value.matchAll(/\{([^}]+)\}/g)]
    .map((match) => match[1])
    .sort()
    .join("|");
}
