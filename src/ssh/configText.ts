import * as vscode from "vscode";

const CANONICAL_DIRECTIVE_KEYS: Record<string, string> = {
  addkeystoagent: "AddKeysToAgent",
  certificatefile: "CertificateFile",
  compression: "Compression",
  connecttimeout: "ConnectTimeout",
  forwardagent: "ForwardAgent",
  identitiesonly: "IdentitiesOnly",
  localforward: "LocalForward",
  loglevel: "LogLevel",
  proxycommand: "ProxyCommand",
  proxyjump: "ProxyJump",
  remoteforward: "RemoteForward",
  sendenv: "SendEnv",
  serveralivecountmax: "ServerAliveCountMax",
  serveraliveinterval: "ServerAliveInterval",
  stricthostkeychecking: "StrictHostKeyChecking",
  userknownhostsfile: "UserKnownHostsFile",
};

/** Split an SSH Config word list while preserving quoted whitespace. */
export function splitSSHConfigWords(value: string): string[] {
  const words: string[] = [];
  let word = "";
  let quote: "\"" | "'" | undefined;

  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else if (char === "\\" && quote === "\"" && index + 1 < value.length) {
        const next = value[index + 1];
        if (next === "\\" || next === "\"") {
          word += next;
          index++;
        } else {
          word += char;
        }
      } else {
        word += char;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (word) {
        words.push(word);
        word = "";
      }
    } else {
      word += char;
    }
  }

  if (word) {words.push(word);}
  return words;
}

export function formatSSHConfigWord(value: string): string {
  assertSingleLineSSHConfigValue(value);
  if (/[\s#"'\\]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
  }
  return value;
}

export function formatSSHIdentityFile(value: string): string {
  const portableValue = process.platform === "win32" || value.startsWith("~\\")
    ? value.replace(/\\/g, "/")
    : value;
  return formatSSHConfigWord(portableValue);
}

export function formatSSHDirectiveKey(key: string): string {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) {
    throw new Error(vscode.l10n.t("Invalid SSH Config directive name: {key}", { key }));
  }
  return CANONICAL_DIRECTIVE_KEYS[key.toLowerCase()] ?? key;
}

export function assertSingleLineSSHConfigValue(value: string): void {
  if (/[\r\n\0]/.test(value)) {
    throw new Error(vscode.l10n.t("SSH Config values cannot contain line breaks or null characters."));
  }
}
