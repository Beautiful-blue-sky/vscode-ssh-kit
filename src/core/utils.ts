// SSH Kit — Shared utility functions
import * as vscode from "vscode";

/**
 * Extract a readable message from an unknown error in a catch block.
 */
export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Show transient operation feedback in the status bar.
 * VS Code notifications never dismiss themselves, so routine confirmations
 * use the status bar and disappear on their own after a few seconds.
 */
export function showTransientInfo(message: string, timeout = 4000): void {
  vscode.window.setStatusBarMessage(message, timeout);
}

/**
 * Show feedback as a bottom-right notification that dismisses itself.
 * Plain notifications stay until the user closes them, so an auto-completing
 * notification-scoped progress is used instead. Fire-and-forget: callers are
 * not blocked for the display duration.
 */
export function showTransientNotification(message: string, duration = 4000): void {
  void vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: message, cancellable: false },
    () => new Promise<void>((resolve) => { globalThis.setTimeout(resolve, duration); })
  );
}
