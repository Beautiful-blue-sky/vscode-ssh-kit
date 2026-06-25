// Host identity helpers shared by import and future duplicate handling.
import type { SSHHost } from "./types";

export type ImportedHost = Omit<SSHHost, "id">;

export interface ImportMatch {
  host: SSHHost;
  reason: "name" | "endpoint";
}

export interface DuplicateHostGroup {
  endpointKey: string;
  hosts: SSHHost[];
}

export function findImportMatch(
  host: ImportedHost,
  existingHosts: SSHHost[],
  touchedHostIds: Set<string>
): ImportMatch | "already-touched" | "ambiguous" | undefined {
  const sameName = existingHosts.find((existing) =>
    normalizeHostName(existing.name) === normalizeHostName(host.name)
  );
  if (sameName) {
    return touchedHostIds.has(sameName.id)
      ? "already-touched"
      : { host: sameName, reason: "name" };
  }

  const importedEndpoint = toEndpointKey(host);
  const sameEndpoint = existingHosts.filter((existing) =>
    toEndpointKey(existing) === importedEndpoint
  );
  if (sameEndpoint.length === 0) {return undefined;}

  const untouched = sameEndpoint.filter((existing) => !touchedHostIds.has(existing.id));
  if (untouched.length === 0) {return "already-touched";}
  if (untouched.length > 1) {return "ambiguous";}
  return { host: untouched[0], reason: "endpoint" };
}

export function createImportedHostUpdates(
  existing: SSHHost,
  imported: ImportedHost,
  reason: ImportMatch["reason"]
): Partial<Omit<SSHHost, "id">> {
  return {
    name: reason === "name" ? imported.name : existing.name,
    hostname: imported.hostname,
    port: imported.port,
    username: imported.username,
    identityFile: imported.identityFile,
    extraConfig: imported.extraConfig,
  };
}

export function findDuplicateEndpointGroups(hosts: SSHHost[]): DuplicateHostGroup[] {
  const groups = new Map<string, SSHHost[]>();
  for (const host of hosts) {
    const key = toEndpointKey(host);
    groups.set(key, [...(groups.get(key) ?? []), host]);
  }

  return [...groups.entries()]
    .filter(([, groupHosts]) => groupHosts.length > 1)
    .map(([endpointKey, groupHosts]) => ({
      endpointKey,
      hosts: groupHosts,
    }));
}

function normalizeHostName(value: string): string {
  return value.trim();
}

export function toEndpointKey(
  host: Pick<SSHHost, "hostname" | "port" | "username">
): string {
  const hostname = host.hostname.trim().toLowerCase();
  const port = Number.isFinite(host.port) ? host.port : 22;
  const username = host.username.trim();
  return `${hostname}\u0000${port}\u0000${username}`;
}
