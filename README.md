# SSH Kit

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/lixiaoyu.ssh-kit?label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=lixiaoyu.ssh-kit)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/lixiaoyu.ssh-kit?label=Installs)](https://marketplace.visualstudio.com/items?itemName=lixiaoyu.ssh-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

SSH Kit is a focused SSH host manager for VS Code. It gives you one place to organize servers, reuse SSH keys, import or write `~/.ssh/config`, and open Remote-SSH sessions without hunting through host aliases.

[中文文档](README.zh-CN.md)

## Why Use It

- Keep SSH hosts grouped by project, environment, or team.
- Open a host through Remote-SSH in the current window, a new empty window, or an external terminal.
- See the current SSH Kit Remote-SSH connection in the status bar, with host details available from the tooltip.
- Import existing SSH Config entries and preview what will be added, updated, or skipped.
- Expand any host to copy its address, port, username, or key path.
- Manage local SSH keys, copy public keys, and regenerate missing `.pub` files.
- Back up and restore SSH Kit data, including associated key files when needed.
- Let Copilot and other VS Code language model tools read host metadata when you ask for SSH context.

## Quick Start

1. Install **SSH Kit** from the VS Code Marketplace.
2. Open the **SSH Kit** activity bar view.
3. Add a host manually, or choose **Import from SSH Config**.
4. Use the inline buttons on a host to connect with Remote-SSH or an external terminal.
5. Expand hosts and keys to copy details directly from the tree.
6. Use **Write to SSH Config** only when you want SSH Kit to become the source of truth for matching Host blocks.
7. In Copilot Chat, mention `#sshKitHosts` when you want Copilot to use your SSH Kit host list.

## Main Features

### Host Management

- Folders for grouping SSH hosts.
- Drag-and-drop hosts between folders.
- Recently connected hosts at the top of the list.
- Search by host name, address, or tag.
- Batch delete and endpoint-based duplicate cleanup.
- Batch change the associated key path for selected hosts, including clearing the key or entering a custom path.
- Right-click a host to change only that host's associated key.

### Remote-SSH Connections

- Open the selected host in a current or new empty Remote-SSH window.
- Keep the native Remote-SSH status label readable by using the Host alias directly.
- Show the active SSH Kit connection per VS Code window in the host tree and status bar; hover to view name, endpoint, user, group, key, and tag details, or click the status item to copy the full details.
- Keep new-window connection context separate from the source window, so opening several Remote-SSH windows does not overwrite the current window marker.
- Use generated SSH Kit connection aliases without polluting imported host data.
- Refresh SSH Kit-managed Remote-SSH Host blocks before connecting, so restored or edited key paths are used without manually writing SSH Config.
- Open a regular SSH shell in the VS Code terminal or a native external terminal. In Remote-SSH windows, SSH Kit can open a local VS Code terminal so local SSH config and local key files still work.

### SSH Config Import and Export

- Import from `~/.ssh/config`, including `Include` directives.
- Preview import changes before writing them into SSH Kit, including added, updated, skipped, and ambiguous entries.
- Match existing hosts by name first, then by SSH endpoint, so repeated imports update existing records instead of creating obvious duplicates.
- Ignore SSH Kit generated Remote-SSH connection alias blocks during import.
- Preserve repeated directives such as `LocalForward` and `SendEnv`.
- Preview write-back impact before modifying `~/.ssh/config`.
- Before writing an existing SSH Config file, choose where to save a backup copy. Canceling the backup cancels the write.
- Treat SSH Kit as the source of truth when writing: same Host aliases or same `HostName` / `Port` targets are replaced by current SSH Kit entries, unmanaged matches require explicit takeover confirmation, and generated SSH Kit connection aliases are removed.

### Key Management

- Scan private keys from `~/.ssh/`.
- Display key type and fingerprint.
- Generate ed25519, RSA, or ECDSA key pairs.
- Copy public keys from the tree.
- Regenerate missing public key files from private keys.

### SSH Kit Data Backup and Restore

- Export SSH Kit groups, hosts, recent connection data, and associated key files to JSON.
- Backup files can include private key contents when hosts reference local keys. SSH Kit shows a warning before creating this kind of backup.
- Preview restore targets before writing key files back to `~/.ssh/`.
- Reuse matching SSH keys by public-key identity even when the local file has a different name, and prompt before handling same-name key conflicts.
- Rewrite restored host key paths to the local key that was written, renamed, or reused; skipped or failed keys leave the imported host without a key association instead of keeping source-machine paths.
- Show failed key restore details when a backup contains invalid key data.
- Use batch key changes after restore to fix migrated or renamed key paths without editing hosts one by one.

### AI and Copilot Access

SSH Kit contributes a read-only VS Code language model tool named `sshKitHosts`. It lets Copilot Chat and other VS Code chat providers that support language model tools use your SSH Kit host metadata when you explicitly ask for it.

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

What the tool can return:

- Host display name
- HostName / IP address
- Port and login user
- Group and tags
- Whether an identity file is associated

What the tool does not return by default:

- Private key contents
- Identity file paths

If key file paths are needed, Copilot can request them through the tool input. SSH Kit will ask for confirmation before sharing paths, and private key contents are never returned.

## Command Palette

Available from `Ctrl+Shift+P`:

| Command | Description |
|---|---|
| `SSH Kit: Add Host` | Add a host with guided input |
| `SSH Kit: Add Group` | Create a host group |
| `SSH Kit: Refresh` | Refresh host and key views |
| `SSH Kit: Search Hosts` | Search hosts and connect |
| `SSH Kit: Import from SSH Config` | Import hosts from `~/.ssh/config` with a preview |
| `SSH Kit: Write to SSH Config` | Write SSH Kit hosts to `~/.ssh/config` after preview and explicit backup |
| `SSH Kit: Open SSH Config` | Open the SSH Config file |
| `SSH Kit: Clean SSH Kit Connection Aliases` | Remove stale SSH Kit Remote-SSH aliases |
| `SSH Kit: List SSH Keys` | Browse scanned SSH keys |
| `SSH Kit: Generate SSH Key` | Generate a new key pair |
| `SSH Kit: Regenerate Public Key` | Recreate a `.pub` file from a private key |
| `SSH Kit: Remove Duplicate Hosts` | Find duplicate endpoints and choose which entry to keep |
| `SSH Kit: Batch Delete Hosts` | Delete selected hosts in one flow |
| `SSH Kit: Batch Change Host Key` | Change the associated key for selected hosts |
| `SSH Kit: Backup Data` | Export SSH Kit data and associated key files to JSON |
| `SSH Kit: Restore Data` | Restore SSH Kit data from a previous JSON backup |

## Requirements

- VS Code `1.100.0` or newer.
- Microsoft Remote-SSH extension for Remote-SSH window connections.
- Local OpenSSH tools (`ssh`, `ssh-keygen`) for connectivity tests and key generation.
- GitHub Copilot Chat, or another VS Code chat provider that supports language model tools, for `#sshKitHosts`.

## Data and Security

SSH Kit stores host metadata in VS Code `globalState`.

There are two different backup flows:

- **SSH Config write-back backup:** when writing to `~/.ssh/config`, SSH Kit asks you to choose where to save a copy of the current SSH Config file before it writes changes. This backs up the config text only.
- **SSH Kit data backup:** the **Backup Data** command exports SSH Kit data to JSON and may include private key contents when hosts reference local keys. Keep these backups in a trusted location and delete temporary copies after migration.

The Copilot/language-model tool is read-only and does not expose private key contents. When you reference `#sshKitHosts`, selected host metadata is included in that chat request so Copilot can answer with the right SSH context.

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
