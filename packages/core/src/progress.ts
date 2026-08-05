import * as vscode from "vscode";

export interface CommandProgress {
  title: string;
  location?: "notification" | "window" | "statusBar";
  cancellable?: boolean;
}

function toLocation(location?: string): vscode.ProgressLocation {
  if (location === "window") return vscode.ProgressLocation.Window;
  if (location === "statusBar") return vscode.ProgressLocation.Window; // statusBar não tem título; Window é o mais próximo estável
  return vscode.ProgressLocation.Notification;
}

/**
 * Envolve um handler de comando em window.withProgress. O CancellationToken
 * é injetado como ÚLTIMO argumento do handler (depois dos args do comando).
 */
export function withCommandProgress(
  progress: CommandProgress | string,
  fn: (...args: unknown[]) => unknown
): (...args: unknown[]) => unknown {
  const opts = typeof progress === "string" ? { title: progress } : progress;
  return (...args: unknown[]) =>
    vscode.window.withProgress(
      {
        location: toLocation(opts.location),
        title: opts.title,
        cancellable: opts.cancellable ?? true,
      },
      (_report, token) => Promise.resolve(fn(...args, token))
    );
}
