import * as vscode from "vscode";
import { log } from "./log";

export interface GuardOptions {
  /** além de logar, notifica o usuário com botão "Abrir logs" (para comandos) */
  notify?: boolean;
}

/**
 * R6 em runtime: nenhum handler morre em silêncio. Erros (síncronos ou de
 * Promise) são logados com stack no canal da extensão; com `notify`, o
 * usuário vê um showErrorMessage com atalho para os logs. O handler guardado
 * devolve undefined no erro — a extensão continua viva.
 */
export function guard<A extends unknown[], R>(
  what: string,
  fn: (...args: A) => R,
  opts: GuardOptions = {}
): (...args: A) => R | undefined {
  return function (this: unknown, ...args: A): R | undefined {
    const fail = (err: unknown): undefined => {
      const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
      log.error(`${what} falhou: ${detail}`);
      if (opts.notify) {
        const summary = err instanceof Error ? err.message : String(err);
        void vscode.window
          .showErrorMessage(`${what} falhou: ${summary}`, "Abrir logs")
          .then((choice) => {
            if (choice === "Abrir logs") log.show();
          });
      }
      return undefined;
    };
    try {
      const result = fn.apply(this, args);
      if (result && typeof (result as { then?: unknown }).then === "function") {
        return (result as unknown as Promise<unknown>).then(
          (value) => value,
          (err) => fail(err)
        ) as unknown as R;
      }
      return result;
    } catch (err) {
      return fail(err);
    }
  };
}
