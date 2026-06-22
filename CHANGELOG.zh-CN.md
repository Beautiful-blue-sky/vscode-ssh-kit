# 更新日志

> [English](CHANGELOG.md)

## 0.0.1 — 未发布

### 新增
- 主机分组管理，支持拖拽排序与移动
- Remote-SSH 连接（当前窗口 / 新窗口 / 外部终端）
- SSH 密钥扫描、生成（ed25519 / RSA / ECDSA）、指纹展示
- `~/.ssh/config` 导入导出，支持 `Include` 指令递归
- 连通性测试（`ssh -o ConnectTimeout=5 -o BatchMode=yes`）
- 按名称、地址、标签搜索主机
- 最近连接虚拟分组
- 分组折叠状态持久化
- 批量删除与去重
- 数据备份与恢复（含密钥文件）
- 国际化支持（英文 / 中文）
