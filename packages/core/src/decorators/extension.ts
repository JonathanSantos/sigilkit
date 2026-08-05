import { registry } from "../registry";
import { dual } from "./dual";
import { registerBoundMember } from "../metadata";

export interface ExtensionOptions {
  prefix?: string;
  /**
   * Habilita a aba de configurações pronta do sigil: emite o comando
   * `<prefix>.configure` e abre um webview com formulário derivado do schema
   * das @Config, two-way com o workspace.
   */
  settings?: boolean | { title?: string; commandTitle?: string };
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
export const Activate = dual(() => registerBoundMember("lifecycle"));

/** Método chamado no deactivate() gerado. */
export const Deactivate = dual(() => registerBoundMember("lifecycle"));
