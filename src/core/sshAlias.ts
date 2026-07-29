import type { SSHHost } from "./types";

const MAX_ALIAS_LENGTH = 120;

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
    truncateAlias(`${base}__${sanitizeEndpoint(host)}`),
    truncateAlias(`${base}__${host.id.slice(-6)}`),
    truncateAlias(`${base}__${host.id}`),
  ];
  return candidates.find((candidate) => !used.has(normalizeAlias(candidate)))
    ?? truncateAlias(`ssh-kit__${host.id}`);
}

export function normalizeStoredSSHAliases(hosts: SSHHost[]): SSHHost[] {
  const used: string[] = [];
  return hosts.map((host) => {
    const alias = ensureUniqueSSHHostAlias(host.sshAlias || host.name, host, used);
    used.push(alias);
    return host.sshAlias === alias ? host : { ...host, sshAlias: alias };
  });
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
