# SSH Kit

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/lixiaoyu.ssh-kit?label=市场)](https://marketplace.visualstudio.com/items?itemName=lixiaoyu.ssh-kit)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/lixiaoyu.ssh-kit?label=安装量)](https://marketplace.visualstudio.com/items?itemName=lixiaoyu.ssh-kit)
[![许可: MIT](https://img.shields.io/badge/许可-MIT-blue.svg)](LICENSE)

SSH Kit 是一个面向 VS Code 的 SSH 主机管理插件。它把服务器分组、密钥管理、SSH Config 导入和 Remote-SSH 快捷连接放到一个侧边栏里，适合经常维护多台服务器的开发、运维和 DevOps 场景。

[English README](README.md)

## 为什么使用

- 按项目、环境或团队整理 SSH 主机。
- 通过 Remote-SSH 在当前窗口、新空窗口或外部终端连接服务器。
- 在状态栏查看当前 SSH Kit Remote-SSH 连接；悬停查看详情，点击即可复制。
- 从实际生效的 SSH Config 导入主机，并预览新增、更新、跳过、冲突及高风险指令。
- 展开主机后直接复制 Host 昵称、地址、端口、用户名、密钥路径等信息。
- 扫描本地 SSH 密钥，复制公钥，重新生成缺失的 `.pub` 文件。
- 通过回收站、内部快照和 JSON 备份恢复数据，必要时可包含已关联密钥文件。
- 当你需要 SSH 上下文时，可让 Copilot 或其他 VS Code 语言模型工具读取主机元数据。

## 快速开始

1. 从 VS Code Marketplace 安装 **SSH Kit**。
2. 打开活动栏里的 **SSH Kit** 视图。
3. 手动添加主机，或选择 **从 SSH Config 导入**。
4. 在主机行右侧使用内联按钮连接 Remote-SSH 或外部终端。
5. 展开主机和密钥节点，直接复制常用详情。
6. 首次使用 Remote-SSH 连接时，按提示保存一份本次 SSH Config 备份文件并启用托管 `Include`；之后主机修改只更新 SSH Kit 自己的配置文件。
7. 在 Copilot Chat 中需要 SSH 上下文时，可在提示词里引用 `#sshKitHosts`。

## 核心功能

### 主机管理

- 使用文件夹分组管理 SSH 主机。
- 分组行悬停时可一键上移或下移，也可将分组拖到目标位置；右键菜单的 **调整分组顺序** 还支持置顶和置底。
- 可通过一个命令按自然名称排列全部分组，整理后仍可继续手动调整。
- 支持拖拽主机到不同分组。
- 最近连接主机自动显示在列表顶部。
- 分组内主机可按自然名称、名称倒序、地址或最近连接排序；所选模式会跨重启保留，筛选列表时也继续生效。
- 按主机名、地址或标签搜索并连接。
- 可直接筛选主机树，支持 Host 昵称、IP / HostName、用户、端口、分组和标签；多个空格分隔的关键词会组合匹配，旁边的清除按钮可恢复完整列表。筛选隐藏部分分组时会暂停分组排序，避免发生不可见的位置跳动。
- 支持批量删除和按实际连接目标清理重复主机；删除的主机先进入回收站。
- 支持批量修改选中主机的关联密钥路径，也可以清空关联或输入自定义路径。
- 每台主机可明确选择“OpenSSH 自动”“指定认证文件”或“仅密码”三种认证方式。清空关联密钥会回到自动模式，并不等于强制密码登录。
- 支持 IPv4、IPv6 和域名，也支持 `DOMAIN\\user`、`user@example.com` 等常见企业登录名。

### Remote-SSH 连接

- 在当前窗口或新空窗口打开选中的 Remote-SSH 主机。
- Remote-SSH 左下角保持原生 Host alias 显示，名称更清晰。
- 主机列表和 SSH Kit 状态栏会按 VS Code 窗口标记当前连接；悬停状态栏可查看名称、连接地址、用户、分组、密钥和标签等详情，点击状态栏可复制完整信息。
- VS Code 重启并自动恢复 Remote-SSH 窗口，或从远程空窗口切换为打开文件夹后，会恢复各窗口对应的 SSH Kit 状态栏和主机已连接标记。
- 新窗口连接上下文与发起窗口隔离，短时间打开多个 Remote-SSH 窗口时不会覆盖当前窗口标记。
- 每台主机保存稳定、唯一的 Remote-SSH Host alias。编辑显示名称、地址、端口、用户或认证方式不会创建第二条主机记录。
- 连接前会重建 SSH Kit 托管的 `~/.ssh/ssh-kit/hosts.conf`，确保 Remote-SSH 使用最新连接参数。
- “仅密码”会明确禁用公钥认证；“指定认证文件”会使用 `IdentitiesOnly=yes`，避免继续尝试无关的默认密钥或 ssh-agent 密钥。
- 也可以在 VS Code 终端或系统外部终端打开常规 SSH 会话。在 Remote-SSH 窗口内，SSH Kit 可打开本机 VS Code 终端，继续使用本机 SSH Config 和本机密钥文件。

### SSH Config 导入与 Remote-SSH 连接配置

- 从 Remote-SSH 实际生效的配置文件导入主机；支持 `remote.SSH.configFile` 和递归解析 `Include` 指令。
- 只导入具体的 `Host` 别名；通配符、否定模式和条件 `Match` 段不会变成主机，`Match` 内指令也不会串入前一个 Host。全局默认项和 `Match` 规则不会作为继承值应用到导入主机。
- 导入前预览新增、更新、跳过和冲突项。
- 优先按 Host 名称匹配已有主机，再按 SSH 连接目标匹配，重复导入会更新已有记录，避免明显重复。
- 导入时会忽略 SSH Kit 自己生成的托管配置和旧版 Remote-SSH 连接别名块，避免循环导入。
- `ProxyCommand`、`LocalCommand`、`RemoteCommand`、`KnownHostsCommand` 等可执行命令的指令会在导入确认中单独警告。
- 保留 `LocalForward`、`SendEnv` 等可重复配置项。
- 同时支持空格分隔和 `关键字=值` 指令语法，忽略引号外的行尾注释，并按 OpenSSH 规则为单值指令采用第一项。
- 保留带引号的配置值和含空格的认证文件路径；导入到无效端口时会回退到 SSH 默认端口 `22`。用户确认后，整次导入通过一个 Catalog 事务提交。
- SSH Kit 的主机目录是唯一主数据源，并确定性生成 `~/.ssh/ssh-kit/hosts.conf`。
- 启用 Remote-SSH 连接配置时，只在主配置顶部加入受标记管理的 `Include ssh-kit/hosts.conf`。修改前必须由用户保存一份本次备份文件；取消备份不会改动主配置。
- 日常新增、编辑、删除和恢复主机只重建托管文件，不改写用户原有 Host、注释、`Include` / `Match`、全局指令或其他工具管理的内容。
- **导出主机为 SSH Config** 只写入用户选择的独立文件，拒绝替换当前生效的 SSH Config。
- 可查看连接配置状态、打开托管文件，或显式修复、移除连接配置。状态检查会识别 Include 是否位于其他 SSH 指令之前；修复会先备份，再将 Include 规范到生效位置。移除只删除受标记的 Include，保留 SSH Kit 数据和托管文件。
- 旧版遗留连接别名可在查看数量后显式备份并清理，不会在升级时静默删除。
- 连通性测试使用 OpenSSH `StrictHostKeyChecking=accept-new`：首次出现的主机指纹可自动接受，但指纹发生变化时仍会阻止连接。“仅密码”主机需要直接连接验证，因为连通性测试不会交互式输入密码。

### 密钥管理

- 自动扫描 `~/.ssh/` 下可识别的 OpenSSH 和 PEM 私钥，并忽略无关文件。
- 显示密钥类型和指纹。
- 生成 ed25519、RSA 或 ECDSA 密钥对。
- 在树视图中一键复制公钥。
- 展开密钥后可直接打开私钥或公钥文件内容，同时保留路径复制入口。
- 从私钥重新生成缺失的公钥文件。
- 重命名密钥对时，自动更新仍关联旧路径的主机。
- 删除已关联密钥前明确警告；确认删除后清除受影响主机的密钥关联。

### SSH Kit 数据备份与恢复

- 旧版本保存在 VS Code `globalState` 中的数据会在升级后自动迁移到独立主机目录，原数据保留为回滚副本，无需重新导入。目录暂时不可写或迁移失败时会继续使用旧数据，不会显示成空主机列表，并在后续启动时重试。
- 删除主机时先移入回收站；可恢复单台主机、永久删除或清空回收站，密钥文件不会随主机删除。
- 删除分组、将主机移入或移出回收站、永久删除或清空回收站、恢复 JSON 数据，以及恢复另一份快照时，都会创建不含私钥的内部快照。SSH Kit 保留最近 10 份，可通过主机视图菜单或命令面板恢复。
- 备份时可选择“仅主机数据”，或创建包含关联密钥文件的完整 JSON 备份。
- 完整备份包含私钥内容，创建前必须明确确认安全提示；在 POSIX 系统上会设置为仅文件所有者可读写的 `0600` 权限。
- 恢复前预览密钥文件写入 `~/.ssh/` 的目标。
- 会按 SSH 公钥身份复用同一把密钥，即使本机文件名不同；同名但不是同一把密钥时会在恢复前提示处理。
- 会把恢复主机的密钥路径改写为本机实际写入、改名或复用的密钥路径；跳过或恢复失败的密钥会清空关联，不保留源机器路径。
- 如果备份内包含无效密钥，会显示恢复失败详情。
- 恢复时明确选择“合并”或“替换”：合并跳过已有项，替换会先创建内部快照再还原所选备份。
- 旧版本不会导入由更新数据格式创建的备份，以免丢失未知字段；请先更新 SSH Kit 再恢复。
- 恢复后可用批量修改关联密钥修正迁移或重命名后的密钥路径，无需逐台编辑。

### AI 与 Copilot 接入

SSH Kit 提供只读的 VS Code 语言模型工具 `sshKitHosts`，让 Copilot Chat 或其他支持语言模型工具的 VS Code 聊天能力读取已保存的 SSH Kit 主机元数据。引用 `#sshKitHosts` 是最明确的调用方式；在 Agent 模式中启用该工具后，Copilot 也可能针对相关请求自动选择它，是否需要批准由 VS Code 的聊天工具设置控制。

在 Copilot Chat 中使用：

1. 在 VS Code 中安装并启用 **SSH Kit**。
2. 手动添加主机，或从 SSH Config 导入主机。
3. 打开 Copilot Chat。
4. 在提示词中使用 `#sshKitHosts` 引用这个工具。

示例：

```text
#sshKitHosts 找出 prod 相关主机，列出名称、连接地址、用户和分组。
```

```text
#sshKitHosts 搜索 nginx 相关主机，并建议我应该用 Remote-SSH 打开哪一台。
```

```text
#sshKitHosts 列出 10.0.1 相关主机，并带上标签。
```

如果看不到 `#sshKitHosts`，请更新 VS Code 和 Copilot Chat，然后重载 VS Code 窗口。该工具由 SSH Kit 插件声明，并在插件激活时注册。

该工具只读取 SSH Kit 保存的主机，不会建立连接、测试连通性、解析 SSH Config 文件或识别当前 Remote-SSH 窗口。以空格分隔的查询词会组合匹配 Host 昵称、地址、用户、端口、分组和标签。结果采用分页返回：默认每页最多 50 台，单次上限为 200 台；仍有结果时会返回 `nextOffset`。SSH Kit 还会根据当前模型的 token 预算进一步缩短单页结果。

工具可返回：

- 主机显示名称
- HostName / IP 地址
- 端口和登录用户
- 分组和标签
- 认证方式（`auto`、`identityFile` 或 `password`）
- 是否有关联密钥

默认不会返回：

- 私钥内容
- 认证文件路径

如果确实需要认证文件路径，Copilot 可以通过工具输入请求；SSH Kit 会在共享路径前显示查询条件、偏移量和数量上限供确认，并且始终不会返回私钥内容。

## 命令面板

以下命令可从 `Ctrl+Shift+P` 访问：

| 命令 | 说明 |
|---|---|
| `SSH Kit: 添加主机` | 交互式添加主机 |
| `SSH Kit: 添加分组` | 创建主机分组 |
| `SSH Kit: 刷新` | 刷新主机与密钥视图 |
| `SSH Kit: 搜索主机` | 搜索主机并连接 |
| `SSH Kit: 主机排序` | 按自然名称、名称倒序、地址或最近连接记录排列分组内主机 |
| `SSH Kit: 按名称排列分组` | 按自然名称顺序一次整理全部真实主机分组 |
| `SSH Kit: 筛选主机列表` | 按别名、地址、用户、端口、分组或标签筛选当前主机树 |
| `SSH Kit: 清除主机筛选` | 清除当前主机树筛选条件 |
| `SSH Kit: 从 SSH Config 导入` | 预览并从 `~/.ssh/config` 导入主机 |
| `SSH Kit: 导出主机为 SSH Config` | 将当前主机写入用户选择的独立配置文件，不替换生效配置 |
| `SSH Kit: 打开 SSH Config 文件` | 打开 SSH Config 文件 |
| `SSH Kit: 打开 SSH Kit 连接配置` | 打开自动生成的 `hosts.conf` |
| `SSH Kit: 查看 Remote-SSH 连接配置状态` | 显示 Include 是否生效、生效配置、托管文件和旧版别名数量 |
| `SSH Kit: 启用 Remote-SSH 连接配置` | 备份后在生效配置顶部加入托管 Include |
| `SSH Kit: 修复 Remote-SSH 连接配置` | 备份并将 Include 规范到其他 SSH 指令之前 |
| `SSH Kit: 移除 Remote-SSH 连接配置` | 备份并移除 Include，保留 SSH Kit 数据 |
| `SSH Kit: 清理旧版 SSH Kit 连接别名` | 预览数量、备份并删除旧版标记块 |
| `SSH Kit: 查看密钥列表` | 浏览已扫描到的 SSH 密钥 |
| `SSH Kit: 生成 SSH 密钥` | 生成新的密钥对 |
| `SSH Kit: 重新生成公钥` | 从私钥重建 `.pub` 文件 |
| `SSH Kit: 清理重复主机` | 查找重复连接目标，并选择保留项 |
| `SSH Kit: 批量删除主机` | 一次选择多台主机并移入回收站 |
| `SSH Kit: 打开主机回收站` | 恢复或永久删除已移入回收站的主机 |
| `SSH Kit: 清空主机回收站` | 创建快照后永久删除回收站内容 |
| `SSH Kit: 批量修改主机关联密钥` | 批量修改选中主机的关联密钥 |
| `SSH Kit: 备份数据` | 仅导出主机数据，或明确选择同时包含关联密钥文件 |
| `SSH Kit: 恢复数据` | 选择合并或替换方式恢复 JSON 备份 |
| `SSH Kit: 恢复内部快照` | 恢复不含私钥的最近主机目录快照 |

## 运行要求

- VS Code `1.100.0` 或更高版本。
- 使用 Remote-SSH 窗口连接时，需要安装 Microsoft Remote-SSH 扩展。
- 连通性测试和密钥生成依赖本机 OpenSSH 工具：`ssh`、`ssh-keygen`。
- 使用 `#sshKitHosts` 时，需要 GitHub Copilot Chat 或其他支持语言模型工具的 VS Code 聊天提供方。

## 数据与安全

SSH Kit 将主机、分组和回收站保存在 VS Code 扩展全局存储目录中的版本化 Catalog 文件中；偏好设置和每个窗口的连接状态分开保存。旧版 `globalState` 数据会在首次启动时自动校验、迁移并保留回滚副本。

SSH Kit 有三种不同的数据保护方式：

- **Remote-SSH 连接配置备份：** 首次连接会按需准备连接配置；修改、移除 Include 或清理旧版别名前，必须为本次操作保存原配置副本。这不是设置永久备份目录；日常主机修改不触碰主配置。
- **内部 Catalog 快照：** 危险目录操作前自动创建，最多保留最近 10 份，不包含私钥。
- **SSH Kit JSON 备份：** **备份数据** 命令可只导出主机数据，也可包含关联密钥。完整备份含私钥内容，请存放在加密或访问受控的位置，并及时删除临时副本。

运行时提示和树视图文本支持英文及简体中文。持久化数据带有 schema 版本，加载旧版数据时会校验并迁移；格式异常、标识重复或含有不安全 SSH Config 值的备份记录会在恢复前被拒绝。

Copilot/语言模型工具是只读能力，不会暴露私钥内容。启用的工具被手动引用或由 Agent 模式调用时，匹配结果中的当前一页主机元数据会进入本次聊天请求，方便 Copilot 基于正确的 SSH 上下文回答。若主机清单较敏感，请检查 VS Code 的工具批准设置。

提交安全问题或分享可能包含主机、密钥信息的诊断内容前，请先阅读[安全策略](SECURITY.md)。

## 开发

源码托管在 GitHub：

```bash
git clone https://github.com/Beautiful-blue-sky/vscode-ssh-kit.git
cd vscode-ssh-kit
pnpm install
pnpm run preflight
```

## 许可

[MIT](LICENSE)
