import * as vscode from "vscode";
import { dual } from "./dual";
import { registry } from "../registry";
import { registerBoundMember } from "../metadata";
import { guard } from "../guard";

export interface LanguageOptions {
  /** id(s) de linguagem que a classe atende (ex.: "markdown", ["md", "mdx"]) */
  id: string | string[];
  /**
   * DSL própria? Declare as extensões de arquivo (ex.: [".mock"]) e o sigil
   * emite o `contributes.languages` — sem isso o VSCode nunca associa seus
   * arquivos ao language id e nenhum provider dispara.
   */
  extensions?: string[];
  /** nomes exibidos da linguagem (contributes.languages[].aliases) */
  aliases?: string[];
  /** caminho do language-configuration.json (comentários, brackets…), relativo à raiz */
  configuration?: string;
}

/**
 * Marca uma classe de providers de linguagem (hover/completion/code lens/
 * diagnostics). O seletor é identidade (AST); o sigil emite os
 * `activationEvents: onLanguage:<id>` correspondentes no manifesto — a única
 * ponte que o VSCode NÃO gera sozinho para providers.
 */
export function Language(_opts: LanguageOptions) {
  return function <T extends new (...args: any[]) => object>(
    _target: T,
    _ctx: ClassDecoratorContext<T>
  ): void {};
}

/** provideHover(document, position, token) — retorno vira vscode.Hover. */
export const Hover = dual(() => registerBoundMember("languageHandlers"));

export interface CompletionOptions {
  triggerCharacters?: string[];
}

/** provideCompletionItems(document, position, token, context). */
export function Completion(_opts: CompletionOptions = {}) {
  return registerBoundMember("languageHandlers");
}

/** provideCodeLenses(document, token). */
export const CodeLens = dual(() => registerBoundMember("languageHandlers"));

/**
 * Ghost text (inline completion): handler(doc, pos, context, token) retorna
 * string, string[] ou InlineCompletionItem[] — strings viram itens.
 */
export const InlineCompletion = dual(() => registerBoundMember("languageHandlers"));

export interface DiagnosticsOptions {
  /** quando revalidar: a cada edição (default) ou só ao salvar */
  on?: "change" | "save";
}

/**
 * validate(document) → vscode.Diagnostic[]. O sigil cuida do
 * DiagnosticCollection, dos eventos de documento e da limpeza no close.
 */
export function Diagnostics(_opts: DiagnosticsOptions = {}) {
  return registerBoundMember("languageHandlers");
}

export interface CodeActionOptions {
  /** kinds oferecidos (ex.: ["quickfix", "refactor.extract"]) — vira providedCodeActionKinds */
  kinds?: string[];
}

/** provideCodeActions(document, range, context, token) → CodeAction[]. */
export function CodeAction(_opts: CodeActionOptions = {}) {
  return registerBoundMember("languageHandlers");
}

/** provideDefinition(document, position, token) → Location | Location[]. */
export const Definition = dual(() => registerBoundMember("languageHandlers"));

/** provideReferences(document, position, context, token) → Location[]. */
export const References = dual(() => registerBoundMember("languageHandlers"));

/** provideRenameEdits(document, position, newName, token) → WorkspaceEdit. */
export const Rename = dual(() => registerBoundMember("languageHandlers"));

/**
 * Formatação: handler(document, options, token). Retorne TextEdit[] — ou uma
 * STRING com o documento inteiro formatado, que o sigil converte no TextEdit
 * de range completo (`@Formatting() format(doc) { return prettier(...); }`).
 */
export const Formatting = dual(() => registerBoundMember("languageHandlers"));

/** provideDocumentSymbols(document, token) → DocumentSymbol[]. */
export const Symbols = dual(() => registerBoundMember("languageHandlers"));

/** provideInlayHints(document, range, token) → InlayHint[] (objetos {position, label} servem). */
export const InlayHints = dual(() => registerBoundMember("languageHandlers"));

export interface LanguageBinding {
  readonly key: string;
  readonly selector: readonly string[];
  readonly hoverKey?: string;
  readonly inlineKey?: string;
  readonly completionKey?: string;
  readonly completionTriggers?: readonly string[];
  readonly codeLensKey?: string;
  readonly diagnosticsKey?: string;
  readonly diagnosticsOn?: "change" | "save";
  readonly codeActionKey?: string;
  readonly codeActionKinds?: readonly string[];
  readonly definitionKey?: string;
  readonly referencesKey?: string;
  readonly renameKey?: string;
  readonly formattingKey?: string;
  readonly symbolsKey?: string;
  readonly inlayHintsKey?: string;
}

/**
 * Chamado pelo activate() gerado. Dispatch dinâmico (resolve do registry a
 * cada chamada — hot swap troca os providers por baixo) e guard em tudo.
 */
export function bindLanguage(binding: LanguageBinding, ctx: vscode.ExtensionContext): vscode.Disposable {
  const allKeys = [
    binding.hoverKey, binding.inlineKey, binding.completionKey, binding.codeLensKey, binding.diagnosticsKey,
    binding.codeActionKey, binding.definitionKey, binding.referencesKey, binding.renameKey,
    binding.formattingKey, binding.symbolsKey, binding.inlayHintsKey,
  ];
  for (const key of allKeys) {
    if (key && !registry.languageHandlers.has(key)) {
      throw new Error(`sigil: handler de linguagem ausente para ${key}. Rode 'sigil build'.`);
    }
  }

  const selector = [...binding.selector];
  const matches = (doc: vscode.TextDocument): boolean => selector.includes(doc.languageId);
  const call = (what: string, key: string, args: unknown[]): unknown =>
    guard(what, () => {
      const fn = registry.languageHandlers.get(key);
      if (!fn) throw new Error(`sigil: handler ausente para ${key}. Rode 'sigil build'.`);
      return fn(...args);
    })();

  const disposables: vscode.Disposable[] = [];

  if (binding.hoverKey) {
    const key = binding.hoverKey;
    disposables.push(
      vscode.languages.registerHoverProvider(selector, {
        provideHover: (doc, pos, token) =>
          call(`@Hover de ${binding.key}`, key, [doc, pos, token]) as vscode.ProviderResult<vscode.Hover>,
      })
    );
  }
  if (binding.inlineKey) {
    const key = binding.inlineKey;
    disposables.push(
      vscode.languages.registerInlineCompletionItemProvider(selector, {
        provideInlineCompletionItems: async (doc, pos, context, token) => {
          const result = await call(`@InlineCompletion de ${binding.key}`, key, [doc, pos, context, token]);
          if (result == null) return [];
          // strings viram itens; itens prontos passam direto
          const lista = Array.isArray(result) ? result : [result];
          return lista.map((item) =>
            typeof item === "string" ? { insertText: item } : item
          ) as vscode.InlineCompletionItem[];
        },
      })
    );
  }
  if (binding.completionKey) {
    const key = binding.completionKey;
    disposables.push(
      vscode.languages.registerCompletionItemProvider(
        selector,
        {
          provideCompletionItems: (doc, pos, token, context) =>
            call(`@Completion de ${binding.key}`, key, [doc, pos, token, context]) as vscode.ProviderResult<
              vscode.CompletionItem[]
            >,
        },
        ...(binding.completionTriggers ?? [])
      )
    );
  }
  if (binding.codeLensKey) {
    const key = binding.codeLensKey;
    disposables.push(
      vscode.languages.registerCodeLensProvider(selector, {
        provideCodeLenses: (doc, token) =>
          call(`@CodeLens de ${binding.key}`, key, [doc, token]) as vscode.ProviderResult<vscode.CodeLens[]>,
      })
    );
  }
  if (binding.codeActionKey) {
    const key = binding.codeActionKey;
    // metadata só quando há kinds — e CodeActionKind resolvido dinamicamente
    // (Empty.append é a forma pública de construir um kind a partir de string)
    const CAK = (vscode as unknown as { CodeActionKind?: { Empty: { append(v: string): unknown } } }).CodeActionKind;
    const metadata =
      binding.codeActionKinds && binding.codeActionKinds.length > 0 && CAK
        ? { providedCodeActionKinds: binding.codeActionKinds.map((k) => CAK.Empty.append(k)) }
        : undefined;
    disposables.push(
      vscode.languages.registerCodeActionsProvider(
        selector,
        {
          provideCodeActions: (doc, range, context, token) =>
            call(`@CodeAction de ${binding.key}`, key, [doc, range, context, token]) as vscode.ProviderResult<
              vscode.CodeAction[]
            >,
        },
        metadata as vscode.CodeActionProviderMetadata | undefined
      )
    );
  }
  if (binding.definitionKey) {
    const key = binding.definitionKey;
    disposables.push(
      vscode.languages.registerDefinitionProvider(selector, {
        provideDefinition: (doc, pos, token) =>
          call(`@Definition de ${binding.key}`, key, [doc, pos, token]) as vscode.ProviderResult<vscode.Definition>,
      })
    );
  }
  if (binding.referencesKey) {
    const key = binding.referencesKey;
    disposables.push(
      vscode.languages.registerReferenceProvider(selector, {
        provideReferences: (doc, pos, context, token) =>
          call(`@References de ${binding.key}`, key, [doc, pos, context, token]) as vscode.ProviderResult<
            vscode.Location[]
          >,
      })
    );
  }
  if (binding.renameKey) {
    const key = binding.renameKey;
    disposables.push(
      vscode.languages.registerRenameProvider(selector, {
        provideRenameEdits: (doc, pos, newName, token) =>
          call(`@Rename de ${binding.key}`, key, [doc, pos, newName, token]) as vscode.ProviderResult<
            vscode.WorkspaceEdit
          >,
      })
    );
  }
  if (binding.formattingKey) {
    const key = binding.formattingKey;
    disposables.push(
      vscode.languages.registerDocumentFormattingEditProvider(selector, {
        provideDocumentFormattingEdits: async (doc, options, token) => {
          const result = await call(`@Formatting de ${binding.key}`, key, [doc, options, token]);
          if (result == null) return [];
          if (typeof result !== "string") return result as vscode.TextEdit[];
          // string = documento inteiro formatado → TextEdit de range completo
          const range = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
          const TE = (vscode as unknown as { TextEdit?: { replace(r: vscode.Range, t: string): vscode.TextEdit } }).TextEdit;
          return TE ? [TE.replace(range, result)] : ([{ range, newText: result }] as unknown as vscode.TextEdit[]);
        },
      })
    );
  }
  if (binding.symbolsKey) {
    const key = binding.symbolsKey;
    disposables.push(
      vscode.languages.registerDocumentSymbolProvider(selector, {
        provideDocumentSymbols: (doc, token) =>
          call(`@Symbols de ${binding.key}`, key, [doc, token]) as vscode.ProviderResult<vscode.DocumentSymbol[]>,
      })
    );
  }
  if (binding.inlayHintsKey) {
    const key = binding.inlayHintsKey;
    disposables.push(
      vscode.languages.registerInlayHintsProvider(selector, {
        provideInlayHints: (doc, range, token) =>
          call(`@InlayHints de ${binding.key}`, key, [doc, range, token]) as vscode.ProviderResult<
            vscode.InlayHint[]
          >,
      })
    );
  }
  if (binding.diagnosticsKey) {
    const key = binding.diagnosticsKey;
    const collection = vscode.languages.createDiagnosticCollection(binding.key);
    disposables.push(collection);
    const run = async (doc: vscode.TextDocument): Promise<void> => {
      if (!matches(doc)) return;
      const result = (await call(`@Diagnostics de ${binding.key}`, key, [doc])) as
        | vscode.Diagnostic[]
        | undefined;
      collection.set(doc.uri, result ?? []);
    };
    if (binding.diagnosticsOn === "save") {
      disposables.push(vscode.workspace.onDidSaveTextDocument((doc) => void run(doc)));
    } else {
      disposables.push(vscode.workspace.onDidChangeTextDocument((e) => void run(e.document)));
    }
    disposables.push(vscode.workspace.onDidOpenTextDocument((doc) => void run(doc)));
    disposables.push(vscode.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri)));
    for (const doc of vscode.workspace.textDocuments) void run(doc);
  }

  void ctx;
  return {
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
