import { IR } from "../ir";
import { compact } from "../util";

/**
 * Chaves de `contributes` que o sigil gerencia (§10.1). O merge substitui
 * integralmente cada uma delas e preserva todo o resto — o que permite ao
 * usuário manter à mão o que o framework ainda não suporta.
 *
 * Nota: `activationEvents` não é emitido de propósito — no VSCode 1.74+ os
 * `onCommand:` são gerados automaticamente a partir de `contributes.commands`.
 */
export const OWNED_CONTRIBUTES = ["commands", "configuration", "menus", "keybindings", "views"] as const;
export type OwnedContributeKey = (typeof OWNED_CONTRIBUTES)[number];

export type Contributes = Partial<Record<OwnedContributeKey, unknown>>;

/** IR → bloco contributes. Retorna APENAS as chaves gerenciadas não-vazias. */
export function emitManifest(ir: IR): Contributes {
  const out: Contributes = {};

  if (ir.commands.length > 0) {
    out.commands = ir.commands.map((c) =>
      compact({
        command: c.id,
        title: c.title,
        category: c.category,
        icon: c.icon,
        enablement: c.enablement,
      })
    );
  }

  if (ir.configs.length > 0) {
    const properties: Record<string, unknown> = {};
    for (const c of ir.configs) {
      properties[c.id] = compact({
        type: c.jsonType,
        default: c.default,
        description: c.description,
        scope: c.scope,
        enum: c.enum,
        minimum: c.minimum,
        maximum: c.maximum,
        items: c.items,
      });
    }
    out.configuration = {
      title: ir.prefix.charAt(0).toUpperCase() + ir.prefix.slice(1),
      properties,
    };
  }

  const menus: Record<string, unknown[]> = {};
  for (const c of ir.commands) {
    for (const m of c.menus) {
      (menus[m.menu] ??= []).push(compact({ command: c.id, when: m.when, group: m.group }));
    }
  }
  if (Object.keys(menus).length > 0) out.menus = menus;

  const keybindings = ir.commands
    .filter((c) => c.keybinding)
    .map((c) =>
      compact({
        command: c.id,
        key: c.keybinding!.key,
        mac: c.keybinding!.mac,
        when: c.keybinding!.when ?? c.when,
      })
    );
  if (keybindings.length > 0) out.keybindings = keybindings;

  if (ir.treeViews.length > 0) {
    const views: Record<string, { id: string; name: string }[]> = {};
    for (const t of ir.treeViews) {
      (views[t.container] ??= []).push({ id: t.id, name: t.name });
    }
    out.views = views;
  }

  // webviews não contribuem nada no manifesto: painéis são criados em runtime.

  return out;
}
