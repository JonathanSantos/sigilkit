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

/**
 * Chaves de propriedade CONDICIONAL: substituídas integralmente quando o
 * sigil as emite, mas NUNCA removidas quando ausentes — o usuário pode
 * mantê-las à mão enquanto não usar a forma declarativa (container inline).
 */
export const CONDITIONAL_CONTRIBUTES = ["viewsContainers", "chatParticipants", "customEditors"] as const;
export type ConditionalContributeKey = (typeof CONDITIONAL_CONTRIBUTES)[number];

export type Contributes = Partial<Record<OwnedContributeKey | ConditionalContributeKey, unknown>>;

/** IR → bloco contributes. Retorna APENAS as chaves gerenciadas não-vazias. */
export function emitManifest(ir: IR): Contributes {
  const out: Contributes = {};

  const commandEntries: Record<string, unknown>[] = ir.commands.map((c) =>
    compact({
      command: c.id,
      title: c.title,
      category: c.category,
      icon: c.icon,
      enablement: c.enablement,
    })
  );
  if (ir.settingsPanel) {
    commandEntries.push({ command: ir.settingsPanel.commandId, title: ir.settingsPanel.commandTitle });
    commandEntries.sort((a, b) => ((a.command as string) < (b.command as string) ? -1 : 1));
  }
  if (commandEntries.length > 0) out.commands = commandEntries;

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
        deprecationMessage: c.deprecationMessage,
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
        linux: c.keybinding!.linux,
        win: c.keybinding!.win,
        when: c.keybinding!.when ?? c.when,
      })
    );
  if (keybindings.length > 0) out.keybindings = keybindings;

  const views: Record<string, unknown[]> = {};
  for (const t of ir.treeViews) {
    (views[t.container] ??= []).push({ id: t.id, name: t.name });
  }
  // webviews de sidebar são views com type "webview"; painéis não contribuem nada
  for (const w of ir.webviews) {
    if (w.location !== "sidebar") continue;
    (views[w.container ?? "explorer"] ??= []).push({ id: w.id, name: w.name ?? w.title, type: "webview" });
  }
  if (Object.keys(views).length > 0) out.views = views;

  if (ir.viewContainers.length > 0) {
    const grouped: Record<string, unknown[]> = {};
    for (const c of ir.viewContainers) {
      (grouped[c.location] ??= []).push({ id: c.id, title: c.title, icon: c.icon });
    }
    out.viewsContainers = grouped;
  }

  if (ir.chatParticipants.length > 0) {
    out.chatParticipants = ir.chatParticipants.map((c) =>
      compact({
        id: c.id,
        name: c.name,
        fullName: c.fullName,
        description: c.description,
        isSticky: c.isSticky,
      })
    );
  }

  if (ir.customEditors.length > 0) {
    out.customEditors = ir.customEditors.map((e) =>
      compact({
        viewType: e.viewType,
        displayName: e.displayName,
        selector: e.patterns.map((p) => ({ filenamePattern: p })),
        priority: e.priority,
      })
    );
  }

  return out;
}

/**
 * activationEvents que o VSCode NÃO gera sozinho: providers de linguagem
 * precisam de onLanguage:<id>. O merge gerencia só o SUBCONJUNTO onLanguage:*
 * do array — o resto (onStartupFinished etc.) fica intacto na mão do usuário.
 */
export function emitActivationEvents(ir: IR): string[] {
  const events = new Set<string>();
  for (const lang of ir.languages) {
    for (const id of lang.selector) events.add(`onLanguage:${id}`);
  }
  return [...events].sort();
}
