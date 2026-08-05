import { registry } from "../registry";

export interface WebviewOptions {
  id: string;
  title: string;
  /** Caminho do HTML da UI, relativo à raiz da extensão (ex.: "./ui/settings.html"). */
  ui: string;
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
  return function <This, Value extends (this: This, value: any) => any>(
    value: Value,
    ctx: ClassMethodDecoratorContext<This, Value>
  ): void {
    ctx.addInitializer(function (this: This) {
      const key = `${(this as object).constructor.name}.${String(ctx.name)}`;
      registry.webviewHandlers.set(key, (value as (v: unknown) => unknown).bind(this));
    });
  };
}
