import * as vscode from "vscode";
import { registry } from "../registry";
import { bucketOf } from "../metadata";

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
 * propriedade na AST. O default capturado no `init` vai para o bucket da
 * classe (ctx.metadata) — nenhuma dependência de nome de classe em runtime.
 */
export function Config(_opts: ConfigOptions = {}) {
  return function <T>(
    _target: ClassAccessorDecoratorTarget<any, T>,
    ctx: ClassAccessorDecoratorContext<any, T>
  ): ClassAccessorDecoratorResult<any, T> {
    const name = String(ctx.name);
    const metadata = ctx.metadata;
    return {
      get() {
        const value = vscode.workspace.getConfiguration(registry.prefix).get<T>(name);
        if (value !== undefined) return value;
        return bucketOf(metadata).configDefaults.get(name) as T;
      },
      set(value: T) {
        void vscode.workspace
          .getConfiguration(registry.prefix)
          .update(name, value, vscode.ConfigurationTarget.Global);
      },
      init(initial: T) {
        bucketOf(metadata).configDefaults.set(name, initial);
        return initial;
      },
    };
  };
}
