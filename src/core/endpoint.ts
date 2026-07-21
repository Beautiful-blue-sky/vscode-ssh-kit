import type { SSHHost } from "./types";

export function formatAddressPort(hostname: string, port: number): string {
  const displayHostname = hostname.includes(":") && !/^\[.*\]$/.test(hostname)
    ? `[${hostname}]`
    : hostname;
  return `${displayHostname}:${port}`;
}

export function formatHostEndpoint(
  host: Pick<SSHHost, "hostname" | "port" | "username">,
  includeUsername = true
): string {
  const address = formatAddressPort(host.hostname, host.port);
  return includeUsername && host.username ? `${host.username}@${address}` : address;
}
