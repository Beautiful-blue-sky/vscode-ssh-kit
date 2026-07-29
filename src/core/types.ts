// SSH Kit — Data model type definitions

/** SSH host configuration */
export const SSH_AUTH_MODES = ["auto", "identityFile", "password"] as const;
export type SSHAuthMode = (typeof SSH_AUTH_MODES)[number];

export interface SSHHost {
  id: string;
  name: string;            // Display name
  sshAlias?: string;       // Stable OpenSSH / Remote-SSH Host alias
  hostname: string;        // IP address or hostname
  port: number;            // SSH port, default 22
  username: string;        // Login username
  authMode?: SSHAuthMode;  // Missing means legacy auto/key inference
  identityFile?: string;   // Associated private key path
  groupId?: string;        // Owning group ID (undefined means ungrouped)
  tags: string[];          // Tags for cross-group filtering
  extraConfig?: Record<string, string | string[]>; // Additional SSH config directives
}

/** Host group */
export interface SSHGroup {
  id: string;
  name: string;
  order: number;           // Sort order
}

export const HOST_SORT_MODES = ["nameAsc", "nameDesc", "addressAsc", "recent"] as const;
export type HostSortMode = (typeof HOST_SORT_MODES)[number];
export const DEFAULT_HOST_SORT_MODE: HostSortMode = "nameAsc";

export interface SSHKitSortPreferences {
  hostSort: HostSortMode;
}

/** Top-level extension storage structure */
export interface SSHKitData {
  schemaVersion: number;
  groups: SSHGroup[];
  hosts: SSHHost[];
  groupCollapsedState: Record<string, boolean>; // Group ID → collapsed
  recentConnections: string[];                   // Recently connected host IDs
  sortPreferences: SSHKitSortPreferences;
  currentConnection?: SSHKitCurrentConnection;   // Last SSH Kit Remote-SSH connection context
  deletedHosts?: DeletedSSHHost[];
}

export interface DeletedSSHHost {
  host: SSHHost;
  deletedAt: string;
  groupName?: string;
}

export interface SSHKitCatalog {
  schemaVersion: number;
  revision: number;
  groups: SSHGroup[];
  hosts: SSHHost[];
  deletedHosts: DeletedSSHHost[];
}

/** Last known SSH Kit Remote-SSH connection */
export interface SSHKitCurrentConnection {
  hostId: string;
  alias: string;
  connectedAt: string;
}

/** Create default empty storage data */
export function createDefaultData(): SSHKitData {
  return {
    schemaVersion: 4,
    groups: [],
    hosts: [],
    groupCollapsedState: {},
    recentConnections: [],
    sortPreferences: {
      hostSort: DEFAULT_HOST_SORT_MODE,
    },
  };
}

export function createDefaultCatalog(): SSHKitCatalog {
  return {
    schemaVersion: 4,
    revision: 0,
    groups: [],
    hosts: [],
    deletedHosts: [],
  };
}

/** Resolve legacy hosts while keeping explicit authentication choices authoritative. */
export function resolveHostAuthMode(
  host: Pick<SSHHost, "authMode" | "identityFile" | "extraConfig">
): SSHAuthMode {
  if (host.authMode && SSH_AUTH_MODES.includes(host.authMode)) {
    return host.authMode;
  }

  const pubkeyAuthentication = getFirstExtraConfigValue(
    host.extraConfig,
    "pubkeyauthentication"
  );
  if (pubkeyAuthentication?.trim().toLowerCase() === "no") {
    return "password";
  }
  const preferredAuthentications = getFirstExtraConfigValue(
    host.extraConfig,
    "preferredauthentications"
  )?.toLowerCase().split(",").map((value) => value.trim());
  if (
    preferredAuthentications?.some((method) =>
      method === "password" || method === "keyboard-interactive"
    ) &&
    !preferredAuthentications.includes("publickey")
  ) {
    return "password";
  }
  return host.identityFile ? "identityFile" : "auto";
}

/** Remove directives owned by SSH Kit's explicit authentication mode. */
export function stripManagedAuthenticationConfig(
  extraConfig: SSHHost["extraConfig"]
): SSHHost["extraConfig"] {
  if (!extraConfig) {return undefined;}

  const managedKeys = new Set([
    "identitiesonly",
    "preferredauthentications",
    "pubkeyauthentication",
  ]);
  const filtered = Object.fromEntries(
    Object.entries(extraConfig).filter(([key]) => !managedKeys.has(key.toLowerCase()))
  );
  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

function getFirstExtraConfigValue(
  extraConfig: SSHHost["extraConfig"],
  key: string
): string | undefined {
  const entry = Object.entries(extraConfig ?? {}).find(
    ([candidate]) => candidate.toLowerCase() === key
  )?.[1];
  return Array.isArray(entry) ? entry[0] : entry;
}

/** Generate a short unique ID */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ─── Shared callback types ────────────────────────────────────────────────

import type { StorageService } from "./storage";

/** Multi-step input callback signature for creating/editing hosts */
export type PromptNewHostFn = (
  storage: StorageService,
  prefill?: Partial<SSHHost>
) => Promise<Omit<SSHHost, "id"> | undefined>;

/** Single-field edit callback signature for updating hosts */
export type PromptEditHostFn = (
  storage: StorageService,
  host: SSHHost
) => Promise<Partial<Omit<SSHHost, "id">> | undefined>;
