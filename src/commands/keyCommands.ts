// SSH Kit — Key management UI commands
import * as path from "path";
import * as vscode from "vscode";
import {
  listKeys, populateFingerprints, generateKeyPair, deleteKeyPair, renameKeyPair,
  readPublicKey, regeneratePublicKey, KeyInfo, KeyType, areIdentityPathsEquivalent
} from "../keys/keyManager";
import { getErrorMessage } from "../core/utils";
import { StorageService } from "../core/storage";
import { HostTreeDataProvider } from "../views/treeView";

/** List and display keys found under ~/.ssh/ */
export async function showKeyList(
  keyTree?: { refresh: () => void },
  storage?: StorageService,
  hostTree?: HostTreeDataProvider
): Promise<void> {
  const keys = listKeys();
  if (keys.length === 0) {
    vscode.window.showInformationMessage(
      vscode.l10n.t("No SSH keys were found. Run “Generate SSH Key” to create one.")
    );
    return;
  }

  populateFingerprints(keys);

  const items = keys.map((k) => ({
    label: `$(key) ${k.name}`,
    description: formatKeyType(k),
    detail: k.fingerprint ?? vscode.l10n.t("Reading fingerprint…"),
    key: k,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: vscode.l10n.t("Choose a key to view details, copy its public key, or manage it"),
  });

  if (picked) {
    await showKeyDetail(picked.key, keyTree, storage, hostTree);
  }
}

/** Show key detail dialog with copy/delete/rename actions */
async function showKeyDetail(
  key: KeyInfo,
  keyTree?: { refresh: () => void },
  storage?: StorageService,
  hostTree?: HostTreeDataProvider
): Promise<void> {
  const parts: string[] = [];
  parts.push(vscode.l10n.t("$(key) Key: {name}", { name: key.name }));
  parts.push(vscode.l10n.t("Type: {type}", { type: formatKeyType(key) }));
  if (key.fingerprint) {
    parts.push(vscode.l10n.t("Fingerprint: {fingerprint}", { fingerprint: key.fingerprint }));
  }
  parts.push(vscode.l10n.t("Path: {path}", { path: key.privateKeyPath }));
  if (!key.publicKeyPath) {
    parts.push(vscode.l10n.t("Public key: file is missing"));
  }

  const regenerateAction = vscode.l10n.t("Regenerate Public Key");
  const copyAction = vscode.l10n.t("Copy Public Key");
  const renameAction = vscode.l10n.t("Rename");
  const deleteAction = vscode.l10n.t("Delete");
  const actions = [
    ...(!key.publicKeyPath || key.type === "unknown" ? [regenerateAction] : []),
    copyAction,
    renameAction,
    deleteAction,
  ];
  const choice = await vscode.window.showInformationMessage(
    parts.join("\n"),
    { modal: false },
    ...actions
  );

  switch (choice) {
    case regenerateAction:
      await promptRegeneratePublicKey(key, keyTree);
      break;
    case copyAction:
      await copyPublicKeyToClipboard(key);
      break;
    case renameAction:
      await promptRenameKey(key, keyTree, storage, hostTree);
      break;
    case deleteAction:
      await promptDeleteKey(key, keyTree, storage, hostTree);
      break;
  }
}

function formatKeyType(key: KeyInfo): string {
  return key.type === "unknown" ? vscode.l10n.t("Unknown") : key.type;
}

/** Copy public key to clipboard */
export async function copyPublicKeyToClipboard(key: KeyInfo): Promise<void> {
  if (!key.publicKeyPath) {
    vscode.window.showErrorMessage(vscode.l10n.t("This key has no public key file."));
    return;
  }
  try {
    const pubKey = readPublicKey(key.publicKeyPath);
    await vscode.env.clipboard.writeText(pubKey);
    vscode.window.showInformationMessage(vscode.l10n.t("Public key copied to the clipboard."));
  } catch (err: unknown) {
    vscode.window.showErrorMessage(vscode.l10n.t("Failed to read public key: {error}", { error: getErrorMessage(err) }));
  }
}

/** Confirm and delete a key pair */
export async function promptDeleteKey(
  key: KeyInfo,
  keyTree?: { refresh: () => void },
  storage?: StorageService,
  hostTree?: HostTreeDataProvider
): Promise<void> {
  const associatedHosts = findHostsUsingKey(storage, key.privateKeyPath);
  const deleteAction = associatedHosts.length > 0
    ? vscode.l10n.t("Delete and Clear Associations")
    : vscode.l10n.t("Delete");
  const confirmed = await vscode.window.showWarningMessage(
    associatedHosts.length > 0
      ? vscode.l10n.t("Delete key “{name}”? It is associated with {count} hosts. Their identity-file associations will also be cleared. This cannot be undone.\nPrivate key: {path}", {
          name: key.name,
          count: associatedHosts.length,
          path: key.privateKeyPath,
        })
      : vscode.l10n.t("Delete key “{name}”? This cannot be undone.\nPrivate key: {path}", {
          name: key.name,
          path: key.privateKeyPath,
        }),
    { modal: true },
    deleteAction
  );
  if (confirmed !== deleteAction) {return;}

  try {
    if (storage && associatedHosts.length > 0) {
      await storage.updateHostsIdentityFile(associatedHosts.map((host) => host.id), undefined);
    }
    try {
      deleteKeyPair(key.privateKeyPath);
    } catch (error) {
      if (storage && associatedHosts.length > 0) {
        try {
          await storage.updateHostsIdentityFile(associatedHosts.map((host) => host.id), key.privateKeyPath);
        } catch {
          // Report the file error; association rollback may require manual repair.
        }
      }
      throw error;
    }
    if (associatedHosts.length > 0) {hostTree?.refresh();}
    keyTree?.refresh();
    vscode.window.showInformationMessage(associatedHosts.length > 0
      ? vscode.l10n.t("Deleted key: {name}. Cleared associations from {count} hosts.", {
          name: key.name,
          count: associatedHosts.length,
        })
      : vscode.l10n.t("Deleted key: {name}", { name: key.name }));
  } catch (err: unknown) {
    vscode.window.showErrorMessage(vscode.l10n.t("Delete failed: {error}", { error: getErrorMessage(err) }));
  }
}

export async function promptRegeneratePublicKey(key: KeyInfo, keyTree?: { refresh: () => void }): Promise<void> {
  const hasPublicKey = Boolean(key.publicKeyPath);
  if (hasPublicKey) {
    const regenerateAction = vscode.l10n.t("Regenerate");
    const confirmed = await vscode.window.showWarningMessage(
      vscode.l10n.t("The public key file already exists. Regenerate and overwrite “{name}.pub”?", { name: key.name }),
      { modal: true },
      regenerateAction
    );
    if (confirmed !== regenerateAction) {return;}
  }

  try {
    const publicKeyPath = regeneratePublicKey(key.privateKeyPath, hasPublicKey);
    keyTree?.refresh();
    vscode.window.showInformationMessage(vscode.l10n.t("Generated public key: {path}", { path: publicKeyPath }));
  } catch (err: unknown) {
    vscode.window.showErrorMessage(vscode.l10n.t("Public key generation failed: {error}", { error: getErrorMessage(err) }));
  }
}

/** Rename a key pair */
export async function promptRenameKey(
  key: KeyInfo,
  keyTree?: { refresh: () => void },
  storage?: StorageService,
  hostTree?: HostTreeDataProvider
): Promise<void> {
  const newName = await vscode.window.showInputBox({
    prompt: vscode.l10n.t("New file name (without a path)"),
    placeHolder: vscode.l10n.t("For example, id_ed25519_new"),
    value: key.name,
    validateInput: (v) => {
      if (!v.trim()) {return vscode.l10n.t("File name is required");}
      if (/[\\/:"*?<>| ]/.test(v)) {return vscode.l10n.t("File name contains invalid characters or spaces");}
      return undefined;
    },
  });
  if (!newName || newName.trim() === key.name) {return;}

  const associatedHosts = findHostsUsingKey(storage, key.privateKeyPath);
  try {
    const newPath = renameKeyPair(key.privateKeyPath, newName.trim());
    if (storage && associatedHosts.length > 0) {
      try {
        await storage.updateHostsIdentityFile(associatedHosts.map((host) => host.id), newPath);
      } catch (error) {
        try { renameKeyPair(newPath, path.basename(key.privateKeyPath)); } catch {
          // Report the storage error; the user can still repair the path manually if rollback fails.
        }
        throw error;
      }
      hostTree?.refresh();
    }
    keyTree?.refresh();
    vscode.window.showInformationMessage(
      associatedHosts.length > 0
        ? vscode.l10n.t("Renamed: {oldName} → {newName}. Updated {count} host associations.", {
            oldName: key.name,
            newName: path.basename(newPath),
            count: associatedHosts.length,
          })
        : vscode.l10n.t("Renamed: {oldName} → {newName}", { oldName: key.name, newName: path.basename(newPath) })
    );
  } catch (err: unknown) {
    vscode.window.showErrorMessage(vscode.l10n.t("Rename failed: {error}", { error: getErrorMessage(err) }));
  }
}

function findHostsUsingKey(storage: StorageService | undefined, privateKeyPath: string) {
  return storage?.getAllHosts().filter((host) => {
    const identityFile = host.identityFile;
    return identityFile ? areIdentityPathsEquivalent(identityFile, privateKeyPath) : false;
  }) ?? [];
}

/** Generate a new SSH key pair */
export async function generateKey(keyTree?: { refresh: () => void }): Promise<void> {
  const config = await promptKeyGenConfig();
  if (!config) {return;}

  try {
    const result = generateKeyPair(config);
    const pubKey = readPublicKey(result.publicKeyPath);
    await vscode.env.clipboard.writeText(pubKey);

    vscode.window.showInformationMessage(config.passphrase
      ? vscode.l10n.t("Generated password-protected {type} key pair: {path}\nPublic key copied to the clipboard.", {
          type: config.type,
          path: result.privateKeyPath,
        })
      : vscode.l10n.t("Generated {type} key pair: {path}\nPublic key copied to the clipboard.", {
          type: config.type,
          path: result.privateKeyPath,
        }));
    keyTree?.refresh();
  } catch (err: unknown) {
    vscode.window.showErrorMessage(vscode.l10n.t("Key generation failed: {error}", { error: getErrorMessage(err) }));
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
    { label: "ed25519", description: vscode.l10n.t("Recommended · 256-bit · strong security · compact and fast"), type: "ed25519" },
    { label: "RSA 4096", description: vscode.l10n.t("4096-bit · strong security · legacy compatibility · larger keys"), type: "rsa" },
    { label: "RSA 2048", description: vscode.l10n.t("2048-bit · moderate security · minimum compatibility option"), type: "rsa" },
    { label: "ECDSA", description: vscode.l10n.t("256-bit · strong security · elliptic curve · older default"), type: "ecdsa" },
  ];
  const typePick = await vscode.window.showQuickPick(typeItems, {
    placeHolder: vscode.l10n.t("Choose a key algorithm"),
  });
  if (!typePick) {return;}
  const type = typePick.type;

  // 2. Key file name
  const name = await vscode.window.showInputBox({
    prompt: vscode.l10n.t("Key file name (saved under ~/.ssh/)"),
    placeHolder: vscode.l10n.t("For example, id_{type}_github", { type }),
    validateInput: (v) => {
      if (!v.trim()) {return vscode.l10n.t("File name is required");}
      if (/[\\/:"*?<>| ]/.test(v)) {return vscode.l10n.t("File name contains invalid characters or spaces");}
      return undefined;
    },
  });
  if (!name) {return;}

  // 3. Comment (optional)
  const comment = await vscode.window.showInputBox({
    prompt: vscode.l10n.t("Comment (optional, used to identify the key)"),
    placeHolder: vscode.l10n.t("For example, your-name@company.com"),
  });
  if (comment === undefined) {return;}

  // 4. Passphrase (optional)
  const passphrase = await vscode.window.showInputBox({
    prompt: vscode.l10n.t("Passphrase (optional; leave empty for none)"),
    placeHolder: vscode.l10n.t("A passphrase is recommended to protect the private key"),
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
