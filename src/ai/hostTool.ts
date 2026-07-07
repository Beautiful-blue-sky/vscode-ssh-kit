// SSH Kit — Read-only host metadata tool for VS Code language models
import * as vscode from "vscode";
import { SSHHost } from "../core/types";
import { StorageService } from "../core/storage";

interface ListHostsToolInput {
  query?: string;
  limit?: number;
  includeIdentityFilePath?: boolean;
}

interface HostToolResult {
  total: number;
  returned: number;
  query?: string;
  hosts: Array<{
    name: string;
    hostname: string;
    port: number;
    username: string;
    endpoint: string;
    group?: string;
    tags: string[];
    hasIdentityFile: boolean;
    identityFile?: string;
  }>;
  note: string;
}

const TOOL_NAME = "sshKit_listHosts";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function registerAIHostTools(
  context: vscode.ExtensionContext,
  storage: StorageService
): void {
  if (!vscode.lm?.registerTool) {
    return;
  }

  context.subscriptions.push(
    vscode.lm.registerTool<ListHostsToolInput>(TOOL_NAME, {
      invoke: (options) => {
        const result = buildHostToolResult(storage, options.input ?? {});
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
        ]);
      },
      prepareInvocation: (options) => ({
        invocationMessage: options.input?.query
          ? `Reading SSH Kit hosts matching "${options.input.query}"`
          : "Reading SSH Kit host metadata",
        ...(options.input?.includeIdentityFilePath
          ? {
              confirmationMessages: {
                title: "Share SSH key file paths?",
                message: "SSH Kit can include associated private key file paths in this read-only tool result. Private key contents are never shared.",
              },
            }
          : {}),
      }),
    })
  );
}

export function buildHostToolResult(
  storage: StorageService,
  input: ListHostsToolInput
): HostToolResult {
  const query = normalizeQuery(input.query);
  const limit = normalizeLimit(input.limit);
  const groups = new Map(storage.getGroups().map((group) => [group.id, group.name]));
  const allHosts = storage.getAllHosts();
  const matchedHosts = query
    ? allHosts.filter((host) => hostMatchesQuery(host, groups.get(host.groupId ?? ""), query))
    : allHosts;

  const hosts = matchedHosts.slice(0, limit).map((host) => ({
    name: host.name,
    hostname: host.hostname,
    port: host.port,
    username: host.username,
    endpoint: `${host.username}@${host.hostname}:${host.port}`,
    group: groups.get(host.groupId ?? ""),
    tags: [...(host.tags ?? [])],
    hasIdentityFile: Boolean(host.identityFile),
    ...(input.includeIdentityFilePath && host.identityFile ? { identityFile: host.identityFile } : {}),
  }));

  return {
    total: matchedHosts.length,
    returned: hosts.length,
    ...(query ? { query } : {}),
    hosts,
    note: input.includeIdentityFilePath
      ? "Private key contents are never included."
      : "Identity file paths are hidden by default; pass includeIdentityFilePath=true if paths are required. Private key contents are never included.",
  };
}

function normalizeQuery(query: string | undefined): string | undefined {
  const trimmed = query?.trim().toLowerCase();
  return trimmed || undefined;
}

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
}

function hostMatchesQuery(host: SSHHost, groupName: string | undefined, query: string): boolean {
  return [
    host.name,
    host.hostname,
    host.username,
    String(host.port),
    groupName,
    ...host.tags,
  ].some((value) => value?.toLowerCase().includes(query));
}
