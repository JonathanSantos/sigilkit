import ts from "typescript";
import path from "node:path";
import { IR, IRCommand, IRConfig, IRTreeView, IRWatch, IRWebview, IR_VERSION, SourceLoc } from "../ir";
import { diagAt, diagGlobal, SIGIL } from "../diagnostics";
import { evalStatic, StaticEvalError } from "./static-eval";
import { typeNodeToSchema, schemaFromValue } from "./type-to-schema";
import { compact, toPosix } from "../util";

export interface CollectOptions {
  /**
   * Prefixo default (campo `name` do package.json do usuário). Emitters não
   * podem ler disco (R4/§13), então o valor entra no IR aqui, na coleta.
   */
  defaultPrefix: string;
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
  if (!file.includes("@sigil/core") && !file.includes("packages/core")) return undefined;
  return sym.name;
}

const EVAL_FAILED: unique symbol = Symbol("sigil.evalFailed");

// Decorators de membro por espécie de classe (§8.5 + §15)
const EXTENSION_MEMBERS = ["Command", "Config", "Watch", "Activate", "Deactivate"] as const;
const TREE_MEMBERS = ["TreeRoot", "TreeChildren", "TreeItem", "Command"] as const;
const WEBVIEW_MEMBERS = ["OnMessage"] as const;
const ALL_MEMBERS = [...new Set([...EXTENSION_MEMBERS, ...TREE_MEMBERS, ...WEBVIEW_MEMBERS])];

export function collect(program: ts.Program, opts: CollectOptions): CollectResult {
  const checker = program.getTypeChecker();
  const diagnostics: ts.Diagnostic[] = [];

  function tryEval(node: ts.Expression, what = "argumento de decorator"): unknown {
    try {
      return evalStatic(node);
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

  /** Extrai o objeto de opções de um decorator com call (`@X({...})`). */
  function optionsNodeOf(dec: ts.Decorator): ts.Expression | undefined {
    return ts.isCallExpression(dec.expression) ? dec.expression.arguments[0] : undefined;
  }

  // ── categoriza as classes do projeto ───────────────────────────────────────
  const extensionClasses: ts.ClassDeclaration[] = [];
  const treeClasses: ts.ClassDeclaration[] = [];
  const webviewClasses: ts.ClassDeclaration[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) {
      const marks = ["Extension", "TreeView", "Webview"].filter((n) =>
        getDecorator(node, checker, n)
      );
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
  if (extOptsNode) {
    const raw = tryEval(extOptsNode);
    if (raw === EVAL_FAILED) return { diagnostics };
    const p = (raw as { prefix?: unknown } | null)?.prefix;
    if (typeof p === "string" && p.length > 0) prefix = p;
  }

  const commands: IRCommand[] = [];
  const configs: IRConfig[] = [];
  const watches: IRWatch[] = [];
  const treeViews: IRTreeView[] = [];
  const webviews: IRWebview[] = [];
  let activateKey: string | undefined;
  let deactivateKey: string | undefined;

  /** @Command em classe @Extension ou @TreeView. viewId dá o `when` default de "view/title". */
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
      keybinding = compact(o.keybinding as { key: string; mac?: string; when?: string });
    }

    const menuNames =
      typeof o.menu === "string" ? [o.menu] : Array.isArray(o.menu) ? (o.menu as string[]) : [];
    const menus = menuNames.map((menu) => {
      let when = o.when as string | undefined;
      // comando de @TreeView em menu "view/*" sem `when` explícito: escopa à
      // própria view — sem isso o item apareceria em TODAS as views
      if (when === undefined && viewId && menu.startsWith("view/")) when = `view == ${viewId}`;
      return compact({ menu, group: o.group as string | undefined, when });
    });

    commands.push(
      compact({
        key,
        id: `${prefix}.${methodName}`,
        title: o.title,
        category: o.category as string | undefined,
        icon: o.icon as string | undefined,
        when: o.when as string | undefined,
        enablement: o.enablement as string | undefined,
        keybinding,
        menus,
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
    if (rejectMember(m, ["TreeRoot", "TreeChildren", "TreeItem", "OnMessage"], "@Extension")) return;

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

    if (getDecorator(m, checker, "Activate")) {
      activateKey = key;
      return;
    }
    if (getDecorator(m, checker, "Deactivate")) {
      deactivateKey = key;
      return;
    }
  }

  function collectExtensionProperty(p: ts.PropertyDeclaration): void {
    const cfgDec = getDecorator(p, checker, "Config");
    if (!cfgDec) return;

    const propName = memberNameOf(p.name);
    const isAutoAccessor = !!p.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.AccessorKeyword);
    if (!isAutoAccessor) {
      diagnostics.push(
        diagAt(p.name, SIGIL.ConfigWithoutAccessor, `@Config exige a palavra-chave 'accessor': "accessor ${propName} = ..." (§6 do spec)`)
      );
      return;
    }

    let schema = p.type ? typeNodeToSchema(p.type) : undefined;
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
    const container = typeof o.container === "string" && o.container.length > 0 ? o.container : "explorer";

    let rootsKey: string | undefined;
    let childrenKey: string | undefined;
    let itemKey: string | undefined;

    const markerFor = (m: ts.MethodDeclaration, name: string): boolean =>
      getDecorator(m, checker, name) !== undefined;

    for (const member of tree.members) {
      if (ts.isPropertyDeclaration(member)) {
        rejectMember(member, ["Config"], "@TreeView (pertence à classe @Extension)");
        continue;
      }
      if (!ts.isMethodDeclaration(member)) continue;
      if (rejectMember(member, ["Watch", "Activate", "Deactivate", "OnMessage"], "@TreeView")) continue;

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

    treeViews.push(
      compact({
        key: treeClassName,
        id: viewId,
        name: o.name,
        container,
        rootsKey,
        childrenKey,
        itemKey,
        sourceFile: sourceFileOf(tree),
        loc: locOf(tree.name),
      }) as IRTreeView
    );
  }

  // ── classes @Webview (§15.2) ───────────────────────────────────────────────
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

    const handlers: { type: string; key: string }[] = [];
    const seen = new Set<string>();

    for (const member of wv.members) {
      if (ts.isPropertyDeclaration(member)) {
        rejectMember(member, ["Config"], "@Webview (pertence à classe @Extension)");
        continue;
      }
      if (!ts.isMethodDeclaration(member)) continue;
      if (
        rejectMember(member, ["Command", "Watch", "Activate", "Deactivate", "TreeRoot", "TreeChildren", "TreeItem"], "@Webview")
      ) {
        continue;
      }

      const msgDec = getDecorator(member, checker, "OnMessage");
      if (!msgDec) continue;
      const arg = optionsNodeOf(msgDec);
      const type = arg ? tryEval(arg) : undefined;
      if (type === EVAL_FAILED) continue;
      if (typeof type !== "string" || type.length === 0) {
        diagnostics.push(
          diagAt(arg ?? member.name, SIGIL.NotStaticLiteral, "@OnMessage precisa de um tipo de mensagem literal (string)")
        );
        continue;
      }
      if (seen.has(type)) {
        diagnostics.push(
          diagAt(arg ?? member.name, SIGIL.DuplicateMessageType, `tipo de mensagem duplicado em @OnMessage: '${type}'`)
        );
        continue;
      }
      seen.add(type);
      handlers.push({ type, key: `${wvClassName}.${memberNameOf(member.name)}` });
    }

    handlers.sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));

    webviews.push({
      key: wvClassName,
      id: `${prefix}.${o.id}`,
      title: o.title as string,
      uiEntry: toPosix(o.ui as string).replace(/^\.\//, ""),
      messageHandlers: handlers,
      sourceFile: sourceFileOf(wv),
      loc: locOf(wv.name),
    });
  }

  for (const tree of treeClasses) collectTreeClass(tree);
  for (const wv of webviewClasses) collectWebviewClass(wv);

  // ── §8.5: ordem determinística é requisito do `sigil check`, não polimento ─
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const byKey = (a: { key: string }, b: { key: string }) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  commands.sort(byId);
  configs.sort(byId);
  watches.sort(byKey);
  treeViews.sort(byId);
  webviews.sort(byId);

  const ir = compact({
    version: IR_VERSION,
    prefix,
    extensionClass: className,
    sourceFile: sourceFileOf(cls),
    activateKey,
    deactivateKey,
    commands,
    configs,
    watches,
    treeViews,
    webviews,
  }) as IR;

  return { ir, diagnostics };
}
