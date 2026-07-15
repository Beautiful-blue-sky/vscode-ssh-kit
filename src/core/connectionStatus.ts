import { clearTimeout, setTimeout } from "node:timers";
import * as vscode from "vscode";
import { findHostByRemoteSshAlias } from "../commands/connectCommands";
import { HostTreeDataProvider } from "../views/treeView";
import { canUseCachedSshKitWindowConnection } from "./connectionState";
import { decodeRemoteSshAuthority } from "./remoteAuthority";
import { StorageService } from "./storage";
import { SSHHost } from "./types";

interface CurrentConnectionInfo {
  host: SSHHost;
  alias: string;
}

export class ConnectionStatusController implements vscode.Disposable {
  private readonly statusItem: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  private current: CurrentConnectionInfo | undefined;
  private refreshQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: StorageService,
    private readonly tree: HostTreeDataProvider,
    startupRefreshDelays: readonly number[] = [1000, 5000, 15000]
  ) {
    this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    this.statusItem.name = "SSH Kit Connection";
    const startupRefreshTimers = startupRefreshDelays.map((delay) =>
      setTimeout(() => { void this.refresh(); }, delay)
    );
    this.disposables.push(
      this.statusItem,
      vscode.workspace.onDidChangeWorkspaceFolders(() => { void this.refresh(); }),
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          void this.refresh();
        }
      }),
      {
        dispose: () => {
          for (const timer of startupRefreshTimers) {
            clearTimeout(timer);
          }
        },
      }
    );
    void this.refresh();
  }

  refresh(options: { claimPending?: boolean } = {}): Promise<void> {
    const task = this.refreshQueue.then(async () => {
      this.current = await this.resolveCurrentConnection(options.claimPending ?? true);
      this.tree.setConnectedHostId(this.current?.host.id);
      this.updateStatusItem();
    });
    this.refreshQueue = task.catch(() => {});
    return task;
  }

  async showDetails(): Promise<void> {
    if (!this.current) {
      vscode.window.showInformationMessage(vscode.l10n.t("No SSH Kit connection was detected in this window."));
      return;
    }

    await vscode.env.clipboard.writeText(this.formatConnectionDetails(this.current.host, this.current.alias));
    vscode.window.setStatusBarMessage(vscode.l10n.t("$(check) SSH Kit: Current connection details copied"), 3000);
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private updateStatusItem(): void {
    if (!this.current) {
      this.statusItem.hide();
      return;
    }

    const { host, alias } = this.current;
    this.statusItem.text = `$(remote) SSH Kit: ${host.name}`;
    this.statusItem.command = {
      command: "sshKit.showCurrentConnection",
      title: vscode.l10n.t("Copy current connection details"),
    };
    this.statusItem.tooltip = this.buildTooltip(host, alias);
    this.statusItem.show();
  }

  private buildTooltip(host: SSHHost, alias: string): vscode.MarkdownString {
    const details = this.formatConnectionDetails(host, alias);
    const tooltip = new vscode.MarkdownString(undefined, true);
    tooltip.supportThemeIcons = true;
    tooltip.appendMarkdown(vscode.l10n.t("$(remote) **SSH Kit Current Connection**\n\n"));
    tooltip.appendCodeblock(details);
    tooltip.appendMarkdown(vscode.l10n.t("\n\nClick the status bar item to copy all connection details."));
    return tooltip;
  }

  private formatConnectionDetails(host: SSHHost, alias: string): string {
    const connection = `${host.username}@${host.hostname}:${host.port}`;
    const groupName = host.groupId
      ? this.storage.getGroups().find((group) => group.id === host.groupId)?.name
      : undefined;
    return [
      vscode.l10n.t("Name: {name}", { name: host.name }),
      vscode.l10n.t("Connection: {connection}", { connection }),
      vscode.l10n.t("Address: {address}", { address: host.hostname }),
      vscode.l10n.t("Port: {port}", { port: host.port }),
      vscode.l10n.t("User: {user}", { user: host.username }),
      groupName ? vscode.l10n.t("Group: {group}", { group: groupName }) : "",
      host.identityFile ? vscode.l10n.t("Identity file: {path}", { path: host.identityFile }) : "",
      host.tags.length > 0 ? vscode.l10n.t("Tags: {tags}", { tags: host.tags.join(", ") }) : "",
      alias !== host.name ? `SSH Host: ${alias}` : "",
    ].filter(Boolean).join("\n");
  }

  private async resolveCurrentConnection(claimPending: boolean): Promise<CurrentConnectionInfo | undefined> {
    const hosts = this.storage.getAllHosts();
    const authority = getCurrentRemoteSshAuthority();
    if (authority) {
      const matchedByAuthority = findHostByRemoteAuthority(authority, hosts) ??
        findStoredHostByRemoteAuthority(authority, hosts, this.storage);
      if (matchedByAuthority) {
        await this.storage.setWindowConnection(matchedByAuthority.host.id, matchedByAuthority.alias);
        await this.storage.setRemoteAuthorityConnection(matchedByAuthority.host.id, matchedByAuthority.alias);
        await this.storage.clearPendingWindowConnection(matchedByAuthority.host.id, matchedByAuthority.alias);
        return matchedByAuthority;
      }

      if (claimPending && vscode.env.remoteName === "ssh-remote") {
        const claimed = await this.storage.claimPendingWindowConnection(authority);
        const claimedHost = claimed ? hosts.find((item) => item.id === claimed.hostId) : undefined;
        if (claimedHost && claimed) {
          return { host: claimedHost, alias: claimed.alias };
        }
      }

      return undefined;
    }

    if (!canUseCachedSshKitWindowConnection(vscode.env.remoteName)) {
      return undefined;
    }

    const windowConnection = this.storage.getWindowConnection();
    const windowHost = windowConnection
      ? hosts.find((item) => item.id === windowConnection.hostId)
      : undefined;
    if (windowHost && windowConnection) {
      return { host: windowHost, alias: windowConnection.alias };
    }

    if (claimPending && vscode.env.remoteName === "ssh-remote") {
      const claimed = await this.storage.claimPendingWindowConnection();
      const claimedHost = claimed ? hosts.find((item) => item.id === claimed.hostId) : undefined;
      if (claimedHost && claimed) {
        return { host: claimedHost, alias: claimed.alias };
      }
    }

    return undefined;
  }
}

function getCurrentRemoteSshAuthority(): string | undefined {
  const remoteFolder = vscode.workspace.workspaceFolders?.find((folder) =>
    folder.uri.scheme === "vscode-remote" && folder.uri.authority.startsWith("ssh-remote+")
  );
  if (remoteFolder) {
    return decodeRemoteSshAuthority(remoteFolder.uri.authority);
  }

  const workspaceFile = vscode.workspace.workspaceFile;
  if (workspaceFile?.scheme === "vscode-remote" && workspaceFile.authority.startsWith("ssh-remote+")) {
    return decodeRemoteSshAuthority(workspaceFile.authority);
  }

  return undefined;
}

function findHostByRemoteAuthority(alias: string, hosts: SSHHost[]): CurrentConnectionInfo | undefined {
  const host = findHostByRemoteSshAlias(alias, hosts);
  return host ? { host, alias } : undefined;
}

function findStoredHostByRemoteAuthority(
  alias: string,
  hosts: SSHHost[],
  storage: StorageService
): CurrentConnectionInfo | undefined {
  const saved = storage.getRemoteAuthorityConnection(alias);
  const host = saved ? hosts.find((item) => item.id === saved.hostId) : undefined;
  return host && saved ? { host, alias: saved.alias } : undefined;
}
