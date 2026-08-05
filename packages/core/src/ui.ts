/**
 * Runtime do LADO UI do webview (§15.2 item 5) — roda no browser do webview,
 * nunca no extension host. Import: `@sigil/core/ui`. Não importa vscode nem
 * nada de node; os tipos de mensagem são compartilhados via `import type`.
 */

interface VsCodeWebviewApi {
  postMessage(msg: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeWebviewApi;
declare const window: {
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
};

let api: VsCodeWebviewApi | undefined;

function vscodeApi(): VsCodeWebviewApi {
  // acquireVsCodeApi só pode ser chamada uma vez por sessão do webview
  return (api ??= acquireVsCodeApi());
}

export function postToHost<T = unknown>(msg: T): void {
  vscodeApi().postMessage(msg);
}

/** Registra um handler para mensagens do host. Retorna a função de unsubscribe. */
export function onHostMessage<T = unknown>(handler: (msg: T) => void): () => void {
  const listener = (event: { data: unknown }) => handler(event.data as T);
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
