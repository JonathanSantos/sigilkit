import * as vscode from "vscode";
import { registry } from "./registry";

/**
 * Sistema de logs da extensão sobre vscode.LogOutputChannel (aba Output, com
 * nível controlado pelo usuário via workbench.action.setLogLevel).
 *
 * `log` funciona ANTES da ativação: mensagens ficam num buffer e são
 * despejadas no canal quando o bindLog (chamado pelo wire) o cria.
 */

type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

const buffer: { level: LogLevel; message: string; args: unknown[] }[] = [];

function emit(level: LogLevel, message: string, args: unknown[]): void {
  const channel = registry.logChannel;
  if (!channel) {
    buffer.push({ level, message, args });
    if (buffer.length > 1000) buffer.shift();
    return;
  }
  channel[level](message, ...args);
}

export const log = {
  trace: (message: string, ...args: unknown[]): void => emit("trace", message, args),
  debug: (message: string, ...args: unknown[]): void => emit("debug", message, args),
  info: (message: string, ...args: unknown[]): void => emit("info", message, args),
  warn: (message: string, ...args: unknown[]): void => emit("warn", message, args),
  error: (message: string, ...args: unknown[]): void => emit("error", message, args),
  /** Revela a aba Output no canal da extensão. */
  show: (): void => registry.logChannel?.show(),
};

/** Chamado pelo activate() gerado. Cria o canal e despeja o buffer pré-ativação. */
export function bindLog(name: string): vscode.Disposable {
  const channel = vscode.window.createOutputChannel(name, { log: true });
  registry.logChannel = channel;
  for (const entry of buffer.splice(0)) {
    channel[entry.level](entry.message, ...entry.args);
  }
  return {
    dispose() {
      if (registry.logChannel === channel) registry.logChannel = undefined;
      channel.dispose();
    },
  };
}
