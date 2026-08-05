import path from "node:path";
import { IR } from "../ir";

/**
 * O wire mora em src/.generated/wire.ts; imports de arquivos do usuário são
 * relativos a esse diretório (§13). Os caminhos do IR são relativos à raiz.
 */
function relativeImport(sourceFile: string): string {
  let rel = path.posix.relative("src/.generated", sourceFile);
  rel = rel.replace(/\.tsx?$/, "");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

/**
 * IR → src/.generated/wire.ts. Template strings, não ts.factory (§10.2).
 * O throw de handler ausente é a materialização de R6: dessincronização vira
 * exceção na ativação, nunca comando fantasma.
 *
 * Ordem no activate: instanciar TUDO (extensão, trees, webviews) antes do join
 * de comandos — os decorators registram handlers na construção da instância.
 */
export function emitWire(ir: IR): string {
  const cmds = ir.commands.map((c) => ({ key: c.key, id: c.id }));
  const watches = ir.watches.map((w) => ({ key: w.key, targetConfigId: w.targetConfigId }));

  const coreImports = ["registry", "bindConfigWatchers"];
  if (ir.treeViews.length > 0) coreImports.push("bindTreeView");
  if (ir.webviews.length > 0) coreImports.push("bindWebview");

  const byFile = new Map<string, Set<string>>();
  const addImport = (file: string, cls: string): void => {
    const set = byFile.get(file) ?? new Set<string>();
    set.add(cls);
    byFile.set(file, set);
  };
  addImport(ir.sourceFile, ir.extensionClass);
  for (const t of ir.treeViews) addImport(t.sourceFile, t.key);
  for (const w of ir.webviews) addImport(w.sourceFile, w.key);
  const userImports = [...byFile.entries()]
    .map(([file, names]) => `import { ${[...names].sort().join(", ")} } from "${relativeImport(file)}";`)
    .join("\n");

  const treeSetup = ir.treeViews
    .map((t) => {
      const binding = { key: t.key, id: t.id, rootsKey: t.rootsKey, childrenKey: t.childrenKey, itemKey: t.itemKey };
      return `  new ${t.key}();\n  ctx.subscriptions.push(bindTreeView(${JSON.stringify(binding)}));\n`;
    })
    .join("");

  const webviewSetup = ir.webviews
    .map((w) => {
      const binding = { key: w.key, id: w.id, title: w.title, uiEntry: w.uiEntry, handlers: w.messageHandlers };
      return `  ctx.subscriptions.push(bindWebview(new ${w.key}(), ${JSON.stringify(binding)}, ctx));\n`;
    })
    .join("");

  return `// GERADO POR sigil — NÃO EDITE
import * as vscode from "vscode";
import { ${coreImports.join(", ")} } from "@sigil/core";
${userImports}

const COMMANDS = ${JSON.stringify(cmds, null, 2)} as const;
const WATCHES = ${JSON.stringify(watches, null, 2)} as const;

let instance: ${ir.extensionClass} | undefined;

export function activate(ctx: vscode.ExtensionContext) {
  registry.prefix = ${JSON.stringify(ir.prefix)};
  instance = new ${ir.extensionClass}();
${treeSetup}${webviewSetup}  for (const c of COMMANDS) {
    const fn = registry.commands.get(c.key);
    if (!fn) throw new Error(\`sigil: handler ausente para \${c.key}. Rode 'sigil build'.\`);
    ctx.subscriptions.push(vscode.commands.registerCommand(c.id, fn));
  }
  ctx.subscriptions.push(bindConfigWatchers(WATCHES));
${ir.activateKey ? `  registry.lifecycle.get(${JSON.stringify(ir.activateKey)})?.(ctx);\n` : ""}}

export function deactivate() {
${ir.deactivateKey ? `  registry.lifecycle.get(${JSON.stringify(ir.deactivateKey)})?.();\n` : ""}  instance = undefined;
}
`;
}
