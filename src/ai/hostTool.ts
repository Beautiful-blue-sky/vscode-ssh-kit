// SSH Kit — Read-only host metadata tool for VS Code language models
import * as vscode from "vscode";
import { formatHostEndpoint } from "../core/endpoint";
import { StorageService } from "../core/storage";
import { hostMatchesSearch, splitHostSearchTerms } from "../core/hostSearch";

interface ListHostsToolInput {
  query?: string;
  limit?: number;
  offset?: number;
  includeIdentityFilePath?: boolean;
}

interface HostToolResult {
  total: number;
  offset: number;
  returned: number;
  hasMore: boolean;
  nextOffset?: number;
  truncatedByTokenBudget: boolean;
  identityFilePathsIncluded: boolean;
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
      invoke: async (options, token) => {
        const result = buildHostToolResult(storage, options.input);
        const serialized = await serializeHostToolResult(
          result,
          options.tokenizationOptions,
          token
        );
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(serialized),
        ]);
      },
      prepareInvocation: (options) => {
        const query = normalizeQuery(options.input.query);
        const limit = normalizeLimit(options.input.limit);
        const offset = normalizeOffset(options.input.offset);
        return {
          invocationMessage: query
            ? vscode.l10n.t("Reading SSH Kit hosts matching “{query}”", { query })
            : vscode.l10n.t("Reading SSH Kit host metadata"),
          ...(options.input.includeIdentityFilePath
            ? {
                confirmationMessages: {
                  title: vscode.l10n.t("Share SSH key file paths?"),
                  message: vscode.l10n.t(
                    "SSH Kit will include associated private key file paths in a read-only result (filter: {query}, offset: {offset}, limit: {limit}). Private key contents are never shared.",
                    {
                      query: query ?? vscode.l10n.t("none"),
                      offset,
                      limit,
                    }
                  ),
                },
              }
            : {}),
        };
      },
    })
  );
}

export function buildHostToolResult(
  storage: StorageService,
  input: ListHostsToolInput
): HostToolResult {
  const query = normalizeQuery(input.query);
  const terms = query ? splitHostSearchTerms(query) : [];
  const limit = normalizeLimit(input.limit);
  const offset = normalizeOffset(input.offset);
  const groups = new Map(storage.getGroups().map((group) => [group.id, group.name]));
  const allHosts = storage.getAllHosts();
  const matchedHosts = terms.length > 0
    ? allHosts.filter((host) => hostMatchesSearch(host, groups.get(host.groupId ?? ""), terms))
    : allHosts;

  const hosts = matchedHosts.slice(offset, offset + limit).map((host) => ({
    name: host.name,
    hostname: host.hostname,
    port: host.port,
    username: host.username,
    endpoint: formatHostEndpoint(host),
    group: groups.get(host.groupId ?? ""),
    tags: [...(host.tags ?? [])],
    hasIdentityFile: Boolean(host.identityFile),
    ...(input.includeIdentityFilePath && host.identityFile ? { identityFile: host.identityFile } : {}),
  }));
  const nextOffset = offset + hosts.length;
  const hasMore = nextOffset < matchedHosts.length;

  return {
    total: matchedHosts.length,
    offset,
    returned: hosts.length,
    hasMore,
    ...(hasMore && hosts.length > 0 ? { nextOffset } : {}),
    truncatedByTokenBudget: false,
    identityFilePathsIncluded: input.includeIdentityFilePath === true,
    ...(query ? { query } : {}),
    hosts,
    note: buildResultNote(input.includeIdentityFilePath === true, hasMore),
  };
}

function normalizeQuery(query: string | undefined): string | undefined {
  const normalized = query ? splitHostSearchTerms(query).join(" ") : "";
  return normalized || undefined;
}

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
}

function normalizeOffset(offset: number | undefined): number {
  if (typeof offset !== "number" || !Number.isFinite(offset)) {
    return 0;
  }
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(offset)));
}

function buildResultNote(includeIdentityFilePath: boolean, hasMore: boolean): string {
  const notes = [
    includeIdentityFilePath
      ? "Private key contents are never included."
      : "Identity file paths are hidden by default; pass includeIdentityFilePath=true if paths are required. Private key contents are never included.",
  ];
  if (hasMore) {
    notes.push("More matching hosts are available; call the tool again with nextOffset as offset.");
  }
  return notes.join(" ");
}

async function serializeHostToolResult(
  result: HostToolResult,
  tokenizationOptions: vscode.LanguageModelToolTokenizationOptions | undefined,
  token: vscode.CancellationToken
): Promise<string> {
  const serialized = JSON.stringify(result);
  if (!tokenizationOptions || result.hosts.length === 0) {
    return serialized;
  }

  throwIfCancelled(token);
  if (await tokenizationOptions.countTokens(serialized, token) <= tokenizationOptions.tokenBudget) {
    return serialized;
  }

  let low = 0;
  let high = result.hosts.length - 1;
  let best: HostToolResult | undefined;
  while (low <= high) {
    throwIfCancelled(token);
    const count = Math.floor((low + high) / 2);
    const candidate = truncateResultForTokenBudget(result, count);
    const candidateText = JSON.stringify(candidate);
    if (await tokenizationOptions.countTokens(candidateText, token) <= tokenizationOptions.tokenBudget) {
      best = candidate;
      low = count + 1;
    } else {
      high = count - 1;
    }
  }

  return JSON.stringify(best ?? truncateResultForTokenBudget(result, 0));
}

function truncateResultForTokenBudget(result: HostToolResult, count: number): HostToolResult {
  const hosts = result.hosts.slice(0, count);
  const nextOffset = result.offset + hosts.length;
  const hasMore = nextOffset < result.total;
  return {
    ...result,
    returned: hosts.length,
    hosts,
    hasMore,
    nextOffset: hasMore && hosts.length > 0 ? nextOffset : undefined,
    truncatedByTokenBudget: true,
    note: hosts.length > 0
      ? `${buildResultNote(result.identityFilePathsIncluded, hasMore)} The page was shortened to fit the model token budget.`
      : "Host metadata could not fit the model token budget. Use a narrower query or a smaller page.",
  };
}

function throwIfCancelled(token: vscode.CancellationToken): void {
  if (token.isCancellationRequested) {
    throw new vscode.CancellationError();
  }
}
