import * as vscode from "vscode";
import { fillWebview, makeRouter } from "./webview-host";

export interface CustomEditorOptions {
  /** sufixo do viewType (vira `<prefix>.<id>` no manifesto) */
  id: string;
  displayName: string;
  /** padrão(ões) de arquivo que o editor atende (ex.: "*.csv") */
  filenamePattern: string | string[];
  /** "default" assume o arquivo; "option" aparece em "Reopen Editor With…" */
  priority?: "default" | "option";
  /** HTML da UI, relativo à raiz da extensão (mesmo shell dos @Webview) */
  ui: string;
}

/**
 * Editor customizado baseado em texto (§CustomTextEditorProvider) sobre o
 * shell de webview do sigil: CSP + nonce + asWebviewUri + roteador tipado.
 * Os handlers @OnMessage/@OnRequest recebem um SEGUNDO argumento com o
 * contexto do documento — cada arquivo aberto tem seu painel, mas a classe
 * continua sendo uma instância única.
 */
export function CustomEditor(_opts: CustomEditorOptions) {
  return function <T extends new (...args: any[]) => object>(
    _target: T,
    _ctx: ClassDecoratorContext<T>
  ): void {};
}

/** Segundo argumento dos handlers de @CustomEditor. */
export interface SigilEditorContext {
  readonly uri: vscode.Uri;
  getText(): string;
  /** substitui o conteúdo inteiro do documento (via WorkspaceEdit → undo funciona) */
  applyEdit(newText: string): Thenable<boolean>;
}

export interface CustomEditorBinding {
  readonly key: string;
  readonly viewType: string;
  readonly uiEntry: string;
  readonly handlers: readonly { type: string; key: string }[];
  readonly requests?: readonly { type: string; key: string }[];
}

export function bindCustomEditor(binding: CustomEditorBinding, ctx: vscode.ExtensionContext): vscode.Disposable {
  const provider: vscode.CustomTextEditorProvider = {
    resolveCustomTextEditor: async (document, panel) => {
      panel.webview.options = { enableScripts: true, localResourceRoots: [ctx.extensionUri] };

      const editorContext: SigilEditorContext = {
        uri: document.uri,
        getText: () => document.getText(),
        applyEdit: (newText: string) => {
          const edit = new vscode.WorkspaceEdit();
          const fullRange = new vscode.Range(
            new vscode.Position(0, 0),
            document.positionAt(document.getText().length)
          );
          edit.replace(document.uri, fullRange, newText);
          return vscode.workspace.applyEdit(edit);
        },
      };

      const post = (msg: unknown): void => void panel.webview.postMessage(msg);
      panel.webview.onDidReceiveMessage(makeRouter(binding, post, editorContext));

      // documento → UI: estado inicial + toda mudança (edits externos inclusive)
      const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === document.uri.toString()) {
          post({ type: "__sigilDocument", value: { text: document.getText() } });
        }
      });
      panel.onDidDispose(() => changeSub.dispose());

      await fillWebview(panel.webview, binding, ctx);
      post({
        type: "__sigilDocument",
        value: { text: document.getText(), uri: document.uri.toString(), languageId: document.languageId },
      });
    },
  };

  return vscode.window.registerCustomEditorProvider(binding.viewType, provider, {
    webviewOptions: { retainContextWhenHidden: true },
    supportsMultipleEditorsPerDocument: false,
  });
}
