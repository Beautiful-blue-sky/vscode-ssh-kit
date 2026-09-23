# 更新日志 / Changelog

最新版本在本页提供中文和 English。更早版本的完整中文记录请查看
[中文更新日志](CHANGELOG.zh-CN.md)。

## 0.1.4 — 2026-09-23

### 中文

#### 修复
- 窗口重新获得焦点时不再无条件重建主机树，仅当主机数据确实在别处变化后才刷新。修复第一次连接后快速再次点击连接类按钮时报 `Cannot read properties of undefined (reading 'id')` 的问题：重复点击现在可直接正常响应。
- 主机命令因树刷新瞬间或快捷键调用而未携带目标主机时，会等待界面稳定并尝试从当前选中项恢复。

#### 调整
- 无法确定目标主机时改为状态栏提示“请先在 SSH Kit 主机列表中选择一台主机。”，不再弹出容易误解的主机选择框。

#### 验证
- 通过类型检查、ESLint、生产构建、38 项运行时行为检查、479 条中英文运行时文案检查，以及 50 个命令和 13 个 VSIX 文件的发布清单校验。

### English

#### Fixed
- Stop rebuilding the host tree on every window focus; the tree now refreshes only when host data actually changed elsewhere. Rapidly clicking a connect action again right after a connection no longer fails with `Cannot read properties of undefined (reading 'id')` — repeat clicks respond normally.
- When a host command runs without its target host (tree rebuild race or keyboard shortcut), wait for the UI to settle and try to recover it from the current selection.

#### Changed
- When the target host still cannot be determined, show a brief status bar hint instead of a confusing host picker.

#### Validation
- Pass type checking, ESLint, production build, 38 runtime behavior checks, 479 English/Chinese runtime message checks, and release-surface validation for 50 commands and 13 VSIX files.

## 0.1.3 — 2026-09-23

### 中文

#### 修复
- 通过自定义快捷键或编程方式无参数调用主机命令（在终端连接、当前/新窗口打开、编辑、删除、复制地址、测试连通性）时，扩展不再报 `Cannot read properties of undefined (reading 'id')`，改为弹出主机选择框继续操作。

#### 调整
- 常规操作反馈不再在右下角堆积：主机、分组、密钥、导入导出、备份恢复等应用内操作的成功提示改为状态栏短暂显示并自动消失。
- 外部终端“正在连接”、VS Code 终端“已打开”、连通性测试“可达”等连接反馈保留右下角通知形式，但数秒后自动关闭，不再常驻。
- 连通性测试成功提示移除多余的“确定”按钮。

#### 验证
- 通过类型检查、ESLint、生产构建、38 项运行时行为检查、478 条中英文运行时文案检查，以及 50 个命令和 13 个 VSIX 文件的发布清单校验。

### English

#### Fixed
- Host commands invoked without a host selection — for example from custom keyboard shortcuts or programmatic calls — no longer fail with `Cannot read properties of undefined (reading 'id')`. SSH Kit now shows a host picker so the action can continue.

#### Changed
- Routine success feedback for in-app operations (host, group, key, import/export, backup, and maintenance actions) now appears as a brief status bar message that disappears on its own instead of piling up as notifications.
- Connection feedback — connecting in an external terminal, opened terminals, and reachable connectivity test results — still appears as a bottom-right notification, but it now dismisses itself after a few seconds.
- Remove the redundant OK button from the connectivity test success message.

#### Validation
- Pass type checking, ESLint, production build, 38 runtime behavior checks, 478 English/Chinese runtime message checks, and release-surface validation for 50 commands and 13 VSIX files.

## 0.1.2 — 2026-08-17

### 中文

#### 新增
- 升级后会检测旧版本修改昵称时遗留的 SSH Host alias，逐项预览旧值与建议值；用户确认后先创建内部快照，再一次性更新 Catalog 和托管配置。暂不处理时可从“管理 Remote-SSH 连接配置”重新进入。

#### 调整
- 修改主机昵称会同步重命名托管 Host alias；地址、端口、用户、认证方式等连接字段变化时保持 alias 稳定。编辑、删除、复制、测试和连接前均按主机 ID 读取最新 Catalog 记录。
- 窗口重新获得焦点时刷新共享主机与密钥数据；Catalog 变化会同步刷新主机树、当前连接状态和已启用的托管配置。
- Remote-SSH 连接配置改为单一管理入口，仅展示当前适用的准备、修复、配置文件、旧昵称检查、移除和旧版连接别名清理操作。
- 主机视图标题栏保留高频操作，重复主机、批量删除、回收站、批量密钥和备份恢复收进“主机数据维护”菜单。
- 托管 `hosts.conf` 内容未变化时跳过重复写盘；同名主机 alias 的自动后缀改为更简洁的单下划线形式。

#### 修复
- 主机新增、编辑、SSH Config 导入、密钥关联、删除/恢复、备份恢复和内部快照恢复后，托管配置会同步最新的 HostName、端口、用户、认证方式、密钥路径及自定义指令。
- 切换认证方式，以及恢复时跳过或无法写入密钥后，会移除 `IdentityFile`、`IdentitiesOnly`、`PreferredAuthentications` 等过期认证指令，同时保留无关 SSH 设置。
- 避免其他窗口中未刷新的树节点继续使用旧主机信息；旧昵称 alias 修复会保护合法的标准化名称、同名后缀、历史地址后缀和 ID 兜底 alias，并拒绝应用未经重新预览的并发变化。

#### 验证
- 通过类型检查、ESLint、生产构建、38 项运行时行为检查、479 条中英文运行时文案检查，以及 50 个命令和 13 个 VSIX 文件的发布清单校验。

### English

#### Added
- Detect SSH Host aliases left behind by nickname edits in older versions and show an old-to-suggested preview. After confirmation, create an internal snapshot and update the catalog and managed config in one transaction. Dismissed reviews remain available under **Manage Remote-SSH Integration**.

#### Changed
- Rename the managed Host alias when a host nickname changes, while keeping it stable for address, port, user, and authentication edits. Resolve the latest catalog record by host ID before edit, delete, copy, test, or connection actions.
- Refresh shared host and key data when a window regains focus. Catalog changes also refresh the host tree, current connection state, and enabled managed config.
- Consolidate Remote-SSH configuration into one manager that only shows applicable setup, repair, file, renamed-alias review, removal, and legacy connection-alias cleanup actions.
- Keep frequent actions in the host view title and move deduplication, batch deletion, recycle-bin, batch-key, backup, and restore operations into **Host Data Maintenance**.
- Skip rewriting managed `hosts.conf` when its generated content is unchanged, and use cleaner single-underscore suffixes for generated duplicate-name aliases.

#### Fixed
- Keep HostName, port, user, authentication mode, identity path, and custom directives synchronized after host creation and edits, SSH Config import, key association, deletion or restore, backup restore, and internal snapshot restore.
- Remove stale `IdentityFile`, `IdentitiesOnly`, and `PreferredAuthentications` directives after authentication changes or skipped/failed key restoration while preserving unrelated SSH settings.
- Prevent stale tree items in other windows from reusing outdated host data. Legacy nickname-alias repair preserves valid sanitized names, duplicate suffixes, historical endpoint suffixes, and ID fallbacks, and rejects concurrent changes that were not previewed.

#### Validation
- Pass type checking, ESLint, production build, 38 runtime behavior checks, 479 English/Chinese runtime message checks, and release-surface validation for 50 commands and 13 VSIX files.

## 0.1.1 — 2026-07-29

### 中文

#### 调整
- Marketplace 主更新日志改为最新版本中文在前、英文在后，并移除正式包中的空“未发布”章节。
- 单主机认证设置统一到“编辑主机 → 认证方式”，移除功能重叠且不支持“仅密码”的“修改此主机关联密钥”右键入口；批量修改关联密钥保持不变。

#### 验证
- 发布前检查会拒绝空的“未发布 / Unreleased”章节，并要求当前版本包含有正文的中文和 English 区块。
- 命令声明、菜单引用、运行时注册、中英文文案和批量密钥回归检查保持一致。

### English

#### Changed
- Make the latest Marketplace changelog entry bilingual with Chinese first and English second, and remove empty Unreleased headings from release packages.
- Consolidate single-host authentication under **Edit Host → Authentication**. Remove the overlapping **Change This Host Key** context action, which did not support password-only mode, while retaining batch key changes.

#### Validation
- Make preflight reject empty Unreleased headings and require non-empty Chinese and English sections for the packaged version.
- Keep command declarations, menu references, runtime registrations, localized strings, and batch key regression coverage aligned.

## 0.1.0 — 2026-07-29

### 中文

#### 新增
- 每台主机可明确选择 OpenSSH 自动、指定一个认证文件或仅密码三种认证方式。
- 主机展开详情、当前连接详情、备份数据和只读语言模型主机元数据会显示认证方式。
- 将主机、分组和回收站迁移到带修订号、进程间写锁、原子写入及损坏回退的独立 Catalog；旧版 `globalState` 数据首次启动时自动迁移并保留回滚副本。
- 新增主机回收站、最近 10 份无私钥内部快照，以及内部快照恢复命令。
- 新增 Remote-SSH 托管配置的启用、状态检查、修复、移除和打开命令。
- 数据恢复可明确选择合并或替换；替换前自动创建内部快照。

#### 调整
- 指定密钥时使用 `IdentitiesOnly=yes`；仅密码连接会在 Remote-SSH 和各类终端入口中明确禁用公钥认证。
- SSH Kit 以独立 Catalog 为主数据源，日常主机变更只重建 `~/.ssh/ssh-kit/hosts.conf`；主配置只在显式备份后加入一条受标记的 Include。
- 原“写入到 SSH Config”改为导出到用户选择的独立文件，并拒绝覆盖当前生效配置。
- SSH Config 导入会跳过 SSH Kit 自己生成的托管文件，并警告可执行命令的高风险指令。
- 旧版连接别名仅在用户查看数量、确认并选择备份位置后清理，不会在升级时静默删除。
- 旧版本会拒绝恢复由更新数据格式创建的备份，避免未知字段被静默丢弃。
- 用户确认 SSH Config 导入后，所有主机改动通过一次 Catalog 事务提交，不再逐台重复写存储和托管配置。
- 主机视图不再展示 Remote-SSH 连接配置维护菜单；连接时按需准备或修复，高级维护命令仅保留在命令面板。
- 首次准备托管连接配置时明确解释备份原因，并准确说明哪些目录操作会创建内部快照。

#### 修复
- 主机使用持久化且唯一的 Remote-SSH Host alias；修改地址、端口、用户、密钥或认证方式后仍更新同一托管 Host 块。
- Windows 上生成托管配置时不再套用 Unix `0600` 模式，避免 OpenSSH 因 ACL/所有者检查拒绝读取。
- Catalog 主文件损坏时从上一份有效文件恢复，并避免损坏文件覆盖回退副本。
- Catalog 目录不可用或迁移失败时继续使用旧数据，并保护更高版本 Catalog 不被降级覆盖。
- 连接配置状态会识别位置过晚、可能被其他 SSH 指令覆盖的 Include；修复时在备份后将其规范到生效位置。
- 支持标准 `关键字=值` 语法和行尾注释；单值指令按 OpenSSH 规则使用第一项。
- 另一个 VS Code 窗口已修改 Catalog 时，拒绝使用过期数据执行替换恢复或内部快照恢复。
- SSH Config 备份可直接保存到已存在的磁盘根目录，不再尝试重新创建盘符目录；误选文件夹或复制失败时会明确提示。
- 没有内部快照时，恢复命令会显示原因说明，不再表现为点击后无反应。
- 在本机终端连接时按实际的 PowerShell、cmd.exe 或 POSIX shell 转义 SSH 参数，并拒绝 cmd.exe 无法安全表达的字段值。

### English

#### Added
- Add explicit per-host authentication modes for OpenSSH automatic behavior, one specified identity file, or password-only login.
- Include the authentication mode in expanded host details, current-connection details, backups, and read-only language model host metadata.
- Move hosts, groups, and deleted items into an independent revisioned catalog with a cross-process write lock, atomic writes, and corruption fallback. Legacy `globalState` data migrates automatically with a rollback copy.
- Add a host recycle bin, the latest 10 key-free internal snapshots, and an internal snapshot restore command.
- Add commands to enable, inspect, repair, remove, and open the managed Remote-SSH integration.
- Let backup restore explicitly merge or replace data, with an internal snapshot before replacement.

#### Changed
- Use `IdentitiesOnly=yes` for specified keys and disable public-key authentication for password-only connections across Remote-SSH and terminal launchers.
- Treat the independent catalog as the source of truth. Everyday host changes rebuild only `~/.ssh/ssh-kit/hosts.conf`; the main config receives one marked Include only after an explicit backup.
- Change the former SSH Config write command into a standalone export that refuses to overwrite the active config.
- Skip SSH Kit's generated managed file during import and warn about command-capable SSH directives.
- Clean legacy connection aliases only after showing their count, receiving confirmation, and saving a user-selected backup.
- Refuse backups created by a newer data format instead of silently dropping unknown fields.
- Commit a confirmed SSH Config import in one catalog transaction instead of rewriting storage and the managed projection once per host.
- Remove Remote-SSH integration maintenance actions from the host view menu. Connection attempts prepare or repair the managed configuration when needed; advanced maintenance remains available in the Command Palette.
- Explain why the active SSH Config needs a one-time backup before managed setup, and clarify exactly which catalog operations create internal snapshots.

#### Fixed
- Persist one stable, unique Remote-SSH Host alias per host, updating the same managed Host block after connection details change.
- Avoid applying Unix `0600` mode to generated config files on Windows, which could make OpenSSH reject their ACL or owner.
- Recover a corrupt primary catalog from the previous valid copy without overwriting that fallback with corrupt data.
- Keep using legacy data when the catalog directory or migration is unavailable, and protect newer catalogs from downgrade writes.
- Detect an Include placed too late to override earlier SSH directives, and normalize it to an effective position after an explicit backup.
- Parse standard `Keyword=value` syntax and trailing comments, and use the first value for single-valued directives to match OpenSSH behavior.
- Reject stale replace and internal-snapshot restores when another VS Code window has already changed the catalog.
- Save SSH Config backups directly under an existing drive root without trying to recreate the drive directory, and report folder selections or copy failures clearly.
- Show an explanatory dialog when the internal snapshot restore command has no snapshots instead of appearing to do nothing.
- Quote local-terminal SSH arguments for the actual PowerShell, cmd.exe, or POSIX shell, and reject values that cmd.exe cannot represent safely.

## 0.0.13 — 2026-07-21

### Changed
- Make the `sshKitHosts` language model tool use the same multi-term matching as the host tree, add paged results, and shorten responses to fit the active model token budget.
- Clarify when Agent mode can invoke the tool, what metadata it can read, and how VS Code approval settings affect host inventory sharing.
- Localize language model invocation and key-path confirmation messages, including the requested query and page scope.
- Accept IPv6 and common enterprise usernames in host input, and format IPv6 endpoints consistently across the tree, previews, status details, and AI results.
- Scan only recognized OpenSSH or PEM private keys, and keep host identity-file associations synchronized when a key is renamed or deleted.
- Share one SSH Config tokenizer and formatter across import, write-back, and generated Remote-SSH aliases, including quoted paths containing spaces.
- Override vulnerable transitive development dependencies with patched releases.

### Fixed
- Format IPv6 endpoints unambiguously in language model results.
- Fall back to port 22 when an imported SSH Config port is invalid or outside the valid range.
- Reject duplicate backup identifiers and unsafe line-break, null-character, or directive-name values before they can reach SSH Config output.
- Prevent orphan public-key files and partial key restore/rename operations from silently overwriting or desynchronizing key pairs.

## 0.0.12 — 2026-07-16

### Added
- Add persistent host sorting by natural name, reverse name, address, or recent connection activity; filtering keeps the selected order.
- Add manual group ordering through hover up/down actions, target-position drag-and-drop, and folder context actions for moving to the top or bottom.
- Add a one-click action to arrange every real host group in natural name order.

### Changed
- Normalize stored group order during data migration and include host sort preferences in backup and restore validation.
- Preserve the relative order of newly restored groups when merging backup data, and pause group reordering while a host filter hides part of the tree.

### Fixed
- Hide edit and reorder actions from the virtual Recent Connections group.
- Avoid writes and tree refreshes when hosts are dropped back into their current group.

## 0.0.11 — 2026-07-15

### Changed
- Add direct actions in expanded key details to open private and public key files while preserving path-copy actions.
- Add an in-place host-tree filter for alias, HostName/IP, user, port, group, and tags, with multi-term matching and a clear action.
- Let data backups explicitly choose host data only or a complete backup with associated keys; protect created backups with `0600` permissions on POSIX systems.
- Localize all runtime prompts, errors, tree labels, and status details for English and Simplified Chinese, with localization coverage checked during preflight.
- Add versioned validation and migration for stored SSH Kit data and reject malformed backup records before restore.
- Extract connection-status lifecycle logic from the extension entry point to keep activation and command registration focused.

### Fixed
- Activate SSH Kit in every restored VS Code window and resolve both plain and hex-encoded Remote-SSH authorities, keeping status and connected-host markers visible after restart or opening a remote folder.
- Stop SSH Config `Match` directives from contaminating the preceding Host during import, and skip wildcard or negated Host patterns instead of creating unusable host records.
- Use `StrictHostKeyChecking=accept-new` for connectivity tests so changed host fingerprints are not silently accepted.

## 0.0.10 — 2026-07-14

### Changed
- Clarify README instructions for using SSH Kit from Copilot Chat with `#sshKitHosts`, including example prompts, requirements, and privacy behavior.
- Clarify the difference between SSH Config write-back backups and SSH Kit data backups.
- Mark the language model tool as prompt-referenceable in the extension manifest with a user-facing description and icon.
- Include the Host nickname in expanded host details so it can be copied directly.

### Fixed
- Restore SSH Kit status bar and connected-host indicators when VS Code cold-starts and automatically restores one or more Remote-SSH windows.

## 0.0.9 — 2026-07-07

### Added
- Add a read-only VS Code language model tool, `sshKitHosts`, so Copilot and other language model clients can read SSH Kit host metadata without private key contents.

### Changed
- Ask the user to choose an explicit backup location before writing to `~/.ssh/config` instead of silently creating `config.bak.*` files beside the config.
- Treat SSH Kit as the source of truth when writing SSH Config: same Host aliases or same `HostName` / `Port` targets are replaced by current SSH Kit entries, and generated SSH Kit connection aliases are removed.

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
- Open Remote-SSH through the native Remote-SSH command host argument so aliases such as `web+cache+gateway` stay readable without `%2B` escaping or `+` truncation.
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
- Host management with grouping, tagging, and dragging hosts between groups
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
