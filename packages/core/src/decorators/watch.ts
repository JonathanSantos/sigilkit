import * as vscode from "vscode";
import { registry } from "../registry";
import { getConfig } from "../config-access";

/**
 * Observa mudanças de uma config declarada com @Config na mesma classe.
 * O argumento é o nome da propriedade (não o id completo); o compilador
 * resolve para `${prefix}.${nome}` e valida a existência (SIGIL1004).
 */
export function Watch(_configProperty: string) {
  return function <This, Value extends (this: This, next: any, prev: any) => any>(
    value: Value,
    ctx: ClassMethodDecoratorContext<This, Value>
  ): void {
    ctx.addInitializer(function (this: This) {
      const key = `${(this as object).constructor.name}.${String(ctx.name)}`;
      registry.watches.set(key, (value as (next: unknown, prev: unknown) => unknown).bind(this));
    });
  };
}

export interface WatchBinding {
  readonly key: string;
  readonly targetConfigId: string;
}

/**
 * Chamado pelo activate() gerado. Um único listener de onDidChangeConfiguration
 * despacha para os handlers do registry, com (next, prev).
 */
export function bindConfigWatchers(watches: readonly WatchBinding[]): vscode.Disposable {
  const last = new Map<string, unknown>();
  for (const w of watches) last.set(w.targetConfigId, getConfig(w.targetConfigId));

  return vscode.workspace.onDidChangeConfiguration((e) => {
    for (const w of watches) {
      if (!e.affectsConfiguration(w.targetConfigId)) continue;
      const next = getConfig(w.targetConfigId);
      const prev = last.get(w.targetConfigId);
      last.set(w.targetConfigId, next);
      const handler = registry.watches.get(w.key);
      if (!handler) {
        throw new Error(`sigil: watcher ausente para ${w.key}. Rode 'sigil build'.`);
      }
      handler(next, prev);
    }
  });
}
