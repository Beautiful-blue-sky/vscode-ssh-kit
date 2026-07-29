# SSH Kit

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/lixiaoyu.ssh-kit?label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=lixiaoyu.ssh-kit)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/lixiaoyu.ssh-kit?label=Installs)](https://marketplace.visualstudio.com/items?itemName=lixiaoyu.ssh-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

SSH Kit is a focused SSH host manager for VS Code. It gives you one place to organize servers, reuse SSH keys, safely integrate with SSH Config, and open Remote-SSH sessions without hunting through host aliases.

[中文文档](README.zh-CN.md)

## Why Use It

- Keep SSH hosts grouped by project, environment, or team.
- Open a host through Remote-SSH in the current window, a new empty window, or an external terminal.
- See the current SSH Kit Remote-SSH connection in the status bar; hover for details or click to copy them.
- Import the effective SSH Config and preview additions, updates, skips, conflicts, and command-capable directives.
- Expand any host to copy its Host nickname, address, port, username, or key path.
- Manage local SSH keys, copy public keys, and regenerate missing `.pub` files.
- Recover data through a recycle bin, internal snapshots, and JSON backups that can optionally include associated keys.
- Let Copilot and other VS Code language model tools read host metadata when you ask for SSH context.

## Quick Start

1. Install **SSH Kit** from the VS Code Marketplace.
2. Open the **SSH Kit** activity bar view.
3. Add a host manually, or choose **Import from SSH Config**.
4. Use the inline buttons on a host to connect with Remote-SSH or an external terminal.
5. Expand hosts and keys to copy details directly from the tree.
6. On the first Remote-SSH connection, save a one-time copy of the current SSH Config and enable the managed `Include`; later host changes update only SSH Kit's own config file.
7. In Copilot Chat, mention `#sshKitHosts` when you want Copilot to use your SSH Kit host list.

## Main Features

### Host Management

- Folders for grouping SSH hosts.
- Reorder folders with hover actions for quick up/down moves, by dragging a folder onto the target position, or through **Group Order** in the folder context menu.
- Arrange all folders in natural name order with one command; manual ordering remains available afterward.
- Drag-and-drop hosts between folders.
- Recently connected hosts at the top of the list.
- Sort hosts inside every folder by natural name order, reverse name order, address, or recent connection activity. The selected mode is preserved across restarts and remains active while filtering.
- Search-and-connect by host name, address, or tag.
- Filter the host tree in place by Host alias, IP / HostName, user, port, group, or tags. Space-separated terms are combined, and the adjacent clear action restores the full tree. Group reordering is paused while a filter hides part of the list.
- Batch delete and endpoint-based duplicate cleanup; deleted hosts first enter the recycle bin.
- Batch change the associated key path for selected hosts, including clearing the key or entering a custom path.
- Right-click a host to change only that host's associated key.
- Choose an explicit authentication mode per host: OpenSSH automatic, one specified identity file, or password only. Clearing an associated key returns the host to automatic mode; it does not force password authentication.
- Accept IPv4, IPv6, and domain names, plus common enterprise login forms such as `DOMAIN\\user` and `user@example.com`.

### Remote-SSH Connections

- Open the selected host in a current or new empty Remote-SSH window.
- Keep the native Remote-SSH status label readable by using the Host alias directly.
- Show the active SSH Kit connection per VS Code window in the host tree and status bar; hover to view name, endpoint, user, group, key, and tag details, or click the status item to copy the full details.
- Restore each window's SSH Kit status and connected-host marker when VS Code restarts, reopens Remote-SSH windows, or switches a remote window from empty state to an opened folder.
- Keep new-window connection context separate from the source window, so opening several Remote-SSH windows does not overwrite the current window marker.
- Persist one stable, unique Remote-SSH Host alias per host. Editing display or connection fields does not create a second host identity.
- Rebuild SSH Kit's managed `~/.ssh/ssh-kit/hosts.conf` before connecting so Remote-SSH receives current connection settings.
- In password-only mode, disable public-key authentication explicitly. In specified-key mode, use `IdentitiesOnly=yes` so unrelated default or ssh-agent keys are not attempted.
- Open a regular SSH shell in the VS Code terminal or a native external terminal. In Remote-SSH windows, SSH Kit can open a local VS Code terminal so local SSH config and local key files still work.

### SSH Config Import and Remote-SSH Integration

- Import from the config actually used by Remote-SSH, including `remote.SSH.configFile` and recursive `Include` directives.
- Import concrete `Host` aliases only. Wildcard/negated patterns and conditional `Match` sections are kept out of the host list, and `Match` directives cannot leak into the preceding host. Global defaults and `Match` rules are not evaluated as inherited host values.
- Preview import changes before writing them into SSH Kit, including added, updated, skipped, and ambiguous entries.
- Match existing hosts by name first, then by SSH endpoint, so repeated imports update existing records instead of creating obvious duplicates.
- Ignore SSH Kit's generated managed file and legacy Remote-SSH alias blocks during import, preventing circular imports.
- Call out `ProxyCommand`, `LocalCommand`, `RemoteCommand`, and `KnownHostsCommand` in the import confirmation because they can execute commands.
- Preserve repeated directives such as `LocalForward` and `SendEnv`.
- Accept both whitespace and `Keyword=value` directive syntax, ignore trailing comments outside quotes, and follow OpenSSH's first-value rule for single-valued directives.
- Preserve quoted values and identity-file paths containing spaces; imported invalid ports fall back to the SSH default port `22`. A confirmed import is committed as one catalog transaction.
- The SSH Kit catalog is the source of truth and deterministically generates `~/.ssh/ssh-kit/hosts.conf`.
- Enabling integration adds only a marked `Include ssh-kit/hosts.conf` block at the top of the effective config. You must save a one-time backup file first; canceling leaves the config unchanged.
- Everyday add, edit, delete, and restore operations rebuild only the managed file. User Hosts, comments, `Include` / `Match` rules, global directives, and other tools' content remain untouched.
- **Export Hosts as SSH Config** writes only to a separate file selected by the user and refuses to replace the active SSH Config.
- Inspect, repair, or remove integration explicitly. Status checks verify that the Include appears before other SSH directives; repair backs up the config and normalizes the Include to an effective position. Removal deletes only the marked Include while retaining SSH Kit data and the generated file.
- Legacy alias blocks can be counted, backed up, and cleaned explicitly; upgrades never remove them silently.
- Connectivity tests use OpenSSH `StrictHostKeyChecking=accept-new`: first-seen fingerprints can be accepted automatically, while changed fingerprints still stop the connection. Password-only hosts must be verified by connecting directly because the connectivity test is non-interactive.

### Key Management

- Scan recognized OpenSSH and PEM private keys from `~/.ssh/` while ignoring unrelated files.
- Display key type and fingerprint.
- Generate ed25519, RSA, or ECDSA key pairs.
- Copy public keys from the tree.
- Open private or public key files directly from expanded key details while keeping path-copy actions available.
- Regenerate missing public key files from private keys.
- Rename a key pair and automatically update hosts associated with its previous path.
- Warn before deleting an associated key and clear affected host associations after confirmation.

### SSH Kit Data Backup and Restore

- Data stored by older versions in VS Code `globalState` migrates automatically into the independent catalog on upgrade, while retaining the original value as a rollback copy. If the catalog directory is temporarily unavailable or migration fails, SSH Kit keeps using the old data instead of showing an empty list and retries on a later activation.
- Host deletion moves items to a recycle bin. Restore individual hosts, delete them permanently, or empty the bin; host deletion never removes key files.
- Deleting a group, moving hosts to or from the recycle bin, permanently deleting or emptying recycle-bin items, restoring JSON data, and restoring another snapshot create key-free internal snapshots. SSH Kit retains the latest 10, which can be restored from the host view menu or Command Palette.
- Choose between a host-data-only JSON backup and a complete backup containing associated key files.
- Complete backups contain private key contents. SSH Kit requires an explicit warning confirmation, and applies owner-only `0600` permissions on POSIX systems.
- Preview restore targets before writing key files back to `~/.ssh/`.
- Reuse matching SSH keys by public-key identity even when the local file has a different name, and prompt before handling same-name key conflicts.
- Rewrite restored host key paths to the local key that was written, renamed, or reused; skipped or failed keys leave the imported host without a key association instead of keeping source-machine paths.
- Show failed key restore details when a backup contains invalid key data.
- Choose **merge** or **replace** during restore. Merge skips existing items; replace snapshots the current catalog before reproducing the selected backup.
- Older versions refuse backups created by a newer data format to avoid dropping unknown fields; update SSH Kit before restoring such a backup.
- Use batch key changes after restore to fix migrated or renamed key paths without editing hosts one by one.

### AI and Copilot Access

SSH Kit contributes a read-only VS Code language model tool named `sshKitHosts`. It lets Copilot Chat and other VS Code chat providers that support language model tools use saved SSH Kit host metadata. Referencing `#sshKitHosts` is the most explicit way to invoke it; when the tool is enabled in Agent mode, Copilot may also select it automatically for a relevant request. VS Code controls tool approval according to your chat tool settings.

How to use it in Copilot Chat:

1. Install and enable **SSH Kit** in VS Code.
2. Add hosts manually or import them from SSH Config.
3. Open Copilot Chat.
4. Reference the tool in your prompt with `#sshKitHosts`.

Example prompts:

```text
#sshKitHosts Find prod hosts and show name, endpoint, user, and group.
```

```text
#sshKitHosts Search for nginx hosts and suggest which one I should open with Remote-SSH.
```

```text
#sshKitHosts List hosts related to 10.0.1 and include tags.
```

If `#sshKitHosts` does not appear, update VS Code and Copilot Chat, then reload the VS Code window. The tool is declared by the extension and registered when SSH Kit activates.

The tool only reads hosts stored by SSH Kit. It does not establish connections, test reachability, parse SSH Config files, or identify the current Remote-SSH window. Space-separated query terms are combined across host name, address, user, port, group, and tags. Results are paged: the default page contains up to 50 hosts, each invocation is capped at 200, and `nextOffset` is returned when more matches are available. SSH Kit may shorten a page further to stay within the active model's token budget.

What the tool can return:

- Host display name
- HostName / IP address
- Port and login user
- Group and tags
- Authentication mode (`auto`, `identityFile`, or `password`)
- Whether an identity file is associated

What the tool does not return by default:

- Private key contents
- Identity file paths

If key file paths are needed, Copilot can request them through the tool input. SSH Kit shows the query, offset, and page limit in its confirmation before sharing paths, and private key contents are never returned.

## Command Palette

Available from `Ctrl+Shift+P`:

| Command | Description |
|---|---|
| `SSH Kit: Add Host` | Add a host with guided input |
| `SSH Kit: Add Group` | Create a host group |
| `SSH Kit: Refresh` | Refresh host and key views |
| `SSH Kit: Search Hosts` | Search hosts and connect |
| `SSH Kit: Sort Hosts` | Sort hosts by natural name, reverse name, address, or recent connection activity |
| `SSH Kit: Sort Groups by Name` | Arrange all real host groups in natural name order |
| `SSH Kit: Filter Host List` | Filter the current host tree by alias, address, user, port, group, or tags |
| `SSH Kit: Clear Host Filter` | Clear the active host-tree filter |
| `SSH Kit: Import from SSH Config` | Import hosts from `~/.ssh/config` with a preview |
| `SSH Kit: Export Hosts as SSH Config` | Write current hosts to a separate selected file without replacing the active config |
| `SSH Kit: Open SSH Config` | Open the SSH Config file |
| `SSH Kit: Open Managed SSH Config` | Open the generated `hosts.conf` |
| `SSH Kit: Show Remote-SSH Integration Status` | Show whether the Include is effective, plus config paths and the legacy alias count |
| `SSH Kit: Enable Remote-SSH Integration` | Back up and add the managed Include to the effective config |
| `SSH Kit: Repair Remote-SSH Integration` | Back up and normalize the Include before other SSH directives |
| `SSH Kit: Remove Remote-SSH Integration` | Back up and remove the Include while retaining SSH Kit data |
| `SSH Kit: Clean Legacy SSH Kit Connection Aliases` | Preview, back up, and remove legacy marked alias blocks |
| `SSH Kit: List SSH Keys` | Browse scanned SSH keys |
| `SSH Kit: Generate SSH Key` | Generate a new key pair |
| `SSH Kit: Regenerate Public Key` | Recreate a `.pub` file from a private key |
| `SSH Kit: Remove Duplicate Hosts` | Find duplicate endpoints and choose which entry to keep |
| `SSH Kit: Batch Delete Hosts` | Move selected hosts to the recycle bin |
| `SSH Kit: Open Recycle Bin` | Restore or permanently remove deleted hosts |
| `SSH Kit: Empty Recycle Bin` | Snapshot and permanently remove recycle-bin contents |
| `SSH Kit: Batch Change Host Key` | Change the associated key for selected hosts |
| `SSH Kit: Backup Data` | Export host data only, or explicitly include associated key files |
| `SSH Kit: Restore Data` | Restore a JSON backup by merging or replacing |
| `SSH Kit: Restore Internal Snapshot` | Restore a recent key-free catalog snapshot |

## Requirements

- VS Code `1.100.0` or newer.
- Microsoft Remote-SSH extension for Remote-SSH window connections.
- Local OpenSSH tools (`ssh`, `ssh-keygen`) for connectivity tests and key generation.
- GitHub Copilot Chat, or another VS Code chat provider that supports language model tools, for `#sshKitHosts`.

## Data and Security

SSH Kit stores hosts, groups, and deleted items in a versioned catalog under VS Code extension global storage. Preferences and per-window connection state are stored separately. Legacy `globalState` data is validated and migrated automatically on first activation, with the original value retained for rollback.

SSH Kit has three distinct protection layers:

- **SSH Config integration backup:** enabling, repairing, or removing the Include, and cleaning legacy aliases, requires saving a backup file for that operation. This does not configure a permanent backup directory; everyday host changes do not touch the main config.
- **Internal catalog snapshots:** destructive catalog operations create key-free snapshots and retain the latest 10.
- **SSH Kit JSON backup:** **Backup Data** can export host data only or include associated keys. A complete backup contains private key material; keep it encrypted or access-controlled and delete temporary copies after migration.

Runtime prompts and tree labels are localized for English and Simplified Chinese. Stored data carries a schema version and is validated/migrated when older extension data is loaded; malformed records, duplicate identifiers, and unsafe SSH Config values are rejected before restore.

The Copilot/language-model tool is read-only and does not expose private key contents. When the enabled tool is invoked manually or by Agent mode, the matching page of host metadata is included in that chat request so Copilot can answer with the right SSH context. Review VS Code's tool approval settings if host inventory is sensitive.

See the [security policy](SECURITY.md) before reporting a vulnerability or sharing diagnostics that may contain host or key information.

## Development

Source code is available on GitHub:

```bash
git clone https://github.com/Beautiful-blue-sky/vscode-ssh-kit.git
cd vscode-ssh-kit
pnpm install
pnpm run preflight
```

## License

[MIT](LICENSE)
