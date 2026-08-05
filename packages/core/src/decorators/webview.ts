import { registerBoundMember } from "../metadata";
import type { ViewContainerSpec } from "./tree-view";

export interface WebviewOptions {
  id: string;
  title: string;
  /** Caminho do HTML da UI, relativo à raiz da extensão (ex.: "./ui/settings.html"). */
  ui: string;
  /** "panel" (default): WebviewPanel sob demanda. "sidebar": view em contributes.views. */
  location?: "panel" | "sidebar";
  /** sidebar: nome exibido na view (default = title). */
  name?: string;
  /** sidebar: container builtin ou declarado inline. */
  container?: "explorer" | "scm" | "debug" | (string & {}) | ViewContainerSpec;
}

/** Marca uma classe como painel Webview (§15.2). Metadados para a AST. */
export function Webview(_opts: WebviewOptions) {
  return function <T extends new (...args: any[]) => object>(
    _target: T,
    _ctx: ClassDecoratorContext<T>
  ): void {};
}

/**
 * Handler de mensagem vinda da UI: o roteador do webview-host despacha
 * `{ type, value }` para o método registrado para `type`, passando `value`.
 */
export function OnMessage(_type: string) {
  return registerBoundMember("webviewHandlers");
}
