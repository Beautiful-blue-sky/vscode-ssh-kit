# 更新日志

[![en](https://img.shields.io/badge/CHANGELOG-English-blue)](CHANGELOG.md)

## 0.0.3 — 2026-06-26

### 修复
- Remote-SSH 连接别名不再包含冒号，避免初始 SSH 成功后，VS Code 使用 `scp` 上传远程服务包时把别名误解析成错误主机。
- 改用 Remote-SSH 原生命令参数传递 Host alias，让 `nginx+redis+safeline` 这类名称不再出现 `%2B` 或被 `+` 截断。
- 优化 Remote-SSH 显示别名，优先使用原 Host alias，冲突时再追加连接目标。
- 声明扩展为 UI extension，让本地窗口和远程窗口都优先使用本机 SSH Config 与密钥文件。
- 主机列表和状态栏展示当前 SSH Kit 连接，状态栏悬停浮层展示可选中复制的纯文本详情。
- VS Code 启动后自动激活扩展，无需先打开 SSH Kit 视图即可显示当前连接状态。
- 在 Remote-SSH 窗口内发起终端 SSH 连接时，可切换到本机 VS Code 终端，避免本机密钥路径在远程终端中失效。
- 移除命令面板菜单贡献中无效的视图 focus 命令引用。

## 0.0.2 — 2026-06-25

### 调整
- 重写 Marketplace README，让首屏更适合插件使用者阅读，补充快速开始、功能说明、运行要求和安全提示。
- 将开发构建说明移动到文档底部，避免市场详情页首先展示源码构建内容。

## 0.0.1 — 2026-06-25

### 新增
- 主机分组管理，支持拖拽排序与移动
- Remote-SSH 连接（当前窗口 / 新窗口 / 外部终端）
- SSH 密钥扫描、生成（ed25519 / RSA / ECDSA）、指纹展示
- `~/.ssh/config` 导入导出，支持 `Include` 指令递归
- SSH Config 导入预览，支持按名称/连接目标匹配、保留重复指令，并过滤 SSH Kit 自动连接别名
- 连通性测试（`ssh -o ConnectTimeout=5 -o BatchMode=yes`）
- 按名称、地址、标签搜索主机
- 最近连接虚拟分组
- 分组折叠状态持久化
- 批量删除与按连接目标去重，可选择保留项
- 数据备份与恢复（含密钥文件），预览密钥目标并展示失败详情
- 主机详情复制、密钥详情复制、失效 Remote-SSH 别名清理、公钥重新生成
- 国际化支持（英文 / 中文）
