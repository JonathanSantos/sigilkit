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
  readonly start: PositionMock;
  readonly end: PositionMock;
  /** aceita (start, end) com Positions OU o overload numérico (l1, c1, l2, c2) do vscode real */
  constructor(start: PositionMock | number, end: PositionMock | number, endLine?: number, endCharacter?: number) {
    if (typeof start === "number") {
      this.start = new PositionMock(start, (end as number) ?? 0);
      this.end = new PositionMock(endLine ?? (start as number), endCharacter ?? 0);
    } else {
      this.start = start;
      this.end = end as PositionMock;
    }
  }
}

/** MarkdownString real o suficiente para hovers clássicos. */
export class MarkdownStringMock {
  isTrusted = false;
  supportHtml = false;
  constructor(public value: string = "") {}
  appendMarkdown(s: string): this {
    this.value += s;
    return this;
  }
  appendText(s: string): this {
    this.value += s.replace(/[\\`*_{}[\]()#+\-.!]/g, "\\$&");
    return this;
  }
  appendCodeblock(code: string, language = ""): this {
    this.value += `\n\`\`\`${language}\n${code}\n\`\`\`\n`;
    return this;
  }
  toString(): string {
    return this.value;
  }
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

  /** F10 do dogfood: com range, FATIA como o VSCode real (via offsets) —
   *  aceitar o argumento e ignorá-lo era divergência silenciosa. */
  getText(range?: { start: { line: number; character: number }; end: { line: number; character: number } }): string {
    if (!range) return this.text;
    return this.text.slice(this.offsetAt(range.start), this.offsetAt(range.end));
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

  /** a forma canônica de hover: a palavra sob o cursor (regex custom opcional). */
  getWordRangeAtPosition(pos: { line: number; character: number }, regex?: RegExp): RangeMock | undefined {
    const line = this.text.split("\n")[pos.line] ?? "";
    const re = new RegExp((regex ?? /[\wÀ-ɏ]+/).source, `${(regex?.flags ?? "").replace(/g/g, "")}g`);
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      if (m.index <= pos.character && pos.character <= m.index + m[0].length && m[0].length > 0) {
        return new RangeMock(new PositionMock(pos.line, m.index), new PositionMock(pos.line, m.index + m[0].length));
      }
      if (m.index > pos.character) break;
      if (m[0].length === 0) re.lastIndex++;
    }
    return undefined;
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
  /** fire de onDidChangeTextDocument — ligado pelo createVscodeMock */
  onEdited?: (doc: TextDocumentMock) => void;

  constructor(readonly document: TextDocumentMock) {
    this.selection = new SelectionMock(new PositionMock(0, 0), new PositionMock(0, 0));
  }

  edit(callback: (builder: TextEditorEditMock) => void): Promise<boolean> {
    const builder = new TextEditorEditMock(this.document);
    callback(builder);
    builder.apply();
    this.onEdited?.(this.document);
    return Promise.resolve(true);
  }
}

export class HoverMock {
  readonly contents: unknown[];
  constructor(contents: unknown) {
    this.contents = Array.isArray(contents) ? contents : [contents];
  }
}

export class CompletionItemMock {
  constructor(
    public label: unknown,
    public kind?: number
  ) {}
}

export class CodeLensMock {
  constructor(
    public range: RangeMock,
    public command?: unknown
  ) {}
}

export class DiagnosticMock {
  constructor(
    public range: RangeMock,
    public message: string,
    public severity?: number
  ) {}
}

export class WorkspaceEditMock {
  readonly replacements: { uri: UriMock; range: RangeMock; newText: string }[] = [];
  replace(uri: UriMock, range: RangeMock, newText: string): void {
    this.replacements.push({ uri, range, newText });
  }
}

export class DiagnosticCollectionMock {
  readonly byUri = new Map<string, DiagnosticMock[]>();
  constructor(readonly name: string) {}
  set(uri: UriMock, diagnostics: DiagnosticMock[] | undefined): void {
    if (!diagnostics || diagnostics.length === 0) this.byUri.delete(uri.toString());
    else this.byUri.set(uri.toString(), diagnostics);
  }
  delete(uri: UriMock): void {
    this.byUri.delete(uri.toString());
  }
  clear(): void {
    this.byUri.clear();
  }
  dispose(): void {
    this.byUri.clear();
  }
}

export interface LanguageProviderEntry {
  kind:
    | "hover" | "completion" | "codeLens"
    | "codeAction" | "definition" | "references" | "rename" | "formatting" | "symbols" | "inlayHints";
  selector: string[];
  provider: Record<string, (...args: unknown[]) => unknown>;
  triggers?: string[];
  metadata?: unknown;
}

// ── Testing API ──────────────────────────────────────────────────────────────

export class TestItemCollectionMock {
  private map = new Map<string, TestItemMock>();
  replace(items: TestItemMock[]): void {
    this.map.clear();
    for (const item of items) this.map.set(item.id, item);
  }
  add(item: TestItemMock): void {
    this.map.set(item.id, item);
  }
  get(id: string): TestItemMock | undefined {
    return this.map.get(id);
  }
  get size(): number {
    return this.map.size;
  }
  forEach(cb: (item: TestItemMock) => void): void {
    for (const item of this.map.values()) cb(item);
  }
}

export class TestItemMock {
  readonly children = new TestItemCollectionMock();
  range?: unknown;
  constructor(
    readonly id: string,
    public label: string,
    readonly uri?: unknown
  ) {}
}

export class TestRunMock {
  readonly results: { id: string; status: "passed" | "failed" | "skipped"; message?: string; duration?: number }[] = [];
  ended = false;
  started(_item: TestItemMock): void {}
  passed(item: TestItemMock, duration?: number): void {
    this.results.push({ id: item.id, status: "passed", duration });
  }
  failed(item: TestItemMock, message: unknown, duration?: number): void {
    const text = typeof message === "string" ? message : ((message as { message?: string })?.message ?? String(message));
    this.results.push({ id: item.id, status: "failed", message: text, duration });
  }
  skipped(item: TestItemMock): void {
    this.results.push({ id: item.id, status: "skipped" });
  }
  end(): void {
    this.ended = true;
  }
}

export class TestControllerMock {
  readonly items = new TestItemCollectionMock();
  readonly profiles: { label: string; kind: unknown; handler: (request: unknown, token: unknown) => unknown; isDefault?: boolean }[] = [];
  readonly runs: TestRunMock[] = [];
  refreshHandler?: () => unknown;
  constructor(
    readonly id: string,
    readonly label: string
  ) {}
  createTestItem(id: string, label: string, uri?: unknown): TestItemMock {
    return new TestItemMock(id, label, uri);
  }
  createRunProfile(label: string, kind: unknown, handler: (request: unknown, token: unknown) => unknown, isDefault?: boolean) {
    const profile = { label, kind, handler, isDefault };
    this.profiles.push(profile);
    return { dispose: () => void this.profiles.splice(this.profiles.indexOf(profile), 1) };
  }
  createTestRun(_request: unknown): TestRunMock {
    const run = new TestRunMock();
    this.runs.push(run);
    return run;
  }
  dispose(): void {}
}

export class MementoMock {
  private readonly store = new Map<string, unknown>();
  get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.store.has(key) ? this.store.get(key) : defaultValue) as T | undefined;
  }
  update(key: string, value: unknown): Promise<void> {
    if (value === undefined) this.store.delete(key);
    else this.store.set(key, value);
    return Promise.resolve();
  }
  keys(): string[] {
    return [...this.store.keys()];
  }
}

export class SecretStorageMock {
  private readonly values = new Map<string, string>();
  private readonly listeners: ((e: { key: string }) => void)[] = [];
  get(key: string): Promise<string | undefined> {
    return Promise.resolve(this.values.get(key));
  }
  store(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    this.listeners.forEach((l) => l({ key }));
    return Promise.resolve();
  }
  delete(key: string): Promise<void> {
    this.values.delete(key);
    this.listeners.forEach((l) => l({ key }));
    return Promise.resolve();
  }
  onDidChange = (cb: (e: { key: string }) => void): DisposableLike => {
    this.listeners.push(cb);
    return { dispose: () => void this.listeners.splice(this.listeners.indexOf(cb), 1) };
  };
}

export class FileWatcherMock {
  readonly changeListeners: ((uri: UriMock) => void)[] = [];
  readonly createListeners: ((uri: UriMock) => void)[] = [];
  readonly deleteListeners: ((uri: UriMock) => void)[] = [];
  constructor(readonly glob: string) {}
  onDidChange = (cb: (uri: UriMock) => void): DisposableLike => {
    this.changeListeners.push(cb);
    return { dispose() {} };
  };
  onDidCreate = (cb: (uri: UriMock) => void): DisposableLike => {
    this.createListeners.push(cb);
    return { dispose() {} };
  };
  onDidDelete = (cb: (uri: UriMock) => void): DisposableLike => {
    this.deleteListeners.push(cb);
    return { dispose() {} };
  };
  matches(filePath: string): boolean {
    // placeholders evitam que o output de um replace seja mastigado pelo próximo
    const pattern = this.glob
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*\//g, "\u0001")
      .replace(/\*\*/g, "\u0002")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]")
      .replace(/\u0001/g, "(?:.*/)?")
      .replace(/\u0002/g, ".*");
    const regex = new RegExp(`^${pattern}$`);
    return regex.test(filePath) || regex.test(filePath.replace(/^\//, ""));
  }
  dispose(): void {}
}

export class ChatResponseStreamMock {
  readonly calls: { kind: string; value: unknown }[] = [];
  markdown(value: unknown): void {
    this.calls.push({ kind: "markdown", value });
  }
  progress(value: unknown): void {
    this.calls.push({ kind: "progress", value });
  }
  button(value: unknown): void {
    this.calls.push({ kind: "button", value });
  }
  anchor(value: unknown): void {
    this.calls.push({ kind: "anchor", value });
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
  private rpcSequence = 0;
  private readonly rpcPending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

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
        // resolve requests pendentes de panel.request() (correlação como a UI real)
        const envelope = msg as { type?: string; id?: number; ok?: boolean; value?: unknown; error?: string };
        if (envelope?.type === "__sigilRpcResult" && typeof envelope.id === "number") {
          const pending = self.rpcPending.get(envelope.id);
          if (pending) {
            self.rpcPending.delete(envelope.id);
            if (envelope.ok) pending.resolve(envelope.value);
            else pending.reject(new Error(envelope.error ?? "erro no host"));
          }
        }
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

  /**
   * RPC como a UI real faz (callHost): envia o @OnRequest com __sigilRpcId e
   * devolve a Promise resolvida/rejeitada pelo __sigilRpcResult correlacionado.
   */
  request<T = unknown>(type: string, value?: unknown): Promise<T> {
    const id = ++this.rpcSequence;
    const promise = new Promise<T>((resolve, reject) => {
      this.rpcPending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    });
    this.receive({ type, value, __sigilRpcId: id });
    return promise;
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

/**
 * Resposta roteirizada do modelo: string = só texto; a forma objeto inclui
 * tool calls, que o llm.agent executa e devolve pareadas por callId.
 */
export type LlmScriptedReply =
  | string
  | { text?: string; toolCalls?: { callId: string; name: string; input?: unknown }[] };

export interface VscodeMockState {
  /** raiz do projeto sob teste — alimenta workspaceFolders/findFiles/asRelativePath */
  projectDir?: string;
  /** F14: extensão de arquivo → language id (semeado do contributes.languages) */
  languageByExtension: Map<string, string>;
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
  docListeners: {
    open: ((doc: TextDocumentMock) => void)[];
    change: ((e: { document: TextDocumentMock }) => void)[];
    save: ((doc: TextDocumentMock) => void)[];
    close: ((doc: TextDocumentMock) => void)[];
  };
  languageProviders: LanguageProviderEntry[];
  diagnosticCollections: DiagnosticCollectionMock[];
  chatParticipants: {
    id: string;
    handler: (...args: unknown[]) => unknown;
    followupProvider?: { provideFollowups: (...args: unknown[]) => unknown };
  }[];
  customEditorProviders: Map<string, { resolveCustomTextEditor(document: unknown, panel: unknown): unknown }>;
  globalState: MementoMock;
  workspaceState: MementoMock;
  secretStorage: SecretStorageMock;
  /** valores publicados via executeCommand("setContext", …) */
  contextKeys: Map<string, unknown>;
  fileWatchers: FileWatcherMock[];
  uriHandler?: { handleUri(uri: unknown): unknown };
  progressRuns: { title?: string; location?: unknown }[];
  /** respostas enfileiradas para llm.ask/stream/agent (fila vazia → "resposta simulada") */
  llmQueue: LlmScriptedReply[];
  /** mensagens de cada sendRequest, na ordem — para asserir o protocolo do llm.agent */
  llmRequests: unknown[][];
  testControllers: TestControllerMock[];
  lmTools: { name: string; tool: { invoke(options: { input?: unknown }, token?: unknown): unknown; prepareInvocation?(): unknown } }[];
  mcpProviders: { id: string; provider: { provideMcpServerDefinitions(): unknown } }[];
  inlineProviders: { selector: unknown; provider: { provideInlineCompletionItems(...args: unknown[]): unknown } }[];
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
    docListeners: { open: [], change: [], save: [], close: [] },
    languageProviders: [],
    diagnosticCollections: [],
    chatParticipants: [],
    customEditorProviders: new Map(),
    globalState: new MementoMock(),
    workspaceState: new MementoMock(),
    secretStorage: new SecretStorageMock(),
    contextKeys: new Map(),
    fileWatchers: [],
    uriHandler: undefined,
    progressRuns: [],
    llmQueue: [],
    llmRequests: [],
    languageByExtension: new Map(),
    testControllers: [],
    lmTools: [],
    mcpProviders: [],
    inlineProviders: [],
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
  state.docListeners = { open: [], change: [], save: [], close: [] };
  state.languageProviders.length = 0;
  state.diagnosticCollections.length = 0;
  state.chatParticipants.length = 0;
  state.customEditorProviders.clear();
  state.globalState = new MementoMock();
  state.workspaceState = new MementoMock();
  state.secretStorage = new SecretStorageMock();
  state.contextKeys.clear();
  state.fileWatchers.length = 0;
  state.uriHandler = undefined;
  state.progressRuns.length = 0;
  state.llmQueue.length = 0;
  state.llmRequests.length = 0;
  state.languageByExtension.clear();
  state.testControllers.length = 0;
  state.lmTools.length = 0;
  state.mcpProviders.length = 0;
  state.inlineProviders.length = 0;
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

  const fireDoc = {
    open: (doc: TextDocumentMock) => state.docListeners.open.forEach((l) => l(doc)),
    change: (doc: TextDocumentMock) => state.docListeners.change.forEach((l) => l({ document: doc })),
    save: (doc: TextDocumentMock) => state.docListeners.save.forEach((l) => l(doc)),
    close: (doc: TextDocumentMock) => state.docListeners.close.forEach((l) => l(doc)),
  };
  const docListener = (kind: keyof typeof fireDoc) => (cb: never): DisposableLike => {
    (state.docListeners[kind] as unknown[]).push(cb);
    return {
      dispose: () => {
        const list = state.docListeners[kind] as unknown[];
        const idx = list.indexOf(cb);
        if (idx >= 0) list.splice(idx, 1);
      },
    };
  };
  // F13 do dogfood: DocumentFilter ({language}) é forma comum no host real —
  // degradar para [] em silêncio era divergência; forma desconhecida lança R6
  const toSelectorArray = (selector: unknown): string[] => {
    const one = (s: unknown): string => {
      if (typeof s === "string") return s;
      if (s && typeof s === "object" && typeof (s as { language?: unknown }).language === "string") {
        return (s as { language: string }).language;
      }
      return unsupported(`selector de provider '${JSON.stringify(s)}' (use string, {language} ou array deles)`);
    };
    return Array.isArray(selector) ? selector.map(one) : [one(selector)];
  };

  const api: Record<string, unknown> = {
    EventEmitter: EventEmitterMock,
    TreeItem: TreeItemMock,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2, Three: 3 },
    MarkdownString: MarkdownStringMock,
    FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
    ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    CompletionItemKind: { Text: 0, Method: 1, Function: 2, Keyword: 13, Snippet: 14 },
    Position: PositionMock,
    Range: RangeMock,
    TextEdit: class {
      constructor(public range: RangeMock, public newText: string) {}
      static replace(range: RangeMock, newText: string) {
        return { range, newText };
      }
    },
    CodeActionKind: {
      Empty: { append: (value: string) => ({ value }) },
    },
    Selection: SelectionMock,
    Hover: HoverMock,
    CompletionItem: CompletionItemMock,
    CodeLens: CodeLensMock,
    Diagnostic: DiagnosticMock,
    WorkspaceEdit: WorkspaceEditMock,
    __resolveWebviewView: resolveWebviewView,
    __fireDoc: fireDoc,
    languages: {
      registerInlineCompletionItemProvider: (selector: unknown, provider: { provideInlineCompletionItems(...args: unknown[]): unknown }) => {
        const entry = { selector, provider };
        state.inlineProviders.push(entry);
        return { dispose: () => void state.inlineProviders.splice(state.inlineProviders.indexOf(entry), 1) };
      },
      registerHoverProvider: (selector: unknown, provider: Record<string, (...args: unknown[]) => unknown>) => {
        const entry: LanguageProviderEntry = { kind: "hover", selector: toSelectorArray(selector), provider };
        state.languageProviders.push(entry);
        return { dispose: () => void state.languageProviders.splice(state.languageProviders.indexOf(entry), 1) };
      },
      registerCompletionItemProvider: (
        selector: unknown,
        provider: Record<string, (...args: unknown[]) => unknown>,
        ...triggers: string[]
      ) => {
        const entry: LanguageProviderEntry = { kind: "completion", selector: toSelectorArray(selector), provider, triggers };
        state.languageProviders.push(entry);
        return { dispose: () => void state.languageProviders.splice(state.languageProviders.indexOf(entry), 1) };
      },
      registerCodeLensProvider: (selector: unknown, provider: Record<string, (...args: unknown[]) => unknown>) => {
        const entry: LanguageProviderEntry = { kind: "codeLens", selector: toSelectorArray(selector), provider };
        state.languageProviders.push(entry);
        return { dispose: () => void state.languageProviders.splice(state.languageProviders.indexOf(entry), 1) };
      },
      registerCodeActionsProvider: (selector: unknown, provider: Record<string, (...args: unknown[]) => unknown>, metadata?: unknown) => {
        const entry: LanguageProviderEntry = { kind: "codeAction", selector: toSelectorArray(selector), provider, metadata };
        state.languageProviders.push(entry);
        return { dispose: () => void state.languageProviders.splice(state.languageProviders.indexOf(entry), 1) };
      },
      registerDefinitionProvider: (selector: unknown, provider: Record<string, (...args: unknown[]) => unknown>) => {
        const entry: LanguageProviderEntry = { kind: "definition", selector: toSelectorArray(selector), provider };
        state.languageProviders.push(entry);
        return { dispose: () => void state.languageProviders.splice(state.languageProviders.indexOf(entry), 1) };
      },
      registerReferenceProvider: (selector: unknown, provider: Record<string, (...args: unknown[]) => unknown>) => {
        const entry: LanguageProviderEntry = { kind: "references", selector: toSelectorArray(selector), provider };
        state.languageProviders.push(entry);
        return { dispose: () => void state.languageProviders.splice(state.languageProviders.indexOf(entry), 1) };
      },
      registerRenameProvider: (selector: unknown, provider: Record<string, (...args: unknown[]) => unknown>) => {
        const entry: LanguageProviderEntry = { kind: "rename", selector: toSelectorArray(selector), provider };
        state.languageProviders.push(entry);
        return { dispose: () => void state.languageProviders.splice(state.languageProviders.indexOf(entry), 1) };
      },
      registerDocumentFormattingEditProvider: (selector: unknown, provider: Record<string, (...args: unknown[]) => unknown>) => {
        const entry: LanguageProviderEntry = { kind: "formatting", selector: toSelectorArray(selector), provider };
        state.languageProviders.push(entry);
        return { dispose: () => void state.languageProviders.splice(state.languageProviders.indexOf(entry), 1) };
      },
      registerDocumentSymbolProvider: (selector: unknown, provider: Record<string, (...args: unknown[]) => unknown>) => {
        const entry: LanguageProviderEntry = { kind: "symbols", selector: toSelectorArray(selector), provider };
        state.languageProviders.push(entry);
        return { dispose: () => void state.languageProviders.splice(state.languageProviders.indexOf(entry), 1) };
      },
      registerInlayHintsProvider: (selector: unknown, provider: Record<string, (...args: unknown[]) => unknown>) => {
        const entry: LanguageProviderEntry = { kind: "inlayHints", selector: toSelectorArray(selector), provider };
        state.languageProviders.push(entry);
        return { dispose: () => void state.languageProviders.splice(state.languageProviders.indexOf(entry), 1) };
      },
      createDiagnosticCollection: (name: string) => {
        const collection = new DiagnosticCollectionMock(name);
        state.diagnosticCollections.push(collection);
        return collection;
      },
    },
    ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
    TestRunProfileKind: { Run: 1, Debug: 2, Coverage: 3 },
    TestMessage: class {
      constructor(public message: string) {}
    },
    tests: {
      createTestController: (id: string, label: string) => {
        if (state.testControllers.some((c) => c.id === id)) {
          throw new Error(`sigil-test: test controller '${id}' criado duas vezes`);
        }
        const controller = new TestControllerMock(id, label);
        state.testControllers.push(controller);
        return controller;
      },
    },
    LanguageModelChatMessage: {
      User: (content: unknown) => ({ role: "user", content }),
      Assistant: (content: unknown) => ({ role: "assistant", content }),
    },
    LanguageModelToolResult: class {
      constructor(public content: unknown[]) {}
    },
    LanguageModelTextPart: class {
      constructor(public value: string) {}
    },
    LanguageModelToolCallPart: class {
      constructor(public callId: string, public name: string, public input: object) {}
    },
    LanguageModelToolResultPart: class {
      constructor(public callId: string, public content: unknown[]) {}
    },
    CancellationTokenSource: class {
      token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
      cancel() {}
      dispose() {}
    },
    McpStdioServerDefinition: class {
      cwd?: unknown;
      constructor(
        public label: string,
        public command: string,
        public args: string[] = [],
        public env?: Record<string, string | number | null>
      ) {}
    },
    McpHttpServerDefinition: class {
      constructor(public label: string, public uri: unknown, public headers?: Record<string, string>) {}
    },
    lm: {
      registerTool: (name: string, tool: (typeof state.lmTools)[number]["tool"]) => {
        if (state.lmTools.some((t) => t.name === name)) {
          throw new Error(`sigil-test: tool '${name}' registrada duas vezes`);
        }
        const entry = { name, tool };
        state.lmTools.push(entry);
        return { dispose: () => void state.lmTools.splice(state.lmTools.indexOf(entry), 1) };
      },
      get tools() {
        return state.lmTools.map((t) => ({ name: t.name }));
      },
      invokeTool: async (name: string, options: { input?: unknown }) => {
        const entry = state.lmTools.find((t) => t.name === name);
        if (!entry) throw new Error(`sigil-test: tool '${name}' não registrada`);
        return entry.tool.invoke(options ?? {}, { isCancellationRequested: false });
      },
      registerMcpServerDefinitionProvider: (id: string, provider: (typeof state.mcpProviders)[number]["provider"]) => {
        const entry = { id, provider };
        state.mcpProviders.push(entry);
        return { dispose: () => void state.mcpProviders.splice(state.mcpProviders.indexOf(entry), 1) };
      },
      selectChatModels: (_selector?: unknown) =>
        Promise.resolve([
          {
            family: "mock-model",
            sendRequest: (messages: unknown[], _opts: unknown, _token: unknown) => {
              state.llmRequests.push([...messages]);
              const raw = state.llmQueue.shift() ?? "resposta simulada";
              const reply = typeof raw === "string" ? { text: raw, toolCalls: [] } : { text: raw.text ?? "", toolCalls: raw.toolCalls ?? [] };
              return Promise.resolve({
                text: (async function* () {
                  if (reply.text) yield reply.text;
                })(),
                stream: (async function* () {
                  if (reply.text) yield { value: reply.text };
                  for (const c of reply.toolCalls) yield { callId: c.callId, name: c.name, input: c.input };
                })(),
              });
            },
          },
        ]),
    },
    chat: {
      createChatParticipant: (id: string, handler: (...args: unknown[]) => unknown) => {
        const participant: (typeof state.chatParticipants)[number] = { id, handler };
        state.chatParticipants.push(participant);
        return {
          set followupProvider(p: { provideFollowups: (...args: unknown[]) => unknown }) {
            participant.followupProvider = p;
          },
          dispose: () => void state.chatParticipants.splice(state.chatParticipants.indexOf(participant), 1),
        };
      },
    },
    Uri: {
      file: uriFile,
      parse: (value: string): UriMock => ({ fsPath: value, path: value, toString: () => value }),
      joinPath: (base: UriMock, ...parts: string[]) => uriFile(path.join(base.fsPath, ...parts)),
    },
    window: {
      // no host real SEMPRE existe; sem simular, o fallback `?? x` do usuário
      // rodava silenciosamente diferente do VSCode (o Proxy R6 expôs isso)
      activeColorTheme: { kind: 2 }, // ColorThemeKind.Dark
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
        editor.onEdited = (d) => fireDoc.change(d);
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
      registerCustomEditorProvider: (
        viewType: string,
        provider: { resolveCustomTextEditor(document: unknown, panel: unknown): unknown },
        _options?: unknown
      ) => {
        state.customEditorProviders.set(viewType, provider);
        return { dispose: () => state.customEditorProviders.delete(viewType) };
      },
      registerUriHandler: (handler: { handleUri(uri: unknown): unknown }) => {
        state.uriHandler = handler;
        return { dispose: () => (state.uriHandler = undefined) };
      },
      withProgress: (
        options: { title?: string; location?: unknown },
        task: (progress: { report(v: unknown): void }, token: unknown) => unknown
      ) => {
        state.progressRuns.push({ title: options.title, location: options.location });
        return Promise.resolve(
          task({ report() {} }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) })
        );
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
        if (id === "setContext") {
          state.contextKeys.set(String(args[0]), args[1]);
          return Promise.resolve(undefined);
        }
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
      onDidOpenTextDocument: docListener("open"),
      onDidChangeTextDocument: docListener("change"),
      onDidSaveTextDocument: docListener("save"),
      onDidCloseTextDocument: docListener("close"),
      createFileSystemWatcher: (glob: string) => {
        const watcher = new FileWatcherMock(glob);
        state.fileWatchers.push(watcher);
        return watcher;
      },
      applyEdit: (edit: WorkspaceEditMock) => {
        for (const op of edit.replacements) {
          const doc = state.documents.find((d) => d.uri.toString() === op.uri.toString());
          if (!doc) continue;
          const start = doc.offsetAt(op.range.start);
          const end = doc.offsetAt(op.range.end);
          doc.text = doc.text.slice(0, start) + op.newText + doc.text.slice(end);
          fireDoc.change(doc);
        }
        return Promise.resolve(true);
      },
      fs: {
        readFile: (uri: UriMock): Promise<Uint8Array> =>
          Promise.resolve(new Uint8Array(fs.readFileSync(uri.fsPath))),
        writeFile: (uri: UriMock, content: Uint8Array): Promise<void> => {
          fs.mkdirSync(path.dirname(uri.fsPath), { recursive: true });
          fs.writeFileSync(uri.fsPath, content);
          return Promise.resolve();
        },
        readDirectory: (uri: UriMock): Promise<[string, number][]> =>
          Promise.resolve(
            fs
              .readdirSync(uri.fsPath, { withFileTypes: true })
              .map((e) => [e.name, e.isDirectory() ? 2 : 1] as [string, number])
          ),
        createDirectory: (uri: UriMock): Promise<void> => {
          fs.mkdirSync(uri.fsPath, { recursive: true });
          return Promise.resolve();
        },
        stat: (uri: UriMock) => {
          const s = fs.statSync(uri.fsPath);
          return Promise.resolve({ type: s.isDirectory() ? 2 : 1, ctime: s.ctimeMs, mtime: s.mtimeMs, size: s.size });
        },
        delete: (uri: UriMock, opts?: { recursive?: boolean }): Promise<void> => {
          fs.rmSync(uri.fsPath, { recursive: opts?.recursive ?? false, force: true });
          return Promise.resolve();
        },
      },
      findFiles: (include: string, exclude?: string | null, maxResults?: number): Promise<UriMock[]> => {
        const root = state.projectDir;
        if (!root) return unsupported("workspace.findFiles (host ativado sem projectDir)");
        const inc = globToRegex(include);
        const exc = exclude ? globToRegex(exclude) : undefined;
        const out: UriMock[] = [];
        const visit = (dir: string): void => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === "node_modules" || entry.name.startsWith(".git")) continue;
            const abs = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              visit(abs);
              continue;
            }
            const rel = path.relative(root, abs).split(path.sep).join("/");
            if (inc.test(rel) && !exc?.test(rel)) {
              out.push(uriFile(abs));
              if (maxResults !== undefined && out.length >= maxResults) return;
            }
          }
        };
        visit(root);
        return Promise.resolve(maxResults !== undefined ? out.slice(0, maxResults) : out);
      },
      asRelativePath: (input: string | UriMock, _includeWorkspaceFolder?: boolean): string => {
        const root = state.projectDir;
        const fsPath = typeof input === "string" ? input : input.fsPath;
        if (!root) return fsPath;
        const rel = path.relative(root, fsPath);
        return rel.startsWith("..") ? fsPath : rel.split(path.sep).join("/");
      },
      get textDocuments() {
        return [...state.documents];
      },
      openTextDocument: (options?: { content?: string; language?: string } | UriMock) => {
        if (options && "fsPath" in (options as UriMock)) {
          const uri = options as UriMock;
          // F14: resolve o language id pela extensão (contributes.languages),
          // como o VSCode real — antes tudo abria como plaintext
          const lang = state.languageByExtension.get(path.extname(uri.fsPath)) ?? "plaintext";
          const doc = new TextDocumentMock(fs.readFileSync(uri.fsPath, "utf8"), lang, uri);
          state.documents.push(doc);
          fireDoc.open(doc);
          return Promise.resolve(doc);
        }
        const o = (options ?? {}) as { content?: string; language?: string };
        const doc = new TextDocumentMock(
          o.content ?? "",
          o.language ?? "plaintext",
          uriFile(`/untitled-${state.documents.length + 1}`)
        );
        state.documents.push(doc);
        fireDoc.open(doc);
        return Promise.resolve(doc);
      },
      get workspaceFolders() {
        // com projectDir (o caso do activateExtension) o workspace é REAL
        if (!state.projectDir) return undefined;
        return [{ uri: uriFile(state.projectDir), name: path.basename(state.projectDir), index: 0 }];
      },
      getWorkspaceFolder: (uri: UriMock) => {
        if (!state.projectDir) return undefined;
        const rel = path.relative(state.projectDir, uri.fsPath);
        return rel.startsWith("..")
          ? undefined
          : { uri: uriFile(state.projectDir), name: path.basename(state.projectDir), index: 0 };
      },
    },
  };

  // ── R6 por Proxy (F5 do dogfood externo): membro DESCONHECIDO de um
  // namespace lança o erro descritivo com o nome completo — antes, só os
  // getters enumerados um a um avisavam; o resto era undefined → TypeError
  // genérico. Membros que EXISTEM (mesmo retornando undefined, ex.:
  // activeTextEditor) passam normais. O bundle acessa os namespaces via
  // getters delegantes do interop CJS→ESM, então o Proxy por namespace o
  // cobre; o de nível de módulo cobre acesso direto (require em testes).
  for (const ns of ["workspace", "window", "languages", "commands", "lm", "chat", "tests", "env", "extensions"]) {
    const target = api[ns];
    if (target && typeof target === "object") api[ns] = r6Namespace(ns, target as object);
  }
  return r6Namespace("vscode", api);
}

const R6_SAFE_PROPS = new Set([
  "then", "catch", "finally", "toJSON", "toString", "valueOf", "constructor",
  "hasOwnProperty", "__esModule", "default", "inspect",
]);

function r6Namespace<T extends object>(name: string, target: T): T {
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (typeof prop === "string" && !(prop in t) && !R6_SAFE_PROPS.has(prop)) {
        unsupported(`${name}.${prop}`);
      }
      return Reflect.get(t, prop, receiver);
    },
  });
}

/** glob mínimo para findFiles: **, *, ?, {a,b} — cobre o uso comum. */
function globToRegex(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += "(?:.*)";
        i++;
        if (glob[i + 1] === "/") i++;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") re += "(?:";
    else if (c === "}") re += ")";
    else if (c === ",") re += "|";
    else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}
