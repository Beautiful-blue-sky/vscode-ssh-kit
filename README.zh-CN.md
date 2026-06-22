# SSH Kit

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/vscode-ssh-kit.ssh-kit?label=市场)](https://marketplace.visualstudio.com/items?itemName=vscode-ssh-kit.ssh-kit)
[![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/vscode-ssh-kit.ssh-kit?label=安装量)](https://marketplace.visualstudio.com/items?itemName=vscode-ssh-kit.ssh-kit)
[![许可: MIT](https://img.shields.io/badge/许可-MIT-blue.svg)](LICENSE)

SSH 主机分组管理面板，作为 [Remote-SSH](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-ssh) 的配置管理前端。提供分组、标签、密钥面板与一键连接，数据与 `~/.ssh/config` 双向互通。

[![en](https://img.shields.io/badge/README-English-blue)](README.md)

---

## 功能

- 分组管理 SSH 主机，支持拖拽排序与移动
- 一键连接 Remote-SSH（当前窗口 / 新窗口）或外部终端
- 自动扫描 `~/.ssh/` 私钥，展示类型与指纹
- 生成 ed25519 / RSA / ECDSA 密钥对
- 从 `~/.ssh/config` 导入，合并导出（支持 `Include` 指令递归）
- 连通性测试（`ssh -o ConnectTimeout=5 -o BatchMode=yes`）
- 按名称、地址、标签搜索主机
- 数据 + 密钥打包备份与恢复

## 快速开始

### 从源码构建

```bash
git clone https://github.com/Beautiful-blue-sky/vscode-ssh-kit.git
cd vscode-ssh-kit
pnpm install
pnpm run compile
```

在 VS Code 中打开项目，按 `F5` 启动扩展开发主机。

## 使用

安装后活动栏出现 **SSH Kit** 视图容器，包含两个面板。

### 主机

| 操作 | 方式 |
|---|---|
| 添加主机 | 标题栏 `+` 或右键 |
| 连接 | 主机右侧内联按钮（当前窗口 / 新窗口 / 外部终端） |
| 编辑 / 删除 | 右键主机 |
| 连通性测试 | 右键 → 测试连通性 |
| 搜索 | 命令面板 `SSH Kit: 搜索主机` |
| 导入 / 导出 | 标题栏按钮 |

### 密钥

密钥面板列出 `~/.ssh/` 下的私钥文件。展开可查看类型、指纹与文件路径，单击路径打开文件，右侧按钮一键复制公钥。

## 命令

以下命令均可从命令面板（`Ctrl+Shift+P`）访问：

| 命令 | 说明 |
|---|---|
| `SSH Kit: 添加主机` | 交互式输入主机信息 |
| `SSH Kit: 搜索主机` | 模糊搜索并连接 |
| `SSH Kit: 从 SSH Config 导入` | 解析 `~/.ssh/config` 导入主机 |
| `SSH Kit: 写入到 SSH Config` | 将管理的主机合并写入 `~/.ssh/config` |
| `SSH Kit: 生成 SSH 密钥` | 生成新的密钥对 |
| `SSH Kit: 备份数据` | 导出主机数据与密钥文件 |
| `SSH Kit: 恢复数据` | 从备份文件恢复 |

## 开发

```bash
pnpm install       # 安装依赖
pnpm run compile   # 类型检查（tsc --noEmit）+ 构建（esbuild）
pnpm run watch     # 监听模式
pnpm run lint      # ESLint
pnpm run package   # 打包 .vsix
```

基于 TypeScript + esbuild 构建，零运行时依赖。主机数据通过 VS Code `globalState` 本地持久化，使用「备份数据 / 恢复数据」可在不同机器间迁移。

## 许可

[MIT](LICENSE)
