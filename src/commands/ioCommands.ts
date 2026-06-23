// SSH Kit — SSH Config import/export commands
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
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

    let imported = 0;
    let skipped = 0;
    for (const host of hosts) {
      if (storage.getHostByName(host.name)) {
        skipped++;
        continue;
      }
      await storage.addHost(host);
      imported++;
    }

    tree.refresh();

    const parts: string[] = [];
    if (imported > 0) {parts.push(`已导入 ${imported} 台主机`);}
    if (skipped > 0) {parts.push(`跳过 ${skipped} 台重复`);}
    vscode.window.showInformationMessage(parts.join("，") + "。");
  } catch (err: unknown) {
    vscode.window.showErrorMessage(`导入失败：${getErrorMessage(err)}`);
  }
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

    const lines = [
      `即将写入 ${hosts.length} 台主机到 ~/.ssh/config：`,
      stats.added > 0 ? `  新增 ${stats.added} 台` : "",
      stats.synced > 0 ? `  同步 ${stats.synced} 台（已存在，将更新）` : "",
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

    const filePath = exportToSSHConfig(hosts);
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

/** Backup SSH Kit data to a JSON file (including key files) */
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
    "备份文件将包含 SSH 私钥内容，请妥善保管。\n建议保存到加密位置，使用后及时删除。",
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
      preview.keyCount > 0 ? `含 ${preview.keyCount} 个密钥文件（将写入 ~/.ssh/）` : "",
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

    const result = storage.commitImport(json);
    tree.refresh();
    keyTree?.refresh();

    const parts = [`已导入 ${result.importedHosts} 台主机、${result.importedGroups} 个分组`];
    if (result.keyFilesRestored > 0) {
      parts.push(`恢复了 ${result.keyFilesRestored} 个密钥文件到 ~/.ssh/`);
    } else if (result.importedHosts > 0 || result.importedGroups > 0) {
      // Host/group import succeeded but key restore may have partially failed; only report when data was imported
    }
    vscode.window.showInformationMessage(parts.join("，"));
  } catch (err: unknown) {
    vscode.window.showErrorMessage(`恢复失败：${getErrorMessage(err)}`);
  }
}
