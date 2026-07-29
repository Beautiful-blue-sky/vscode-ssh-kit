import { isIP } from "node:net";
import * as vscode from "vscode";
import {
  resolveHostAuthMode,
  SSHAuthMode,
  SSHGroup,
  SSHHost,
  stripManagedAuthenticationConfig,
} from "../core/types";
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

export function validateHostAddress(value: string): string | undefined {
  const trimmed = normalizeHostAddress(value);
  if (!trimmed) {return vscode.l10n.t("Address is required");}
  if (/\s/.test(trimmed)) {return vscode.l10n.t("Address cannot contain spaces");}

  if (isIP(trimmed) !== 0) {return undefined;}

  return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(trimmed)
    ? undefined
    : vscode.l10n.t("Enter a valid IPv4 address, IPv6 address, or domain name");
}

export function normalizeHostAddress(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const unwrapped = trimmed.slice(1, -1);
    if (isIP(unwrapped) === 6) {return unwrapped;}
  }
  return trimmed;
}

function validatePort(value: string): string | undefined {
  if (!/^\d+$/.test(value)) {return vscode.l10n.t("Enter a number");}
  const port = Number.parseInt(value, 10);
  return port >= 1 && port <= 65535
    ? undefined
    : vscode.l10n.t("Port must be between 1 and 65535");
}

export function validateUsername(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {return vscode.l10n.t("Username is required");}
  const hasControlCharacter = [...trimmed].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
  return /\s/.test(trimmed) || hasControlCharacter
    ? vscode.l10n.t("Username cannot contain spaces or control characters")
    : undefined;
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
    placeHolder: vscode.l10n.t("For example, production-web-01"),
    value: prefill?.name,
    validate: validateRequiredName,
  });
  if (name === undefined) {return undefined;}

  const hostname = await promptInput({
    prompt: vscode.l10n.t("Host address (IP or domain name)"),
    placeHolder: vscode.l10n.t("For example, 10.0.1.11, 2001:db8::1, or my.server.com"),
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
  const authentication = await promptAuthentication(prefill);
  if (!authentication) {return undefined;}
  const previousAuthMode = prefill ? resolveHostAuthMode(prefill) : undefined;
  const extraConfig = previousAuthMode && previousAuthMode !== authentication.authMode
    ? stripManagedAuthenticationConfig(prefill?.extraConfig)
    : prefill?.extraConfig;

  return {
    name: name.trim(),
    hostname: normalizeHostAddress(hostname),
    port: Number.parseInt(portText, 10),
    username: username.trim(),
    groupId: groupId || undefined,
    authMode: authentication.authMode,
    identityFile: authentication.identityFile,
    tags: prefill?.tags ?? [],
    extraConfig,
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
      {
        label: vscode.l10n.t("$(shield) Authentication"),
        description: formatAuthenticationDescription(host),
        key: "authentication",
      },
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
        placeHolder: vscode.l10n.t("For example, production-web-01"),
        value: host.name,
        validate: validateRequiredName,
      });
      return value === undefined ? undefined : { name: value.trim() };
    }
    case "hostname": {
      const value = await promptInput({
        prompt: vscode.l10n.t("Host address (IP or domain name)"),
        placeHolder: vscode.l10n.t("For example, 10.0.1.11, 2001:db8::1, or my.server.com"),
        value: host.hostname,
        validate: validateHostAddress,
      });
      return value === undefined ? undefined : { hostname: normalizeHostAddress(value) };
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
    case "authentication": {
      const authentication = await promptAuthentication(host);
      if (!authentication) {return undefined;}
      return {
        authMode: authentication.authMode,
        identityFile: authentication.identityFile,
        extraConfig: authentication.authMode === resolveHostAuthMode(host)
          ? host.extraConfig
          : stripManagedAuthenticationConfig(host.extraConfig),
      };
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

interface AuthenticationSelection {
  authMode: SSHAuthMode;
  identityFile?: string;
}

async function promptAuthentication(
  prefill?: Pick<SSHHost, "authMode" | "identityFile" | "extraConfig">
): Promise<AuthenticationSelection | undefined> {
  const currentMode = prefill ? resolveHostAuthMode(prefill) : "auto";
  const items: Array<vscode.QuickPickItem & { mode: SSHAuthMode }> = [
    {
      label: vscode.l10n.t("$(settings-gear) Automatic"),
      description: vscode.l10n.t("Use OpenSSH defaults, ssh-agent, default keys, or password"),
      mode: "auto",
    },
    {
      label: vscode.l10n.t("$(key) Specified identity file"),
      description: vscode.l10n.t("Use only the selected private key"),
      mode: "identityFile",
    },
    {
      label: vscode.l10n.t("$(lock) Password only"),
      description: vscode.l10n.t("Disable public-key authentication for this host"),
      mode: "password",
    },
  ];
  const picked = await showQuickPick(
    items,
    vscode.l10n.t("Choose an authentication method"),
    items.find((item) => item.mode === currentMode)
  );
  if (!picked) {return undefined;}

  if (picked.mode !== "identityFile") {
    return { authMode: picked.mode };
  }

  const identityFile = await promptIdentityFile(prefill?.identityFile);
  return identityFile ? { authMode: "identityFile", identityFile } : undefined;
}

async function promptIdentityFile(prefillPath?: string): Promise<string | null> {
  const keys = listKeys();
  const matchingKey = prefillPath
    ? keys.find((key) => areIdentityPathsEquivalent(prefillPath, key.privateKeyPath))
    : undefined;
  const shouldShowCurrentPath = Boolean(
    prefillPath && (!matchingKey || matchingKey.privateKeyPath !== prefillPath)
  );
  const items: Array<vscode.QuickPickItem & { path?: string; custom?: boolean }> = [];

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

  items.push({
    label: vscode.l10n.t("$(edit) Enter a custom path"),
    description: vscode.l10n.t("For example, ~/.ssh/id_ed25519"),
    custom: true,
  });
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

  const picked = await showQuickPick(
    items,
    vscode.l10n.t("Choose an identity file"),
    activeItem
  );
  if (picked?.custom) {
    const value = await vscode.window.showInputBox({
      prompt: vscode.l10n.t("Enter the private key path"),
      placeHolder: "~/.ssh/id_ed25519",
      value: prefillPath,
      validateInput: (input) => {
        const trimmed = input.trim();
        if (!trimmed) {return vscode.l10n.t("Path is required");}
        return /[\r\n]/.test(trimmed)
          ? vscode.l10n.t("Path cannot contain line breaks")
          : undefined;
      },
    });
    return value === undefined ? null : value.trim();
  }
  return picked === undefined ? null : picked.path ?? "";
}

function formatAuthenticationDescription(host: SSHHost): string {
  switch (resolveHostAuthMode(host)) {
    case "password":
      return vscode.l10n.t("Password only");
    case "identityFile":
      return host.identityFile
        ? vscode.l10n.t("Identity file: {path}", { path: host.identityFile })
        : vscode.l10n.t("Specified identity file");
    default:
      return vscode.l10n.t("Automatic (OpenSSH defaults)");
  }
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
