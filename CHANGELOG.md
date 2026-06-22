# Changelog

## 0.0.1 — Unreleased

### Added
- Host management with grouping, tagging, and drag-and-drop
- Connect via Remote-SSH (current window, new window) or external terminal
- SSH key scanning, generation (ed25519 / RSA / ECDSA), and fingerprint display
- Import from and export to `~/.ssh/config` with `Include` directive support
- Connectivity testing via `ssh -o ConnectTimeout=5 -o BatchMode=yes`
- Search hosts by name, address, or tag (QuickPick fuzzy match)
- Recent connections virtual group
- Group collapse state persistence
- Batch delete and deduplication
- Data backup and restore with key file export
- Internationalization support (English / Chinese)
