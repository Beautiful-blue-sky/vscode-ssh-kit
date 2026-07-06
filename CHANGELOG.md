# Changelog

[![zh-CN](https://img.shields.io/badge/CHANGELOG-中文-red)](CHANGELOG.zh-CN.md)

## 0.0.8 — 2026-07-06

### Fixed
- Hide stale SSH Kit connection status in local or non-SSH windows instead of showing the previous Remote-SSH host from cached window state.

## 0.0.7 — 2026-07-03

### Fixed
- Keep the active SSH Kit connection visible after reusing the current window for Remote-SSH and after opening a folder in the connected remote window.
- Resolve Remote-SSH windows from their actual authority alias before falling back to pending connection context, preventing one remote window from showing another host as connected.

### Changed
- Make the SSH Kit status bar item clickable to copy full connection details, and document the hover-to-view / click-to-copy behavior.

## 0.0.6 — 2026-07-02

### Added
- Add a separate host context menu command for changing only the clicked host's associated key.

### Fixed
- Keep the batch host key command in multi-select mode even when VS Code passes the currently focused tree item to the view title command.

## 0.0.5 — 2026-07-02

### Added
- Add a Batch Change Host Key command from the host view title, host context menu, and Command Palette. It can update selected hosts to a scanned key, a custom key path, or no associated key.
- Add restore-time handling for same-name key conflicts, with automatic rename, custom rename, skip, or cancel choices.

### Fixed
- Rewrite restored host `IdentityFile` paths from source-machine absolute paths to the actual local key path after backup restore, whether the key was newly written, renamed, or reused.
- Reuse an existing local key with the same SSH public-key identity during restore, even if it has a different file name, instead of importing a duplicate key.
- Clear restored host key associations when the referenced key is skipped or fails to restore, so imported hosts do not keep unusable source-machine paths.
- Refresh SSH Kit-managed Remote-SSH Host blocks before connecting, so imported hosts do not keep using stale source-machine `IdentityFile` paths from SSH Config.
- Avoid overwriting the source window's current connection context when opening a Remote-SSH connection in a new window.
- Resolve current connection status from all SSH Kit generated alias candidates, so status bars keep working when a host needs an endpoint-qualified alias.

## 0.0.4 — 2026-06-29

### Fixed
- Keep the SSH Kit active connection marker scoped to each VS Code window, so opening a second Remote-SSH window no longer overwrites the first window's current host display.
- Update SSH Config export matching to replace existing SSH Kit managed blocks by Host alias or by the same `HostName` / `Port` / `User` endpoint, preventing duplicate managed Host blocks with different aliases.
- Preserve SSH Kit Remote-SSH connection alias blocks separately while exporting managed hosts back to SSH Config.

### Changed
- Document the per-window connection marker and same-endpoint SSH Config write-back behavior in the Marketplace README.
- Allow the required pnpm build scripts for the local release toolchain so preflight and VSIX packaging remain reproducible.

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
