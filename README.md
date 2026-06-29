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

## Quick Start

1. Install **SSH Kit** from the VS Code Marketplace.
2. Open the **SSH Kit** activity bar view.
3. Add a host manually, or choose **Import from SSH Config**.
4. Use the inline buttons on a host to connect with Remote-SSH or an external terminal.
5. Expand hosts and keys to copy details directly from the tree.

## Main Features

### Host Management

- Folders for grouping SSH hosts.
- Drag-and-drop hosts between folders.
- Recently connected hosts at the top of the list.
- Search by host name, address, or tag.
- Batch delete and endpoint-based duplicate cleanup.

### Remote-SSH Connections

- Open the selected host in a current or new empty Remote-SSH window.
- Keep the native Remote-SSH status label readable by using the Host alias directly.
- Show the active SSH Kit connection per VS Code window in the host tree and status bar; hover the SSH Kit status item to select and copy name, endpoint, user, group, key, and tag details.
- Use generated SSH Kit connection aliases without polluting imported host data.
- Open a regular SSH shell in the VS Code terminal or a native external terminal. In Remote-SSH windows, SSH Kit can open a local VS Code terminal so local SSH config and local key files still work.

### SSH Config Import and Export

- Import from `~/.ssh/config`, including `Include` directives.
- Preview import changes before writing them into SSH Kit.
- Match existing hosts by name first, then by SSH endpoint.
- Preserve repeated directives such as `LocalForward` and `SendEnv`.
- Write managed hosts back to SSH Config with a backup of the original file, updating existing SSH Kit blocks by Host alias or by the same `HostName` / `Port` / `User` endpoint.

### Key Management

- Scan private keys from `~/.ssh/`.
- Display key type and fingerprint.
- Generate ed25519, RSA, or ECDSA key pairs.
- Copy public keys from the tree.
- Regenerate missing public key files from private keys.

### Backup and Restore

- Export host data and associated key files to JSON.
- Preview restore targets before writing key files.
- Skip existing hosts and existing key files instead of overwriting them.
- Show failed key restore details when a backup contains invalid key data.

## Command Palette

Available from `Ctrl+Shift+P`:

| Command | Description |
|---|---|
| `SSH Kit: Add Host` | Add a host with guided input |
| `SSH Kit: Add Group` | Create a host group |
| `SSH Kit: Refresh` | Refresh host and key views |
| `SSH Kit: Search Hosts` | Search hosts and connect |
| `SSH Kit: Import from SSH Config` | Import hosts from `~/.ssh/config` |
| `SSH Kit: Write to SSH Config` | Merge managed hosts into `~/.ssh/config` |
| `SSH Kit: Open SSH Config` | Open the SSH Config file |
| `SSH Kit: Clean SSH Kit Connection Aliases` | Remove stale SSH Kit Remote-SSH aliases |
| `SSH Kit: List SSH Keys` | Browse scanned SSH keys |
| `SSH Kit: Generate SSH Key` | Generate a new key pair |
| `SSH Kit: Regenerate Public Key` | Recreate a `.pub` file from a private key |
| `SSH Kit: Remove Duplicate Hosts` | Find duplicate endpoints and choose which entry to keep |
| `SSH Kit: Batch Delete Hosts` | Delete selected hosts in one flow |
| `SSH Kit: Backup Data` | Export host data and associated key files |
| `SSH Kit: Restore Data` | Restore from a previous backup |

## Requirements

- VS Code `1.100.0` or newer.
- Microsoft Remote-SSH extension for Remote-SSH window connections.
- Local OpenSSH tools (`ssh`, `ssh-keygen`) for connectivity tests and key generation.

## Data and Security

SSH Kit stores host metadata in VS Code `globalState`. Backup files may include private key material when hosts reference local keys, so keep backups in a trusted location and delete temporary copies after migration.

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
