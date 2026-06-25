# Changelog

[![zh-CN](https://img.shields.io/badge/CHANGELOG-中文-red)](CHANGELOG.zh-CN.md)

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
