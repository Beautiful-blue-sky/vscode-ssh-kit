# Changelog

[![zh-CN](https://img.shields.io/badge/CHANGELOG-中文-red)](CHANGELOG.zh-CN.md)

## 0.0.3 — 2026-06-26

### Fixed
- Use SCP-safe Remote-SSH aliases without colons so VS Code can upload the remote server archive after the initial SSH connection succeeds.
- Open Remote-SSH through the native Remote-SSH command host argument so aliases such as `nginx+redis+safeline` stay readable without `%2B` escaping or `+` truncation.
- Prefer the native Host alias for Remote-SSH display, adding endpoint details only when names would collide.
- Declare the extension as a UI extension so it can keep using local SSH config and key files from local and remote windows.
- Show the current SSH Kit connection in the host tree and status bar, with a selectable plain-text status tooltip for connection details.
- Activate after VS Code startup so the current SSH Kit connection status appears without opening the SSH Kit view first.
- Route terminal SSH connections from Remote-SSH windows to a local VS Code terminal when requested, keeping local key paths usable.
- Remove invalid generated view focus command references from the command palette menu contribution.

## 0.0.2 — 2026-06-25

### Changed
- Reworked the Marketplace README for end users with a clearer quick start, feature overview, requirements, and security notes.
- Moved development instructions to the bottom so the extension listing opens with user-facing content.

## 0.0.1 — 2026-06-25

### Added
- Host management with grouping, tagging, and drag-and-drop
- Connect via Remote-SSH (current window, new window) or external terminal
- SSH key scanning, generation (ed25519 / RSA / ECDSA), and fingerprint display
- Import from and export to `~/.ssh/config` with `Include` directive support
- SSH Config import preview with name and endpoint matching, repeated directive preservation, and SSH Kit alias filtering
- Connectivity testing via `ssh -o ConnectTimeout=5 -o BatchMode=yes`
- Search hosts by name, address, or tag (QuickPick fuzzy match)
- Recent connections virtual group
- Group collapse state persistence
- Batch delete and endpoint-based deduplication with an explicit keep choice
- Data backup and restore with key file export, key target preview, and failed key restore details
- Host detail copy rows, key detail copy rows, stale Remote-SSH alias cleanup, and public key regeneration
- Internationalization support (English / Chinese)
