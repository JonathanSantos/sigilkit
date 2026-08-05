import ts from "typescript";
import { IR } from "./ir";
import { diagAtLoc, SIGIL } from "./diagnostics";

/** Regras semânticas sobre o IR (§9). Cada violação vira diagnóstico com posição. */
export function validate(ir: IR, program: ts.Program, projectDir: string): ts.Diagnostic[] {
  const diags: ts.Diagnostic[] = [];

  const commandIds = new Set<string>();
  for (const c of ir.commands) {
    if (commandIds.has(c.id)) {
      diags.push(diagAtLoc(program, projectDir, c.loc, SIGIL.DuplicateCommandId, `id de comando duplicado: ${c.id}`));
    }
    commandIds.add(c.id);
  }

  const configIds = new Set<string>();
  for (const c of ir.configs) {
    if (configIds.has(c.id)) {
      diags.push(diagAtLoc(program, projectDir, c.loc, SIGIL.DuplicateConfigId, `id de config duplicado: ${c.id}`));
    }
    configIds.add(c.id);
  }

  for (const w of ir.watches) {
    if (!configIds.has(w.targetConfigId)) {
      diags.push(
        diagAtLoc(program, projectDir, w.loc, SIGIL.WatchUnknownConfig, `@Watch referencia config inexistente: ${w.targetConfigId}`)
      );
    }
  }

  const viewIds = new Set<string>();
  for (const t of ir.treeViews) {
    if (viewIds.has(t.id)) {
      diags.push(diagAtLoc(program, projectDir, t.loc, SIGIL.DuplicateViewId, `id de view duplicado: ${t.id}`));
    }
    viewIds.add(t.id);
  }

  const webviewIds = new Set<string>();
  for (const w of ir.webviews) {
    if (webviewIds.has(w.id)) {
      diags.push(diagAtLoc(program, projectDir, w.loc, SIGIL.DuplicateViewId, `id de webview duplicado: ${w.id}`));
    }
    webviewIds.add(w.id);
  }

  const chatIds = new Set<string>();
  for (const c of ir.chatParticipants) {
    if (chatIds.has(c.id)) {
      diags.push(diagAtLoc(program, projectDir, c.loc, SIGIL.DuplicateViewId, `id de chat participant duplicado: ${c.id}`));
    }
    chatIds.add(c.id);
  }

  const editorTypes = new Set<string>();
  for (const e of ir.customEditors) {
    if (editorTypes.has(e.viewType)) {
      diags.push(diagAtLoc(program, projectDir, e.loc, SIGIL.DuplicateViewId, `viewType de custom editor duplicado: ${e.viewType}`));
    }
    editorTypes.add(e.viewType);
  }

  // SIGIL1017: @StatusBar apontando para comando da própria extensão que não existe
  const knownCommandIds = new Set(ir.commands.map((c) => c.id));

  // o comando derivado do settings não pode colidir com um comando do usuário
  if (ir.settingsPanel && knownCommandIds.has(ir.settingsPanel.commandId)) {
    diags.push(
      diagAtLoc(program, projectDir, ir.settingsPanel.loc, SIGIL.DuplicateCommandId, `o comando do settings (${ir.settingsPanel.commandId}) colide com um comando da extensão`)
    );
  }
  for (const sb of ir.statusBars) {
    if (sb.command && sb.command.startsWith(`${ir.prefix}.`) && !knownCommandIds.has(sb.command)) {
      diags.push(
        diagAtLoc(program, projectDir, sb.loc, SIGIL.UnknownCommandReference, `@StatusBar referencia comando inexistente: ${sb.command}`)
      );
    }
  }

  // ── validação de cláusulas `when` (SIGIL1018/1019) ─────────────────────────
  // O compilador vê os dois lados: as @ContextKey declaradas E as expressões.
  // Um typo em `when` que falharia em silêncio para sempre vira erro de build.
  const declaredContextIds = new Set(ir.contextKeys.map((c) => c.id));
  const knownPrefixTokens = new Set([
    ...declaredContextIds,
    ...ir.treeViews.map((t) => t.id),
    ...ir.webviews.map((w) => w.id),
    ...ir.commands.map((c) => c.id),
  ]);

  const WHEN_TOKEN =
    /\s+|&&|\|\||!=|==|=~|>=|<=|[!()<>]|'[^']*'|"[^"]*"|\/(?:[^/\\]|\\.)+\/|\bin\b|\bnot\b|-?\d+(?:\.\d+)?|[A-Za-z_][\w.:\-]*/y;

  const checkWhen = (expr: string, what: string, loc: (typeof ir.commands)[number]["loc"]): void => {
    // sintaxe: tokeniza; sobra de caracteres ou parênteses desbalanceados → 1019
    WHEN_TOKEN.lastIndex = 0;
    let consumed = 0;
    let depth = 0;
    let match: RegExpExecArray | null;
    while ((match = WHEN_TOKEN.exec(expr)) !== null) {
      const token = match[0];
      consumed += token.length;
      if (token === "(") depth++;
      if (token === ")") depth--;
      if (depth < 0) break;
      // semântica: tokens do NOSSO prefixo precisam existir (context key/view/comando)
      if (token.startsWith(`${ir.prefix}.`) && !knownPrefixTokens.has(token)) {
        diags.push(
          diagAtLoc(program, projectDir, loc, SIGIL.UnknownContextKey, `${what} referencia '${token}', que não é uma @ContextKey (nem view/comando) declarada — declare-a ou corrija o typo`)
        );
      }
    }
    if (consumed !== expr.length || depth !== 0) {
      diags.push(diagAtLoc(program, projectDir, loc, SIGIL.InvalidWhenExpression, `${what} tem sintaxe inválida: "${expr}"`));
    }
  };

  for (const c of ir.commands) {
    if (c.when) checkWhen(c.when, `o when de ${c.id}`, c.loc);
    if (c.enablement) checkWhen(c.enablement, `o enablement de ${c.id}`, c.loc);
    for (const m of c.menus) if (m.when) checkWhen(m.when, `o when do menu ${m.menu} de ${c.id}`, c.loc);
    if (c.keybinding?.when) checkWhen(c.keybinding.when, `o when do keybinding de ${c.id}`, c.loc);
  }

  const keybindings = new Map<string, string>();
  for (const c of ir.commands) {
    if (!c.keybinding) continue;
    const sig = c.keybinding.key;
    const owner = keybindings.get(sig);
    if (owner) {
      diags.push(
        diagAtLoc(program, projectDir, c.loc, SIGIL.DuplicateKeybinding, `keybinding duplicado: '${sig}' já usado por ${owner}`)
      );
    } else {
      keybindings.set(sig, c.id);
    }
  }

  return diags;
}
