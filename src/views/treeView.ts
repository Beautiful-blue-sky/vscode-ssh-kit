// SSH Kit — TreeView nodes and DataProvider
import * as vscode from "vscode";
import { SSHHost, SSHGroup } from "../core/types";
import { StorageService } from "../core/storage";

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
    this.contextValue = "group";
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
    this.tooltip = copyable && value ? `点击复制${label}：${value}` : `${label}：${value}`;
    this.command = copyable && value
      ? {
          command: "sshKit.copyHostDetail",
          title: `复制${label}`,
          arguments: [this],
        }
      : undefined;
  }
}

/** Host node — expand for details, inline buttons for connection */
export class HostItem extends vscode.TreeItem {
  constructor(
    public readonly host: SSHHost,
    itemScope: string
  ) {
    super(host.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `host:${itemScope}:${host.id}`;
    this.description = `${host.hostname}:${host.port}`;
    this.iconPath = new vscode.ThemeIcon("server");
    this.contextValue = "host";
    this.tooltip = `${host.username}@${host.hostname}:${host.port}` +
      (host.identityFile ? `\n🔑 ${host.identityFile}` : "");
  }
}

// ─── TreeDataProvider ──────────────────────────────────────────────────────

/** Virtual group ID for recent connections */
export const RECENT_GROUP_ID = "__recent__";

export class HostTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private storage: StorageService) {}

  /** Refresh the entire tree */
  refresh(): void {
    this._onDidChangeTreeData.fire();
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

    children.push(new HostDetailItem("地址", h.hostname, "globe", true, parentItemId));
    children.push(new HostDetailItem("端口", String(h.port), "remote", true, parentItemId));
    children.push(new HostDetailItem("用户", h.username, "person", true, parentItemId));

    if (h.identityFile) {
      children.push(new HostDetailItem("密钥", h.identityFile, "key", true, parentItemId));
    } else {
      children.push(new HostDetailItem("密钥", "未关联", "key", false, parentItemId));
    }

    if (h.tags.length > 0) {
      children.push(new HostDetailItem("标签", h.tags.join(", "), "tag", true, parentItemId));
    }

    return children;
  }

  /** Build the recent connections virtual group node (empty if none) */
  private buildRecentGroup(): GroupItem[] {
    const recentHosts = this.storage.getRecentHosts();
    if (recentHosts.length === 0) {return [];}

    const group: SSHGroup = {
      id: RECENT_GROUP_ID,
      name: "最近连接",
      order: -1,
    };
    return [new GroupItem(group, recentHosts.length, false)];
  }

  /** Build recent connection host nodes */
  private buildRecentHostNodes(): HostItem[] {
    return this.storage.getRecentHosts().map((h) => new HostItem(h, "recent"));
  }

  /** Build group nodes from storage */
  private buildGroupNodes(): GroupItem[] {
    const groups = this.storage.getGroups();
    const collapsed = this.storage.getGroupCollapsedState();
    return groups.map((g) => {
      const count = this.storage.getHostsByGroup(g.id).length;
      return new GroupItem(g, count, collapsed[g.id] ?? true);
    });
  }

  /** Build host nodes for a given group (groupId=undefined returns ungrouped hosts), sorted by name */
  private buildHostNodes(groupId: string | undefined): HostItem[] {
    const itemScope = groupId ? `group:${groupId}` : "ungrouped";
    return this.storage.getHostsByGroup(groupId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((h) => new HostItem(h, itemScope));
  }
}

// ─── Drag-and-drop controller ─────────────────────────────────────────────

const SSHKIT_MIME = "application/vnd.code.tree.sshKit";

/**
 * Host drag-and-drop controller — supports moving hosts between groups.
 * Drop onto a group node → move host into that group.
 * Drop onto empty space → ungroup the host.
 */
export class HostDragAndDropController implements vscode.TreeDragAndDropController<vscode.TreeItem> {
  readonly dropMimeTypes = [SSHKIT_MIME];
  readonly dragMimeTypes = [SSHKIT_MIME];

  constructor(
    private storage: StorageService,
    private onChanged: () => void
  ) {}

  /** Prepare drag data: serialize host IDs into the DataTransfer */
  handleDrag(
    source: readonly vscode.TreeItem[],
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): void {
    const hostIds = source
      .filter((s): s is HostItem => s instanceof HostItem)
      .map((s) => s.host.id);
    if (hostIds.length > 0) {
      dataTransfer.set(SSHKIT_MIME, new vscode.DataTransferItem(JSON.stringify(hostIds)));
    }
  }

  /** Handle drop: read host IDs and update their group assignment */
  async handleDrop(
    target: vscode.TreeItem | undefined,
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const item = dataTransfer.get(SSHKIT_MIME);
    if (!item) {return;}

    let hostIds: string[];
    try {
      hostIds = JSON.parse(String(item.value));
    } catch {
      return;
    }

    // Determine target group: real GroupItem -> that group, otherwise -> ungrouped
    const targetGroupId = target instanceof GroupItem && target.group.id !== RECENT_GROUP_ID
      ? target.group.id
      : undefined;

    for (const id of hostIds) {
      await this.storage.updateHost(id, { groupId: targetGroupId });
    }
    this.onChanged();
  }
}
