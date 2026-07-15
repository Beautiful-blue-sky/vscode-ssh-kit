import * as vscode from "vscode";
import { createDefaultData, generateId, SSHGroup, SSHHost, SSHKitCurrentConnection, SSHKitData } from "./types";

export const CURRENT_DATA_SCHEMA_VERSION = 1;

interface MigrationResult {
  data: SSHKitData;
  changed: boolean;
}

type UnknownRecord = Record<string, unknown>;

export interface ValidatedBackupData extends SSHKitData {
  keyMetadata?: Array<{ name: string }>;
  keyFiles?: Array<{
    name: string;
    type: string;
    privateKey: string;
    publicKey?: string;
  }>;
}

export function migrateStoredData(raw: unknown): MigrationResult {
  if (!isRecord(raw)) {
    return { data: createDefaultData(), changed: raw !== undefined };
  }

  const groups = normalizeGroups(raw.groups);
  const groupIds = new Set(groups.map((group) => group.id));
  const hosts = normalizeHosts(raw.hosts, groupIds);
  const hostIds = new Set(hosts.map((host) => host.id));
  const groupCollapsedState = normalizeCollapsedState(raw.groupCollapsedState, groupIds);
  const recentConnections = normalizeRecentConnections(raw.recentConnections, hostIds);
  const currentConnection = normalizeCurrentConnection(raw.currentConnection, hostIds);
  const rawVersion = typeof raw.schemaVersion === "number" && Number.isInteger(raw.schemaVersion)
    ? raw.schemaVersion
    : 0;

  const knownData: SSHKitData = {
    schemaVersion: Math.max(rawVersion, CURRENT_DATA_SCHEMA_VERSION),
    groups,
    hosts,
    groupCollapsedState,
    recentConnections,
    ...(currentConnection ? { currentConnection } : {}),
  };
  const data = rawVersion > CURRENT_DATA_SCHEMA_VERSION
    ? { ...raw, ...knownData, schemaVersion: rawVersion } as SSHKitData
    : knownData;

  return {
    data,
    changed: rawVersion <= CURRENT_DATA_SCHEMA_VERSION &&
      (rawVersion < CURRENT_DATA_SCHEMA_VERSION || !sameJson(raw, data)),
  };
}

export function validateBackupData(raw: unknown): asserts raw is ValidatedBackupData {
  if (!isRecord(raw) || !Array.isArray(raw.groups) || !Array.isArray(raw.hosts)) {
    throw new Error(vscode.l10n.t("Invalid SSH Kit backup: expected host and group arrays."));
  }

  raw.groups.forEach((group, index) => {
    if (
      !isRecord(group) ||
      !isNonEmptyString(group.id) ||
      !isNonEmptyString(group.name) ||
      (group.order !== undefined && (typeof group.order !== "number" || !Number.isFinite(group.order)))
    ) {
      throw new Error(vscode.l10n.t("Invalid SSH Kit backup: group {index} is missing an id or name.", { index: index + 1 }));
    }
  });

  raw.hosts.forEach((host, index) => {
    if (
      !isRecord(host) ||
      !isNonEmptyString(host.id) ||
      !isNonEmptyString(host.name) ||
      !isNonEmptyString(host.hostname) ||
      typeof host.username !== "string" ||
      !isValidPort(host.port)
    ) {
      throw new Error(vscode.l10n.t("Invalid SSH Kit backup: host {index} has invalid required fields.", { index: index + 1 }));
    }
    if (host.tags !== undefined && (!Array.isArray(host.tags) || host.tags.some((tag) => typeof tag !== "string"))) {
      throw new Error(vscode.l10n.t("Invalid SSH Kit backup: host {index} has invalid tags.", { index: index + 1 }));
    }
    if (
      (host.groupId !== undefined && typeof host.groupId !== "string") ||
      (host.identityFile !== undefined && typeof host.identityFile !== "string") ||
      !isValidExtraConfig(host.extraConfig)
    ) {
      throw new Error(vscode.l10n.t("Invalid SSH Kit backup: host {index} has invalid optional fields.", { index: index + 1 }));
    }
  });

  if (raw.keyMetadata !== undefined) {
    if (!Array.isArray(raw.keyMetadata) || raw.keyMetadata.some((entry) =>
      !isRecord(entry) || !isNonEmptyString(entry.name)
    )) {
      throw new Error(vscode.l10n.t("Invalid SSH Kit backup: keyMetadata must contain named key records."));
    }
  }

  if (raw.keyFiles !== undefined) {
    if (!Array.isArray(raw.keyFiles)) {
      throw new Error(vscode.l10n.t("Invalid SSH Kit backup: keyFiles must be an array."));
    }
    raw.keyFiles.forEach((entry, index) => {
      if (
        !isRecord(entry) ||
        !isNonEmptyString(entry.name) ||
        typeof entry.type !== "string" ||
        !isNonEmptyString(entry.privateKey) ||
        (entry.publicKey !== undefined && typeof entry.publicKey !== "string")
      ) {
        throw new Error(vscode.l10n.t("Invalid SSH Kit backup: key file {index} is malformed.", { index: index + 1 }));
      }
    });
  }
}

function normalizeGroups(value: unknown): SSHGroup[] {
  if (!Array.isArray(value)) {return [];}
  const seen = new Set<string>();
  const groups: SSHGroup[] = [];
  value.forEach((candidate, index) => {
    if (!isRecord(candidate) || !isNonEmptyString(candidate.name)) {return;}
    let id = isNonEmptyString(candidate.id) ? candidate.id.trim() : generateId();
    while (seen.has(id)) {id = generateId();}
    seen.add(id);
    groups.push({
      id,
      name: candidate.name.trim(),
      order: typeof candidate.order === "number" && Number.isFinite(candidate.order)
        ? candidate.order
        : index,
    });
  });
  return groups;
}

function normalizeHosts(value: unknown, groupIds: Set<string>): SSHHost[] {
  if (!Array.isArray(value)) {return [];}
  const seen = new Set<string>();
  const hosts: SSHHost[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate) || !isNonEmptyString(candidate.hostname)) {continue;}
    let id = isNonEmptyString(candidate.id) ? candidate.id.trim() : generateId();
    while (seen.has(id)) {id = generateId();}
    seen.add(id);
    const hostname = candidate.hostname.trim();
    const groupId = isNonEmptyString(candidate.groupId) && groupIds.has(candidate.groupId)
      ? candidate.groupId
      : undefined;
    const identityFile = isNonEmptyString(candidate.identityFile) ? candidate.identityFile.trim() : undefined;
    const extraConfig = normalizeExtraConfig(candidate.extraConfig);
    hosts.push({
      id,
      name: isNonEmptyString(candidate.name) ? candidate.name.trim() : hostname,
      hostname,
      port: isValidPort(candidate.port) ? candidate.port : 22,
      username: typeof candidate.username === "string" ? candidate.username.trim() : "",
      ...(identityFile ? { identityFile } : {}),
      ...(groupId ? { groupId } : {}),
      tags: Array.isArray(candidate.tags)
        ? [...new Set(candidate.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean))]
        : [],
      ...(extraConfig ? { extraConfig } : {}),
    });
  }
  return hosts;
}

function normalizeExtraConfig(value: unknown): Record<string, string | string[]> | undefined {
  if (!isRecord(value)) {return undefined;}
  const result: Record<string, string | string[]> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (typeof candidate === "string") {
      result[key] = candidate;
    } else if (Array.isArray(candidate) && candidate.every((item) => typeof item === "string")) {
      result[key] = candidate;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeCollapsedState(value: unknown, groupIds: Set<string>): Record<string, boolean> {
  if (!isRecord(value)) {return {};}
  return Object.fromEntries(
    Object.entries(value).filter(([id, collapsed]) => groupIds.has(id) && typeof collapsed === "boolean")
  ) as Record<string, boolean>;
}

function normalizeRecentConnections(value: unknown, hostIds: Set<string>): string[] {
  if (!Array.isArray(value)) {return [];}
  return [...new Set(value.filter((id): id is string => typeof id === "string" && hostIds.has(id)))];
}

function normalizeCurrentConnection(value: unknown, hostIds: Set<string>): SSHKitCurrentConnection | undefined {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.hostId) ||
    !hostIds.has(value.hostId) ||
    !isNonEmptyString(value.alias) ||
    !isNonEmptyString(value.connectedAt)
  ) {
    return undefined;
  }
  return {
    hostId: value.hostId,
    alias: value.alias,
    connectedAt: value.connectedAt,
  };
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535;
}

function isValidExtraConfig(value: unknown): boolean {
  if (value === undefined) {return true;}
  if (!isRecord(value)) {return false;}
  return Object.values(value).every((entry) =>
    typeof entry === "string" ||
    (Array.isArray(entry) && entry.every((item) => typeof item === "string"))
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}
