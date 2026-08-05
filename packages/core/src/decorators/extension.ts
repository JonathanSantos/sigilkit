import { registry } from "../registry";

export interface ExtensionOptions {
  prefix?: string;
}

/**
 * Marca a classe raiz da extensão. Em runtime quase não faz nada (§4): as
 * opções existem para serem lidas da AST pelo compilador. O único efeito é
 * registrar o prefix quando fornecido — o wire gerado também o define, com
 * o valor resolvido (que pode vir do package.json quando omitido aqui).
 */
export function Extension(opts: ExtensionOptions = {}) {
  return function <T extends new (...args: any[]) => object>(
    _target: T,
    _ctx: ClassDecoratorContext<T>
  ): void {
    if (opts.prefix) registry.prefix = opts.prefix;
  };
}

/** Método chamado depois do wiring, no activate() gerado. */
export function Activate() {
  return function <This, Value extends (this: This, ...args: any[]) => any>(
    value: Value,
    ctx: ClassMethodDecoratorContext<This, Value>
  ): void {
    ctx.addInitializer(function (this: This) {
      const key = `${(this as object).constructor.name}.${String(ctx.name)}`;
      registry.lifecycle.set(key, (value as (...args: unknown[]) => unknown).bind(this));
    });
  };
}

/** Método chamado no deactivate() gerado. */
export function Deactivate() {
  return function <This, Value extends (this: This, ...args: any[]) => any>(
    value: Value,
    ctx: ClassMethodDecoratorContext<This, Value>
  ): void {
    ctx.addInitializer(function (this: This) {
      const key = `${(this as object).constructor.name}.${String(ctx.name)}`;
      registry.lifecycle.set(key, (value as (...args: unknown[]) => unknown).bind(this));
    });
  };
}
