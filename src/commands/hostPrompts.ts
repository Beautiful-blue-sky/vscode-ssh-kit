import * as vscode from "vscode";
import { SSHGroup, SSHHost } from "../core/types";
import { StorageService } from "../core/storage";
import { areIdentityPathsEquivalent, listKeys } from "../keys/keyManager";

interface InputStep {
  prompt: string;
  placeHolder: string;
  value?: string;
  validate: (value: string) => string | undefined;
}

async function promptInput(step: InputStep): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt: step.prompt,
    placeHolder: step.placeHolder,
    value: step.value,
    validateInput: step.validate,
  });
}

function validateRequiredName(value: string): string | undefined {
  return value.trim() ? undefined : vscode.l10n.t("Name is required");
}

function validateHostAddress(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {return vscode.l10n.t("Address is required");}
  if (/\s/.test(trimmed)) {return vscode.l10n.t("Address cannot contain spaces");}

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = trimmed.match(ipv4);
  if (match) {
    return match.slice(1).some((octet) => Number(octet) > 255)
      ? vscode.l10n.t("Each IPv4 segment must be 255 or less")
      : undefined;
  }

  return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(trimmed)
    ? undefined
    : vscode.l10n.t("Enter a valid IP address or domain name");
}

function validatePort(value: string): string | undefined {
  if (!/^\d+$/.test(value)) {return vscode.l10n.t("Enter a number");}
  const port = Number.parseInt(value, 10);
  return port >= 1 && port <= 65535
    ? undefined
    : vscode.l10n.t("Port must be between 1 and 65535");
}

function validateUsername(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {return vscode.l10n.t("Username is required");}
  return /^[a-z_][a-z0-9_-]*$/.test(trimmed)
    ? undefined
    : vscode.l10n.t("Use lowercase letters, numbers, underscores, or hyphens, starting with a letter");
}

function parseTags(value: string): string[] {
  return value.split(",").map((tag) => tag.trim()).filter(Boolean);
}

export async function promptNewHost(
  storage: StorageService,
  prefill?: Partial<SSHHost>
): Promise<Omit<SSHHost, "id"> | undefined> {
  const name = await promptInput({
    prompt: vscode.l10n.t("Host display name"),
    placeHolder: vscode.l10n.t("For example, es-node1"),
    value: prefill?.name,
    validate: validateRequiredName,
  });
  if (name === undefined) {return undefined;}

  const hostname = await promptInput({
    prompt: vscode.l10n.t("Host address (IP or domain name)"),
    placeHolder: vscode.l10n.t("For example, 10.0.1.11 or my.server.com"),
    value: prefill?.hostname,
    validate: validateHostAddress,
  });
  if (hostname === undefined) {return undefined;}

  const portText = await promptInput({
    prompt: vscode.l10n.t("SSH port"),
    placeHolder: "22",
    value: String(prefill?.port ?? 22),
    validate: validatePort,
  });
  if (portText === undefined) {return undefined;}

  const username = await promptInput({
    prompt: vscode.l10n.t("Login username"),
    placeHolder: vscode.l10n.t("For example, root"),
    value: prefill?.username ?? "root",
    validate: validateUsername,
  });
  if (username === undefined) {return undefined;}

  const groupId = await promptGroup(storage, prefill?.groupId);
  if (groupId === null) {return undefined;}
  const identityFile = await promptIdentityFile(prefill?.identityFile);
  if (identityFile === null) {return undefined;}

  return {
    name: name.trim(),
    hostname: hostname.trim(),
    port: Number.parseInt(portText, 10),
    username: username.trim(),
    groupId: groupId || undefined,
    identityFile: identityFile || undefined,
    tags: prefill?.tags ?? [],
    extraConfig: prefill?.extraConfig,
  };
}

export async function promptEditHost(
  storage: StorageService,
  host: SSHHost
): Promise<Partial<Omit<SSHHost, "id">> | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: vscode.l10n.t("$(symbol-string) Name"), description: host.name, key: "name" },
      { label: vscode.l10n.t("$(globe) Host address"), description: host.hostname, key: "hostname" },
      { label: vscode.l10n.t("$(remote) Port"), description: String(host.port), key: "port" },
      { label: vscode.l10n.t("$(person) Username"), description: host.username, key: "username" },
      {
        label: vscode.l10n.t("$(folder) Group"),
        description: storage.getGroups().find((group) => group.id === host.groupId)?.name ?? vscode.l10n.t("Ungrouped"),
        key: "group",
      },
      { label: vscode.l10n.t("$(key) Identity file"), description: host.identityFile ?? vscode.l10n.t("Not associated"), key: "identityFile" },
      { label: vscode.l10n.t("$(tag) Tags"), description: host.tags.length > 0 ? host.tags.join(", ") : vscode.l10n.t("None"), key: "tags" },
      { label: vscode.l10n.t("$(edit) Edit all fields"), description: vscode.l10n.t("Review every field with the full wizard"), key: "full" },
    ],
    { placeHolder: vscode.l10n.t("Choose a field to edit: {name}", { name: host.name }) }
  );
  if (!picked) {return undefined;}

  switch (picked.key) {
    case "name": {
      const value = await promptInput({
        prompt: vscode.l10n.t("Host display name"),
        placeHolder: vscode.l10n.t("For example, es-node1"),
        value: host.name,
        validate: validateRequiredName,
      });
      return value === undefined ? undefined : { name: value.trim() };
    }
    case "hostname": {
      const value = await promptInput({
        prompt: vscode.l10n.t("Host address (IP or domain name)"),
        placeHolder: vscode.l10n.t("For example, 10.0.1.11 or my.server.com"),
        value: host.hostname,
        validate: validateHostAddress,
      });
      return value === undefined ? undefined : { hostname: value.trim() };
    }
    case "port": {
      const value = await promptInput({
        prompt: vscode.l10n.t("SSH port"),
        placeHolder: "22",
        value: String(host.port),
        validate: validatePort,
      });
      return value === undefined ? undefined : { port: Number.parseInt(value, 10) };
    }
    case "username": {
      const value = await promptInput({
        prompt: vscode.l10n.t("Login username"),
        placeHolder: vscode.l10n.t("For example, root"),
        value: host.username,
        validate: validateUsername,
      });
      return value === undefined ? undefined : { username: value.trim() };
    }
    case "group": {
      const groupId = await promptGroup(storage, host.groupId);
      return groupId === null ? undefined : { groupId: groupId || undefined };
    }
    case "identityFile": {
      const identityFile = await promptIdentityFile(host.identityFile);
      return identityFile === null ? undefined : { identityFile: identityFile || undefined };
    }
    case "tags": {
      const value = await vscode.window.showInputBox({
        prompt: vscode.l10n.t("Tags (comma-separated)"),
        placeHolder: vscode.l10n.t("For example, prod, gpu, cn-shanghai"),
        value: host.tags.join(", "),
      });
      return value === undefined ? undefined : { tags: parseTags(value) };
    }
    case "full":
      return promptNewHost(storage, host);
  }
}

async function promptIdentityFile(prefillPath?: string): Promise<string | null> {
  const keys = listKeys();
  if (keys.length === 0 && !prefillPath) {return "";}

  const matchingKey = prefillPath
    ? keys.find((key) => areIdentityPathsEquivalent(prefillPath, key.privateKeyPath))
    : undefined;
  const shouldShowCurrentPath = Boolean(
    prefillPath && (!matchingKey || matchingKey.privateKeyPath !== prefillPath)
  );
  const items: (vscode.QuickPickItem & { path?: string })[] = [
    { label: vscode.l10n.t("$(circle-slash) No identity file"), path: "" },
  ];

  let activeItem: (typeof items)[number] | undefined;
  if (prefillPath && shouldShowCurrentPath) {
    activeItem = {
      label: vscode.l10n.t("$(key) Current setting"),
      description: vscode.l10n.t("Keep the original path"),
      detail: prefillPath,
      path: prefillPath,
    };
    items.push(activeItem);
  }

  items.push(...keys.map((key) => ({
    label: `$(key) ${key.name}`,
    description: matchingKey?.privateKeyPath === key.privateKeyPath
      ? vscode.l10n.t("{type} · matches current setting", { type: key.type })
      : key.type,
    detail: key.privateKeyPath,
    path: key.privateKeyPath,
  })));

  if (!activeItem && matchingKey) {
    activeItem = items.find((item) => item.path === matchingKey.privateKeyPath);
  }

  const picked = await showQuickPick(items, vscode.l10n.t("Choose an identity file (optional)"), activeItem);
  return picked === undefined ? null : picked.path ?? "";
}

async function promptGroup(storage: StorageService, prefillGroupId?: string): Promise<string | null> {
  const groups = storage.getGroups();
  if (groups.length === 0) {return prefillGroupId ?? "";}

  const items: (vscode.QuickPickItem & { group?: SSHGroup })[] = [
    { label: vscode.l10n.t("$(circle-slash) Ungrouped"), group: undefined },
    ...groups.map((group) => ({ label: `$(folder) ${group.name}`, group })),
  ];
  const activeItem = prefillGroupId
    ? items.find((item) => item.group?.id === prefillGroupId)
    : undefined;
  const picked = await showQuickPick(items, vscode.l10n.t("Choose a group (optional)"), activeItem);
  return picked === undefined ? null : picked.group?.id ?? "";
}

async function showQuickPick<T extends vscode.QuickPickItem>(
  items: T[],
  placeholder: string,
  activeItem?: T
): Promise<T | undefined> {
  const quickPick = vscode.window.createQuickPick<T>();
  quickPick.items = items;
  quickPick.placeholder = placeholder;
  if (activeItem) {quickPick.activeItems = [activeItem];}

  return new Promise<T | undefined>((resolve) => {
    let resolved = false;
    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0] ?? quickPick.activeItems[0];
      resolved = true;
      quickPick.hide();
      resolve(selected);
    });
    quickPick.onDidHide(() => {
      quickPick.dispose();
      if (!resolved) {resolve(undefined);}
    });
    quickPick.show();
  });
}
