// SSH Kit — SSH Config import/export commands
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { SSHHost } from "../core/types";
import { createImportedHostUpdates, findImportMatch } from "../core/hostMatching";
import { StorageService } from "../core/storage";
import { getErrorMessage } from "../core/utils";
import { importFromSSHConfig, exportToSSHConfig, analyzeExport } from "../ssh/sshConfig";
import { HostTreeDataProvider } from "../views/treeView";

/** Import hosts from SSH config */
export async function importConfig(
  storage: StorageService,
  tree: HostTreeDataProvider
): Promise<void> {
  try {
    const { hosts } = importFromSSHConfig();
    if (hosts.length === 0) {
      vscode.window.showInformationMessage("SSH config 中没有找到可导入的主机。");
      return;
    }

    const preview = previewSSHConfigImport(hosts, storage.getAllHosts());
    const confirmed = await confirmSSHConfigImport(preview);
    if (!confirmed) {return;}

    let imported = 0;
    let updated = 0;
    let endpointMatched = 0;
    let skipped = 0;
    let ambiguous = 0;
    const touchedHostIds = new Set<string>();
    const knownHosts = storage.getAllHosts();

    for (const host of hosts) {
      const match = findImportMatch(host, knownHosts, touchedHostIds);
      if (match === "already-touched") {
        skipped++;
        continue;
      }
      if (match === "ambiguous") {
        ambiguous++;
        continue;
      }
      if (match) {
        const updates = createImportedHostUpdates(match.host, host, match.reason);
        await storage.updateHost(match.host.id, updates);
        Object.assign(match.host, updates);
        touchedHostIds.add(match.host.id);
        updated++;
        if (match.reason === "endpoint") {endpointMatched++;}
        continue;
      }

      const added = await storage.addHost(host);
      knownHosts.push(added);
      touchedHostIds.add(added.id);
      imported++;
    }

    tree.refresh();

    const parts: string[] = [];
    if (imported > 0) {parts.push(`已导入 ${imported} 台主机`);}
    if (updated > 0) {
      const detail = endpointMatched > 0 ? `，其中 ${endpointMatched} 台按地址匹配` : "";
      parts.push(`已更新 ${updated} 台已有主机${detail}`);
    }
    if (skipped > 0) {parts.push(`跳过 ${skipped} 台重复`);}
    if (ambiguous > 0) {parts.push(`跳过 ${ambiguous} 台目标重复需手动确认`);}
    if (parts.length === 0) {parts.push("没有需要导入或更新的主机");}
    vscode.window.showInformationMessage(parts.join("，") + "。");
  } catch (err: unknown) {
    vscode.window.showErrorMessage(`导入失败：${getErrorMessage(err)}`);
  }
}

interface SSHConfigImportPreview {
  imported: number;
  updated: number;
  nameMatched: number;
  endpointMatched: number;
  skipped: number;
  ambiguous: number;
  importedSamples: string[];
  updatedSamples: string[];
  ambiguousSamples: string[];
}

function previewSSHConfigImport(
  hosts: Omit<SSHHost, "id">[],
  existingHosts: SSHHost[]
): SSHConfigImportPreview {
  const knownHosts = existingHosts.map((host) => ({ ...host, tags: [...host.tags] }));
  const touchedHostIds = new Set<string>();
  const preview: SSHConfigImportPreview = {
    imported: 0,
    updated: 0,
    nameMatched: 0,
    endpointMatched: 0,
    skipped: 0,
    ambiguous: 0,
    importedSamples: [],
    updatedSamples: [],
    ambiguousSamples: [],
  };

  for (const host of hosts) {
    const match = findImportMatch(host, knownHosts, touchedHostIds);
    if (match === "already-touched") {
      preview.skipped++;
      continue;
    }
    if (match === "ambiguous") {
      preview.ambiguous++;
      pushSample(preview.ambiguousSamples, `${host.name} (${host.username}@${host.hostname}:${host.port})`);
      continue;
    }
    if (match) {
      const updates = createImportedHostUpdates(match.host, host, match.reason);
      Object.assign(match.host, updates);
      touchedHostIds.add(match.host.id);
      preview.updated++;
      if (match.reason === "name") {
        preview.nameMatched++;
      } else {
        preview.endpointMatched++;
      }
      pushSample(preview.updatedSamples, `${host.name} → ${match.host.name}（${match.reason === "name" ? "名称" : "地址"}匹配）`);
      continue;
    }

    preview.imported++;
    const previewHost: SSHHost = {
      ...host,
      id: `preview-${preview.imported}`,
      tags: host.tags ?? [],
    };
    knownHosts.push(previewHost);
    touchedHostIds.add(previewHost.id);
    pushSample(preview.importedSamples, `${host.name} (${host.username}@${host.hostname}:${host.port})`);
  }

  return preview;
}

async function confirmSSHConfigImport(preview: SSHConfigImportPreview): Promise<boolean> {
  if (
    preview.imported === 0 &&
    preview.updated === 0 &&
    preview.skipped === 0 &&
    preview.ambiguous === 0
  ) {
    vscode.window.showInformationMessage("没有需要导入或更新的主机。");
    return false;
  }

  const lines = [
    "即将从 SSH Config 导入：",
    preview.imported > 0 ? `  新增 ${preview.imported} 台` : "",
    preview.updated > 0
      ? `  更新 ${preview.updated} 台（按名称 ${preview.nameMatched}，按地址 ${preview.endpointMatched}）`
      : "",
    preview.skipped > 0 ? `  跳过 ${preview.skipped} 台重复项` : "",
    preview.ambiguous > 0 ? `  跳过 ${preview.ambiguous} 台目标重复需手动确认` : "",
    formatPreviewSamples("新增示例", preview.importedSamples),
    formatPreviewSamples("更新示例", preview.updatedSamples),
    formatPreviewSamples("冲突示例", preview.ambiguousSamples),
  ].filter(Boolean);

  const confirmed = await vscode.window.showInformationMessage(
    lines.join("\n"),
    { modal: true },
    "确认导入"
  );
  return confirmed === "确认导入";
}

function pushSample(samples: string[], value: string): void {
  if (samples.length < 5) {
    samples.push(value);
  }
}

function formatPreviewSamples(label: string, samples: string[]): string {
  return samples.length > 0 ? `  ${label}：${samples.join("；")}` : "";
}

/** Export all hosts to SSH config with change preview and confirmation */
export async function exportConfig(storage: StorageService): Promise<void> {
  try {
    const hosts = storage.getAllHosts();
    if (hosts.length === 0) {
      vscode.window.showInformationMessage("没有可写入的主机。");
      return;
    }

    const stats = analyzeExport(hosts);
    if (!stats) {
      vscode.window.showErrorMessage("无法分析变更影响。");
      return;
    }

    let overwriteUnmanaged = false;
    if (stats.conflicts.length > 0) {
      const preview = stats.conflicts.slice(0, 8).join(", ");
      const more = stats.conflicts.length > 8 ? ` 等 ${stats.conflicts.length} 个` : "";
      const takeover = await vscode.window.showWarningMessage(
        [
          `发现 ${stats.conflicts.length} 个同名或同连接目标 Host 已存在，但不是 SSH Kit 托管：`,
          `${preview}${more}`,
          "",
          "SSH Kit 会按 Host 别名和 HostName/Port/User 判断同一配置。",
          "接管后这些 Host 块会被 SSH Kit 生成内容覆盖，原文件仍会先备份。",
        ].join("\n"),
        { modal: true },
        "接管并覆盖"
      );
      if (takeover !== "接管并覆盖") {return;}
      overwriteUnmanaged = true;
    }

    const lines = [
      `即将写入 ${hosts.length} 台主机到 ~/.ssh/config：`,
      stats.added > 0 ? `  新增 ${stats.added} 台` : "",
      stats.synced > 0 ? `  同步 ${stats.synced} 台（已存在，将更新）` : "",
      stats.conflicts.length > 0 ? `  接管 ${stats.conflicts.length} 个同名或同连接目标 Host` : "",
      stats.preserved > 0 ? `  保留 ${stats.preserved} 个现有主机不动` : "",
      "",
      "原文件将备份为 config.bak.YYYYMMDD-HHmmss",
    ].filter(Boolean);

    const confirmed = await vscode.window.showInformationMessage(
      lines.join("\n"),
      { modal: true },
      "确认写入"
    );
    if (confirmed !== "确认写入") {return;}

    const filePath = exportToSSHConfig(hosts, undefined, { overwriteUnmanaged });
    vscode.window.showInformationMessage(
      `已写入 ${hosts.length} 台主机到 ${filePath}（原文件已备份）`
    );
  } catch (err: unknown) {
    vscode.window.showErrorMessage(`写入失败：${getErrorMessage(err)}`);
  }
}

/** Open the SSH config file (~/.ssh/config) */
export async function openSshConfig(): Promise<void> {
  const configPath = path.join(os.homedir(), ".ssh", "config");
  if (!fs.existsSync(configPath)) {
    vscode.window.showInformationMessage(
      `SSH config 文件不存在：${configPath}`
    );
    return;
  }
  const doc = await vscode.workspace.openTextDocument(configPath);
  await vscode.window.showTextDocument(doc);
}

/** Backup SSH Kit data to a JSON file (including associated key files) */
export async function backupKitData(storage: StorageService): Promise<void> {
  const defaultUri = vscode.Uri.file(
    path.join(os.homedir(), `ssh-kit-backup-${new Date().toISOString().slice(0, 10)}.json`)
  );
  const uri = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { "JSON 文件": ["json"] },
  });
  if (!uri) {return;}

  // Security warning: backup contains private key material
  const confirmed = await vscode.window.showWarningMessage(
    "备份文件将包含已关联主机的 SSH 私钥内容，请妥善保管。\n建议保存到加密位置，使用后及时删除。",
    { modal: true },
    "确认备份"
  );
  if (confirmed !== "确认备份") {return;}

  try {
    const json = storage.exportAllData();
    fs.writeFileSync(uri.fsPath, json, "utf-8");
    vscode.window.showInformationMessage(`已备份到 ${uri.fsPath}`);
  } catch (err: unknown) {
    vscode.window.showErrorMessage(`备份失败：${getErrorMessage(err)}`);
  }
}

/** Restore SSH Kit data from a JSON backup file */
export async function restoreKitData(
  storage: StorageService,
  tree: HostTreeDataProvider,
  keyTree?: { refresh: () => void }
): Promise<void> {
  const uris = await vscode.window.showOpenDialog({
    filters: { "JSON 文件": ["json"] },
    canSelectMany: false,
  });
  if (!uris || uris.length === 0) {return;}

  try {
    const json = fs.readFileSync(uris[0].fsPath, "utf-8");
    const preview = storage.previewImport(json);

    const lines = [
      `即将导入 ${preview.importedHosts} 台主机、${preview.importedGroups} 个分组`,
      preview.skippedHosts > 0 ? `跳过 ${preview.skippedHosts} 台已存在主机` : "",
      preview.keyCount > 0 ? `含 ${preview.keyCount} 个密钥文件（将尝试写入 ~/.ssh/）` : "",
      formatRestoreKeyTargets(preview.keyTargets),
      "已存在的项目将跳过（不覆盖）",
      "",
      "⚠ 请确认备份文件来源可信，其中可能包含私钥",
    ].filter(Boolean);

    const confirmed = await vscode.window.showInformationMessage(
      lines.join("\n"),
      { modal: true },
      "确认导入"
    );
    if (confirmed !== "确认导入") {return;}

    const result = await storage.commitImport(json);
    tree.refresh();
    keyTree?.refresh();

    const parts = [`已导入 ${result.importedHosts} 台主机、${result.importedGroups} 个分组`];
    if (result.skippedHosts > 0) {
      parts.push(`跳过 ${result.skippedHosts} 台已存在主机`);
    }
    if (result.keyFilesRestored > 0) {
      parts.push(`恢复 ${result.keyFilesRestored} 个密钥文件到 ~/.ssh/`);
    }
    if (result.keyFilesSkipped > 0) {
      parts.push(`跳过 ${result.keyFilesSkipped} 个已存在密钥`);
    }
    if (result.keyFilesFailed > 0) {
      parts.push(`${result.keyFilesFailed} 个密钥恢复失败`);
    }
    const action = await vscode.window.showInformationMessage(
      parts.join("，"),
      ...(result.keyFileFailures.length > 0 ? ["查看失败详情"] : [])
    );
    if (action === "查看失败详情") {
      vscode.window.showWarningMessage(
        result.keyFileFailures
          .slice(0, 20)
          .map((failure) => `${failure.name}: ${failure.reason}`)
          .join("\n"),
        { modal: true }
      );
    }
  } catch (err: unknown) {
    vscode.window.showErrorMessage(`恢复失败：${getErrorMessage(err)}`);
  }
}

function formatRestoreKeyTargets(targets: string[]): string {
  if (targets.length === 0) {return "";}
  const visible = targets.slice(0, 8).map((target) => `  - ${target}`);
  const suffix = targets.length > visible.length ? `  ... 另有 ${targets.length - visible.length} 个` : "";
  return ["密钥恢复目标：", ...visible, suffix].filter(Boolean).join("\n");
}
