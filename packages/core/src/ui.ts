/**
 * Runtime do LADO UI do webview (§15.2 item 5) — roda no browser do webview,
 * nunca no extension host. Import: `@sigilkit/core/ui`. Não importa vscode nem
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

/**
 * Registros vazios, preenchidos pela augmentation do `sigil-env.d.ts` gerado
 * na pasta da UI (mesmo padrão do SigilConfigRegistry do getConfig). Com o
 * arquivo gerado no programa, postToHost/callHost ficam tipados por chave e
 * um typo vira erro de build; sem ele, seguem livres.
 */
export interface SigilUiMessages {} // { [type]: tipo do value do @OnMessage }
export interface SigilUiRequests {} // { [type]: { value; result } do @OnRequest }
export interface SigilUiFromHost {} // { message: união das mensagens host→UI }

type OutboundMessage = {
  [K in keyof SigilUiMessages & string]: undefined extends SigilUiMessages[K]
    ? { type: K; value?: SigilUiMessages[K] }
    : { type: K; value: SigilUiMessages[K] };
}[keyof SigilUiMessages & string];

/** `true` quando o registro está vazio (projeto sem o d.ts gerado). */
type FreeForm<T> = [keyof T] extends [never] ? true : false;

type RequestValue<K extends keyof SigilUiRequests> = SigilUiRequests[K] extends { value: infer V }
  ? V
  : never;
type RequestResult<K extends keyof SigilUiRequests> = SigilUiRequests[K] extends { result: infer R }
  ? R
  : never;

type HostMessage = SigilUiFromHost extends { message: infer M }
  ? [M] extends [never]
    ? unknown
    : M
  : unknown;

export function postToHost(msg: OutboundMessage): void;
export function postToHost(msg: FreeForm<SigilUiMessages> extends true ? unknown : never): void;
export function postToHost(msg: unknown): void {
  vscodeApi().postMessage(msg);
}

/** Registra um handler para mensagens do host. Retorna a função de unsubscribe. */
export function onHostMessage<T = HostMessage>(handler: (msg: T) => void): () => void {
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

export interface SigilDocumentState {
  text: string;
  uri?: string;
  languageId?: string;
}

/**
 * Lado UI de um @CustomEditor: recebe o conteúdo do documento no load e a
 * cada mudança (edits externos inclusive). Retorna o unsubscribe.
 */
export function onDocument(handler: (doc: SigilDocumentState) => void): () => void {
  const listener = (event: { data: unknown }) => {
    const msg = event.data as { type?: string; value?: SigilDocumentState } | undefined;
    if (msg?.type === "__sigilDocument" && msg.value) handler(msg.value);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

/**
 * Request/response para um @OnRequest do host: o retorno do handler resolve a
 * Promise; um throw no host a rejeita. Correlação automática por id.
 * Com o `sigil-env.d.ts` gerado no programa da UI, o `type` autocompleta, o
 * `value` é validado e o retorno já vem tipado pelo handler do host.
 */
export function callHost<K extends keyof SigilUiRequests & string>(
  type: K,
  ...args: undefined extends RequestValue<K> ? [value?: RequestValue<K>] : [value: RequestValue<K>]
): Promise<RequestResult<K>>;
export function callHost(
  type: FreeForm<SigilUiRequests> extends true ? string : never,
  value?: unknown
): Promise<unknown>;
export function callHost(type: string, value?: unknown): Promise<unknown> {
  ensureRpcListener();
  const id = ++rpcSequence;
  return new Promise<unknown>((resolve, reject) => {
    pendingRpc.set(id, { resolve, reject });
    vscodeApi().postMessage({ type, value, __sigilRpcId: id });
  });
}

/**
 * Base de recursos da UI derivada da URI do PRÓPRIO script — o jeito de
 * construir URLs de mídia em runtime (sprites, imagens) que funciona em
 * qualquer host de webview, sem o host precisar mandar a base por mensagem.
 * `selector` acha o script de referência (default: o primeiro com src).
 * Ex.: `new URL("../media/gato.gif", resourceBase())`.
 */
export function resourceBase(selector = "script[src]"): string {
  const el = (globalThis as { document?: { querySelector(s: string): { src?: string } | null } })
    .document?.querySelector(selector);
  if (!el?.src) {
    throw new Error(`sigil/ui: nenhum script encontrado para '${selector}' — resourceBase precisa de um <script src>`);
  }
  return new URL(".", el.src).toString();
}
