import path from "node:path";
import { IR } from "../ir";

function compactEntry<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

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
  const cmds = ir.commands.map((c) => compactEntry({ key: c.key, id: c.id, progress: c.progress }));
  const watches = ir.watches.map((w) => ({ key: w.key, targetConfigId: w.targetConfigId }));

  const coreImports = ["registry", "adoptRegistrations", "bindConfigWatchers", "bindLog", "guard"];
  if (ir.treeViews.length > 0) coreImports.push("bindTreeView");
  if (ir.webviews.some((w) => w.location === "panel")) coreImports.push("bindWebview");
  if (ir.webviews.some((w) => w.location === "sidebar")) coreImports.push("bindWebviewView");
  if (ir.webviews.some((w) => w.location === "dual")) coreImports.push("bindWebviewDual");
  if (ir.statusBars.length > 0) coreImports.push("bindStatusBar");
  if (ir.settingsPanel) coreImports.push("bindSettingsApp");
  if (ir.languages.length > 0) coreImports.push("bindLanguage");
  if (ir.chatParticipants.length > 0) coreImports.push("bindChatParticipant");
  if (ir.customEditors.length > 0) coreImports.push("bindCustomEditor");
  if (ir.events.length > 0) coreImports.push("bindEvents");
  if (ir.fileWatchers.length > 0) coreImports.push("bindFileWatchers");
  if (ir.secrets.length > 0) coreImports.push("bindSecrets");
  if (ir.contextKeys.length > 0) coreImports.push("bindContextKeys");
  if (ir.uriHandlerKey) coreImports.push("bindUriHandler");
  if (ir.lmTools.length > 0) coreImports.push("bindLmTools");
  if (ir.mcpProviders.length > 0) coreImports.push("bindMcpServers");
  if ((ir.testControllers ?? []).length > 0) coreImports.push("bindTestController");
  if (ir.commands.some((c) => c.progress)) coreImports.push("withCommandProgress");
  coreImports.push("bindEvery"); // @Every da classe @Extension (no-op sem timers)

  const byFile = new Map<string, Set<string>>();
  const addImport = (file: string, cls: string): void => {
    const set = byFile.get(file) ?? new Set<string>();
    set.add(cls);
    byFile.set(file, set);
  };
  addImport(ir.sourceFile, ir.extensionClass);
  for (const t of ir.treeViews) addImport(t.sourceFile, t.key);
  for (const w of ir.webviews) addImport(w.sourceFile, w.key);
  for (const l of ir.languages) addImport(l.sourceFile, l.key);
  for (const c of ir.chatParticipants) addImport(c.sourceFile, c.key);
  for (const e of ir.customEditors) addImport(e.sourceFile, e.key);
  for (const t of ir.testControllers ?? []) addImport(t.sourceFile, t.key);
  const userImports = [...byFile.entries()]
    .map(([file, names]) => `import { ${[...names].sort().join(", ")} } from "${relativeImport(file)}";`)
    .join("\n");

  // hidratação: instancia + adota + registra em registry.instances (a ponte
  // tipada entre classes) + injeta posts — re-executável (hot swap)
  const hydrate = (key: string, extra: string[] = []): string[] => [
    `  const i_${key} = new ${key}();`,
    `  adoptRegistrations(${JSON.stringify(key)}, ${key});`,
    `  registry.instances.set(${key}, i_${key});`,
    ...extra,
  ];
  const hydrateLines = [
    `  instance = new ${ir.extensionClass}();`,
    `  adoptRegistrations(${JSON.stringify(ir.extensionClass)}, ${ir.extensionClass});`,
    `  registry.instances.set(${ir.extensionClass}, instance);`,
    ...ir.treeViews.flatMap((t) => hydrate(t.key)),
    ...ir.webviews.flatMap((w) =>
      hydrate(w.key, [
        `  (i_${w.key} as { post?: (msg: unknown) => void }).post = (msg) => registry.webviewPosts.get(${JSON.stringify(w.key)})!(msg);`,
        `  registry.webviewKeys.set(${w.key}, ${JSON.stringify(w.key)});`,
      ])
    ),
    ...ir.languages.flatMap((l) => hydrate(l.key)),
    ...ir.chatParticipants.flatMap((c) => hydrate(c.key)),
    ...ir.customEditors.flatMap((e) => hydrate(e.key)),
    ...(ir.testControllers ?? []).flatMap((t) => hydrate(t.key)),
  ].join("\n");

  const treeSetup = ir.treeViews
    .map((t) => {
      const binding = { key: t.key, id: t.id, rootsKey: t.rootsKey, childrenKey: t.childrenKey, itemKey: t.itemKey };
      return `  ctx.subscriptions.push(bindTreeView(${JSON.stringify(binding)}));\n`;
    })
    .join("");

  const webviewSetup = ir.webviews
    .map((w) => {
      const binding = {
        key: w.key,
        id: w.id,
        title: w.title,
        uiEntry: w.uiEntry,
        handlers: w.messageHandlers,
        requests: w.requestHandlers,
      };
      const bindFn = w.location === "sidebar" ? "bindWebviewView" : w.location === "dual" ? "bindWebviewDual" : "bindWebview";
      return `  ctx.subscriptions.push(${bindFn}(${JSON.stringify(binding)}, ctx));\n`;
    })
    .join("");

  const settingsSetup = ir.settingsPanel
    ? `  const settingsApp = bindSettingsApp(${JSON.stringify({
        viewType: ir.settingsPanel.viewType,
        title: ir.settingsPanel.title,
        prefix: ir.prefix,
        fields: ir.configs.map((c) => ({
          id: c.id,
          label: c.key.slice(c.key.indexOf(".") + 1),
          type: c.jsonType,
          description: c.description,
          enum: c.enum,
          minimum: c.minimum,
          maximum: c.maximum,
          default: c.default,
        })),
      })}, ctx);\n  ctx.subscriptions.push(settingsApp);\n  ctx.subscriptions.push(vscode.commands.registerCommand(${JSON.stringify(ir.settingsPanel.commandId)}, guard(${JSON.stringify(`comando ${ir.settingsPanel.commandId}`)}, () => settingsApp.open(), { notify: true })));\n`
    : "";

  const languageSetup = ir.languages
    .map((l) => {
      const binding = {
        key: l.key,
        selector: l.selector,
        hoverKey: l.hoverKey,
        inlineKey: l.inlineKey,
        completionKey: l.completionKey,
        completionTriggers: l.completionTriggers,
        codeLensKey: l.codeLensKey,
        diagnosticsKey: l.diagnosticsKey,
        diagnosticsOn: l.diagnosticsOn,
        codeActionKey: l.codeActionKey,
        codeActionKinds: l.codeActionKinds,
        definitionKey: l.definitionKey,
        referencesKey: l.referencesKey,
        renameKey: l.renameKey,
        formattingKey: l.formattingKey,
        symbolsKey: l.symbolsKey,
        inlayHintsKey: l.inlayHintsKey,
      };
      return `  ctx.subscriptions.push(bindLanguage(${JSON.stringify(binding)}, ctx));\n`;
    })
    .join("");

  const chatSetup = ir.chatParticipants
    .map((c) => {
      // description é assunto do MANIFESTO — o runtime só roteia por name→key
      const binding = compactEntry({
        key: c.key,
        id: c.id,
        requestKey: c.requestKey,
        followupsKey: c.followupsKey,
        commands: c.commands?.map((cmd) => ({ name: cmd.name, key: cmd.key })),
      });
      return `  ctx.subscriptions.push(bindChatParticipant(${JSON.stringify(binding)}, ctx));\n`;
    })
    .join("");

  const customEditorSetup = ir.customEditors
    .map((e) => {
      const binding = {
        key: e.key,
        viewType: e.viewType,
        uiEntry: e.uiEntry,
        handlers: e.messageHandlers,
        requests: e.requestHandlers,
      };
      return `  ctx.subscriptions.push(bindCustomEditor(${JSON.stringify(binding)}, ctx));\n`;
    })
    .join("");

  const extrasSetup = [
    ir.contextKeys.length > 0
      ? `  bindContextKeys(${JSON.stringify(ir.contextKeys.map((c) => ({ id: c.id, default: c.default })))});\n`
      : "",
    ir.secrets.length > 0
      ? `  ctx.subscriptions.push(await bindSecrets(${JSON.stringify(ir.secrets.map((s) => s.name))}));\n`
      : "",
    ir.events.length > 0
      ? `  ctx.subscriptions.push(bindEvents(${JSON.stringify(ir.events.map((e) => compactEntry({ key: e.key, event: e.event, debounce: e.debounce })))}));\n`
      : "",
    ir.fileWatchers.length > 0
      ? `  ctx.subscriptions.push(bindFileWatchers(${JSON.stringify(ir.fileWatchers.map((f) => compactEntry({ key: f.key, glob: f.glob, kind: f.kind, debounce: f.debounce })))}));\n`
      : "",
    ir.uriHandlerKey ? `  ctx.subscriptions.push(bindUriHandler(${JSON.stringify(ir.uriHandlerKey)}));\n` : "",
    ir.lmTools.length > 0
      ? `  ctx.subscriptions.push(bindLmTools(${JSON.stringify(ir.lmTools.map((t) => compactEntry({ key: t.key, name: t.name, invocationMessage: t.invocationMessage })))}));\n`
      : "",
    ir.mcpProviders.length > 0
      ? `  ctx.subscriptions.push(bindMcpServers(${JSON.stringify(ir.mcpProviders.map((m) => ({ key: m.key, id: m.id })))}));\n`
      : "",
    ...(ir.testControllers ?? []).map(
      (t) =>
        `  ctx.subscriptions.push(bindTestController(${JSON.stringify(compactEntry({ key: t.key, id: t.id, label: t.label, discoverKey: t.discoverKey, runKey: t.runKey }))}));\n`
    ),
    // timers @Every da classe @Extension (os de @Webview vivem no ciclo do painel)
    `  ctx.subscriptions.push(bindEvery(${JSON.stringify(ir.extensionClass)}));\n`,
  ].join("");

  const statusBarSetup = ir.statusBars
    .map((s) => {
      const binding = {
        key: s.key,
        alignment: s.alignment,
        priority: s.priority,
        command: s.command,
        tooltip: s.tooltip,
        name: s.name,
      };
      return `  ctx.subscriptions.push(bindStatusBar(${JSON.stringify(binding)}));\n`;
    })
    .join("");

  return `// GERADO POR sigil — NÃO EDITE
import * as vscode from "vscode";
import { ${coreImports.join(", ")} } from "@sigilkit/core";
${userImports}

const COMMANDS = ${JSON.stringify(cmds, null, 2)} as const;
const WATCHES = ${JSON.stringify(watches, null, 2)} as const;

let instance: ${ir.extensionClass} | undefined;

/**
 * (Re)instancia as classes e adota as registrações no registry. O hot swap
 * (sigil sandbox) re-executa isto num bundle recém-carregado: os registros do
 * VSCode ficam intactos e o dispatch dinâmico passa a apontar para os
 * handlers novos.
 */
export function __sigilHydrate() {
${hydrateLines}
}

/** Hot reload de UI: re-preenche o HTML dos webviews ABERTOS. */
export function __sigilRefreshWebviews() {
  for (const h of registry.webviews.values()) void h.refresh?.();
}

/** Roda o @Activate — na ativação e depois de cada hot swap. AGUARDADO:
 *  @Activate async segura a ativação até terminar (F9 do dogfood externo —
 *  fire-and-forget deixava comandos rodarem com a extensão pela metade);
 *  o guard mantém a rejeição alta no log sem matar a ativação. */
export async function __sigilActivateLifecycle() {
${ir.activateKey ? `  await guard("@Activate", () => registry.lifecycle.get(${JSON.stringify(ir.activateKey)})?.(registry.context))();\n` : ""}}

export async function activate(ctx: vscode.ExtensionContext) {
  registry.context = ctx;
  registry.prefix = ${JSON.stringify(ir.prefix)};
  ctx.subscriptions.push(bindLog(${JSON.stringify(ir.displayName)}));
  __sigilHydrate();
${treeSetup}${webviewSetup}${languageSetup}${chatSetup}${customEditorSetup}${extrasSetup}${statusBarSetup}${settingsSetup}  for (const c of COMMANDS) {
    if (!registry.commands.has(c.key)) throw new Error(\`sigil: handler ausente para \${c.key}. Rode 'sigil build'.\`);
    const invoke = (...args: unknown[]) => registry.commands.get(c.key)!(...args);
${
  ir.commands.some((c) => c.progress)
    ? `    const handler = "progress" in c && c.progress ? withCommandProgress(c.progress, invoke) : invoke;\n`
    : `    const handler = invoke;\n`
}    ctx.subscriptions.push(vscode.commands.registerCommand(c.id, guard(\`comando \${c.id}\`, handler, { notify: true })));
  }
  ctx.subscriptions.push(bindConfigWatchers(WATCHES));
  await __sigilActivateLifecycle();
}

export async function deactivate() {
${ir.deactivateKey ? `  await guard("@Deactivate", () => registry.lifecycle.get(${JSON.stringify(ir.deactivateKey)})?.())();\n` : ""}  instance = undefined;
}
`;
}
