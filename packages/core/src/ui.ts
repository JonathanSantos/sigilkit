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

let rpcSequence = 0;
const pendingRpc = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let rpcListenerBound = false;

function ensureRpcListener(): void {
  if (rpcListenerBound) return;
  rpcListenerBound = true;
  window.addEventListener("message", (event) => {
    const msg = event.data as
      | { type?: string; id?: number; ok?: boolean; value?: unknown; error?: string }
      | undefined;
    if (!msg || msg.type !== "__sigilRpcResult" || typeof msg.id !== "number") return;
    const pending = pendingRpc.get(msg.id);
    if (!pending) return;
    pendingRpc.delete(msg.id);
    if (msg.ok) pending.resolve(msg.value);
    else pending.reject(new Error(msg.error ?? "erro no host"));
  });
}

/**
 * Request/response para um @OnRequest do host: o retorno do handler resolve a
 * Promise; um throw no host a rejeita. Correlação automática por id.
 */
export function callHost<TResult = unknown, TValue = unknown>(
  type: string,
  value?: TValue
): Promise<TResult> {
  ensureRpcListener();
  const id = ++rpcSequence;
  return new Promise<TResult>((resolve, reject) => {
    pendingRpc.set(id, { resolve: resolve as (v: unknown) => void, reject });
    vscodeApi().postMessage({ type, value, __sigilRpcId: id });
  });
}
