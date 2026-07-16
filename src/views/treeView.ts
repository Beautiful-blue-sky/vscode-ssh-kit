// SSH Kit — TreeView nodes and DataProvider
import * as vscode from "vscode";
import { SSHHost, SSHGroup } from "../core/types";
import { StorageService } from "../core/storage";

/** Virtual group ID for recent connections. */
export const RECENT_GROUP_ID = "__recent__";

// ─── TreeView nodes ───────────────────────────────────────────────────────

/** Group node */
export class GroupItem extends vscode.TreeItem {
  constructor(
    public readonly group: SSHGroup,
    hostCount: number,
    collapsed: boolean
  ) {
    super(
      group.name,
      collapsed
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.Expanded
    );
    this.id = group.id;
    this.description = `(${hostCount})`;
    this.iconPath = new vscode.ThemeIcon("folder");
    this.contextValue = group.id === RECENT_GROUP_ID ? "recentGroup" : "group";
  }
}

/** Host detail child node */
export class HostDetailItem extends vscode.TreeItem {
  constructor(
    public readonly detailLabel: string,
    public readonly detailValue: string,
    icon: string,
    copyable = true,
    parentItemId?: string
  ) {
    const value = detailValue;
    const label = detailLabel;
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = parentItemId ? `${parentItemId}:detail:${label}` : undefined;
    this.description = value;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = copyable && value ? "hostDetail" : "hostDetailReadonly";
    this.tooltip = copyable && value
      ? vscode.l10n.t("Click to copy {label}: {value}", { label, value })
      : vscode.l10n.t("{label}: {value}", { label, value });
    this.command = copyable && value
      ? {
          command: "sshKit.copyHostDetail",
          title: vscode.l10n.t("Copy {label}", { label }),
          arguments: [this],
        }
      : undefined;
  }
}

/** Host node — expand for details, inline buttons for connection */
export class HostItem extends vscode.TreeItem {
  constructor(
    public readonly host: SSHHost,
    itemScope: string,
    public readonly connected = false
  ) {
    super(host.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `host:${itemScope}:${host.id}`;
    this.description = connected ? vscode.l10n.t("Connected") : `${host.hostname}:${host.port}`;
    this.iconPath = connected
      ? new vscode.ThemeIcon("remote", new vscode.ThemeColor("testing.iconPassed"))
      : new vscode.ThemeIcon("server");
    this.contextValue = "host";
    this.tooltip = `${connected ? `${vscode.l10n.t("Connected")}\n` : ""}${host.username}@${host.hostname}:${host.port}` +
      (host.identityFile ? `\n🔑 ${host.identityFile}` : "");
  }
}

// ─── TreeDataProvider ──────────────────────────────────────────────────────

export class HostTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private connectedHostId: string | undefined;
  private filterQuery = "";
  private filterMatchIds: Set<string> | undefined;
  private readonly hostCollator = new Intl.Collator(vscode.env.language || undefined, {
    numeric: true,
    sensitivity: "base",
  });

  constructor(private storage: StorageService) {}

  /** Refresh the entire tree */
  refresh(): void {
    this.filterMatchIds = undefined;
    this._onDidChangeTreeData.fire();
  }

  setConnectedHostId(hostId: string | undefined): void {
    if (this.connectedHostId === hostId) {return;}
    this.connectedHostId = hostId;
    this.refresh();
  }

  setFilterQuery(query: string): void {
    const normalized = query.trim();
    if (this.filterQuery === normalized) {return;}
    this.filterQuery = normalized;
    this.refresh();
  }

  getFilterQuery(): string {
    return this.filterQuery;
  }

  getFilteredHostCount(): number {
    return this.filterQuery
      ? this.getFilterMatchIds().size
      : this.storage.getAllHosts().length;
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      const recent = this.buildRecentGroup();
      const groups = this.buildGroupNodes();
      const ungrouped = this.buildHostNodes(undefined);
      return [...recent, ...groups, ...ungrouped];
    }

    if (element instanceof GroupItem) {
      if (element.group.id === RECENT_GROUP_ID) {
        return this.buildRecentHostNodes();
      }
      return this.buildHostNodes(element.group.id);
    }

    // Expand host node → show detail children
    if (element instanceof HostItem) {
      return this.buildHostDetailNodes(element);
    }

    return [];
  }

  /** Build detail child nodes for a host */
  private buildHostDetailNodes(hostItem: HostItem): HostDetailItem[] {
    const h = hostItem.host;
    const children: HostDetailItem[] = [];
    const parentItemId = hostItem.id;

    children.push(new HostDetailItem(vscode.l10n.t("Host alias"), h.name, "server", true, parentItemId));
    children.push(new HostDetailItem(vscode.l10n.t("Address"), h.hostname, "globe", true, parentItemId));
    children.push(new HostDetailItem(vscode.l10n.t("Port"), String(h.port), "remote", true, parentItemId));
    children.push(new HostDetailItem(vscode.l10n.t("User"), h.username, "person", true, parentItemId));
    children.push(new HostDetailItem(
      vscode.l10n.t("Status"),
      hostItem.connected ? vscode.l10n.t("Connected") : vscode.l10n.t("Not connected"),
      "pulse",
      false,
      parentItemId
    ));

    if (h.identityFile) {
      children.push(new HostDetailItem(vscode.l10n.t("Identity file"), h.identityFile, "key", true, parentItemId));
    } else {
      children.push(new HostDetailItem(
        vscode.l10n.t("Identity file"),
        vscode.l10n.t("Not associated"),
        "key",
        false,
        parentItemId
      ));
    }

    if (h.tags.length > 0) {
      children.push(new HostDetailItem(vscode.l10n.t("Tags"), h.tags.join(", "), "tag", true, parentItemId));
    }

    return children;
  }

  /** Build the recent connections virtual group node (empty if none) */
  private buildRecentGroup(): GroupItem[] {
    const recentHosts = this.getFilteredRecentHosts();
    if (recentHosts.length === 0) {return [];}

    const group: SSHGroup = {
      id: RECENT_GROUP_ID,
      name: vscode.l10n.t("Recent Connections"),
      order: -1,
    };
    return [new GroupItem(group, recentHosts.length, false)];
  }

  /** Build recent connection host nodes */
  private buildRecentHostNodes(): HostItem[] {
    return this.getFilteredRecentHosts().map((h) => this.createHostItem(h, "recent"));
  }

  /** Build group nodes from storage */
  private buildGroupNodes(): GroupItem[] {
    const groups = this.storage.getGroups();
    const collapsed = this.storage.getGroupCollapsedState();
    return groups.flatMap((g) => {
      const count = this.getFilteredHostsByGroup(g.id).length;
      if (this.filterQuery && count === 0) {return [];}
      return [new GroupItem(g, count, this.filterQuery ? false : collapsed[g.id] ?? true)];
    });
  }

  /** Build sorted host nodes for a group; groupId=undefined returns ungrouped hosts. */
  private buildHostNodes(groupId: string | undefined): HostItem[] {
    const itemScope = groupId ? `group:${groupId}` : "ungrouped";
    return this.sortHosts(this.getFilteredHostsByGroup(groupId))
      .map((h) => this.createHostItem(h, itemScope));
  }

  private sortHosts(hosts: SSHHost[]): SSHHost[] {
    const mode = this.storage.getHostSortMode();
    const recentRanks = mode === "recent"
      ? new Map(this.storage.getRecentConnectionIds().map((id, index) => [id, index]))
      : undefined;

    return [...hosts].sort((left, right) => {
      if (mode === "recent" && recentRanks) {
        const rankDifference = (recentRanks.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (recentRanks.get(right.id) ?? Number.MAX_SAFE_INTEGER);
        if (rankDifference !== 0) {return rankDifference;}
      }

      if (mode === "addressAsc") {
        return this.compareByAddress(left, right);
      }

      const nameDifference = this.hostCollator.compare(left.name, right.name);
      if (nameDifference !== 0) {
        return mode === "nameDesc" ? -nameDifference : nameDifference;
      }
      return this.compareByAddress(left, right);
    });
  }

  private compareByAddress(left: SSHHost, right: SSHHost): number {
    const addressDifference = this.hostCollator.compare(left.hostname, right.hostname);
    if (addressDifference !== 0) {return addressDifference;}
    if (left.port !== right.port) {return left.port - right.port;}
    const nameDifference = this.hostCollator.compare(left.name, right.name);
    return nameDifference !== 0 ? nameDifference : left.id.localeCompare(right.id);
  }

  private getFilteredRecentHosts(): SSHHost[] {
    const matchIds = this.filterQuery ? this.getFilterMatchIds() : undefined;
    return this.storage.getRecentHosts().filter((host) => !matchIds || matchIds.has(host.id));
  }

  private getFilteredHostsByGroup(groupId: string | undefined): SSHHost[] {
    const matchIds = this.filterQuery ? this.getFilterMatchIds() : undefined;
    return this.storage.getHostsByGroup(groupId).filter((host) => !matchIds || matchIds.has(host.id));
  }

  private getFilterMatchIds(): Set<string> {
    if (this.filterMatchIds) {return this.filterMatchIds;}
    const terms = this.filterQuery.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const groupNames = new Map(this.storage.getGroups().map((group) => [group.id, group.name]));
    this.filterMatchIds = new Set(
      this.storage.getAllHosts()
        .filter((host) => this.matchesFilter(host, terms, groupNames))
        .map((host) => host.id)
    );
    return this.filterMatchIds;
  }

  private matchesFilter(host: SSHHost, terms: string[], groupNames: Map<string, string>): boolean {
    const haystack = [
      host.name,
      host.hostname,
      host.username,
      String(host.port),
      host.groupId ? groupNames.get(host.groupId) ?? "" : "",
      ...(host.tags ?? []),
    ].join("\n").toLocaleLowerCase();
    return terms.every((term) => haystack.includes(term));
  }

  private createHostItem(host: SSHHost, itemScope: string): HostItem {
    return new HostItem(host, itemScope, host.id === this.connectedHostId);
  }
}

// ─── Drag-and-drop controller ─────────────────────────────────────────────

const SSHKIT_MIME = "application/vnd.code.tree.sshKit";

type SSHKitDragPayload =
  | { kind: "hosts"; hostIds: string[] }
  | { kind: "group"; groupId: string };

/** Supports manual group ordering and moving hosts between groups. */
export class HostDragAndDropController implements vscode.TreeDragAndDropController<vscode.TreeItem> {
  readonly dropMimeTypes = [SSHKIT_MIME];
  readonly dragMimeTypes = [SSHKIT_MIME];

  constructor(
    private storage: StorageService,
    private onChanged: () => void,
    private isGroupReorderBlocked: () => boolean = () => false
  ) {}

  /** Serialize the dragged hosts or group into the DataTransfer. */
  handleDrag(
    source: readonly vscode.TreeItem[],
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): void {
    const hostIds = source
      .filter((s): s is HostItem => s instanceof HostItem)
      .map((s) => s.host.id);
    if (hostIds.length > 0) {
      const payload: SSHKitDragPayload = { kind: "hosts", hostIds };
      dataTransfer.set(SSHKIT_MIME, new vscode.DataTransferItem(JSON.stringify(payload)));
      return;
    }

    const group = source.find((item): item is GroupItem =>
      item instanceof GroupItem && item.group.id !== RECENT_GROUP_ID
    );
    if (group) {
      const payload: SSHKitDragPayload = { kind: "group", groupId: group.group.id };
      dataTransfer.set(SSHKIT_MIME, new vscode.DataTransferItem(JSON.stringify(payload)));
    }
  }

  /** Reorder a group or update host group assignments. */
  async handleDrop(
    target: vscode.TreeItem | undefined,
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const item = dataTransfer.get(SSHKIT_MIME);
    if (!item) {return;}

    let payload: SSHKitDragPayload;
    try {
      const parsed = JSON.parse(String(item.value)) as Partial<SSHKitDragPayload>;
      if (parsed.kind === "hosts" && Array.isArray(parsed.hostIds)) {
        payload = { kind: "hosts", hostIds: parsed.hostIds.filter((id): id is string => typeof id === "string") };
      } else if (parsed.kind === "group" && typeof parsed.groupId === "string") {
        payload = { kind: "group", groupId: parsed.groupId };
      } else {
        return;
      }
    } catch {
      return;
    }

    if (payload.kind === "group") {
      if (this.isGroupReorderBlocked()) {
        vscode.window.showInformationMessage(vscode.l10n.t("Clear the host filter before reordering groups."));
        return;
      }
      if (target instanceof GroupItem && target.group.id === RECENT_GROUP_ID) {
        if (await this.storage.moveGroup(payload.groupId, "top")) {this.onChanged();}
        return;
      }
      const targetGroupId = target instanceof GroupItem
        ? target.group.id
        : target instanceof HostItem
          ? target.host.groupId
          : undefined;
      if (await this.storage.moveGroupToTarget(payload.groupId, targetGroupId)) {this.onChanged();}
      return;
    }

    if (target instanceof GroupItem && target.group.id === RECENT_GROUP_ID) {return;}
    const targetGroupId = target instanceof GroupItem
      ? target.group.id
      : target instanceof HostItem
        ? target.host.groupId
        : undefined;

    const hostsById = new Map(this.storage.getAllHosts().map((host) => [host.id, host]));
    const changedHostIds = payload.hostIds.filter((id) => hostsById.get(id)?.groupId !== targetGroupId);
    if (changedHostIds.length === 0) {return;}

    for (const id of changedHostIds) {
      await this.storage.updateHost(id, { groupId: targetGroupId });
    }
    this.onChanged();
  }
}
