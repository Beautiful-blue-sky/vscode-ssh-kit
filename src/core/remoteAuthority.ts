import { Buffer } from "node:buffer";

const SSH_REMOTE_PREFIX = "ssh-remote+";

/** Resolve the actual Remote-SSH Host alias from VS Code URI authority formats. */
export function decodeRemoteSshAuthority(authority: string): string {
  const raw = authority.startsWith(SSH_REMOTE_PREFIX)
    ? authority.slice(SSH_REMOTE_PREFIX.length)
    : authority;
  const decoded = decodeUriComponent(raw);

  return parseAuthorityPayload(decoded) ??
    parseHexAuthorityPayload(decoded) ??
    decoded;
}

function decodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseHexAuthorityPayload(value: string): string | undefined {
  if (value.length === 0 || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) {
    return undefined;
  }

  try {
    return parseAuthorityPayload(Buffer.from(value, "hex").toString("utf8"));
  } catch {
    return undefined;
  }
}

function parseAuthorityPayload(value: string): string | undefined {
  if (!value.startsWith("{")) {
    return undefined;
  }

  try {
    const payload = JSON.parse(value) as { hostName?: unknown };
    return typeof payload.hostName === "string" && payload.hostName.length > 0
      ? payload.hostName
      : undefined;
  } catch {
    return undefined;
  }
}
