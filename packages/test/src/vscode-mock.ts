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

export class PositionMock {
  constructor(
    readonly line: number,
    readonly character: number
  ) {}
}

export class RangeMock {
  constructor(
    readonly start: PositionMock,
    readonly end: PositionMock
  ) {}
}

export class SelectionMock extends RangeMock {
  constructor(
    readonly anchor: PositionMock,
    readonly active: PositionMock
  ) {
    super(anchor, active);
  }
}

export class TextDocumentMock {
  constructor(
    public text: string,
    readonly languageId: string,
    readonly uri: UriMock
  ) {}

  getText(): string {
    return this.text;
  }

  get lineCount(): number {
    return this.text.split("\n").length;
  }

  lineAt(line: number): { lineNumber: number; text: string; range: RangeMock } {
    const textLine = this.text.split("\n")[line] ?? "";
    return {
      lineNumber: line,
      text: textLine,
      range: new RangeMock(new PositionMock(line, 0), new PositionMock(line, textLine.length)),
    };
  }

  offsetAt(pos: { line: number; character: number }): number {
    const lines = this.text.split("\n");
    let offset = 0;
    for (let i = 0; i < pos.line && i < lines.length; i++) offset += lines[i]!.length + 1;
    return Math.min(offset + pos.character, this.text.length);
  }

  positionAt(offset: number): PositionMock {
    const clamped = Math.max(0, Math.min(offset, this.text.length));
    const before = this.text.slice(0, clamped);
    const line = (before.match(/\n/g) ?? []).length;
    return new PositionMock(line, clamped - before.lastIndexOf("\n") - 1);
  }
}

class TextEditorEditMock {
  private readonly ops: { start: number; end: number; text: string }[] = [];

  constructor(private readonly doc: TextDocumentMock) {}

  insert(pos: { line: number; character: number }, text: string): void {
    const offset = this.doc.offsetAt(pos);
    this.ops.push({ start: offset, end: offset, text });
  }

  replace(range: RangeMock, text: string): void {
    this.ops.push({ start: this.doc.offsetAt(range.start), end: this.doc.offsetAt(range.end), text });
  }

  delete(range: RangeMock): void {
    this.replace(range, "");
  }

  apply(): void {
    // de trás para frente, para os offsets anteriores não se moverem
    for (const op of [...this.ops].sort((a, b) => b.start - a.start)) {
      this.doc.text = this.doc.text.slice(0, op.start) + op.text + this.doc.text.slice(op.end);
    }
  }
}

export class TextEditorMock {
  selection: SelectionMock;

  constructor(readonly document: TextDocumentMock) {
    this.selection = new SelectionMock(new PositionMock(0, 0), new PositionMock(0, 0));
  }

  edit(callback: (builder: TextEditorEditMock) => void): Promise<boolean> {
    const builder = new TextEditorEditMock(this.document);
    callback(builder);
    builder.apply();
    return Promise.resolve(true);
  }
}

export class OutputChannelMock {
  readonly entries: { level: string; message: string }[] = [];
  shownCount = 0;

  constructor(readonly name: string) {}

  private push(level: string, message: string, args: unknown[]): void {
    const suffix = args.length > 0 ? ` ${args.map((a) => JSON.stringify(a)).join(" ")}` : "";
    this.entries.push({ level, message: `${message}${suffix}` });
  }

  trace(message: string, ...args: unknown[]): void {
    this.push("trace", message, args);
  }
  debug(message: string, ...args: unknown[]): void {
    this.push("debug", message, args);
  }
  info(message: string, ...args: unknown[]): void {
    this.push("info", message, args);
  }
  warn(message: string, ...args: unknown[]): void {
    this.push("warn", message, args);
  }
  error(message: string, ...args: unknown[]): void {
    this.push("error", message, args);
  }
  appendLine(message: string): void {
    this.push("info", message, []);
  }
  show(): void {
    this.shownCount++;
  }
  dispose(): void {}
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
  /**
   * Modo interativo (sim --ui): com as filas vazias, showInputBox/QuickPick
   * delegam para este handler em vez de devolver undefined (ESC).
   */
  interactiveInput?: (kind: "inputBox" | "quickPick", opts: unknown, items?: unknown) => Promise<unknown>;
  /** as opções de cada showInputBox chamado, na ordem */
  inputBoxCalls: unknown[];
  /** os itens (e opções) de cada showQuickPick chamado, na ordem */
  quickPickCalls: { items: unknown; options?: unknown }[];
  documents: TextDocumentMock[];
  activeTextEditor?: TextEditorMock;
  treeProviders: Map<string, TreeDataProviderLike>;
  panels: WebviewPanelMock[];
  webviewViewProviders: Map<string, { resolveWebviewView(view: unknown): unknown }>;
  webviewViews: Map<string, WebviewPanelMock>;
  statusBarItems: StatusBarItemMock[];
  outputChannels: OutputChannelMock[];
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
    inputBoxCalls: [],
    quickPickCalls: [],
    documents: [],
    activeTextEditor: undefined,
    treeProviders: new Map(),
    panels: [],
    webviewViewProviders: new Map(),
    webviewViews: new Map(),
    statusBarItems: [],
    outputChannels: [],
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

/** Zera o estado IN-PLACE (os closures do mock capturam o objeto). */
export function resetState(state: VscodeMockState): void {
  state.values.clear();
  state.defaults.clear();
  state.commands.clear();
  state.infoMessages.length = 0;
  state.warnMessages.length = 0;
  state.errorMessages.length = 0;
  state.inputBoxQueue.length = 0;
  state.quickPickQueue.length = 0;
  state.inputBoxCalls.length = 0;
  state.quickPickCalls.length = 0;
  state.documents.length = 0;
  state.activeTextEditor = undefined;
  state.treeProviders.clear();
  state.panels.length = 0;
  state.webviewViewProviders.clear();
  state.webviewViews.clear();
  state.statusBarItems.length = 0;
  state.outputChannels.length = 0;
  state.configListeners = [];
  state.interactiveInput = undefined;
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
    Position: PositionMock,
    Range: RangeMock,
    Selection: SelectionMock,
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
      // fila com resposta → usa; fila vazia → handler interativo (sim --ui)
      // ou undefined, o mesmo que o usuário apertar ESC no VSCode
      showInputBox: (opts?: unknown) => {
        state.inputBoxCalls.push(opts ?? {});
        if (state.inputBoxQueue.length > 0) return Promise.resolve(state.inputBoxQueue.shift());
        if (state.interactiveInput) return state.interactiveInput("inputBox", opts);
        return Promise.resolve(undefined);
      },
      showQuickPick: (items?: unknown, options?: unknown) => {
        state.quickPickCalls.push({ items, options });
        if (state.quickPickQueue.length > 0) return Promise.resolve(state.quickPickQueue.shift());
        if (state.interactiveInput) return state.interactiveInput("quickPick", options, items);
        return Promise.resolve(undefined);
      },
      get activeTextEditor() {
        return state.activeTextEditor;
      },
      showTextDocument: (doc: TextDocumentMock) => {
        const editor = new TextEditorMock(doc);
        state.activeTextEditor = editor;
        return Promise.resolve(editor);
      },
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
      createOutputChannel: (name: string, _opts?: unknown) => {
        const channel = new OutputChannelMock(name);
        state.outputChannels.push(channel);
        return channel;
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
      get textDocuments() {
        return [...state.documents];
      },
      openTextDocument: (options?: { content?: string; language?: string } | UriMock) => {
        if (options && "fsPath" in (options as UriMock)) {
          const uri = options as UriMock;
          const doc = new TextDocumentMock(fs.readFileSync(uri.fsPath, "utf8"), "plaintext", uri);
          state.documents.push(doc);
          return Promise.resolve(doc);
        }
        const o = (options ?? {}) as { content?: string; language?: string };
        const doc = new TextDocumentMock(
          o.content ?? "",
          o.language ?? "plaintext",
          uriFile(`/untitled-${state.documents.length + 1}`)
        );
        state.documents.push(doc);
        return Promise.resolve(doc);
      },
      get workspaceFolders() {
        return unsupported("workspace.workspaceFolders");
      },
    },
  };
}
