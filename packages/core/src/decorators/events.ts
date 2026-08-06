import * as vscode from "vscode";
import { dual } from "./dual";
import { registry } from "../registry";
import { registerBoundMember, registerEveryMember } from "../metadata";
import { guard } from "../guard";

export interface OnOptions {
  /** trailing debounce em ms — para eventos que disparam a cada tecla */
  debounce?: number;
}

/**
 * Assinatura declarativa de eventos do VSCode com auto-dispose:
 * `@On("workspace.onDidSaveTextDocument")`. O wire subscreve na ativação,
 * descarta no deactivate e envolve o handler em guard — vazamento de
 * disposable deixa de ser possível.
 */
export function On(_event: string, _opts: OnOptions = {}) {
  return registerBoundMember("events");
}

export interface OnFileOptions {
  debounce?: number;
}

/**
 * FileSystemWatcher declarativo: `@OnFile("**​/*.md", "change")`.
 * O handler recebe o vscode.Uri do arquivo.
 */
export function OnFile(_glob: string, _kind: "change" | "create" | "delete" | "all" = "all", _opts: OnFileOptions = {}) {
  return registerBoundMember("events");
}

function withDebounce<A extends unknown[]>(fn: (...args: A) => void, ms?: number): (...args: A) => void {
  if (!ms) return fn;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function dynamicHandler(what: string, key: string): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    const fn = registry.events.get(key);
    if (!fn) throw new Error(`sigil: handler ausente para ${key}. Rode 'sigil build'.`);
    guard(what, fn)(...args);
  };
}

export interface EventBinding {
  readonly key: string;
  readonly event: string; // "workspace.onDidSaveTextDocument"
  readonly debounce?: number;
}

export function bindEvents(bindings: readonly EventBinding[]): vscode.Disposable {
  const disposables = bindings.map((b) => {
    const [ns, name] = b.event.split(".", 2) as [string, string];
    const source = (vscode as unknown as Record<string, Record<string, unknown>>)[ns]?.[name];
    if (typeof source !== "function") {
      throw new Error(`sigil: evento desconhecido '${b.event}' em @On (${b.key}) — confira o nome na API do vscode`);
    }
    const handler = withDebounce(dynamicHandler(`@On ${b.event} (${b.key})`, b.key), b.debounce);
    return (source as (h: (...args: unknown[]) => void) => vscode.Disposable)(handler);
  });
  return {
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

export interface FileWatcherBinding {
  readonly key: string;
  readonly glob: string;
  readonly kind: "change" | "create" | "delete" | "all";
  readonly debounce?: number;
}

export function bindFileWatchers(bindings: readonly FileWatcherBinding[]): vscode.Disposable {
  const disposables: vscode.Disposable[] = [];
  for (const b of bindings) {
    const watcher = vscode.workspace.createFileSystemWatcher(b.glob);
    disposables.push(watcher);
    const handler = withDebounce(dynamicHandler(`@OnFile ${b.glob} (${b.key})`, b.key), b.debounce);
    if (b.kind === "change" || b.kind === "all") disposables.push(watcher.onDidChange(handler));
    if (b.kind === "create" || b.kind === "all") disposables.push(watcher.onDidCreate(handler));
    if (b.kind === "delete" || b.kind === "all") disposables.push(watcher.onDidDelete(handler));
  }
  return {
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

/**
 * `@UriHandler()` — deep links vscode://publisher.ext/…; um por extensão.
 * O sigil emite o activationEvent "onUri" e registra com auto-dispose.
 */
export const UriHandler = dual(() => registerBoundMember("events"));

export function bindUriHandler(key: string): vscode.Disposable {
  if (!registry.events.has(key)) {
    throw new Error(`sigil: handler ausente para ${key}. Rode 'sigil build'.`);
  }
  return vscode.window.registerUriHandler({
    handleUri: (uri) => dynamicHandler(`@UriHandler (${key})`, key)(uri),
  });
}

/**
 * Timer declarativo com o ciclo de vida certo, sem setInterval solto:
 * - em classe @Extension: roda da ativação até a desativação;
 * - em classe @Webview: roda ENQUANTO o painel/view está aberto (o tick de
 *   animação do vscode-pets é o caso canônico) — abre liga, fecha desliga.
 * O handler resolve do registry a cada disparo (hot-swap safe) e passa por
 * guard (erro vira log, o timer sobrevive).
 */
export function Every(ms: number) {
  return registerEveryMember(ms);
}

/**
 * Timers @Every de uma classe fora do ciclo de webview (a @Extension): ligam
 * na ativação e desligam na desativação. O wire chama com o nome da classe.
 */
export function bindEvery(className: string): { dispose(): void } {
  const timers: ReturnType<typeof setInterval>[] = [];
  for (const key of registry.everyHandlers.keys()) {
    if (!key.startsWith(`${className}.`)) continue;
    const ms = registry.everyHandlers.get(key)!.ms;
    timers.push(setInterval(guard(`@Every ${key}`, () => registry.everyHandlers.get(key)?.fn()), ms));
  }
  return {
    dispose() {
      for (const t of timers.splice(0)) clearInterval(t);
    },
  };
}
