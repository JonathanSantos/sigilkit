import * as vscode from "vscode";
import { registry } from "../registry";
import { registerBoundMember } from "../metadata";
import { guard } from "../guard";

export interface LanguageOptions {
  /** id(s) de linguagem que a classe atende (ex.: "markdown", ["md", "mdx"]) */
  id: string | string[];
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
export function Hover() {
  return registerBoundMember("languageHandlers");
}

export interface CompletionOptions {
  triggerCharacters?: string[];
}

/** provideCompletionItems(document, position, token, context). */
export function Completion(_opts: CompletionOptions = {}) {
  return registerBoundMember("languageHandlers");
}

/** provideCodeLenses(document, token). */
export function CodeLens() {
  return registerBoundMember("languageHandlers");
}

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

export interface LanguageBinding {
  readonly key: string;
  readonly selector: readonly string[];
  readonly hoverKey?: string;
  readonly completionKey?: string;
  readonly completionTriggers?: readonly string[];
  readonly codeLensKey?: string;
  readonly diagnosticsKey?: string;
  readonly diagnosticsOn?: "change" | "save";
}

/**
 * Chamado pelo activate() gerado. Dispatch dinâmico (resolve do registry a
 * cada chamada — hot swap troca os providers por baixo) e guard em tudo.
 */
export function bindLanguage(binding: LanguageBinding, ctx: vscode.ExtensionContext): vscode.Disposable {
  for (const key of [binding.hoverKey, binding.completionKey, binding.codeLensKey, binding.diagnosticsKey]) {
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
