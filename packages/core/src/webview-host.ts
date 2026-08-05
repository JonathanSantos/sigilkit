import * as vscode from "vscode";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { registry } from "./registry";
import { renderWebviewHtml } from "./webview-html";

export interface WebviewBinding {
  readonly key: string;
  readonly id: string;
  readonly title: string;
  /** relativo à raiz da extensão, já normalizado (sem "./") */
  readonly uiEntry: string;
  readonly handlers: readonly { type: string; key: string }[];
}

/**
 * Chamado pelo activate() gerado (§15.2). Resolve as quatro dores de sempre:
 * shell HTML com CSP + nonce, asWebviewUri para assets locais,
 * retainContextWhenHidden, e roteador de mensagens por `type`.
 *
 * O painel é lazy: nada abre na ativação — `registry.webviews.get(key)!.open()`
 * cria (ou revela) o painel. `post` é injetado na instância aqui.
 */
export function bindWebview(
  instance: object,
  binding: WebviewBinding,
  ctx: vscode.ExtensionContext
): vscode.Disposable {
  let panel: vscode.WebviewPanel | undefined;

  const post = (msg: unknown): void => {
    if (!panel) {
      console.warn(`sigil: post em '${binding.key}' com o painel fechado — mensagem descartada`);
      return;
    }
    void panel.webview.postMessage(msg);
  };
  (instance as { post?: (msg: unknown) => void }).post = post;

  const open = (): void => {
    if (panel) {
      panel.reveal();
      return;
    }
    panel = vscode.window.createWebviewPanel(binding.id, binding.title, vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [ctx.extensionUri],
    });

    const uiUri = vscode.Uri.joinPath(ctx.extensionUri, binding.uiEntry);
    const baseDir = vscode.Uri.joinPath(uiUri, "..");
    const raw = readFileSync(uiUri.fsPath, "utf8");
    panel.webview.html = renderWebviewHtml(raw, {
      nonce: randomBytes(16).toString("base64url"),
      cspSource: panel.webview.cspSource,
      resolveResource: (rel) =>
        panel!.webview.asWebviewUri(vscode.Uri.joinPath(baseDir, rel)).toString(),
    });

    panel.webview.onDidReceiveMessage((msg: { type?: string; value?: unknown } | undefined) => {
      const handler = binding.handlers.find((h) => h.type === msg?.type);
      if (!handler) {
        // R6: tipo desconhecido vira warning, nunca silêncio
        console.warn(`sigil: mensagem de tipo desconhecido em '${binding.key}': ${String(msg?.type)}`);
        return;
      }
      const fn = registry.webviewHandlers.get(handler.key);
      if (!fn) throw new Error(`sigil: handler ausente para ${handler.key}. Rode 'sigil build'.`);
      fn(msg?.value);
    });
    panel.onDidDispose(() => {
      panel = undefined;
    });
  };

  registry.webviews.set(binding.key, { open, post });
  return {
    dispose() {
      registry.webviews.delete(binding.key);
      panel?.dispose();
    },
  };
}
