// SSH Kit — Key management UI commands
import * as path from "path";
import * as vscode from "vscode";
import {
  listKeys, populateFingerprints, generateKeyPair, deleteKeyPair, renameKeyPair,
  readPublicKey, KeyInfo, KeyType
} from "../keys/keyManager";
import { getErrorMessage } from "../core/utils";

/** List and display keys found under ~/.ssh/ */
export async function showKeyList(keyTree?: { refresh: () => void }): Promise<void> {
  const keys = listKeys();
  if (keys.length === 0) {
    vscode.window.showInformationMessage(
      "未找到 SSH 密钥。可以通过命令「生成 SSH 密钥」新建。"
    );
    return;
  }

  populateFingerprints(keys);

  const items = keys.map((k) => ({
    label: `$(key) ${k.name}`,
    description: k.type,
    detail: k.fingerprint ?? "正在获取指纹...",
    key: k,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "选择密钥查看详情、复制公钥或管理",
  });

  if (picked) {
    await showKeyDetail(picked.key, keyTree);
  }
}

/** Show key detail dialog with copy/delete/rename actions */
async function showKeyDetail(key: KeyInfo, keyTree?: { refresh: () => void }): Promise<void> {
  const parts: string[] = [];
  parts.push(`$(key) 密钥：${key.name}`);
  parts.push(`类型：${key.type}`);
  if (key.fingerprint) {
    parts.push(`指纹：${key.fingerprint}`);
  }
  parts.push(`路径：${key.privateKeyPath}`);

  const choice = await vscode.window.showInformationMessage(
    parts.join("\n"),
    { modal: false },
    "复制公钥", "重命名", "删除"
  );

  switch (choice) {
    case "复制公钥":
      await copyPublicKeyToClipboard(key);
      break;
    case "重命名":
      await promptRenameKey(key, keyTree);
      break;
    case "删除":
      await promptDeleteKey(key, keyTree);
      break;
  }
}

/** Copy public key to clipboard */
async function copyPublicKeyToClipboard(key: KeyInfo): Promise<void> {
  if (!key.publicKeyPath) {
    vscode.window.showErrorMessage("该密钥没有对应的公钥文件。");
    return;
  }
  try {
    const pubKey = readPublicKey(key.publicKeyPath);
    await vscode.env.clipboard.writeText(pubKey);
    vscode.window.showInformationMessage("公钥已复制到剪贴板。");
  } catch (err: unknown) {
    vscode.window.showErrorMessage(`读取公钥失败：${getErrorMessage(err)}`);
  }
}

/** Confirm and delete a key pair */
async function promptDeleteKey(key: KeyInfo, keyTree?: { refresh: () => void }): Promise<void> {
  const confirmed = await vscode.window.showWarningMessage(
    `确定删除密钥「${key.name}」？此操作不可撤销。\n私钥：${key.privateKeyPath}`,
    { modal: true },
    "删除"
  );
  if (confirmed !== "删除") {return;}

  try {
    deleteKeyPair(key.privateKeyPath);
    keyTree?.refresh();
    vscode.window.showInformationMessage(`已删除密钥：${key.name}`);
  } catch (err: unknown) {
    vscode.window.showErrorMessage(`删除失败：${getErrorMessage(err)}`);
  }
}

/** Rename a key pair */
async function promptRenameKey(key: KeyInfo, keyTree?: { refresh: () => void }): Promise<void> {
  const newName = await vscode.window.showInputBox({
    prompt: "新文件名（不含路径）",
    placeHolder: "如 id_ed25519_new",
    value: key.name,
    validateInput: (v) => {
      if (!v.trim()) {return "文件名不能为空";}
      if (/[\\/:"*?<>| ]/.test(v)) {return "文件名包含非法字符（含空格）";}
      return undefined;
    },
  });
  if (!newName || newName.trim() === key.name) {return;}

  try {
    const newPath = renameKeyPair(key.privateKeyPath, newName.trim());
    keyTree?.refresh();
    vscode.window.showInformationMessage(
      `已重命名：${key.name} → ${path.basename(newPath)}`
    );
  } catch (err: unknown) {
    vscode.window.showErrorMessage(`重命名失败：${getErrorMessage(err)}`);
  }
}

/** Generate a new SSH key pair */
export async function generateKey(keyTree?: { refresh: () => void }): Promise<void> {
  const config = await promptKeyGenConfig();
  if (!config) {return;}

  try {
    const result = generateKeyPair(config);
    const pubKey = readPublicKey(result.publicKeyPath);
    await vscode.env.clipboard.writeText(pubKey);

    const passMsg = config.passphrase ? "（已设置密码）" : "";
    vscode.window.showInformationMessage(
      `已生成 ${config.type} 密钥对：${result.privateKeyPath} ${passMsg}\n公钥已复制到剪贴板。`
    );
    keyTree?.refresh();
  } catch (err: unknown) {
    vscode.window.showErrorMessage(`生成密钥失败：${getErrorMessage(err)}`);
  }
}

/** Prompt for key generation configuration */
interface KeyGenConfig {
  type: KeyType;
  name: string;
  comment?: string;
  passphrase?: string;
  bits?: number;
}

async function promptKeyGenConfig(): Promise<KeyGenConfig | undefined> {
  // 1. Select key type
  const typeItems: { label: string; description: string; type: KeyType }[] = [
    { label: "ed25519", description: "推荐 · 256 位 · 安全性高 · 密钥短速度快", type: "ed25519" },
    { label: "RSA 4096", description: "4096 位 · 安全性高 · 兼容旧系统 · 密钥体积大", type: "rsa" },
    { label: "RSA 2048", description: "2048 位 · 安全性中 · 最低兼容门槛", type: "rsa" },
    { label: "ECDSA", description: "256 位 · 安全性高 · 椭圆曲线 · 旧版默认", type: "ecdsa" },
  ];
  const typePick = await vscode.window.showQuickPick(typeItems, {
    placeHolder: "选择密钥加密类型",
  });
  if (!typePick) {return;}
  const type = typePick.type;

  // 2. Key file name
  const name = await vscode.window.showInputBox({
    prompt: "密钥文件名（保存在 ~/.ssh/ 下）",
    placeHolder: `如 id_${type}_github`,
    validateInput: (v) => {
      if (!v.trim()) {return "文件名不能为空";}
      if (/[\\/:"*?<>| ]/.test(v)) {return "文件名包含非法字符（含空格）";}
      return undefined;
    },
  });
  if (!name) {return;}

  // 3. Comment (optional)
  const comment = await vscode.window.showInputBox({
    prompt: "备注（可选，用于标识密钥用途）",
    placeHolder: "如 your-name@company.com",
  });
  if (comment === undefined) {return;}

  // 4. Passphrase (optional)
  const passphrase = await vscode.window.showInputBox({
    prompt: "密码短语（可选，留空则无密码）",
    placeHolder: "建议设置密码保护私钥",
    password: true,
  });
  if (passphrase === undefined) {return;}

  const bits = typePick.label.startsWith("RSA")
    ? parseInt(typePick.label.split(" ")[1], 10)
    : undefined;

  return {
    type,
    name: name.trim(),
    comment: comment?.trim() || undefined,
    passphrase: passphrase || "",
    bits,
  };
}
