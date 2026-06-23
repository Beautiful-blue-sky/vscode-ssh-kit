// SSH Kit — Data model type definitions

/** SSH host configuration */
export interface SSHHost {
  id: string;
  name: string;            // Display name
  hostname: string;        // IP address or hostname
  port: number;            // SSH port, default 22
  username: string;        // Login username
  identityFile?: string;   // Associated private key path
  groupId?: string;        // Owning group ID (undefined means ungrouped)
  tags: string[];          // Tags for cross-group filtering
  extraConfig?: Record<string, string>; // Additional SSH config directives
}

/** Host group */
export interface SSHGroup {
  id: string;
  name: string;
  order: number;           // Sort order
}

/** Top-level extension storage structure */
export interface SSHKitData {
  groups: SSHGroup[];
  hosts: SSHHost[];
  groupCollapsedState: Record<string, boolean>; // Group ID → collapsed
  recentConnections: string[];                   // Recently connected host IDs
}

/** Create default empty storage data */
export function createDefaultData(): SSHKitData {
  return {
    groups: [],
    hosts: [],
    groupCollapsedState: {},
    recentConnections: [],
  };
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
