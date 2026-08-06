import * as vscode from "vscode";
import { registry } from "./registry";
import { renderWebviewHtml } from "./webview-html";
import { guard } from "./guard";
import { log } from "./log";

/**
 * Web-ready de propósito: nada de node:fs/node:crypto — o HTML é lido via
 * workspace.fs e o nonce vem do WebCrypto, então o mesmo bundle funciona no
 * VSCode desktop e no vscode.dev (--platform=browser).
 */

export interface WebviewBinding {
  readonly key: string;
  readonly id: string;
  readonly title: string;
  /** relativo à raiz da extensão, já normalizado (sem "./") */
  readonly uiEntry: string;
  /** fire-and-forget: @OnMessage */
  readonly handlers: readonly { type: string; key: string }[];
  /** request/response: @OnRequest (a UI usa callHost e recebe o retorno) */
  readonly requests?: readonly { type: string; key: string }[];
}

export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

type IncomingMessage = { type?: string; value?: unknown; __sigilRpcId?: number } | undefined;

/**
 * Roteador de mensagens UI → host. `extra` é um segundo argumento passado aos
 * handlers (o contexto de documento dos custom editors); para webviews comuns
 * é undefined e inofensivo.
 */
export function makeRouter(
  binding: Pick<WebviewBinding, "key" | "handlers" | "requests">,
  post: (msg: unknown) => void,
  extra?: unknown
): (msg: IncomingMessage) => void {
  return (msg) => {
    const rpcId = msg?.__sigilRpcId;

    // @OnRequest: request/response com correlação — o retorno (ou erro) do
    // handler volta para o callHost() do lado UI
    if (typeof rpcId === "number") {
      const req = (binding.requests ?? []).find((h) => h.type === msg?.type);
      if (!req) {
        log.warn(`sigil: request de tipo desconhecido em '${binding.key}': ${String(msg?.type)}`);
        post({ type: "__sigilRpcResult", id: rpcId, ok: false, error: `tipo de request desconhecido: ${String(msg?.type)}` });
        return;
      }
      const fn = registry.webviewHandlers.get(req.key);
      if (!fn) throw new Error(`sigil: handler ausente para ${req.key}. Rode 'sigil build'.`);
      Promise.resolve()
        .then(() => fn(msg?.value, extra))
        .then(
          (value) => post({ type: "__sigilRpcResult", id: rpcId, ok: true, value }),
          (err: unknown) => {
            log.error(`@OnRequest '${String(msg?.type)}' em ${binding.key} falhou: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
            post({ type: "__sigilRpcResult", id: rpcId, ok: false, error: err instanceof Error ? err.message : String(err) });
          }
        );
      return;
    }

    const handler = binding.handlers.find((h) => h.type === msg?.type);
    if (!handler) {
      // R6: tipo desconhecido vira warning, nunca silêncio
      console.warn(`sigil: mensagem de tipo desconhecido em '${binding.key}': ${String(msg?.type)}`);
      return;
    }
    const fn = registry.webviewHandlers.get(handler.key);
    if (!fn) throw new Error(`sigil: handler ausente para ${handler.key}. Rode 'sigil build'.`);
    guard(`@OnMessage '${String(msg?.type)}' em ${binding.key}`, fn)(msg?.value, extra);
  };
}

export async function fillWebview(
  webview: vscode.Webview,
  binding: Pick<WebviewBinding, "uiEntry">,
  ctx: vscode.ExtensionContext
): Promise<void> {
  const uiUri = vscode.Uri.joinPath(ctx.extensionUri, binding.uiEntry);
  const baseDir = vscode.Uri.joinPath(uiUri, "..");
  const bytes = await vscode.workspace.fs.readFile(uiUri);
  webview.html = renderWebviewHtml(new TextDecoder().decode(bytes), {
    nonce: makeNonce(),
    cspSource: webview.cspSource,
    resolveResource: (rel) => webview.asWebviewUri(vscode.Uri.joinPath(baseDir, rel)).toString(),
  });
}

/**
 * Ciclo de vida de painel/view por classe: liveness (panel().isOpen/post),
 * handlers @OnOpen/@OnDispose e timers @Every — ligados no open/resolve,
 * desligados no dispose. Handlers resolvem do registry a cada uso (hot swap).
 */
function lifecycleFor(key: string): { opened(): void; closed(): void } {
  const timers: ReturnType<typeof setInterval>[] = [];
  const each = (map: Map<string, () => unknown>, what: string): void => {
    for (const k of map.keys()) {
      if (k.startsWith(`${key}.`)) guard(`${what} ${k}`, () => map.get(k)?.())();
    }
  };
  return {
    opened() {
      registry.webviewLive.set(key, true);
      each(registry.webviewOpenHandlers, "@OnOpen");
      for (const k of registry.everyHandlers.keys()) {
        if (!k.startsWith(`${key}.`)) continue;
        const ms = registry.everyHandlers.get(k)!.ms;
        timers.push(setInterval(guard(`@Every ${k}`, () => registry.everyHandlers.get(k)?.fn()), ms));
      }
    },
    closed() {
      registry.webviewLive.set(key, false);
      for (const t of timers.splice(0)) clearInterval(t);
      each(registry.webviewDisposeHandlers, "@OnDispose");
    },
  };
}

/**
 * @Webview com location "panel" (§15.2): painel lazy e singleton —
 * `registry.webviews.get(key)!.open()` cria ou revela.
 */
export function bindWebview(binding: WebviewBinding, ctx: vscode.ExtensionContext): vscode.Disposable {
  let panel: vscode.WebviewPanel | undefined;

  const post = (msg: unknown): void => {
    if (!panel) {
      console.warn(`sigil: post em '${binding.key}' com o painel fechado — mensagem descartada`);
      return;
    }
    void panel.webview.postMessage(msg);
  };
  // o wire injeta um forwarder nas instâncias (inclusive re-hidratadas no hot swap)
  registry.webviewPosts.set(binding.key, post);
  const router = makeRouter(binding, (msg) => void panel?.webview.postMessage(msg));
  const lifecycle = lifecycleFor(binding.key);

  const open = async (): Promise<void> => {
    if (panel) {
      panel.reveal();
      return;
    }
    panel = vscode.window.createWebviewPanel(binding.id, binding.title, vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [ctx.extensionUri],
    });
    panel.webview.onDidReceiveMessage(router);
    panel.onDidDispose(() => {
      panel = undefined;
      lifecycle.closed();
    });
    await fillWebview(panel.webview, binding, ctx);
    lifecycle.opened();
  };

  registry.webviews.set(binding.key, { open, post });
  return {
    dispose() {
      registry.webviews.delete(binding.key);
      registry.webviewPosts.delete(binding.key);
      panel?.dispose();
    },
  };
}

/**
 * @Webview com location "sidebar": a view entra em contributes.views (com
 * type "webview") e o host registra um WebviewViewProvider. `open()` foca a
 * view via o comando "<viewId>.focus" que o VSCode gera para toda view.
 */
export function bindWebviewView(binding: WebviewBinding, ctx: vscode.ExtensionContext): vscode.Disposable {
  let current: vscode.WebviewView | undefined;

  const post = (msg: unknown): void => {
    if (!current) {
      console.warn(`sigil: post em '${binding.key}' sem a view resolvida — mensagem descartada`);
      return;
    }
    void current.webview.postMessage(msg);
  };
  registry.webviewPosts.set(binding.key, post);
  const router = makeRouter(binding, (msg) => void current?.webview.postMessage(msg));
  const lifecycle = lifecycleFor(binding.key);

  const provider: vscode.WebviewViewProvider = {
    resolveWebviewView: async (view) => {
      current = view;
      view.webview.options = { enableScripts: true, localResourceRoots: [ctx.extensionUri] };
      view.webview.onDidReceiveMessage(router);
      view.onDidDispose(() => {
        current = undefined;
        lifecycle.closed();
      });
      await fillWebview(view.webview, binding, ctx);
      lifecycle.opened();
    },
  };

  registry.webviews.set(binding.key, {
    open: async () => {
      await vscode.commands.executeCommand(`${binding.id}.focus`);
    },
    post,
  });
  const registration = vscode.window.registerWebviewViewProvider(binding.id, provider);
  return {
    dispose() {
      registry.webviews.delete(binding.key);
      registry.webviewPosts.delete(binding.key);
      registration.dispose();
    },
  };
}
