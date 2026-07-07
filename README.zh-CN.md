# SSH Kit

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/lixiaoyu.ssh-kit?label=市场)](https://marketplace.visualstudio.com/items?itemName=lixiaoyu.ssh-kit)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/lixiaoyu.ssh-kit?label=安装量)](https://marketplace.visualstudio.com/items?itemName=lixiaoyu.ssh-kit)
[![许可: MIT](https://img.shields.io/badge/许可-MIT-blue.svg)](LICENSE)

SSH Kit 是一个面向 VS Code 的 SSH 主机管理插件。它把服务器分组、密钥管理、SSH Config 导入导出和 Remote-SSH 快捷连接放到一个侧边栏里，适合经常维护多台服务器的开发、运维和 DevOps 场景。

[English README](README.md)

## 为什么使用

- 按项目、环境或团队整理 SSH 主机。
- 通过 Remote-SSH 在当前窗口、新空窗口或外部终端连接服务器。
- 在状态栏查看当前 SSH Kit Remote-SSH 连接，并通过悬停详情复制主机信息。
- 从现有 `~/.ssh/config` 导入主机，并在写入前预览新增、更新和跳过项。
- 展开主机后直接复制地址、端口、用户名、密钥路径等信息。
- 扫描本地 SSH 密钥，复制公钥，重新生成缺失的 `.pub` 文件。
- 备份和恢复 SSH Kit 数据，必要时可包含已关联密钥文件。
- 当你需要 SSH 上下文时，可让 Copilot 或其他 VS Code 语言模型工具读取主机元数据。

## 快速开始

1. 从 VS Code Marketplace 安装 **SSH Kit**。
2. 打开活动栏里的 **SSH Kit** 视图。
3. 手动添加主机，或选择 **从 SSH Config 导入**。
4. 在主机行右侧使用内联按钮连接 Remote-SSH 或外部终端。
5. 展开主机和密钥节点，直接复制常用详情。

## 核心功能

### 主机管理

- 使用文件夹分组管理 SSH 主机。
- 支持拖拽主机到不同分组。
- 最近连接主机自动显示在列表顶部。
- 按主机名、地址或标签搜索。
- 支持批量删除和按实际连接目标清理重复主机。
- 支持批量修改选中主机的关联密钥路径，也可以清空关联或输入自定义路径。
- 右键单台主机时可只修改当前主机的关联密钥。

### Remote-SSH 连接

- 在当前窗口或新空窗口打开选中的 Remote-SSH 主机。
- Remote-SSH 左下角保持原生 Host alias 显示，名称更清晰。
- 主机列表和 SSH Kit 状态栏会按 VS Code 窗口标记当前连接；悬停状态栏可查看名称、连接地址、用户、分组、密钥和标签等详情，点击状态栏可复制完整信息。
- 新窗口连接上下文与发起窗口隔离，短时间打开多个 Remote-SSH 窗口时不会覆盖当前窗口标记。
- 使用 SSH Kit 自动生成的连接别名，避免导入时把这些别名当成普通主机。
- 连接前自动刷新 SSH Kit 托管的 Remote-SSH Host 块，恢复或编辑后的密钥路径无需手动写回 SSH Config 也会生效。
- 也可以在 VS Code 终端或系统外部终端打开常规 SSH 会话。在 Remote-SSH 窗口内，SSH Kit 可打开本机 VS Code 终端，继续使用本机 SSH Config 和本机密钥文件。

### SSH Config 导入导出

- 从 `~/.ssh/config` 导入主机，支持递归解析 `Include` 指令。
- 导入前预览新增、更新、跳过和冲突项。
- 优先按 Host 名称匹配已有主机，再按 SSH 连接目标匹配。
- 保留 `LocalForward`、`SendEnv` 等可重复配置项。
- 写回 SSH Config 前会先让你选择当前配置文件的备份保存位置。
- 写回时以 SSH Kit 当前主机列表为准：同名 Host alias 或相同 `HostName` / `Port` 目标会被当前 SSH Kit 条目替换，并移除 SSH Kit 自动生成的临时连接别名。

### 密钥管理

- 自动扫描 `~/.ssh/` 下的私钥。
- 显示密钥类型和指纹。
- 生成 ed25519、RSA 或 ECDSA 密钥对。
- 在树视图中一键复制公钥。
- 从私钥重新生成缺失的公钥文件。

### 备份与恢复

- 将主机数据和已关联密钥文件导出为 JSON。
- 恢复前预览密钥文件写入目标。
- 会按 SSH 公钥身份复用同一把密钥，即使本机文件名不同；同名但不是同一把密钥时会在恢复前提示处理。
- 会把恢复主机的密钥路径改写为本机实际写入、改名或复用的密钥路径；跳过或恢复失败的密钥会清空关联，不保留源机器路径。
- 如果备份内包含无效密钥，会显示恢复失败详情。
- 恢复后可用批量修改关联密钥修正迁移或重命名后的密钥路径，无需逐台编辑。

### AI 与 Copilot 接入

- 提供只读的 VS Code 语言模型工具 `sshKitHosts`。
- 可返回主机名称、地址、端口、用户、分组和标签，方便 AI 辅助规划 SSH 或 Remote-SSH 操作。
- 不返回私钥内容；关联密钥路径默认隐藏，只有工具输入明确要求时才返回路径。

## 命令面板

以下命令可从 `Ctrl+Shift+P` 访问：

| 命令 | 说明 |
|---|---|
| `SSH Kit: 添加主机` | 交互式添加主机 |
| `SSH Kit: 添加分组` | 创建主机分组 |
| `SSH Kit: 刷新` | 刷新主机与密钥视图 |
| `SSH Kit: 搜索主机` | 搜索主机并连接 |
| `SSH Kit: 从 SSH Config 导入` | 从 `~/.ssh/config` 导入主机 |
| `SSH Kit: 写入到 SSH Config` | 将管理的主机合并写入 `~/.ssh/config` |
| `SSH Kit: 打开 SSH Config 文件` | 打开 SSH Config 文件 |
| `SSH Kit: 清理 SSH Kit 连接别名` | 删除失效的 SSH Kit Remote-SSH 别名 |
| `SSH Kit: 查看密钥列表` | 浏览已扫描到的 SSH 密钥 |
| `SSH Kit: 生成 SSH 密钥` | 生成新的密钥对 |
| `SSH Kit: 重新生成公钥` | 从私钥重建 `.pub` 文件 |
| `SSH Kit: 清理重复主机` | 查找重复连接目标，并选择保留项 |
| `SSH Kit: 批量删除主机` | 一次选择并删除多台主机 |
| `SSH Kit: 批量修改主机关联密钥` | 批量修改选中主机的关联密钥 |
| `SSH Kit: 备份数据` | 导出主机数据与已关联密钥文件 |
| `SSH Kit: 恢复数据` | 从备份文件恢复 |

## 运行要求

- VS Code `1.100.0` 或更高版本。
- 使用 Remote-SSH 窗口连接时，需要安装 Microsoft Remote-SSH 扩展。
- 连通性测试和密钥生成依赖本机 OpenSSH 工具：`ssh`、`ssh-keygen`。

## 数据与安全

SSH Kit 将主机元数据保存在 VS Code `globalState` 中。备份文件在包含已关联密钥时会携带私钥内容，请保存到可信位置，迁移完成后及时删除临时备份。

写入 `~/.ssh/config` 时，SSH Kit 会在真正写入前要求你选择当前配置文件的备份保存位置。Copilot/语言模型工具是只读能力，不会暴露私钥内容。

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
