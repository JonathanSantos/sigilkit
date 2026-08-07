import ts from "typescript";
import path from "node:path";
import {
  IR,
  IRChatParticipant,
  IRCommand,
  IRConfig,
  IRContextKey,
  IRCustomEditor,
  IREventHandler,
  IRFileWatcher,
  IRLanguage,
  IRLmTool,
  IRTestController,
  IRMcpProvider,
  IRSecret,
  IRSettingsPanel,
  IRStatusBar,
  IRTreeView,
  IRViewContainer,
  IRWatch,
  IRWebview,
  IR_VERSION,
  SourceLoc,
} from "../ir";
import { diagAt, diagGlobal, SIGIL } from "../diagnostics";
import { evalStatic, StaticEvalError, IdentifierResolver } from "./static-eval";
import { typeNodeToSchema, schemaFromValue, typeToToolSchema } from "./type-to-schema";
import { compact, toPosix } from "../util";

export interface CollectOptions {
  /**
   * Prefixo default (campo `name` do package.json do usuário). Emitters não
   * podem ler disco (R4/§13), então o valor entra no IR aqui, na coleta.
   */
  defaultPrefix: string;
  /** displayName do package.json (?? name) — canal de log, título do settings. */
  displayName?: string;
  projectDir: string;
}

export interface CollectResult {
  ir?: IR;
  diagnostics: ts.Diagnostic[];
}

export function getDecorator(
  node: ts.Node,
  checker: ts.TypeChecker,
  name: string
): ts.Decorator | undefined {
  if (!ts.canHaveDecorators(node)) return undefined;
  const decs = ts.getDecorators(node) ?? [];
  return decs.find((d) => resolveDecoratorName(d, checker) === name);
}

/**
 * Compara pelo símbolo, não pelo texto (§8.2): um @Command de outra biblioteca
 * não pode dar falso positivo. Um import produz um alias cuja declaração é o
 * ImportSpecifier no arquivo do usuário — sem resolver o alias primeiro, o
 * teste de origem abaixo olharia para o arquivo errado.
 */
function resolveDecoratorName(d: ts.Decorator, checker: ts.TypeChecker): string | undefined {
  const expr = ts.isCallExpression(d.expression) ? d.expression.expression : d.expression;
  let sym = checker.getSymbolAtLocation(expr);
  if (!sym) return undefined;
  if (sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
  const file = toPosix(sym.declarations?.[0]?.getSourceFile().fileName ?? "");
  if (!file.includes("@sigilkit/core") && !file.includes("packages/core")) return undefined;
  return sym.name;
}

const EVAL_FAILED: unique symbol = Symbol("sigil.evalFailed");

// Decorators de membro por espécie de classe (§8.5 + §15)
const EXTENSION_MEMBERS = [
  "Command",
  "Config",
  "Watch",
  "Activate",
  "Deactivate",
  "StatusBar",
  "On",
  "OnFile",
  "UriHandler",
  "State",
  "Secret",
  "ContextKey",
  "LmTool",
  "McpServers",
] as const;
const TREE_MEMBERS = ["TreeRoot", "TreeChildren", "TreeItem", "Command"] as const;
const WEBVIEW_MEMBERS = ["OnMessage", "OnRequest"] as const;
const LANGUAGE_MEMBERS = [
  "Hover", "Completion", "CodeLens", "Diagnostics", "InlineCompletion",
  "CodeAction", "Definition", "References", "Rename", "Formatting", "Symbols", "InlayHints",
] as const;
const CHAT_MEMBERS = ["ChatRequest", "ChatFollowups", "ChatCommand"] as const;
const TESTING_MEMBERS = ["TestDiscover", "TestRun"] as const;
const ALL_MEMBERS = [
  ...new Set([...EXTENSION_MEMBERS, ...TREE_MEMBERS, ...WEBVIEW_MEMBERS, ...LANGUAGE_MEMBERS, ...CHAT_MEMBERS, ...TESTING_MEMBERS]),
];
const CLASS_MARKS = ["Extension", "TreeView", "Webview", "Language", "ChatParticipant", "CustomEditor", "TestController"] as const;

export function collect(program: ts.Program, opts: CollectOptions): CollectResult {
  const checker = program.getTypeChecker();
  const diagnostics: ts.Diagnostic[] = [];

  /** Segue identificadores até `const` com initializer literal (item de DX; R3 intacta). */
  const resolveConst: IdentifierResolver = (id) => {
    let sym = checker.getSymbolAtLocation(id);
    if (!sym) return undefined;
    if (sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    const decl = sym.valueDeclaration ?? sym.declarations?.[0];
    if (!decl || !ts.isVariableDeclaration(decl)) return undefined;
    if (!(ts.getCombinedNodeFlags(decl) & ts.NodeFlags.Const)) return undefined;
    return decl.initializer;
  };

  function tryEval(node: ts.Expression, what = "argumento de decorator"): unknown {
    try {
      return evalStatic(node, resolveConst);
    } catch (e) {
      if (e instanceof StaticEvalError) {
        diagnostics.push(
          diagAt(e.node, SIGIL.NotStaticLiteral, `${what} precisa ser literal estático: ${e.message}`)
        );
        return EVAL_FAILED;
      }
      throw e;
    }
  }

  function locOf(node: ts.Node): SourceLoc {
    const sf = node.getSourceFile();
    const pos = sf.getLineAndCharacterOfPosition(node.getStart());
    return {
      file: toPosix(path.relative(opts.projectDir, sf.fileName)),
      line: pos.line + 1,
      character: pos.character + 1,
    };
  }

  function sourceFileOf(node: ts.Node): string {
    return toPosix(path.relative(opts.projectDir, node.getSourceFile().fileName));
  }

  function memberNameOf(name: ts.PropertyName): string {
    return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : name.getText();
  }

  function optionsNodeOf(dec: ts.Decorator): ts.Expression | undefined {
    return ts.isCallExpression(dec.expression) ? dec.expression.arguments[0] : undefined;
  }

  // ── categoriza as classes do projeto ───────────────────────────────────────
  const extensionClasses: ts.ClassDeclaration[] = [];
  const treeClasses: ts.ClassDeclaration[] = [];
  const webviewClasses: ts.ClassDeclaration[] = [];
  const languageClasses: ts.ClassDeclaration[] = [];
  const chatClasses: ts.ClassDeclaration[] = [];
  const customEditorClasses: ts.ClassDeclaration[] = [];
  const testControllerClasses: ts.ClassDeclaration[] = [];

  // @OnOpen/@OnDispose vivem em @Webview/@CustomEditor; @Every também na
  // @Extension. Em qualquer outra classe eram IGNORADOS em silêncio — SIGIL1022.
  const MISPLACED_LIFECYCLE: Record<string, readonly string[]> = {
    Extension: ["OnOpen", "OnDispose"],
    TreeView: ["OnOpen", "OnDispose", "Every"],
    Language: ["OnOpen", "OnDispose", "Every"],
    ChatParticipant: ["OnOpen", "OnDispose", "Every"],
    TestController: ["OnOpen", "OnDispose", "Every"],
  };
  const flagMisplacedLifecycle = (cls: ts.ClassDeclaration, mark: string): void => {
    const banned = MISPLACED_LIFECYCLE[mark];
    if (!banned) return;
    for (const member of cls.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      for (const decName of banned) {
        const dec = getDecorator(member, checker, decName);
        if (dec) {
          const onde =
            decName === "Every"
              ? "@Every vive na @Extension (ativação↔desativação) ou num @Webview/@CustomEditor (painel aberto)"
              : `@${decName} vive num @Webview/@CustomEditor`;
          diagnostics.push(
            diagAt(dec, SIGIL.MisplacedLifecycle, `@${decName} numa classe @${mark} é ignorado em runtime — ${onde}`)
          );
        }
      }
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) {
      const marks = CLASS_MARKS.filter((n) => getDecorator(node, checker, n));
      if (marks.length === 1) flagMisplacedLifecycle(node, marks[0]!);
      if (marks.length > 1) {
        diagnostics.push(
          diagAt(node.name ?? node, SIGIL.WrongClassForMember, `uma classe não pode ser ${marks.map((m) => `@${m}`).join(" e ")} ao mesmo tempo`)
        );
      } else if (marks[0] === "Extension") {
        extensionClasses.push(node);
      } else if (marks[0] === "TreeView") {
        treeClasses.push(node);
      } else if (marks[0] === "Webview") {
        webviewClasses.push(node);
      } else if (marks[0] === "Language") {
        languageClasses.push(node);
      } else if (marks[0] === "ChatParticipant") {
        chatClasses.push(node);
      } else if (marks[0] === "CustomEditor") {
        customEditorClasses.push(node);
      } else if (marks[0] === "TestController") {
        testControllerClasses.push(node);
      } else {
        // SIGIL1008: decorator do sigil em classe sem marcador nunca seria
        // registrado — falhar alto (R6) em vez de membro fantasma.
        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member) && !ts.isPropertyDeclaration(member)) continue;
          for (const decName of ALL_MEMBERS) {
            const dec = getDecorator(member, checker, decName);
            if (dec) {
              diagnostics.push(
                diagAt(dec, SIGIL.DecoratedOutsideExtension, `@${decName} em classe sem @Extension/@TreeView/@Webview — o membro nunca seria registrado`)
              );
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || toPosix(sf.fileName).includes("/node_modules/")) continue;
    visit(sf);
  }

  if (extensionClasses.length === 0) {
    diagnostics.push(diagGlobal(SIGIL.NoExtension, "nenhuma classe @Extension encontrada no projeto"));
    return { diagnostics };
  }
  if (extensionClasses.length > 1) {
    for (const extra of extensionClasses.slice(1)) {
      diagnostics.push(
        diagAt(extra.name ?? extra, SIGIL.MultipleExtensionClasses, "mais de uma classe @Extension no projeto")
      );
    }
    return { diagnostics };
  }

  const cls = extensionClasses[0]!;
  if (!cls.name) {
    diagnostics.push(diagAt(cls, SIGIL.NoExtension, "a classe @Extension precisa de um nome"));
    return { diagnostics };
  }
  const className = cls.name.text;

  // ── prefix: @Extension({ prefix }) ?? name do package.json ────────────────
  let prefix = opts.defaultPrefix;
  const extDec = getDecorator(cls, checker, "Extension")!;
  const extOptsNode = optionsNodeOf(extDec);
  let extRaw: Record<string, unknown> | null = null;
  if (extOptsNode) {
    const raw = tryEval(extOptsNode);
    if (raw === EVAL_FAILED) return { diagnostics };
    extRaw = raw as Record<string, unknown> | null;
    const p = extRaw?.prefix;
    if (typeof p === "string" && p.length > 0) prefix = p;
  }
  const displayName = opts.displayName ?? prefix;

  // ── @Extension({ settings }): a aba de configurações pronta ────────────────
  let settingsPanel: IRSettingsPanel | undefined;
  if (extRaw?.settings) {
    const s = extRaw.settings === true ? {} : extRaw.settings;
    if (s === null || typeof s !== "object") {
      diagnostics.push(
        diagAt(extOptsNode ?? cls.name, SIGIL.MissingRequiredOption, "settings de @Extension precisa ser true ou { title?, commandTitle? }")
      );
      return { diagnostics };
    }
    const so = s as { title?: unknown; commandTitle?: unknown };
    settingsPanel = {
      commandId: `${prefix}.configure`,
      commandTitle: typeof so.commandTitle === "string" ? so.commandTitle : "Configure",
      viewType: `${prefix}.sigilSettings`,
      title: typeof so.title === "string" ? so.title : `${displayName} — Configurações`,
      loc: locOf(cls.name),
    };
  }

  const commands: IRCommand[] = [];
  const configs: IRConfig[] = [];
  const watches: IRWatch[] = [];
  const treeViews: IRTreeView[] = [];
  const webviews: IRWebview[] = [];
  const viewContainers: IRViewContainer[] = [];
  const statusBars: IRStatusBar[] = [];
  const languages: IRLanguage[] = [];
  const chatParticipants: IRChatParticipant[] = [];
  const customEditors: IRCustomEditor[] = [];
  const events: IREventHandler[] = [];
  const lmTools: IRLmTool[] = [];
  const testControllers: IRTestController[] = [];
  const mcpProviders: IRMcpProvider[] = [];
  const fileWatchers: IRFileWatcher[] = [];
  const secrets: IRSecret[] = [];
  const contextKeys: IRContextKey[] = [];
  let activateKey: string | undefined;
  let deactivateKey: string | undefined;
  let uriHandlerKey: string | undefined;

  /** Container inline `{ id, title, icon }` → registra e retorna o id. */
  function collectContainer(raw: unknown, optsNode: ts.Expression, at: ts.Node): string | undefined {
    if (typeof raw === "string" && raw.length > 0) return raw;
    if (raw === undefined) return undefined;
    if (raw === null || typeof raw !== "object") {
      diagnostics.push(diagAt(optsNode, SIGIL.MissingRequiredOption, "container precisa ser string ou objeto { id, title, icon }"));
      return undefined;
    }
    const c = raw as Record<string, unknown>;
    for (const field of ["id", "title", "icon"] as const) {
      if (typeof c[field] !== "string" || (c[field] as string).length === 0) {
        diagnostics.push(diagAt(optsNode, SIGIL.MissingRequiredOption, `container inline exige '${field}' (string não vazia)`));
        return undefined;
      }
    }
    const container: IRViewContainer = {
      id: c.id as string,
      title: c.title as string,
      icon: c.icon as string,
      location: c.location === "panel" ? "panel" : "activitybar",
      loc: locOf(at),
    };
    const existing = viewContainers.find((v) => v.id === container.id);
    if (existing) {
      if (
        existing.title !== container.title ||
        existing.icon !== container.icon ||
        existing.location !== container.location
      ) {
        diagnostics.push(
          diagAt(optsNode, SIGIL.DuplicateViewId, `container '${container.id}' declarado duas vezes com opções diferentes`)
        );
      }
    } else {
      viewContainers.push(container);
    }
    return container.id;
  }

  /** @Command em classe @Extension ou @TreeView. viewId dá o `when` default de menus "view/*". */
  function collectCommand(m: ts.MethodDeclaration, ownerClass: string, viewId?: string): void {
    const methodName = memberNameOf(m.name);
    const key = `${ownerClass}.${methodName}`;
    const cmdDec = getDecorator(m, checker, "Command")!;

    const optsNode = optionsNodeOf(cmdDec);
    if (!optsNode) {
      diagnostics.push(diagAt(m.name, SIGIL.CommandWithoutTitle, "@Command precisa de opções com 'title'"));
      return;
    }
    const raw = tryEval(optsNode);
    if (raw === EVAL_FAILED) return;
    const o = raw as Record<string, unknown>;
    if (typeof o.title !== "string" || o.title.length === 0) {
      diagnostics.push(diagAt(optsNode, SIGIL.CommandWithoutTitle, "@Command sem 'title'"));
      return;
    }

    let keybinding: IRCommand["keybinding"];
    if (typeof o.keybinding === "string") keybinding = { key: o.keybinding };
    else if (o.keybinding && typeof o.keybinding === "object") {
      keybinding = compact(
        o.keybinding as { key: string; mac?: string; linux?: string; win?: string; when?: string }
      );
    }

    // menu: "id" | ["id", { id, group?, when? }, ...] — opções por entrada,
    // com group/when do nível do comando como default
    const rawMenus = o.menu === undefined ? [] : Array.isArray(o.menu) ? o.menu : [o.menu];
    const menus: IRCommand["menus"] = [];
    for (const entry of rawMenus) {
      const isObject = entry !== null && typeof entry === "object";
      const menuId = isObject ? (entry as { id?: unknown }).id : entry;
      if (typeof menuId !== "string" || menuId.length === 0) {
        diagnostics.push(diagAt(optsNode, SIGIL.MissingRequiredOption, "entrada de menu precisa de um id (string não vazia)"));
        continue;
      }
      let when = (isObject ? ((entry as { when?: unknown }).when as string | undefined) : undefined) ??
        (o.when as string | undefined);
      // comando de @TreeView em menu "view/*" sem `when` explícito: escopa à
      // própria view — sem isso o item apareceria em TODAS as views
      if (when === undefined && viewId && menuId.startsWith("view/")) when = `view == ${viewId}`;
      const group =
        (isObject ? ((entry as { group?: unknown }).group as string | undefined) : undefined) ??
        (o.group as string | undefined);
      menus.push(compact({ menu: menuId, group, when }));
    }

    let progress: IRCommand["progress"];
    if (typeof o.progress === "string") progress = { title: o.progress };
    else if (o.progress && typeof o.progress === "object") {
      progress = compact(o.progress as { title: string; location?: "notification" | "window" | "statusBar"; cancellable?: boolean });
    }

    if (o.id !== undefined && (typeof o.id !== "string" || o.id.length === 0)) {
      diagnostics.push(diagAt(optsNode, SIGIL.NotStaticLiteral, "o 'id' de @Command precisa ser uma string literal não vazia"));
      return;
    }

    commands.push(
      compact({
        key,
        id: `${prefix}.${(o.id as string | undefined) ?? methodName}`,
        title: o.title,
        category: o.category as string | undefined,
        icon: o.icon as string | undefined,
        when: o.when as string | undefined,
        enablement: o.enablement as string | undefined,
        keybinding,
        menus,
        progress,
        loc: locOf(m.name),
      }) as IRCommand
    );
  }

  function rejectMember(m: ts.ClassElement, names: readonly string[], where: string): boolean {
    for (const decName of names) {
      const dec = getDecorator(m, checker, decName);
      if (dec) {
        diagnostics.push(diagAt(dec, SIGIL.WrongClassForMember, `@${decName} não pertence a uma classe ${where}`));
        return true;
      }
    }
    return false;
  }

  // ── membros da classe @Extension ───────────────────────────────────────────
  function collectExtensionMethod(m: ts.MethodDeclaration): void {
    if (
      rejectMember(
        m,
        ["TreeRoot", "TreeChildren", "TreeItem", "OnMessage", "OnRequest", ...LANGUAGE_MEMBERS, ...CHAT_MEMBERS],
        "@Extension"
      )
    ) {
      return;
    }

    const methodName = memberNameOf(m.name);
    const key = `${className}.${methodName}`;

    if (getDecorator(m, checker, "Command")) {
      collectCommand(m, className);
      return;
    }

    const watchDec = getDecorator(m, checker, "Watch");
    if (watchDec) {
      const arg = optionsNodeOf(watchDec);
      const target = arg ? tryEval(arg) : undefined;
      if (target === EVAL_FAILED) return;
      if (typeof target !== "string" || target.length === 0) {
        diagnostics.push(
          diagAt(arg ?? m.name, SIGIL.NotStaticLiteral, "@Watch precisa de um nome de config literal (string)")
        );
        return;
      }
      watches.push({ key, targetConfigId: `${prefix}.${target}`, loc: locOf(m.name) });
      return;
    }

    const onDec = getDecorator(m, checker, "On");
    if (onDec) {
      const call = ts.isCallExpression(onDec.expression) ? onDec.expression : undefined;
      const eventRaw = call?.arguments[0] ? tryEval(call.arguments[0]) : undefined;
      if (eventRaw === EVAL_FAILED) return;
      if (typeof eventRaw !== "string" || !/^\w+\.on[A-Z]\w*$/.test(eventRaw)) {
        diagnostics.push(
          diagAt(call?.arguments[0] ?? m.name, SIGIL.MissingRequiredOption, `@On exige um caminho de evento como "workspace.onDidSaveTextDocument"`)
        );
        return;
      }
      const optsRaw = call?.arguments[1] ? tryEval(call.arguments[1]) : {};
      if (optsRaw === EVAL_FAILED) return;
      const debounce = (optsRaw as { debounce?: unknown } | null)?.debounce;
      events.push(
        compact({ key, event: eventRaw, debounce: typeof debounce === "number" ? debounce : undefined, loc: locOf(m.name) }) as IREventHandler
      );
      return;
    }

    const onFileDec = getDecorator(m, checker, "OnFile");
    if (onFileDec) {
      const call = ts.isCallExpression(onFileDec.expression) ? onFileDec.expression : undefined;
      const glob = call?.arguments[0] ? tryEval(call.arguments[0]) : undefined;
      if (glob === EVAL_FAILED) return;
      if (typeof glob !== "string" || glob.length === 0) {
        diagnostics.push(diagAt(call?.arguments[0] ?? m.name, SIGIL.MissingRequiredOption, "@OnFile exige um glob (string)"));
        return;
      }
      const kindRaw = call?.arguments[1] ? tryEval(call.arguments[1]) : "all";
      if (kindRaw === EVAL_FAILED) return;
      const kind = kindRaw === "change" || kindRaw === "create" || kindRaw === "delete" ? kindRaw : "all";
      const optsRaw = call?.arguments[2] ? tryEval(call.arguments[2]) : {};
      if (optsRaw === EVAL_FAILED) return;
      const debounce = (optsRaw as { debounce?: unknown } | null)?.debounce;
      fileWatchers.push(
        compact({ key, glob, kind, debounce: typeof debounce === "number" ? debounce : undefined, loc: locOf(m.name) }) as IRFileWatcher
      );
      return;
    }

    if (getDecorator(m, checker, "UriHandler")) {
      if (uriHandlerKey) {
        diagnostics.push(diagAt(m.name, SIGIL.TreeViewIncomplete, "apenas um @UriHandler por extensão"));
        return;
      }
      uriHandlerKey = key;
      return;
    }

    const lmToolDec = getDecorator(m, checker, "LmTool");
    if (lmToolDec) {
      const optsNode = optionsNodeOf(lmToolDec);
      const raw = optsNode ? tryEval(optsNode) : undefined;
      if (raw === EVAL_FAILED) return;
      const o = (raw ?? {}) as Record<string, unknown>;
      if (typeof o.description !== "string" || o.description.length === 0) {
        diagnostics.push(
          diagAt(optsNode ?? m.name, SIGIL.MissingRequiredOption, "@LmTool exige 'description' (o modelo decide usar a tool por ela)")
        );
        return;
      }
      // inputSchema DERIVADO do tipo do primeiro parâmetro (assinatura sigil)
      let inputSchema: Record<string, unknown> | undefined;
      const param = m.parameters[0];
      if (param) {
        const paramType = checker.getTypeAtLocation(param);
        inputSchema = typeToToolSchema(paramType, checker);
        if (!inputSchema || inputSchema.type !== "object") {
          diagnostics.push(
            diagAt(param, SIGIL.UnsupportedToolInput, `o input de @LmTool '${methodName}' precisa ser um objeto de primitivos/uniões de literais/arrays/objetos aninhados — o schema é derivado dele`)
          );
          return;
        }
      }
      // nomes de tool são globais: prefixo com _ (padrão do marketplace)
      const toolName = `${prefix.replace(/[^\w-]/g, "_")}_${(o.name as string | undefined) ?? methodName}`;
      lmTools.push(
        compact({
          key,
          name: toolName,
          description: o.description,
          displayName: o.displayName as string | undefined,
          userDescription: o.userDescription as string | undefined,
          referenceName: o.referenceName as string | undefined,
          invocationMessage: o.invocationMessage as string | undefined,
          tags: Array.isArray(o.tags) ? (o.tags as string[]) : undefined,
          inputSchema,
          loc: locOf(m.name),
        }) as IRLmTool
      );
      return;
    }

    const mcpDec = getDecorator(m, checker, "McpServers");
    if (mcpDec) {
      const optsNode = optionsNodeOf(mcpDec);
      const raw = optsNode ? tryEval(optsNode) : undefined;
      if (raw === EVAL_FAILED) return;
      const o = (raw ?? {}) as Record<string, unknown>;
      if (typeof o.label !== "string" || o.label.length === 0) {
        diagnostics.push(
          diagAt(optsNode ?? m.name, SIGIL.MissingRequiredOption, "@McpServers exige 'label' (nome exibido ao usuário)")
        );
        return;
      }
      mcpProviders.push(
        compact({
          key,
          id: `${prefix}.${(o.id as string | undefined) ?? methodName}`,
          label: o.label,
          loc: locOf(m.name),
        }) as IRMcpProvider
      );
      return;
    }

    if (getDecorator(m, checker, "Activate")) {
      activateKey = key;
      return;
    }
    if (getDecorator(m, checker, "Deactivate")) {
      deactivateKey = key;
      return;
    }
  }

  function requireAccessor(p: ts.PropertyDeclaration, decoratorName: string, propName: string): boolean {
    const isAutoAccessor = !!p.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.AccessorKeyword);
    if (!isAutoAccessor) {
      diagnostics.push(
        diagAt(p.name, SIGIL.ConfigWithoutAccessor, `@${decoratorName} exige a palavra-chave 'accessor': "accessor ${propName} = ..." (§6 do spec)`)
      );
    }
    return isAutoAccessor;
  }

  function collectExtensionProperty(p: ts.PropertyDeclaration): void {
    const propName = memberNameOf(p.name);

    const stateDec = getDecorator(p, checker, "State");
    if (stateDec) {
      requireAccessor(p, "State", propName); // sem IR: @State é só comportamento
      return;
    }
    const secretDec = getDecorator(p, checker, "Secret");
    if (secretDec) {
      if (!requireAccessor(p, "Secret", propName)) return;
      secrets.push({ key: `${className}.${propName}`, name: propName, loc: locOf(p.name) });
      return;
    }
    const ctxKeyDec = getDecorator(p, checker, "ContextKey");
    if (ctxKeyDec) {
      if (!requireAccessor(p, "ContextKey", propName)) return;
      let def: unknown = false;
      if (p.initializer) {
        const evaluated = tryEval(p.initializer, `o default de @ContextKey em '${propName}'`);
        if (evaluated === EVAL_FAILED) return;
        def = evaluated;
      }
      contextKeys.push({ key: `${className}.${propName}`, id: `${prefix}.${propName}`, default: def, loc: locOf(p.name) });
      return;
    }

    const sbDec = getDecorator(p, checker, "StatusBar");
    const cfgDec = getDecorator(p, checker, "Config");
    if (sbDec && cfgDec) {
      diagnostics.push(diagAt(sbDec, SIGIL.WrongClassForMember, "uma propriedade não pode ser @Config e @StatusBar ao mesmo tempo"));
      return;
    }

    if (sbDec) {
      if (!requireAccessor(p, "StatusBar", propName)) return;
      if (!p.initializer) {
        diagnostics.push(diagAt(p.name, SIGIL.ConfigWithoutDefault, `o @StatusBar '${propName}' precisa de um texto default literal`));
        return;
      }
      const text = tryEval(p.initializer, `o texto default de @StatusBar em '${propName}'`);
      if (text === EVAL_FAILED) return;
      if (typeof text !== "string") {
        diagnostics.push(diagAt(p.initializer, SIGIL.UnsupportedConfigType, `@StatusBar '${propName}' precisa de um default string`));
        return;
      }
      const optsNode = optionsNodeOf(sbDec);
      const raw = optsNode ? tryEval(optsNode) : {};
      if (raw === EVAL_FAILED) return;
      const o = (raw ?? {}) as Record<string, unknown>;
      const alignment = o.alignment;
      if (alignment !== undefined && alignment !== "left" && alignment !== "right") {
        diagnostics.push(diagAt(optsNode ?? p.name, SIGIL.MissingRequiredOption, `alignment de @StatusBar precisa ser "left" ou "right"`));
        return;
      }
      statusBars.push(
        compact({
          key: `${className}.${propName}`,
          text,
          alignment: alignment as "left" | "right" | undefined,
          priority: o.priority as number | undefined,
          command: o.command as string | undefined,
          tooltip: o.tooltip as string | undefined,
          name: o.name as string | undefined,
          loc: locOf(p.name),
        }) as IRStatusBar
      );
      return;
    }

    if (!cfgDec) return;
    if (!requireAccessor(p, "Config", propName)) return;

    let schema = p.type ? typeNodeToSchema(p.type, checker) : undefined;
    if (p.type && !schema) {
      diagnostics.push(
        diagAt(p.type, SIGIL.UnsupportedConfigType, `tipo de config não suportado em '${propName}' (use string, number, boolean, array de primitivos, união de literais string ou object literal type)`)
      );
      return;
    }
    if (!p.initializer) {
      diagnostics.push(
        diagAt(p.name, SIGIL.ConfigWithoutDefault, `a config '${propName}' precisa de um valor default literal`)
      );
      return;
    }
    const def = tryEval(p.initializer, `o default de @Config em '${propName}'`);
    if (def === EVAL_FAILED) return;
    schema ??= schemaFromValue(def);
    if (!schema) {
      diagnostics.push(
        diagAt(p.name, SIGIL.UnsupportedConfigType, `não foi possível inferir o tipo da config '${propName}' a partir do default — anote o tipo na propriedade`)
      );
      return;
    }

    const optsNode = optionsNodeOf(cfgDec);
    const raw = optsNode ? tryEval(optsNode) : {};
    if (raw === EVAL_FAILED) return;
    const o = (raw ?? {}) as Record<string, unknown>;

    configs.push(
      compact({
        key: `${className}.${propName}`,
        id: `${prefix}.${propName}`,
        jsonType: schema.jsonType,
        tsType: schema.tsType,
        default: def,
        description: o.description as string | undefined,
        scope: o.scope as string | undefined,
        enum: (o.enum as unknown[] | undefined) ?? schema.enum,
        minimum: o.minimum as number | undefined,
        maximum: o.maximum as number | undefined,
        deprecationMessage: o.deprecationMessage as string | undefined,
        items: schema.items,
        loc: locOf(p.name),
      }) as IRConfig
    );
  }

  for (const member of cls.members) {
    if (ts.isMethodDeclaration(member)) collectExtensionMethod(member);
    else if (ts.isPropertyDeclaration(member)) collectExtensionProperty(member);
  }

  // ── classes @TreeView (§15.1) ──────────────────────────────────────────────
  function collectTreeClass(tree: ts.ClassDeclaration): void {
    if (!tree.name) {
      diagnostics.push(diagAt(tree, SIGIL.TreeViewIncomplete, "a classe @TreeView precisa de um nome"));
      return;
    }
    const treeClassName = tree.name.text;
    const dec = getDecorator(tree, checker, "TreeView")!;
    const optsNode = optionsNodeOf(dec);
    if (!optsNode) {
      diagnostics.push(diagAt(tree.name, SIGIL.MissingRequiredOption, "@TreeView exige opções { id, name }"));
      return;
    }
    const raw = tryEval(optsNode);
    if (raw === EVAL_FAILED) return;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== "string" || o.id.length === 0 || typeof o.name !== "string" || o.name.length === 0) {
      diagnostics.push(diagAt(optsNode, SIGIL.MissingRequiredOption, "@TreeView exige 'id' e 'name' (strings não vazias)"));
      return;
    }
    const viewId = `${prefix}.${o.id}`;
    const container = collectContainer(o.container, optsNode, tree.name) ?? "explorer";

    let rootsKey: string | undefined;
    let childrenKey: string | undefined;
    let itemKey: string | undefined;

    const markerFor = (m: ts.MethodDeclaration, name: string): boolean =>
      getDecorator(m, checker, name) !== undefined;

    for (const member of tree.members) {
      if (ts.isPropertyDeclaration(member)) {
        rejectMember(member, ["Config", "StatusBar"], "@TreeView (pertence à classe @Extension)");
        continue;
      }
      if (!ts.isMethodDeclaration(member)) continue;
      if (
        rejectMember(
          member,
          ["Watch", "Activate", "Deactivate", "OnMessage", "OnRequest", ...LANGUAGE_MEMBERS, ...CHAT_MEMBERS],
          "@TreeView"
        )
      ) {
        continue;
      }

      const key = `${treeClassName}.${memberNameOf(member.name)}`;
      if (markerFor(member, "TreeRoot")) {
        if (rootsKey) {
          diagnostics.push(diagAt(member.name, SIGIL.TreeViewIncomplete, "apenas um @TreeRoot por @TreeView"));
          continue;
        }
        rootsKey = key;
      } else if (markerFor(member, "TreeChildren")) {
        if (childrenKey) {
          diagnostics.push(diagAt(member.name, SIGIL.TreeViewIncomplete, "apenas um @TreeChildren por @TreeView"));
          continue;
        }
        childrenKey = key;
      } else if (markerFor(member, "TreeItem")) {
        if (itemKey) {
          diagnostics.push(diagAt(member.name, SIGIL.TreeViewIncomplete, "apenas um @TreeItem por @TreeView"));
          continue;
        }
        itemKey = key;
      } else if (markerFor(member, "Command")) {
        collectCommand(member, treeClassName, viewId);
      }
    }

    if (!rootsKey || !itemKey) {
      diagnostics.push(
        diagAt(tree.name, SIGIL.TreeViewIncomplete, `@TreeView '${treeClassName}' precisa de um método @TreeRoot e um @TreeItem`)
      );
      return;
    }

    if (o.when !== undefined && typeof o.when !== "string") {
      diagnostics.push(diagAt(optsNode, SIGIL.NotStaticLiteral, "o 'when' de @TreeView precisa ser uma string literal"));
      return;
    }

    treeViews.push(
      compact({
        key: treeClassName,
        id: viewId,
        name: o.name,
        when: o.when as string | undefined,
        container,
        rootsKey,
        childrenKey,
        itemKey,
        sourceFile: sourceFileOf(tree),
        loc: locOf(tree.name),
      }) as IRTreeView
    );
  }

  /** @OnMessage/@OnRequest de uma classe de UI (@Webview ou @CustomEditor). */
  function collectUiHandlers(
    cls: ts.ClassDeclaration,
    className: string,
    where: string
  ): { handlers: { type: string; key: string }[]; requests: { type: string; key: string }[] } {
    const handlers: { type: string; key: string }[] = [];
    const requests: { type: string; key: string }[] = [];
    const seen = new Set<string>();

    for (const member of cls.members) {
      if (ts.isPropertyDeclaration(member)) {
        rejectMember(member, ["Config", "StatusBar"], `${where} (pertence à classe @Extension)`);
        continue;
      }
      if (!ts.isMethodDeclaration(member)) continue;
      if (
        rejectMember(
          member,
          ["Command", "Watch", "Activate", "Deactivate", "TreeRoot", "TreeChildren", "TreeItem", ...LANGUAGE_MEMBERS, ...CHAT_MEMBERS],
          where
        )
      ) {
        continue;
      }

      const msgDec = getDecorator(member, checker, "OnMessage");
      const reqDec = getDecorator(member, checker, "OnRequest");
      if (msgDec && reqDec) {
        diagnostics.push(
          diagAt(reqDec, SIGIL.WrongClassForMember, "um método não pode ser @OnMessage e @OnRequest ao mesmo tempo")
        );
        continue;
      }
      const dec = msgDec ?? reqDec;
      if (!dec) continue;
      const decoratorName = msgDec ? "OnMessage" : "OnRequest";
      const arg = optionsNodeOf(dec);
      const type = arg ? tryEval(arg) : undefined;
      if (type === EVAL_FAILED) continue;
      if (typeof type !== "string" || type.length === 0) {
        diagnostics.push(
          diagAt(arg ?? member.name, SIGIL.NotStaticLiteral, `@${decoratorName} precisa de um tipo de mensagem literal (string)`)
        );
        continue;
      }
      if (seen.has(type)) {
        diagnostics.push(
          diagAt(arg ?? member.name, SIGIL.DuplicateMessageType, `tipo de mensagem duplicado em @${decoratorName}: '${type}'`)
        );
        continue;
      }
      seen.add(type);
      (msgDec ? handlers : requests).push({ type, key: `${className}.${memberNameOf(member.name)}` });
    }

    const byType = (a: { type: string }, b: { type: string }) =>
      a.type < b.type ? -1 : a.type > b.type ? 1 : 0;
    handlers.sort(byType);
    requests.sort(byType);
    return { handlers, requests };
  }

  // ── classes @Webview (§15.2) — painel sob demanda ou view de sidebar ───────
  function collectWebviewClass(wv: ts.ClassDeclaration): void {
    if (!wv.name) {
      diagnostics.push(diagAt(wv, SIGIL.MissingRequiredOption, "a classe @Webview precisa de um nome"));
      return;
    }
    const wvClassName = wv.name.text;
    const dec = getDecorator(wv, checker, "Webview")!;
    const optsNode = optionsNodeOf(dec);
    if (!optsNode) {
      diagnostics.push(diagAt(wv.name, SIGIL.MissingRequiredOption, "@Webview exige opções { id, title, ui }"));
      return;
    }
    const raw = tryEval(optsNode);
    if (raw === EVAL_FAILED) return;
    const o = raw as Record<string, unknown>;
    for (const field of ["id", "title", "ui"] as const) {
      if (typeof o[field] !== "string" || (o[field] as string).length === 0) {
        diagnostics.push(diagAt(optsNode, SIGIL.MissingRequiredOption, `@Webview exige '${field}' (string não vazia)`));
        return;
      }
    }
    if (o.when !== undefined && (typeof o.when !== "string" || (o.location ?? "panel") === "panel")) {
      diagnostics.push(
        diagAt(optsNode, SIGIL.MissingRequiredOption, "o 'when' de @Webview só existe para location \"sidebar\"/\"dual\" (painéis não têm entrada em contributes.views)")
      );
      return;
    }
    const location = o.location ?? "panel";
    if (location !== "panel" && location !== "sidebar" && location !== "dual") {
      diagnostics.push(diagAt(optsNode, SIGIL.MissingRequiredOption, `location de @Webview precisa ser "panel", "sidebar" ou "dual"`));
      return;
    }
    let container: string | undefined;
    if (location === "sidebar" || location === "dual") {
      container = collectContainer(o.container, optsNode, wv.name) ?? "explorer";
    } else if (o.container !== undefined) {
      diagnostics.push(diagAt(optsNode, SIGIL.MissingRequiredOption, `'container' só vale para @Webview com location: "sidebar" ou "dual"`));
      return;
    }

    const { handlers, requests } = collectUiHandlers(wv, wvClassName, "@Webview");

    webviews.push(
      compact({
        key: wvClassName,
        id: `${prefix}.${o.id}`,
        title: o.title as string,
        uiEntry: toPosix(o.ui as string).replace(/^\.\//, ""),
        location,
        name: location === "sidebar" || location === "dual" ? ((o.name as string | undefined) ?? (o.title as string)) : undefined,
        when: o.when as string | undefined,
        container,
        messageHandlers: handlers,
        requestHandlers: requests,
        sourceFile: sourceFileOf(wv),
        loc: locOf(wv.name),
      }) as IRWebview
    );
  }

  // ── classes @Language: providers de hover/completion/code lens/diagnostics ─
  function collectLanguageClass(lang: ts.ClassDeclaration): void {
    if (!lang.name) {
      diagnostics.push(diagAt(lang, SIGIL.MissingRequiredOption, "a classe @Language precisa de um nome"));
      return;
    }
    const langClassName = lang.name.text;
    const dec = getDecorator(lang, checker, "Language")!;
    const optsNode = optionsNodeOf(dec);
    const raw = optsNode ? tryEval(optsNode) : undefined;
    if (raw === EVAL_FAILED) return;
    const o = (raw ?? {}) as Record<string, unknown>;
    const rawId = o.id;
    const selector = (typeof rawId === "string" ? [rawId] : Array.isArray(rawId) ? rawId : []).filter(
      (s): s is string => typeof s === "string" && s.length > 0
    );
    if (selector.length === 0) {
      diagnostics.push(diagAt(optsNode ?? lang.name, SIGIL.MissingRequiredOption, "@Language exige 'id' (string ou string[])"));
      return;
    }
    selector.sort();

    // DSL própria (F4 do dogfood): extensions/aliases/configuration viram
    // contributes.languages — e aí o id precisa ser ÚNICO (a entrada é por id)
    let langExtensions: string[] | undefined;
    let langAliases: string[] | undefined;
    let langConfiguration: string | undefined;
    let langGrammar: string | undefined;
    if (o.grammar !== undefined) {
      if (typeof o.grammar !== "string" || o.grammar.length === 0) {
        diagnostics.push(diagAt(optsNode ?? lang.name, SIGIL.MissingRequiredOption, "'grammar' de @Language precisa ser um caminho (string) para o tmLanguage.json"));
        return;
      }
      if (selector.length > 1) {
        diagnostics.push(diagAt(optsNode ?? lang.name, SIGIL.MissingRequiredOption, "'grammar' de @Language exige um ÚNICO id"));
        return;
      }
      langGrammar = toPosix(o.grammar).replace(/^\.\//, "");
    }
    if (o.extensions !== undefined || o.aliases !== undefined || o.configuration !== undefined) {
      if (selector.length > 1) {
        diagnostics.push(
          diagAt(optsNode ?? lang.name, SIGIL.MissingRequiredOption, "extensions/aliases/configuration de @Language exigem um ÚNICO id (a entrada de contributes.languages é por id)")
        );
        return;
      }
      if (o.extensions !== undefined) {
        if (!Array.isArray(o.extensions) || o.extensions.some((e) => typeof e !== "string" || e.length === 0)) {
          diagnostics.push(diagAt(optsNode ?? lang.name, SIGIL.MissingRequiredOption, "'extensions' de @Language precisa ser string[] (ex.: [\".mock\"])"));
          return;
        }
        langExtensions = (o.extensions as string[]).map((e) => (e.startsWith(".") ? e : `.${e}`));
      }
      if (o.aliases !== undefined) {
        if (!Array.isArray(o.aliases) || o.aliases.some((a) => typeof a !== "string")) {
          diagnostics.push(diagAt(optsNode ?? lang.name, SIGIL.MissingRequiredOption, "'aliases' de @Language precisa ser string[]"));
          return;
        }
        langAliases = o.aliases as string[];
      }
      if (o.configuration !== undefined) {
        if (typeof o.configuration !== "string" || o.configuration.length === 0) {
          diagnostics.push(diagAt(optsNode ?? lang.name, SIGIL.MissingRequiredOption, "'configuration' de @Language precisa ser um caminho (string)"));
          return;
        }
        langConfiguration = toPosix(o.configuration).replace(/^\.\//, "");
      }
    }

    let hoverKey: string | undefined;
    let inlineKey: string | undefined;
    let completionKey: string | undefined;
    let completionTriggers: string[] | undefined;
    let codeLensKey: string | undefined;
    let diagnosticsKey: string | undefined;
    let diagnosticsOn: "change" | "save" | undefined;
    let codeActionKey: string | undefined;
    let codeActionKinds: string[] | undefined;
    let definitionKey: string | undefined;
    let referencesKey: string | undefined;
    let renameKey: string | undefined;
    let formattingKey: string | undefined;
    let symbolsKey: string | undefined;
    let inlayHintsKey: string | undefined;

    const single = (current: string | undefined, name: string, node: ts.Node): boolean => {
      if (current) {
        diagnostics.push(diagAt(node, SIGIL.TreeViewIncomplete, `apenas um @${name} por @Language`));
        return false;
      }
      return true;
    };

    for (const member of lang.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      if (
        rejectMember(
          member,
          ["Command", "Config", "Watch", "Activate", "Deactivate", "OnMessage", "OnRequest", "TreeRoot", "TreeChildren", "TreeItem", ...CHAT_MEMBERS],
          "@Language"
        )
      ) {
        continue;
      }
      const key = `${langClassName}.${memberNameOf(member.name)}`;
      const hoverDec = getDecorator(member, checker, "Hover");
      const complDec = getDecorator(member, checker, "Completion");
      const lensDec = getDecorator(member, checker, "CodeLens");
      const diagDec = getDecorator(member, checker, "Diagnostics");
      if (hoverDec && single(hoverKey, "Hover", member.name)) hoverKey = key;
      const inlineDec = getDecorator(member, checker, "InlineCompletion");
      if (inlineDec && single(inlineKey, "InlineCompletion", member.name)) inlineKey = key;
      else if (complDec && single(completionKey, "Completion", member.name)) {
        completionKey = key;
        const cOpts = optionsNodeOf(complDec) ? tryEval(optionsNodeOf(complDec)!) : {};
        if (cOpts === EVAL_FAILED) return;
        const triggers = (cOpts as { triggerCharacters?: unknown } | null)?.triggerCharacters;
        if (Array.isArray(triggers)) completionTriggers = triggers.map(String);
      } else if (lensDec && single(codeLensKey, "CodeLens", member.name)) codeLensKey = key;
      else if (diagDec && single(diagnosticsKey, "Diagnostics", member.name)) {
        diagnosticsKey = key;
        const dOpts = optionsNodeOf(diagDec) ? tryEval(optionsNodeOf(diagDec)!) : {};
        if (dOpts === EVAL_FAILED) return;
        const on = (dOpts as { on?: unknown } | null)?.on;
        if (on === "save" || on === "change") diagnosticsOn = on;
      }

      const actionDec = getDecorator(member, checker, "CodeAction");
      if (actionDec && single(codeActionKey, "CodeAction", member.name)) {
        codeActionKey = key;
        const aOpts = optionsNodeOf(actionDec) ? tryEval(optionsNodeOf(actionDec)!) : {};
        if (aOpts === EVAL_FAILED) return;
        const kinds = (aOpts as { kinds?: unknown } | null)?.kinds;
        if (Array.isArray(kinds)) codeActionKinds = kinds.map(String);
      }
      const defDec = getDecorator(member, checker, "Definition");
      if (defDec && single(definitionKey, "Definition", member.name)) definitionKey = key;
      const refDec = getDecorator(member, checker, "References");
      if (refDec && single(referencesKey, "References", member.name)) referencesKey = key;
      const renDec = getDecorator(member, checker, "Rename");
      if (renDec && single(renameKey, "Rename", member.name)) renameKey = key;
      const fmtDec = getDecorator(member, checker, "Formatting");
      if (fmtDec && single(formattingKey, "Formatting", member.name)) formattingKey = key;
      const symDec = getDecorator(member, checker, "Symbols");
      if (symDec && single(symbolsKey, "Symbols", member.name)) symbolsKey = key;
      const hintDec = getDecorator(member, checker, "InlayHints");
      if (hintDec && single(inlayHintsKey, "InlayHints", member.name)) inlayHintsKey = key;
    }

    const anyProvider =
      hoverKey || inlineKey || completionKey || codeLensKey || diagnosticsKey ||
      codeActionKey || definitionKey || referencesKey || renameKey ||
      formattingKey || symbolsKey || inlayHintsKey;
    if (!anyProvider) {
      diagnostics.push(
        diagAt(lang.name, SIGIL.TreeViewIncomplete, `@Language '${langClassName}' precisa de ao menos um provider (@Hover, @Completion, @CodeAction, @Definition, …)`)
      );
      return;
    }

    languages.push(
      compact({
        key: langClassName,
        selector,
        extensions: langExtensions,
        aliases: langAliases,
        configuration: langConfiguration,
        grammar: langGrammar,
        hoverKey,
        inlineKey,
        completionKey,
        completionTriggers,
        codeLensKey,
        diagnosticsKey,
        diagnosticsOn,
        codeActionKey,
        codeActionKinds,
        definitionKey,
        referencesKey,
        renameKey,
        formattingKey,
        symbolsKey,
        inlayHintsKey,
        sourceFile: sourceFileOf(lang),
        loc: locOf(lang.name),
      }) as IRLanguage
    );
  }

  // ── classes @ChatParticipant ───────────────────────────────────────────────
  function collectChatClass(chat: ts.ClassDeclaration): void {
    if (!chat.name) {
      diagnostics.push(diagAt(chat, SIGIL.MissingRequiredOption, "a classe @ChatParticipant precisa de um nome"));
      return;
    }
    const chatClassName = chat.name.text;
    const dec = getDecorator(chat, checker, "ChatParticipant")!;
    const optsNode = optionsNodeOf(dec);
    const raw = optsNode ? tryEval(optsNode) : undefined;
    if (raw === EVAL_FAILED) return;
    const o = (raw ?? {}) as Record<string, unknown>;
    for (const field of ["id", "name"] as const) {
      if (typeof o[field] !== "string" || (o[field] as string).length === 0) {
        diagnostics.push(diagAt(optsNode ?? chat.name, SIGIL.MissingRequiredOption, `@ChatParticipant exige '${field}' (string não vazia)`));
        return;
      }
    }

    let requestKey: string | undefined;
    let followupsKey: string | undefined;
    const chatCommands: { name: string; description?: string; key: string }[] = [];
    for (const member of chat.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      if (
        rejectMember(
          member,
          ["Command", "Config", "Watch", "Activate", "Deactivate", "OnMessage", "OnRequest", "TreeRoot", "TreeChildren", "TreeItem", ...LANGUAGE_MEMBERS],
          "@ChatParticipant"
        )
      ) {
        continue;
      }
      const key = `${chatClassName}.${memberNameOf(member.name)}`;
      if (getDecorator(member, checker, "ChatRequest")) {
        if (requestKey) {
          diagnostics.push(diagAt(member.name, SIGIL.TreeViewIncomplete, "apenas um @ChatRequest por @ChatParticipant"));
          continue;
        }
        requestKey = key;
      } else if (getDecorator(member, checker, "ChatFollowups")) {
        if (followupsKey) {
          diagnostics.push(diagAt(member.name, SIGIL.TreeViewIncomplete, "apenas um @ChatFollowups por @ChatParticipant"));
          continue;
        }
        followupsKey = key;
      } else {
        const cmdDec = getDecorator(member, checker, "ChatCommand");
        if (cmdDec) {
          const call = ts.isCallExpression(cmdDec.expression) ? cmdDec.expression : undefined;
          const nameRaw = call?.arguments[0] ? tryEval(call.arguments[0]) : undefined;
          if (nameRaw === EVAL_FAILED) continue;
          if (typeof nameRaw !== "string" || nameRaw.length === 0) {
            diagnostics.push(diagAt(call?.arguments[0] ?? member.name, SIGIL.NotStaticLiteral, '@ChatCommand exige o nome do slash command (string literal, sem "/")'));
            continue;
          }
          if (chatCommands.some((c) => c.name === nameRaw)) {
            diagnostics.push(diagAt(call?.arguments[0] ?? member.name, SIGIL.DuplicateMessageType, `slash command duplicado: /${nameRaw}`));
            continue;
          }
          const cmdOptsRaw = call?.arguments[1] ? tryEval(call.arguments[1]) : {};
          if (cmdOptsRaw === EVAL_FAILED) continue;
          const description = (cmdOptsRaw as { description?: unknown } | null)?.description;
          chatCommands.push(
            compact({ name: nameRaw, description: typeof description === "string" ? description : undefined, key }) as {
              name: string; description?: string; key: string;
            }
          );
        }
      }
    }
    chatCommands.sort((a, b) => (a.name < b.name ? -1 : 1));

    if (!requestKey) {
      diagnostics.push(
        diagAt(chat.name, SIGIL.TreeViewIncomplete, `@ChatParticipant '${chatClassName}' precisa de um método @ChatRequest`)
      );
      return;
    }

    chatParticipants.push(
      compact({
        commands: chatCommands.length > 0 ? chatCommands : undefined,
        key: chatClassName,
        id: `${prefix}.${o.id as string}`,
        name: o.name as string,
        fullName: o.fullName as string | undefined,
        description: o.description as string | undefined,
        isSticky: o.isSticky as boolean | undefined,
        requestKey,
        followupsKey,
        sourceFile: sourceFileOf(chat),
        loc: locOf(chat.name),
      }) as IRChatParticipant
    );
  }

  // ── classes @CustomEditor ──────────────────────────────────────────────────
  function collectCustomEditorClass(ce: ts.ClassDeclaration): void {
    if (!ce.name) {
      diagnostics.push(diagAt(ce, SIGIL.MissingRequiredOption, "a classe @CustomEditor precisa de um nome"));
      return;
    }
    const ceClassName = ce.name.text;
    const dec = getDecorator(ce, checker, "CustomEditor")!;
    const optsNode = optionsNodeOf(dec);
    const raw = optsNode ? tryEval(optsNode) : undefined;
    if (raw === EVAL_FAILED) return;
    const o = (raw ?? {}) as Record<string, unknown>;
    for (const field of ["id", "displayName", "ui"] as const) {
      if (typeof o[field] !== "string" || (o[field] as string).length === 0) {
        diagnostics.push(diagAt(optsNode ?? ce.name, SIGIL.MissingRequiredOption, `@CustomEditor exige '${field}' (string não vazia)`));
        return;
      }
    }
    const rawPatterns = o.filenamePattern;
    const patterns = (typeof rawPatterns === "string" ? [rawPatterns] : Array.isArray(rawPatterns) ? rawPatterns : []).filter(
      (p): p is string => typeof p === "string" && p.length > 0
    );
    if (patterns.length === 0) {
      diagnostics.push(diagAt(optsNode ?? ce.name, SIGIL.MissingRequiredOption, "@CustomEditor exige 'filenamePattern' (string ou string[])"));
      return;
    }
    patterns.sort();
    const priority = o.priority;
    if (priority !== undefined && priority !== "default" && priority !== "option") {
      diagnostics.push(diagAt(optsNode ?? ce.name, SIGIL.MissingRequiredOption, `priority de @CustomEditor precisa ser "default" ou "option"`));
      return;
    }

    const { handlers, requests } = collectUiHandlers(ce, ceClassName, "@CustomEditor");

    customEditors.push(
      compact({
        key: ceClassName,
        viewType: `${prefix}.${o.id as string}`,
        displayName: o.displayName as string,
        patterns,
        priority: priority as "default" | "option" | undefined,
        uiEntry: toPosix(o.ui as string).replace(/^\.\//, ""),
        messageHandlers: handlers,
        requestHandlers: requests,
        sourceFile: sourceFileOf(ce),
        loc: locOf(ce.name),
      }) as IRCustomEditor
    );
  }

  // ── classes @TestController ────────────────────────────────────────────────
  function collectTestControllerClass(tc: ts.ClassDeclaration): void {
    if (!tc.name) {
      diagnostics.push(diagAt(tc, SIGIL.MissingRequiredOption, "a classe @TestController precisa de um nome"));
      return;
    }
    const tcClassName = tc.name.text;
    const dec = getDecorator(tc, checker, "TestController")!;
    const optsNode = optionsNodeOf(dec);
    const raw = optsNode ? tryEval(optsNode) : undefined;
    if (raw === EVAL_FAILED) return;
    const o = (raw ?? {}) as Record<string, unknown>;
    if (typeof o.label !== "string" || o.label.length === 0) {
      diagnostics.push(diagAt(optsNode ?? tc.name, SIGIL.MissingRequiredOption, "@TestController exige 'label' (o nome exibido no Test Explorer)"));
      return;
    }
    let discoverKey: string | undefined;
    let runKey: string | undefined;
    const single = (current: string | undefined, name: string, node: ts.Node): boolean => {
      if (current) {
        diagnostics.push(diagAt(node, SIGIL.TreeViewIncomplete, `apenas um @${name} por @TestController`));
        return false;
      }
      return true;
    };
    for (const member of tc.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      const key = `${tcClassName}.${memberNameOf(member.name)}`;
      if (getDecorator(member, checker, "TestDiscover") && single(discoverKey, "TestDiscover", member.name)) discoverKey = key;
      if (getDecorator(member, checker, "TestRun") && single(runKey, "TestRun", member.name)) runKey = key;
    }
    if (!discoverKey) {
      diagnostics.push(
        diagAt(tc.name, SIGIL.TreeViewIncomplete, `@TestController '${tcClassName}' precisa de um método @TestDiscover`)
      );
      return;
    }
    testControllers.push(
      compact({
        key: tcClassName,
        id: `${prefix}.${(o.id as string | undefined) ?? tcClassName.charAt(0).toLowerCase() + tcClassName.slice(1)}`,
        label: o.label,
        discoverKey,
        runKey,
        sourceFile: sourceFileOf(tc),
        loc: locOf(tc.name),
      }) as IRTestController
    );
  }

  for (const tree of treeClasses) collectTreeClass(tree);
  for (const wv of webviewClasses) collectWebviewClass(wv);
  for (const lang of languageClasses) collectLanguageClass(lang);
  for (const chat of chatClasses) collectChatClass(chat);
  for (const ce of customEditorClasses) collectCustomEditorClass(ce);
  for (const tc of testControllerClasses) collectTestControllerClass(tc);

  // ── §8.5: ordem determinística é requisito do `sigil check`, não polimento ─
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const byKey = (a: { key: string }, b: { key: string }) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  commands.sort(byId);
  configs.sort(byId);
  watches.sort(byKey);
  treeViews.sort(byId);
  webviews.sort(byId);
  viewContainers.sort(byId);
  statusBars.sort(byKey);
  languages.sort(byKey);
  chatParticipants.sort(byId);
  lmTools.sort((a, b) => (a.name < b.name ? -1 : 1));
  mcpProviders.sort(byId);
  testControllers.sort(byId);
  customEditors.sort((a, b) => (a.viewType < b.viewType ? -1 : a.viewType > b.viewType ? 1 : 0));
  events.sort(byKey);
  fileWatchers.sort(byKey);
  secrets.sort(byKey);
  contextKeys.sort(byId);

  const ir = compact({
    version: IR_VERSION,
    prefix,
    displayName,
    extensionClass: className,
    sourceFile: sourceFileOf(cls),
    activateKey,
    deactivateKey,
    settingsPanel,
    commands,
    configs,
    watches,
    treeViews,
    webviews,
    viewContainers,
    statusBars,
    languages,
    chatParticipants,
    customEditors,
    lmTools,
    mcpProviders,
    testControllers,
    events,
    fileWatchers,
    secrets,
    contextKeys,
    uriHandlerKey,
  }) as IR;

  return { ir, diagnostics };
}
