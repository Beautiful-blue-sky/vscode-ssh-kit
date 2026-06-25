# 更新日志

[![en](https://img.shields.io/badge/CHANGELOG-English-blue)](CHANGELOG.md)

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
