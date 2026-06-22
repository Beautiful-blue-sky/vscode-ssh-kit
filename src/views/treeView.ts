// SSH Kit —— TreeView 节点与 DataProvider
import * as vscode from "vscode";
import { SSHHost, SSHGroup } from "../core/types";
import { StorageService } from "../core/storage";

// ─── TreeView 节点 ────────────────────────────────────────────────────────

/** 分组节点 */
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

/** 主机详情子节点 */
class HostDetailItem extends vscode.TreeItem {
  constructor(label: string, value: string, icon: string, command?: vscode.Command) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = value;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.command = command;
  }
}

/** 主机节点 —— 单击展开详情，内联按钮连接 */
export class HostItem extends vscode.TreeItem {
  constructor(public readonly host: SSHHost) {
    super(host.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = host.id;
    this.description = `${host.hostname}:${host.port}`;
    this.iconPath = new vscode.ThemeIcon("server");
    this.contextValue = "host";
    this.tooltip = `${host.username}@${host.hostname}:${host.port}` +
      (host.identityFile ? `\n🔑 ${host.identityFile}` : "");
  }
}

// ─── TreeDataProvider ──────────────────────────────────────────────────────

/** 最近连接虚拟分组 ID */
export const RECENT_GROUP_ID = "__recent__";

export class HostTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private storage: StorageService) {}

  /** 刷新整个树 */
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

    // 展开主机节点 → 显示详情
    if (element instanceof HostItem) {
      return this.buildHostDetailNodes(element);
    }

    return [];
  }

  /** 构建主机详情子节点列表 */
  private buildHostDetailNodes(hostItem: HostItem): HostDetailItem[] {
    const h = hostItem.host;
    const children: HostDetailItem[] = [];

    children.push(new HostDetailItem("地址", h.hostname, "globe"));
    children.push(new HostDetailItem("端口", String(h.port), "remote"));
    children.push(new HostDetailItem("用户", h.username, "person"));

    if (h.identityFile) {
      children.push(new HostDetailItem(
        "密钥", h.identityFile, "key",
        {
          command: "vscode.open",
          title: "打开密钥文件",
          arguments: [vscode.Uri.file(h.identityFile)],
        }
      ));
    } else {
      children.push(new HostDetailItem("密钥", "未关联", "key"));
    }

    if (h.tags.length > 0) {
      children.push(new HostDetailItem("标签", h.tags.join(", "), "tag"));
    }

    return children;
  }

  /** 构建最近连接虚拟分组节点（无最近连接时返回空数组） */
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

  /** 构建最近连接主机节点列表 */
  private buildRecentHostNodes(): HostItem[] {
    return this.storage.getRecentHosts().map((h) => new HostItem(h));
  }

  /** 构建分组节点列表 */
  private buildGroupNodes(): GroupItem[] {
    const groups = this.storage.getGroups();
    const collapsed = this.storage.getGroupCollapsedState();
    return groups.map((g) => {
      const count = this.storage.getHostsByGroup(g.id).length;
      return new GroupItem(g, count, collapsed[g.id] ?? true);
    });
  }

  /** 构建指定分组下的主机节点列表（groupId 为 undefined 时返回未分组主机），按名称排序 */
  private buildHostNodes(groupId: string | undefined): HostItem[] {
    return this.storage.getHostsByGroup(groupId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((h) => new HostItem(h));
  }
}

// ─── 拖拽控制器 ────────────────────────────────────────────────────────────

const SSHKIT_MIME = "application/vnd.code.tree.sshKit";

/**
 * 主机拖拽控制器 —— 支持在分组间、分组与未分组之间拖拽移动主机。
 * 拖到分组节点 → 移入该分组；拖到空白处 → 取消分组。
 */
export class HostDragAndDropController implements vscode.TreeDragAndDropController<vscode.TreeItem> {
  readonly dropMimeTypes = [SSHKIT_MIME];
  readonly dragMimeTypes = [SSHKIT_MIME];

  constructor(
    private storage: StorageService,
    private onChanged: () => void
  ) {}

  /** 准备拖拽数据：将主机 ID 写入 DataTransfer */
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

  /** 处理放置：读取主机 ID，更新所属分组 */
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

    // 目标分组：拖到 GroupItem → 该分组，否则 → 未分组
    const targetGroupId = target instanceof GroupItem
      ? target.group.id
      : undefined;

    for (const id of hostIds) {
      await this.storage.updateHost(id, { groupId: targetGroupId });
    }
    this.onChanged();
  }
}
