/* eslint-disable @typescript-eslint/no-explicit-any */

type AnyDecorator = (value: any, ctx: any) => any;

/**
 * Torna um factory de decorator sem argumentos utilizável nas duas formas:
 * `@Activate` e `@Activate()`. A detecção é pelo segundo argumento: um
 * contexto de decorator stage-3 sempre tem `kind` — um call de factory
 * sem argumentos, não.
 */
export function dual<D extends AnyDecorator>(make: () => D): D & (() => D) {
  const wrapper = (...args: unknown[]): unknown => {
    const ctx = args[1];
    if (args.length === 2 && typeof ctx === "object" && ctx !== null && "kind" in ctx) {
      return make()(args[0], ctx);
    }
    return make();
  };
  return wrapper as D & (() => D);
}
