import { registry } from "../registry";

export interface CommandOptions {
  title: string;
  category?: string;
  icon?: string;
  when?: string;
  keybinding?: string | { key: string; mac?: string; when?: string };
  menu?: string | string[]; // ex: "editor/context", "commandPalette"
  group?: string;
  enablement?: string;
}

/**
 * As opções são ignoradas em runtime (§4) — existem para a AST. Aqui só se
 * registra o handler, com `this` ligado à instância. Decorators stage 3 de
 * método não conhecem o nome da classe no momento da decoração, então o
 * registro acontece via addInitializer, durante a construção da instância —
 * antes do join no activate() gerado, que instancia a classe primeiro.
 */
export function Command(_opts: CommandOptions) {
  return function <This, Value extends (this: This, ...args: any[]) => any>(
    value: Value,
    ctx: ClassMethodDecoratorContext<This, Value>
  ): void {
    ctx.addInitializer(function (this: This) {
      const key = `${(this as object).constructor.name}.${String(ctx.name)}`;
      registry.commands.set(key, (value as (...args: unknown[]) => unknown).bind(this));
    });
  };
}
