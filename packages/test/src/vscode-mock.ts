import fs from "node:fs";
import path from "node:path";

/**
 * Simulador do subconjunto da API `vscode` que o runtime do sigil toca.
 *
 * Fidelidade onde importa:
 * - configuração com defaults semeados do manifesto (como o VSCode faz) e
 *   semântica correta de `affectsConfiguration` (prefixo nos dois sentidos);
 * - `update()` de config dispara `onDidChangeConfiguration` (o VSCode também
 *   dispara para escritas programáticas);
 * - `registerCommand` duplicado lança, `executeCommand` desconhecido rejeita;
 * - webview panel com html/postMessage/onDidReceiveMessage/reveal/dispose.
 *
 * Honestidade nas bordas (R6): o que não é simulado lança erro descritivo em
 * vez de retornar undefined silencioso.
 */

export interface DisposableLike {
  dispose(): void;
}

export class EventEmitterMock<T = unknown> {
  private listeners: ((e: T) => void)[] = [];

  readonly event = (listener: (e: T) => void): DisposableLike => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      },
    };
  };

  fire(payload: T): void {
    for (const l of [...this.listeners]) l(payload);
  }

  dispose(): void {
    this.listeners = [];
  }
}

export class TreeItemMock {
  label: unknown;
  collapsibleState?: number;
  id?: string;
  [extra: string]: unknown;

  constructor(label: unknown, collapsibleState?: number) {
    this.label = label;
    if (collapsibleState !== undefined) this.collapsibleState = collapsibleState;
  }
}

export interface UriMock {
  fsPath: string;
  path: string;
  toString(): string;
}

export function uriFile(fsPath: string): UriMock {
  const posix = fsPath.split(path.sep).join("/");
  return { fsPath, path: posix, toString: () => `file://${posix}` };
}

export interface TreeDataProviderLike {
  onDidChangeTreeData?: (listener: (e: unknown) => void) => DisposableLike;
  getTreeItem(element: unknown): unknown;
  getChildren(element?: unknown): unknown;
}

export class StatusBarItemMock {
  text = "";
  tooltip?: string;
  command?: string;
  name?: string;
  shown = false;

  constructor(
    readonly alignment: number,
    readonly priority?: number
  ) {}

  show(): void {
    this.shown = true;
  }
  hide(): void {
    this.shown = false;
  }
  dispose(): void {
    this.shown = false;
  }
}

/** Serve tanto de WebviewPanel quanto de WebviewView (sidebar) fake. */
export class WebviewPanelMock {
  readonly viewType: string;
  title: string;
  disposed = false;
  revealCount = 0;
  /** mensagens enviadas do host para a UI via post/postMessage */
  readonly posted: unknown[] = [];
  readonly webview: {
    cspSource: string;
    html: string;
    /** WebviewView: options são atribuídas no resolve */
    options?: unknown;
    asWebviewUri(uri: UriMock): { toString(): string };
    postMessage(msg: unknown): Promise<boolean>;
    onDidReceiveMessage(cb: (msg: unknown) => void): DisposableLike;
  };
  private receiveHandler?: (msg: unknown) => void;
  private disposeHandlers: (() => void)[] = [];
  private htmlValue = "";

  constructor(viewType: string, title: string) {
    this.viewType = viewType;
    this.title = title;
    const self = this;
    this.webview = {
      cspSource: "https://sigil-test.csp",
      get html() {
        return self.htmlValue;
      },
      set html(v: string) {
        self.htmlValue = v;
      },
      asWebviewUri: (uri: UriMock) => ({ toString: () => `sigil-webview://${uri.path}` }),
      postMessage: (msg: unknown) => {
        self.posted.push(msg);
        return Promise.resolve(true);
      },
      onDidReceiveMessage: (cb: (msg: unknown) => void) => {
        self.receiveHandler = cb;
        return { dispose() {} };
      },
    };
  }

  /** atalho de teste: o HTML atual do painel */
  get html(): string {
    return this.htmlValue;
  }

  /** simula a UI enviando uma mensagem para o host */
  receive(msg: unknown): void {
    if (!this.receiveHandler) {
      throw new Error(`sigil-test: o painel '${this.viewType}' não registrou onDidReceiveMessage`);
    }
    this.receiveHandler(msg);
  }

  reveal(): void {
    this.revealCount++;
  }

  /** WebviewView usa show() em vez de reveal() */
  show(): void {
    this.revealCount++;
  }

  onDidDispose(cb: () => void): DisposableLike {
    this.disposeHandlers.push(cb);
    return { dispose() {} };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const h of this.disposeHandlers) h();
  }
}

export interface VscodeMockState {
  /** valores "escritos" (usuário ou extensão); ausência → default do manifesto */
  values: Map<string, unknown>;
  /** defaults semeados de contributes.configuration.properties */
  defaults: Map<string, unknown>;
  commands: Map<string, (...args: unknown[]) => unknown>;
  infoMessages: string[];
  warnMessages: string[];
  errorMessages: string[];
  /** respostas enfileiradas para showInputBox; fila vazia = usuário cancelou (undefined) */
  inputBoxQueue: (string | undefined)[];
  /** respostas enfileiradas para showQuickPick; fila vazia = usuário cancelou */
  quickPickQueue: unknown[];
  treeProviders: Map<string, TreeDataProviderLike>;
  panels: WebviewPanelMock[];
  webviewViewProviders: Map<string, { resolveWebviewView(view: unknown): unknown }>;
  webviewViews: Map<string, WebviewPanelMock>;
  statusBarItems: StatusBarItemMock[];
  configListeners: ((e: { affectsConfiguration(section: string): boolean }) => void)[];
  fireConfigChange(changedId: string): void;
}

export function createState(): VscodeMockState {
  const state: VscodeMockState = {
    values: new Map(),
    defaults: new Map(),
    commands: new Map(),
    infoMessages: [],
    warnMessages: [],
    errorMessages: [],
    inputBoxQueue: [],
    quickPickQueue: [],
    treeProviders: new Map(),
    panels: [],
    webviewViewProviders: new Map(),
    webviewViews: new Map(),
    statusBarItems: [],
    configListeners: [],
    fireConfigChange(changedId: string) {
      const event = {
        affectsConfiguration: (section: string) =>
          changedId === section ||
          changedId.startsWith(section + ".") ||
          section.startsWith(changedId + "."),
      };
      for (const l of [...state.configListeners]) l(event);
    },
  };
  return state;
}

function unsupported(what: string): never {
  throw new Error(`sigil-test: '${what}' não é simulado — abra uma issue ou use o E2E com @vscode/test-electron`);
}

export function createVscodeMock(state: VscodeMockState): Record<string, unknown> {
  const fullId = (section: string, key: string) => (section ? `${section}.${key}` : key);

  /** VSCode resolve a view no primeiro show; o comando "<id>.focus" faz isso aqui. */
  const resolveWebviewView = async (viewId: string): Promise<WebviewPanelMock> => {
    const provider = state.webviewViewProviders.get(viewId);
    if (!provider) {
      throw new Error(
        `sigil-test: nenhum WebviewViewProvider registrado como '${viewId}' (registrados: ${[...state.webviewViewProviders.keys()].sort().join(", ") || "nenhum"})`
      );
    }
    const existing = state.webviewViews.get(viewId);
    if (existing && !existing.disposed) {
      existing.show();
      return existing;
    }
    const view = new WebviewPanelMock(viewId, viewId);
    state.webviewViews.set(viewId, view);
    await provider.resolveWebviewView(view);
    return view;
  };

  return {
    EventEmitter: EventEmitterMock,
    TreeItem: TreeItemMock,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2, Three: 3 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    __resolveWebviewView: resolveWebviewView,
    Uri: {
      file: uriFile,
      joinPath: (base: UriMock, ...parts: string[]) => uriFile(path.join(base.fsPath, ...parts)),
    },
    window: {
      showInformationMessage: (msg: string) => {
        state.infoMessages.push(String(msg));
        return Promise.resolve(undefined);
      },
      showWarningMessage: (msg: string) => {
        state.warnMessages.push(String(msg));
        return Promise.resolve(undefined);
      },
      showErrorMessage: (msg: string) => {
        state.errorMessages.push(String(msg));
        return Promise.resolve(undefined);
      },
      // fila vazia → undefined, o mesmo que o usuário apertar ESC no VSCode
      showInputBox: (_opts?: unknown) => Promise.resolve(state.inputBoxQueue.shift()),
      showQuickPick: (_items?: unknown, _opts?: unknown) =>
        Promise.resolve(state.quickPickQueue.shift()),
      registerTreeDataProvider: (id: string, provider: TreeDataProviderLike) => {
        state.treeProviders.set(id, provider);
        return { dispose: () => state.treeProviders.delete(id) };
      },
      createTreeView: (id: string, opts: { treeDataProvider: TreeDataProviderLike }) => {
        state.treeProviders.set(id, opts.treeDataProvider);
        return { dispose: () => state.treeProviders.delete(id) };
      },
      createWebviewPanel: (viewType: string, title: string) => {
        const panel = new WebviewPanelMock(viewType, title);
        state.panels.push(panel);
        return panel;
      },
      registerWebviewViewProvider: (id: string, provider: { resolveWebviewView(view: unknown): unknown }) => {
        state.webviewViewProviders.set(id, provider);
        return { dispose: () => state.webviewViewProviders.delete(id) };
      },
      createStatusBarItem: (alignment?: number, priority?: number) => {
        const item = new StatusBarItemMock(alignment ?? 1, priority);
        state.statusBarItems.push(item);
        return item;
      },
    },
    commands: {
      registerCommand: (id: string, fn: (...args: unknown[]) => unknown) => {
        if (state.commands.has(id)) {
          // o VSCode também lança em registro duplicado
          throw new Error(`command '${id}' already exists`);
        }
        state.commands.set(id, fn);
        return { dispose: () => state.commands.delete(id) };
      },
      executeCommand: (id: string, ...args: unknown[]) => {
        const fn = state.commands.get(id);
        if (fn) return Promise.resolve(fn(...args));
        // o VSCode gera "<viewId>.focus" para toda view contribuída
        if (id.endsWith(".focus")) {
          const viewId = id.slice(0, -".focus".length);
          if (state.webviewViewProviders.has(viewId)) {
            return resolveWebviewView(viewId).then(() => undefined);
          }
        }
        return Promise.reject(
          new Error(
            `sigil-test: comando desconhecido '${id}' — o simulador só conhece comandos registrados pela extensão (${[...state.commands.keys()].sort().join(", ") || "nenhum"})`
          )
        );
      },
      getCommands: () => Promise.resolve([...state.commands.keys()]),
    },
    workspace: {
      getConfiguration: (section = "") => ({
        get: (key: string) => {
          const id = fullId(section, key);
          return state.values.has(id) ? state.values.get(id) : state.defaults.get(id);
        },
        has: (key: string) => {
          const id = fullId(section, key);
          return state.values.has(id) || state.defaults.has(id);
        },
        update: (key: string, value: unknown) => {
          const id = fullId(section, key);
          if (value === undefined) state.values.delete(id);
          else state.values.set(id, value);
          state.fireConfigChange(id);
          return Promise.resolve();
        },
      }),
      onDidChangeConfiguration: (cb: (e: { affectsConfiguration(s: string): boolean }) => void) => {
        state.configListeners.push(cb);
        return {
          dispose: () => {
            state.configListeners = state.configListeners.filter((l) => l !== cb);
          },
        };
      },
      fs: {
        readFile: (uri: UriMock): Promise<Uint8Array> =>
          Promise.resolve(new Uint8Array(fs.readFileSync(uri.fsPath))),
      },
      get workspaceFolders() {
        return unsupported("workspace.workspaceFolders");
      },
    },
  };
}
