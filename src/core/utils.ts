// SSH Kit — Shared utility functions

/**
 * Extract a readable message from an unknown error in a catch block.
 */
export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
