import { registry } from "../registry";
import { registerBoundMember } from "../metadata";

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
  return registerBoundMember("lifecycle");
}

/** Método chamado no deactivate() gerado. */
export function Deactivate() {
  return registerBoundMember("lifecycle");
}
