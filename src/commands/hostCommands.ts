// SSH Kit — Host CRUD commands (add, edit, delete, copy, deduplicate, batch operations)
import * as vscode from "vscode";
import { formatHostEndpoint } from "../core/endpoint";
import { resolveHostAuthMode, SSHHost, PromptNewHostFn, PromptEditHostFn } from "../core/types";
import { DuplicateHostGroup, findDuplicateEndpointGroups } from "../core/hostMatching";
import { StorageService } from "../core/storage";
import { HostTreeDataProvider } from "../views/treeView";
import { listKeys } from "../keys/keyManager";

type KeepDuplicatePick = vscode.QuickPickItem & {
  host?: SSHHost;
  skip?: boolean;
};

type HostPickItem = vscode.QuickPickItem & {
  _hostId?: string;
};

type IdentityPickItem = vscode.QuickPickItem & {
  action: "key" | "custom" | "clear";
  path?: string;
};

/** Add a host */
export async function addHost(
  storage: StorageService,
  tree: HostTreeDataProvider,
  promptNewHost: PromptNewHostFn
): Promise<void> {
  const host = await promptNewHost(storage);
  if (!host) {return;}

  await storage.addHost(host);
  tree.refresh();
  vscode.window.showInformationMessage(
    vscode.l10n.t("Added host: {name} ({endpoint})", { name: host.name, endpoint: formatHostEndpoint(host, false) })
  );
}

/** Edit a host */
export async function editHost(
  host: SSHHost,
  storage: StorageService,
  tree: HostTreeDataProvider,
  promptEditHost: PromptEditHostFn
): Promise<void> {
  const updates = await promptEditHost(storage, host);
  if (!updates) {return;}

  await storage.updateHost(host.id, updates);
  tree.refresh();
  vscode.window.showInformationMessage(
    vscode.l10n.t("Updated host: {name}", { name: updates.name ?? host.name })
  );
}

/** Delete a single host */
export async function deleteHost(
  host: SSHHost,
  storage: StorageService,
  tree: HostTreeDataProvider
): Promise<void> {
  const deleteAction = vscode.l10n.t("Move to Recycle Bin");
  const confirmed = await vscode.window.showWarningMessage(
    vscode.l10n.t("Move host “{name}” ({endpoint}) to the SSH Kit recycle bin?", {
      name: host.name,
      endpoint: formatHostEndpoint(host, false),
    }),
    { modal: true },
    deleteAction
  );
  if (confirmed !== deleteAction) {return;}

  await storage.deleteHost(host.id);
  tree.refresh();
  vscode.window.showInformationMessage(
    vscode.l10n.t("Moved host to recycle bin: {name} ({endpoint})", {
      name: host.name,
      endpoint: formatHostEndpoint(host, false),
    })
  );
}

/** Browse deleted hosts and restore or permanently remove one. */
export async function manageRecycleBin(
  storage: StorageService,
  tree: HostTreeDataProvider
): Promise<void> {
  const deletedHosts = storage.getDeletedHosts();
  if (deletedHosts.length === 0) {
    vscode.window.showInformationMessage(vscode.l10n.t("The SSH Kit recycle bin is empty."));
    return;
  }

  const picked = await vscode.window.showQuickPick(
    deletedHosts.map((entry) => ({
      label: `$(trash) ${entry.host.name}`,
      description: formatHostEndpoint(entry.host),
      detail: [
        entry.groupName
          ? vscode.l10n.t("Previous group: {name}", { name: entry.groupName })
          : vscode.l10n.t("Previous group: Ungrouped"),
        vscode.l10n.t("Deleted: {time}", {
          time: new Date(entry.deletedAt).toLocaleString(),
        }),
      ].join(" · "),
      entry,
    })),
    {
      title: vscode.l10n.t("SSH Kit Recycle Bin"),
      placeHolder: vscode.l10n.t("Choose a deleted host to restore or permanently delete"),
      matchOnDescription: true,
      matchOnDetail: true,
    }
  );
  if (!picked) {return;}

  const restoreAction = vscode.l10n.t("Restore");
  const permanentAction = vscode.l10n.t("Delete Permanently");
  const action = await vscode.window.showQuickPick(
    [
      {
        label: `$(discard) ${restoreAction}`,
        description: vscode.l10n.t("Return the host to its previous group when possible"),
        action: "restore" as const,
      },
      {
        label: `$(trash) ${permanentAction}`,
        description: vscode.l10n.t("Remove this host from the recycle bin"),
        action: "delete" as const,
      },
    ],
    { title: picked.entry.host.name }
  );
  if (!action) {return;}

  if (action.action === "restore") {
    const restored = await storage.restoreDeletedHost(picked.entry.host.id);
    if (restored) {
      tree.refresh();
      vscode.window.showInformationMessage(vscode.l10n.t("Restored host: {name}", {
        name: restored.name,
      }));
    }
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    vscode.l10n.t("Permanently delete host “{name}”? An internal snapshot will be kept temporarily.", {
      name: picked.entry.host.name,
    }),
    { modal: true },
    permanentAction
  );
  if (confirmed !== permanentAction) {return;}
  if (await storage.permanentlyDeleteHost(picked.entry.host.id)) {
    tree.refresh();
    vscode.window.showInformationMessage(vscode.l10n.t("Permanently deleted host: {name}", {
      name: picked.entry.host.name,
    }));
  }
}

export async function emptyRecycleBin(
  storage: StorageService,
  tree: HostTreeDataProvider
): Promise<void> {
  const count = storage.getDeletedHosts().length;
  if (count === 0) {
    vscode.window.showInformationMessage(vscode.l10n.t("The SSH Kit recycle bin is empty."));
    return;
  }

  const emptyAction = vscode.l10n.t("Empty Recycle Bin");
  const confirmed = await vscode.window.showWarningMessage(
    vscode.l10n.t("Permanently delete {count} hosts from the recycle bin? An internal snapshot will be kept temporarily.", {
      count,
    }),
    { modal: true },
    emptyAction
  );
  if (confirmed !== emptyAction) {return;}
  const deleted = await storage.emptyRecycleBin();
  tree.refresh();
  vscode.window.showInformationMessage(vscode.l10n.t("Permanently deleted {count} hosts.", {
    count: deleted,
  }));
}

/** Copy hostname to clipboard */
export async function copyHostName(host: SSHHost): Promise<void> {
  await vscode.env.clipboard.writeText(host.hostname);
  vscode.window.showInformationMessage(vscode.l10n.t("Copied: {value}", { value: host.hostname }));
}

/** Copy an expanded host detail field to clipboard */
export async function copyHostDetail(label: string, value: string): Promise<void> {
  await vscode.env.clipboard.writeText(value);
  vscode.window.showInformationMessage(vscode.l10n.t("Copied {label}: {value}", { label, value }));
}

/** Remove duplicate hosts by actual SSH endpoint after the user chooses which item to keep. */
export async function deduplicateHosts(
  storage: StorageService,
  tree: HostTreeDataProvider
): Promise<void> {
  const hosts = storage.getAllHosts();
  const duplicates = findDuplicateEndpointGroups(hosts);
  if (duplicates.length === 0) {
    vscode.window.showInformationMessage(vscode.l10n.t("No duplicate hosts share the same address, port, and user."));
    return;
  }

  const groupNames = new Map(storage.getGroups().map((g) => [g.id, g.name]));
  const deleteIds = new Set<string>();
  let skipped = 0;

  for (let index = 0; index < duplicates.length; index++) {
    const keep = await promptHostToKeep(duplicates[index], groupNames, index + 1, duplicates.length);
    if (keep === undefined) {
      break;
    }
    if (keep === "skip") {
      skipped++;
      continue;
    }

    for (const host of duplicates[index].hosts) {
      if (host.id !== keep.id) {
        deleteIds.add(host.id);
      }
    }
  }

  if (deleteIds.size === 0) {
    vscode.window.showInformationMessage(skipped > 0
      ? vscode.l10n.t("No duplicate hosts were moved; {count} groups were skipped.", { count: skipped })
      : vscode.l10n.t("No duplicate hosts were moved."));
    return;
  }

  const toDelete = hosts.filter((host) => deleteIds.has(host.id));
  const preview = toDelete.slice(0, 8).map((host) => `“${host.name}”`).join(", ");
  const more = toDelete.length > 8 ? vscode.l10n.t(" and {count} hosts total", { count: toDelete.length }) : "";
  const confirmDeleteAction = vscode.l10n.t("Move to Recycle Bin");
  const confirmed = await vscode.window.showWarningMessage(
    vscode.l10n.t("Move {count} duplicate hosts to the recycle bin: {preview}{more}.", {
      count: toDelete.length,
      preview,
      more,
    }),
    { modal: true },
    confirmDeleteAction
  );
  if (confirmed !== confirmDeleteAction) {return;}

  await storage.deleteHosts(toDelete.map((host) => host.id));
  tree.refresh();
  vscode.window.showInformationMessage(vscode.l10n.t("Moved {count} duplicate hosts to the recycle bin.", { count: toDelete.length }));
}

async function promptHostToKeep(
  duplicateGroup: DuplicateHostGroup,
  groupNames: Map<string, string>,
  index: number,
  total: number
): Promise<SSHHost | "skip" | undefined> {
  const sortedHosts = [...duplicateGroup.hosts].sort((a, b) => {
    const groupA = a.groupId ? 0 : 1;
    const groupB = b.groupId ? 0 : 1;
    return groupA - groupB;
  });
  const endpoint = formatEndpoint(sortedHosts[0]);
  const items: KeepDuplicatePick[] = [
    ...sortedHosts.map((host) => ({
      label: host.name,
      description: `[${getGroupName(host, groupNames)}] ${formatEndpoint(host)}`,
      detail: [
        vscode.l10n.t("Authentication: {method}", {
          method: formatHostAuthentication(host),
        }),
        host.identityFile
          ? vscode.l10n.t("Identity file: {path}", { path: host.identityFile })
          : vscode.l10n.t("Identity file: not associated"),
        host.tags.length > 0 ? vscode.l10n.t("Tags: {tags}", { tags: host.tags.join(", ") }) : "",
      ].filter(Boolean).join("  "),
      host,
    })),
    {
      label: vscode.l10n.t("$(debug-step-over) Skip this group"),
      description: endpoint,
      skip: true,
    },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    matchOnDescription: true,
    matchOnDetail: true,
    placeHolder: vscode.l10n.t("Duplicate target {index}/{total}: choose the host to keep; the others will move to the recycle bin", { index, total }),
  });
  if (!picked) {return undefined;}
  if (picked.skip) {return "skip";}
  return picked.host;
}

function getGroupName(host: SSHHost, groupNames: Map<string, string>): string {
  return host.groupId
    ? groupNames.get(host.groupId) ?? vscode.l10n.t("Unknown group")
    : vscode.l10n.t("Ungrouped");
}

function formatEndpoint(host: SSHHost): string {
  return formatHostEndpoint(host);
}

/** Batch delete hosts via multi-select QuickPick. Note: canPickMany checkbox flickering is a VS Code platform limitation. */
export async function batchDeleteHosts(
  storage: StorageService,
  tree: HostTreeDataProvider
): Promise<void> {
  const hosts = storage.getAllHosts();
  if (hosts.length === 0) {
    vscode.window.showInformationMessage(vscode.l10n.t("No hosts are available."));
    return;
  }

  const groups = storage.getGroups();
  const items: (vscode.QuickPickItem & { _hostId?: string })[] = [];
  const pushed = new Set<string>();

  for (const group of groups) {
    for (const h of storage.getHostsByGroup(group.id)) {
      items.push({
        label: h.name,
        description: `[${group.name}] ${formatHostEndpoint(h)}`,
        _hostId: h.id,
      });
      pushed.add(h.id);
    }
  }

  for (const h of hosts.filter((h) => !pushed.has(h.id))) {
    items.push({
      label: h.name,
      description: `[${vscode.l10n.t("Ungrouped")}] ${formatHostEndpoint(h)}`,
      _hostId: h.id,
    });
  }

  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    matchOnDescription: false,
    matchOnDetail: false,
    placeHolder: vscode.l10n.t("Choose hosts to delete (multiple selection allowed)…"),
  });

  if (!picked || picked.length === 0) {return;}

  const ids = new Set(picked.map((p) => p._hostId).filter(Boolean) as string[]);
  const toDelete = hosts.filter((h) => ids.has(h.id));
  if (toDelete.length === 0) {return;}

  const batchDeleteAction = vscode.l10n.t("Move to Recycle Bin");
  const confirmed = await vscode.window.showWarningMessage(
    vscode.l10n.t("Move the {count} selected hosts to the recycle bin?", { count: toDelete.length }),
    { modal: true },
    batchDeleteAction
  );
  if (confirmed !== batchDeleteAction) {return;}

  await storage.deleteHosts(toDelete.map((host) => host.id));
  tree.refresh();
  vscode.window.showInformationMessage(vscode.l10n.t("Moved {count} hosts to the recycle bin.", {
    count: toDelete.length,
  }));
}

/** Change selected hosts to a new associated identity file. */
export async function batchChangeHostKey(
  storage: StorageService,
  tree: HostTreeDataProvider
): Promise<void> {
  const hosts = storage.getAllHosts();
  if (hosts.length === 0) {
    vscode.window.showInformationMessage(vscode.l10n.t("No hosts are available."));
    return;
  }

  const targets = await pickHostsForKeyChange(storage, hosts);
  if (!targets || targets.length === 0) {return;}

  await applyHostKeyChange(storage, tree, targets);
}

/** Change one host to a new associated identity file. */
export async function changeHostKey(
  host: SSHHost,
  storage: StorageService,
  tree: HostTreeDataProvider
): Promise<void> {
  const target = storage.getAllHosts().find((item) => item.id === host.id);
  if (!target) {
    vscode.window.showInformationMessage(vscode.l10n.t("This host does not exist or has been deleted."));
    return;
  }

  await applyHostKeyChange(storage, tree, [target]);
}

async function applyHostKeyChange(
  storage: StorageService,
  tree: HostTreeDataProvider,
  targets: SSHHost[]
): Promise<void> {
  const identityFile = await pickIdentityFileForHosts(targets);
  if (identityFile === null) {return;}

  const label = identityFile || vscode.l10n.t("OpenSSH automatic (no specified identity file)");
  const preview = targets.slice(0, 8).map((host) => `“${host.name}”`).join(", ");
  const more = targets.length > 8 ? vscode.l10n.t(" and {count} hosts total", { count: targets.length }) : "";
  const confirmChangeAction = vscode.l10n.t("Confirm Change");
  const confirmed = await vscode.window.showWarningMessage(
    vscode.l10n.t("Change the identity file for {count} hosts to “{identity}”: {preview}{more}.", {
      count: targets.length,
      identity: label,
      preview,
      more,
    }),
    { modal: true },
    confirmChangeAction
  );
  if (confirmed !== confirmChangeAction) {return;}

  const updated = await storage.updateHostsIdentityFile(
    targets.map((host) => host.id),
    identityFile || undefined
  );
  tree.refresh();
  vscode.window.showInformationMessage(vscode.l10n.t("Updated the identity file for {count} hosts.", { count: updated }));
}

async function pickHostsForKeyChange(
  storage: StorageService,
  hosts: SSHHost[]
): Promise<SSHHost[] | undefined> {
  const groups = storage.getGroups();
  const items: HostPickItem[] = [];
  const pushed = new Set<string>();

  for (const group of groups) {
    for (const host of storage.getHostsByGroup(group.id)) {
      items.push(hostToPickItem(host, group.name));
      pushed.add(host.id);
    }
  }

  for (const host of hosts.filter((item) => !pushed.has(item.id))) {
    items.push(hostToPickItem(host, vscode.l10n.t("Ungrouped")));
  }

  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    matchOnDescription: true,
    matchOnDetail: true,
    placeHolder: vscode.l10n.t("Choose hosts whose identity file should change (multiple selection allowed)…"),
  });
  if (!picked || picked.length === 0) {return undefined;}

  const ids = new Set(picked.map((item) => item._hostId).filter(Boolean) as string[]);
  return hosts.filter((host) => ids.has(host.id));
}

function hostToPickItem(host: SSHHost, groupName: string): HostPickItem {
  return {
    label: host.name,
    description: `[${groupName}] ${formatEndpoint(host)}`,
    detail: `${vscode.l10n.t("Authentication: {method}", {
      method: formatHostAuthentication(host),
    })} · ${host.identityFile
      ? vscode.l10n.t("Current identity file: {path}", { path: host.identityFile })
      : vscode.l10n.t("No identity file is currently associated")}`,
    _hostId: host.id,
  };
}

async function pickIdentityFileForHosts(hosts: SSHHost[]): Promise<string | null> {
  const currentValues = [...new Set(hosts.map((host) => host.identityFile || "").filter(Boolean))];
  const currentSummary = currentValues.length === 0
    ? vscode.l10n.t("None of the selected hosts has an identity file")
    : currentValues.length === 1
      ? vscode.l10n.t("Current: {path}", { path: currentValues[0] })
      : vscode.l10n.t("The selection currently uses {count} different identity files", { count: currentValues.length });

  const items: IdentityPickItem[] = [
    {
      label: vscode.l10n.t("$(settings-gear) OpenSSH automatic"),
      description: currentSummary,
      action: "clear",
      path: "",
    },
    {
      label: vscode.l10n.t("$(edit) Enter a custom path"),
      description: vscode.l10n.t("For example, ~/.ssh/id_ed25519 or a migrated absolute path"),
      action: "custom",
    },
    ...listKeys().map((key) => ({
      label: `$(key) ${key.name}`,
      description: key.type,
      detail: key.privateKeyPath,
      action: "key" as const,
      path: key.privateKeyPath,
    })),
  ];

  const picked = await vscode.window.showQuickPick(items, {
    matchOnDescription: true,
    matchOnDetail: true,
    placeHolder: vscode.l10n.t("Choose a new identity file ({count} hosts)", { count: hosts.length }),
  });
  if (!picked) {return null;}

  if (picked.action === "custom") {
    const value = await vscode.window.showInputBox({
      prompt: vscode.l10n.t("Enter the new private key path"),
      placeHolder: "~/.ssh/id_ed25519",
      validateInput: (input) => {
        const trimmed = input.trim();
        if (!trimmed) {return vscode.l10n.t("Path is required");}
        if (/[\r\n]/.test(trimmed)) {return vscode.l10n.t("Path cannot contain line breaks");}
        return undefined;
      },
    });
    return value === undefined ? null : value.trim();
  }

  return picked.path ?? "";
}

function formatHostAuthentication(host: SSHHost): string {
  switch (resolveHostAuthMode(host)) {
    case "password":
      return vscode.l10n.t("Password only");
    case "identityFile":
      return vscode.l10n.t("Specified identity file");
    default:
      return vscode.l10n.t("Automatic (OpenSSH defaults)");
  }
}
