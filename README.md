# SSH Kit

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/lixiaoyu.ssh-kit?label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=lixiaoyu.ssh-kit)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/lixiaoyu.ssh-kit?label=Installs)](https://marketplace.visualstudio.com/items?itemName=lixiaoyu.ssh-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A VS Code extension providing a host management panel with grouping, key management, and quick-connect shortcuts for [Remote-SSH](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-ssh). Data stays compatible with `~/.ssh/config` via import/export.

[![zh-CN](https://img.shields.io/badge/README-中文-red)](README.zh-CN.md)

---

## Features

- Group SSH hosts into folders with drag-and-drop
- Connect via Remote-SSH (current or new window) or external terminal
- Scan `~/.ssh/` for private keys, display type and fingerprint
- Generate ed25519, RSA, or ECDSA key pairs
- Import from and export to `~/.ssh/config` (supports `Include` directives)
- Test connectivity via `ssh -o ConnectTimeout=5 -o BatchMode=yes`
- Search hosts by name, address, or tag
- Backup and restore host data with key files

## Getting Started

### Build from Source

```bash
git clone https://github.com/Beautiful-blue-sky/vscode-ssh-kit.git
cd vscode-ssh-kit
pnpm install
pnpm run compile
```

Press `F5` in VS Code to launch the Extension Development Host.

## Usage

The extension adds an **SSH Kit** view container to the Activity Bar with two panels.

### Hosts

| Action | How |
|---|---|
| Add a host | Click `+` in the view title or right-click |
| Connect | Inline buttons on each host entry (current window, new window, external terminal) |
| Edit / delete | Right-click a host |
| Test connectivity | Right-click → *Test Connection* |
| Search | Command Palette → `SSH Kit: Search Hosts` |
| Import / export | View title buttons |

### Keys

The Keys panel lists private keys found in `~/.ssh/`. Expand a key entry to inspect its type, fingerprint, and file paths. Click a file path to open it in the editor. Use the inline copy button to copy the public key.

## Commands

Available from the Command Palette (`Ctrl+Shift+P`):

| Command | Description |
|---|---|
| `SSH Kit: Add Host` | Prompt for host details |
| `SSH Kit: Search Hosts` | Fuzzy-search and connect |
| `SSH Kit: Import from SSH Config` | Parse `~/.ssh/config` into managed hosts |
| `SSH Kit: Export to SSH Config` | Merge managed hosts into `~/.ssh/config` |
| `SSH Kit: Generate SSH Key` | Generate a new key pair |
| `SSH Kit: Backup Data` | Export host data and keys to a JSON file |
| `SSH Kit: Restore Data` | Restore from a previously created backup |

## Development

```bash
pnpm install       # Install dependencies
pnpm run compile   # Type-check (tsc --noEmit) and bundle (esbuild)
pnpm run watch     # Watch mode
pnpm run lint      # ESLint
pnpm run package   # Production bundle for VS Code prepublish
pnpm run vsix      # Create a .vsix package for distribution
```

Built with TypeScript and esbuild. Zero runtime dependencies. Host data is persisted in VS Code `globalState`. Use **Backup Data** / **Restore Data** to migrate between machines.

## License

[MIT](LICENSE)
