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

  // SIGIL1017: @StatusBar apontando para comando da própria extensão que não existe
  const knownCommandIds = new Set(ir.commands.map((c) => c.id));
  for (const sb of ir.statusBars) {
    if (sb.command && sb.command.startsWith(`${ir.prefix}.`) && !knownCommandIds.has(sb.command)) {
      diags.push(
        diagAtLoc(program, projectDir, sb.loc, SIGIL.UnknownCommandReference, `@StatusBar referencia comando inexistente: ${sb.command}`)
      );
    }
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
