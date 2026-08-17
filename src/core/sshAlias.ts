import type { SSHHost } from "./types";

const MAX_ALIAS_LENGTH = 120;

export interface SSHHostAliasRepair {
  hostId: string;
  name: string;
  currentAlias: string;
  suggestedAlias: string;
}

/**
 * Keep Remote-SSH aliases readable while avoiding whitespace, URI delimiters,
 * and SSH config pattern characters that are unreliable as literal host names.
 */
export function sanitizeSSHHostAlias(value: string): string {
  return value
    .trim()
    .replace(/[\r\n\t\s]+/g, "_")
    .replace(/[^\p{L}\p{N}._+-]+/gu, "_")
    .replace(/_+/g, "_")
    .replace(/^[._+-]+|[._+-]+$/g, "")
    .slice(0, MAX_ALIAS_LENGTH);
}

export function ensureUniqueSSHHostAlias(
  preferred: string,
  host: Pick<SSHHost, "id" | "hostname" | "port">,
  existingAliases: Iterable<string>
): string {
  const used = new Set([...existingAliases].map(normalizeAlias));
  const base = sanitizeSSHHostAlias(preferred) || sanitizeEndpoint(host) || "host";
  const candidates = [
    base,
    truncateAlias(`${base}_${sanitizeEndpoint(host)}`),
    truncateAlias(`${base}_${host.id.slice(-6)}`),
    truncateAlias(`${base}_${host.id}`),
  ];
  return candidates.find((candidate) => !used.has(normalizeAlias(candidate)))
    ?? truncateAlias(`ssh-kit_${host.id}`);
}

export function normalizeStoredSSHAliases(hosts: SSHHost[]): SSHHost[] {
  const used: string[] = [];
  return hosts.map((host) => {
    const alias = ensureUniqueSSHHostAlias(host.sshAlias || host.name, host, used);
    used.push(alias);
    return host.sshAlias === alias ? host : { ...host, sshAlias: alias };
  });
}

/**
 * Find aliases left behind by versions that did not rename the SSH Host when
 * the display name changed. Generated collision suffixes remain valid.
 */
export function planLegacySSHHostAliasRepairs(
  hosts: readonly SSHHost[]
): SSHHostAliasRepair[] {
  const preservedAliases: string[] = [];
  const repairIds = new Set<string>();

  for (const host of hosts) {
    const currentAlias = host.sshAlias?.trim() ?? "";
    const normalizedCurrent = sanitizeSSHHostAlias(currentAlias);
    const alreadyUsed = preservedAliases.some(
      (alias) => normalizeAlias(alias) === normalizeAlias(normalizedCurrent)
    );
    if (
      !currentAlias ||
      normalizedCurrent !== currentAlias ||
      alreadyUsed ||
      !isAliasDerivedFromCurrentName(normalizedCurrent, host)
    ) {
      repairIds.add(host.id);
      continue;
    }
    preservedAliases.push(currentAlias);
  }

  const usedAliases = [...preservedAliases];
  const repairs: SSHHostAliasRepair[] = [];
  for (const host of hosts) {
    if (!repairIds.has(host.id)) {continue;}
    const suggestedAlias = ensureUniqueSSHHostAlias(host.name, host, usedAliases);
    usedAliases.push(suggestedAlias);
    repairs.push({
      hostId: host.id,
      name: host.name,
      currentAlias: host.sshAlias ?? "",
      suggestedAlias,
    });
  }
  return repairs;
}

function isAliasDerivedFromCurrentName(
  alias: string,
  host: Pick<SSHHost, "id" | "name" | "hostname" | "port">
): boolean {
  const base = sanitizeSSHHostAlias(host.name) || sanitizeEndpoint(host) || "host";
  const normalizedAlias = normalizeAlias(alias);
  // A collision suffix may contain an earlier endpoint. Connection edits keep
  // aliases stable, so any current-name prefix is intentionally ambiguous and
  // must not be treated as a legacy nickname mismatch.
  if (normalizedAlias.startsWith(normalizeAlias(`${base}_`))) {return true;}
  return [
    base,
    truncateAlias(`${base}_${sanitizeEndpoint(host)}`),
    truncateAlias(`${base}_${host.id.slice(-6)}`),
    truncateAlias(`${base}_${host.id}`),
    truncateAlias(`ssh-kit_${host.id}`),
  ].some((candidate) => normalizeAlias(candidate) === normalizedAlias);
}

function sanitizeEndpoint(host: Pick<SSHHost, "hostname" | "port">): string {
  const hostname = host.hostname
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${hostname || "host"}_${host.port || 22}`;
}

function truncateAlias(value: string): string {
  return value.length <= MAX_ALIAS_LENGTH ? value : value.slice(0, MAX_ALIAS_LENGTH);
}

function normalizeAlias(value: string): string {
  return value.toLocaleLowerCase();
}
