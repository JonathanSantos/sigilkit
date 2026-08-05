import * as vscode from "vscode";
import { registry } from "../registry";
import { registerBoundMember } from "../metadata";
import { getConfig } from "../config-access";
import { guard } from "../guard";

/**
 * Observa mudanças de uma config declarada com @Config na mesma classe.
 * O argumento é o nome da propriedade (não o id completo); o compilador
 * resolve para `${prefix}.${nome}` e valida a existência (SIGIL1004).
 */
export function Watch(_configProperty: string) {
  return registerBoundMember("watches");
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
      guard(`@Watch ${w.key}`, handler)(next, prev);
    }
  });
}
