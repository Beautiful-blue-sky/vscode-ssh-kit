# SSH Kit

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/lixiaoyu.ssh-kit?label=市场)](https://marketplace.visualstudio.com/items?itemName=lixiaoyu.ssh-kit)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/lixiaoyu.ssh-kit?label=安装量)](https://marketplace.visualstudio.com/items?itemName=lixiaoyu.ssh-kit)
[![许可: MIT](https://img.shields.io/badge/许可-MIT-blue.svg)](LICENSE)

SSH Kit 是一个面向 VS Code 的 SSH 主机管理插件。它把服务器分组、密钥管理、SSH Config 导入导出和 Remote-SSH 快捷连接放到一个侧边栏里，适合经常维护多台服务器的开发、运维和 DevOps 场景。

[English README](README.md)

## 为什么使用

- 按项目、环境或团队整理 SSH 主机。
- 通过 Remote-SSH 在当前窗口、新空窗口或外部终端连接服务器。
- 从现有 `~/.ssh/config` 导入主机，并在写入前预览新增、更新和跳过项。
- 展开主机后直接复制地址、端口、用户名、密钥路径等信息。
- 扫描本地 SSH 密钥，复制公钥，重新生成缺失的 `.pub` 文件。
- 备份和恢复 SSH Kit 数据，必要时可包含已关联密钥文件。

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

### Remote-SSH 连接

- 在当前窗口或新空窗口打开选中的 Remote-SSH 主机。
- 左下角 Remote-SSH 标识会同时显示主机名和连接地址。
- 使用 SSH Kit 自动生成的连接别名，避免导入时把这些别名当成普通主机。
- 也可以通过系统外部终端打开常规 SSH 会话。

### SSH Config 导入导出

- 从 `~/.ssh/config` 导入主机，支持递归解析 `Include` 指令。
- 导入前预览新增、更新、跳过和冲突项。
- 优先按 Host 名称匹配已有主机，再按 SSH 连接目标匹配。
- 保留 `LocalForward`、`SendEnv` 等可重复配置项。
- 写回 SSH Config 前会备份原文件。

### 密钥管理

- 自动扫描 `~/.ssh/` 下的私钥。
- 显示密钥类型和指纹。
- 生成 ed25519、RSA 或 ECDSA 密钥对。
- 在树视图中一键复制公钥。
- 从私钥重新生成缺失的公钥文件。

### 备份与恢复

- 将主机数据和已关联密钥文件导出为 JSON。
- 恢复前预览密钥文件写入目标。
- 已存在的主机和密钥文件默认跳过，不覆盖。
- 如果备份内包含无效密钥，会显示恢复失败详情。

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
| `SSH Kit: 备份数据` | 导出主机数据与已关联密钥文件 |
| `SSH Kit: 恢复数据` | 从备份文件恢复 |

## 运行要求

- VS Code `1.100.0` 或更高版本。
- 使用 Remote-SSH 窗口连接时，需要安装 Microsoft Remote-SSH 扩展。
- 连通性测试和密钥生成依赖本机 OpenSSH 工具：`ssh`、`ssh-keygen`。

## 数据与安全

SSH Kit 将主机元数据保存在 VS Code `globalState` 中。备份文件在包含已关联密钥时会携带私钥内容，请保存到可信位置，迁移完成后及时删除临时备份。

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
