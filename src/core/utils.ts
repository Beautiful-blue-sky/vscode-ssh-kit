// SSH Kit —— 公共工具函数

/**
 * 从 try-catch 的 unknown error 中提取可读消息。
 * 避免项目中 5 处重复 `err instanceof Error ? err.message : String(err)` 模式。
 */
export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
