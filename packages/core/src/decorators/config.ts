import { registry } from "../registry";
import { readWorkspaceConfig, writeWorkspaceConfig } from "../config-access";

export interface ConfigOptions {
  description?: string;
  scope?: "application" | "machine" | "window" | "resource";
  enum?: string[];
  minimum?: number;
  maximum?: number;
  deprecationMessage?: string;
}

/**
 * Exige a palavra-chave `accessor` (§6 do spec — decision record): no spec
 * stage 3, só o decorator de auto-accessor pode substituir a propriedade por
 * um par get/set, e ler `this.greeting` precisa retornar o valor atual do
 * workspace, não um valor congelado na construção.
 *
 * O tipo e o default NÃO vêm das opções: o compilador os lê da declaração da
 * propriedade na AST. O `init` abaixo captura o default em runtime apenas como
 * fallback — o manifesto usa a versão da AST.
 */
export function Config(_opts: ConfigOptions = {}) {
  return function <T>(
    _target: ClassAccessorDecoratorTarget<any, T>,
    ctx: ClassAccessorDecoratorContext<any, T>
  ): ClassAccessorDecoratorResult<any, T> {
    const name = String(ctx.name);
    return {
      get() {
        return readWorkspaceConfig<T>(this.constructor.name, name);
      },
      set(value: T) {
        void writeWorkspaceConfig(this.constructor.name, name, value);
      },
      init(initial: T) {
        registry.configDefaults.set(`${this.constructor.name}.${name}`, initial);
        return initial;
      },
    };
  };
}
