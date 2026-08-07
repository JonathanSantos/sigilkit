import Module from "node:module";
import fs from "node:fs";
import path from "node:path";
import {
  ChatResponseStreamMock,
  DiagnosticMock,
  DisposableLike,
  TextDocumentMock,
  TreeDataProviderLike,
  TextEditorMock,
  TreeItemMock,
  VscodeMockState,
  WebviewPanelMock,
  createState,
  createVscodeMock,
  uriFile,
} from "./vscode-mock";

export {
  ChatResponseStreamMock,
  CodeLensMock,
  CompletionItemMock,
  DiagnosticCollectionMock,
  DiagnosticMock,
  EventEmitterMock,
  HoverMock,
  OutputChannelMock,
  PositionMock,
  RangeMock,
  SelectionMock,
  StatusBarItemMock,
  TextDocumentMock,
  TextEditorMock,
  TreeItemMock,
  WebviewPanelMock,
  WorkspaceEditMock,
  createState,
  createVscodeMock,
  resetState,
} from "./vscode-mock";
export type { DisposableLike, LlmScriptedReply, TreeDataProviderLike, UriMock, VscodeMockState } from "./vscode-mock";

export interface ActivateOptions {
  /** Raiz do projeto da extensão (com package.json apontando `main` para o bundle). */
  projectDir: string;
  /** Valores iniciais de config além dos defaults do manifesto (id completo → valor). */
  configuration?: Record<string, unknown>;
  /** Override do bundle a ativar (default: o `main` do package.json). */
  bundlePath?: string;
}

interface ExtensionModule {
  activate(ctx: unknown): unknown;
  deactivate?(): unknown;
}

/**
 * Ativa o bundle REAL da extensão dentro do simulador: intercepta
 * `require("vscode")` durante o load do bundle e chama o `activate()` gerado
 * com um ExtensionContext fake. Cada chamada é isolada (o cache de require do
 * bundle é limpo, então o registry recomeça do zero).
 *
 * Os defaults de config são semeados de `contributes.configuration` do
 * package.json — o mesmo papel que o VSCode cumpre ao ler o manifesto.
 */
export async function activateExtension(opts: ActivateOptions): Promise<SigilTestHost> {
  const projectDir = path.resolve(opts.projectDir);
  const pkgPath = path.join(projectDir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`sigil-test: package.json não encontrado em ${projectDir}`);
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    main?: string;
    contributes?: { configuration?: { properties?: Record<string, { default?: unknown }> } };
  };
  const bundlePath = path.resolve(projectDir, opts.bundlePath ?? pkg.main ?? "./out/extension.js");
  if (!fs.existsSync(bundlePath)) {
    throw new Error(
      `sigil-test: bundle não encontrado em ${bundlePath} — rode o build da extensão antes (ex.: npm run build)`
    );
  }

  const state = createState();
  const properties = pkg.contributes?.configuration?.properties ?? {};
  for (const [id, schema] of Object.entries(properties)) {
    if (schema && "default" in schema) state.defaults.set(id, schema.default);
  }
  if (opts.configuration) {
    for (const [id, value] of Object.entries(opts.configuration)) state.values.set(id, value);
  }

  const vscodeMock = createVscodeMock(state);
  const moduleInternals = Module as unknown as {
    _load: (request: string, ...rest: unknown[]) => unknown;
  };
  const originalLoad = moduleInternals._load;
  moduleInternals._load = function (request: string, ...rest: unknown[]) {
    if (request === "vscode") return vscodeMock;
    return originalLoad.call(this, request, ...rest);
  };

  try {
    delete require.cache[require.resolve(bundlePath)];
    const ext = require(bundlePath) as ExtensionModule;
    const ctx = {
      subscriptions: [] as DisposableLike[],
      extensionUri: uriFile(projectDir),
      extensionPath: projectDir,
      globalState: state.globalState,
      workspaceState: state.workspaceState,
      secrets: state.secretStorage,
    };
    await ext.activate(ctx);
    return new SigilTestHost(state, vscodeMock, ext, ctx);
  } finally {
    moduleInternals._load = originalLoad;
  }
}

/** Sonda de leitura de uma TreeView registrada. */
export class TreeProbe {
  /** quantas vezes o onDidChangeTreeData disparou desde a criação da sonda */
  refreshCount = 0;

  constructor(private readonly provider: TreeDataProviderLike) {
    provider.onDidChangeTreeData?.(() => {
      this.refreshCount++;
    });
  }

  async roots(): Promise<unknown[]> {
    return ((await this.provider.getChildren(undefined)) as unknown[]) ?? [];
  }

  async children(node: unknown): Promise<unknown[]> {
    return ((await this.provider.getChildren(node)) as unknown[]) ?? [];
  }

  async item(node: unknown): Promise<TreeItemMock> {
    return (await this.provider.getTreeItem(node)) as TreeItemMock;
  }
}

export class SigilTestHost {
  constructor(
    private readonly state: VscodeMockState,
    /** escape hatch: o namespace vscode simulado, para asserções avançadas */
    readonly vscode: Record<string, unknown>,
    private readonly ext: ExtensionModule,
    private readonly ctx: { subscriptions: DisposableLike[] }
  ) {}

  /** O módulo da extensão (o wire) — expõe __sigilHydrate para testar hot swap. */
  get module(): ExtensionModule & Record<string, unknown> {
    return this.ext as ExtensionModule & Record<string, unknown>;
  }

  /** ids de comando registrados, ordenados */
  get commands(): string[] {
    return [...this.state.commands.keys()].sort();
  }

  executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T> {
    const commands = this.vscode.commands as {
      executeCommand: (id: string, ...args: unknown[]) => Promise<T>;
    };
    return commands.executeCommand(id, ...args);
  }

  readonly configuration = {
    get: <T = unknown>(id: string): T => {
      return (
        this.state.values.has(id) ? this.state.values.get(id) : this.state.defaults.get(id)
      ) as T;
    },
    /** Simula o usuário editando Settings: grava e dispara onDidChangeConfiguration. */
    set: (id: string, value: unknown): void => {
      if (value === undefined) this.state.values.delete(id);
      else this.state.values.set(id, value);
      this.state.fireConfigChange(id);
    },
    /** Valores ESCRITOS (não defaults) — útil para carregar entre reloads do sim. */
    snapshot: (): Record<string, unknown> => {
      return Object.fromEntries(this.state.values);
    },
  };

  /** Entradas de log de todos os canais criados (via bindLog do core). */
  get logs(): { level: string; message: string }[] {
    return this.state.outputChannels.flatMap((c) => c.entries);
  }

  /** Os logs como texto ("[info] mensagem" por linha) — pronto para toContain. */
  logText(): string {
    return this.logs.map((l) => `[${l.level}] ${l.message}`).join("\n");
  }

  /** Canais de output criados pela extensão. */
  get outputChannels() {
    return [...this.state.outputChannels];
  }

  /** Enfileira respostas para os próximos showInputBox (fila vazia = ESC/cancelar). */
  queueInputBox(...values: (string | undefined)[]): void {
    this.state.inputBoxQueue.push(...values);
  }

  /** Enfileira respostas para os próximos showQuickPick (fila vazia = ESC/cancelar). */
  queueQuickPick(...values: unknown[]): void {
    this.state.quickPickQueue.push(...values);
  }

  /** As opções de cada showInputBox que a extensão chamou, na ordem. */
  get inputBoxCalls(): unknown[] {
    return [...this.state.inputBoxCalls];
  }

  /** Os itens/opções de cada showQuickPick que a extensão chamou, na ordem. */
  get quickPickCalls(): { items: unknown; options?: unknown }[] {
    return [...this.state.quickPickCalls];
  }

  /**
   * Modo interativo (sim --ui): com as filas vazias, showInputBox/QuickPick
   * delegam para o handler — a Promise da extensão espera a resposta da UI.
   */
  onInputRequest(
    handler?: (kind: "inputBox" | "quickPick", opts: unknown, items?: unknown) => Promise<unknown>
  ): void {
    this.state.interactiveInput = handler;
  }

  /** viewTypes das webviews de SIDEBAR registradas (resolvidas ou não). */
  get webviewViewIds(): string[] {
    return [...this.state.webviewViewProviders.keys()].sort();
  }

  private languageProvider(kind: import("./vscode-mock").LanguageProviderEntry["kind"], doc: TextDocumentMock) {
    const entry = this.state.languageProviders.find(
      (p) => p.kind === kind && p.selector.includes(doc.languageId)
    );
    if (!entry) {
      throw new Error(
        `sigil-test: nenhum provider de ${kind} para a linguagem '${doc.languageId}' (registrados: ${this.state.languageProviders.map((p) => `${p.kind}:${p.selector.join("/")}`).join(", ") || "nenhum"})`
      );
    }
    return entry.provider;
  }

  /** Invoca o @Hover registrado para a linguagem do documento. */
  async provideHover(doc: TextDocumentMock, position: { line: number; character: number }) {
    return this.languageProvider("hover", doc).provideHover!(doc, position, {});
  }

  /** Invoca o @Completion registrado para a linguagem do documento. */
  async provideCompletions(doc: TextDocumentMock, position: { line: number; character: number }) {
    return this.languageProvider("completion", doc).provideCompletionItems!(doc, position, {}, {});
  }

  /** Invoca o @CodeLens registrado para a linguagem do documento. */
  async provideCodeLenses(doc: TextDocumentMock) {
    return this.languageProvider("codeLens", doc).provideCodeLenses!(doc, {});
  }

  /** Diagnostics correntes do documento (todas as collections). */
  diagnosticsFor(doc: TextDocumentMock): DiagnosticMock[] {
    return this.state.diagnosticCollections.flatMap((c) => c.byUri.get(doc.uri.toString()) ?? []);
  }

  /** Invoca o @CodeAction registrado (range/context opcionais). */
  async provideCodeActions(doc: TextDocumentMock, range?: unknown, context?: unknown) {
    return this.languageProvider("codeAction", doc).provideCodeActions!(doc, range ?? {}, context ?? { diagnostics: [] }, {});
  }

  /** Invoca o @Definition registrado. */
  async provideDefinition(doc: TextDocumentMock, position: { line: number; character: number }) {
    return this.languageProvider("definition", doc).provideDefinition!(doc, position, {});
  }

  /** Invoca o @References registrado. */
  async provideReferences(doc: TextDocumentMock, position: { line: number; character: number }) {
    return this.languageProvider("references", doc).provideReferences!(doc, position, { includeDeclaration: true }, {});
  }

  /** Invoca o @Rename registrado com o nome novo. */
  async provideRenameEdits(doc: TextDocumentMock, position: { line: number; character: number }, newName: string) {
    return this.languageProvider("rename", doc).provideRenameEdits!(doc, position, newName, {});
  }

  /** Invoca o @Formatting registrado (string do handler já vem como TextEdit de range completo). */
  async provideFormattingEdits(doc: TextDocumentMock) {
    return this.languageProvider("formatting", doc).provideDocumentFormattingEdits!(doc, { tabSize: 2, insertSpaces: true }, {});
  }

  /** Invoca o @Symbols registrado. */
  async provideDocumentSymbols(doc: TextDocumentMock) {
    return this.languageProvider("symbols", doc).provideDocumentSymbols!(doc, {});
  }

  /** Invoca o @InlayHints registrado no range dado (default: doc inteiro). */
  async provideInlayHints(doc: TextDocumentMock, range?: unknown) {
    return this.languageProvider("inlayHints", doc).provideInlayHints!(doc, range ?? {}, {});
  }

  /** Envia um request de chat ao participante; retorna o stream gravado. */
  async chatRequest(
    participantId: string,
    prompt: string,
    opts: { command?: string } = {}
  ): Promise<ChatResponseStreamMock> {
    const participant = this.state.chatParticipants.find((p) => p.id === participantId);
    if (!participant) {
      throw new Error(
        `sigil-test: participante '${participantId}' não registrado (registrados: ${this.state.chatParticipants.map((p) => p.id).join(", ") || "nenhum"})`
      );
    }
    const stream = new ChatResponseStreamMock();
    await participant.handler(
      { prompt, command: opts.command },
      { history: [] },
      stream,
      { isCancellationRequested: false }
    );
    return stream;
  }

  /** Nomes das @LmTool registradas (lm.registerTool). */
  get lmTools(): string[] {
    return this.state.lmTools.map((t) => t.name);
  }

  /** Invoca uma @LmTool como o agent mode faria; devolve o TEXTO do resultado. */
  async invokeTool(name: string, input?: unknown): Promise<string> {
    const entry = this.state.lmTools.find((t) => t.name === name);
    if (!entry) {
      throw new Error(
        `sigil-test: tool '${name}' não registrada (registradas: ${this.state.lmTools.map((t) => t.name).join(", ") || "nenhuma"})`
      );
    }
    const result = (await entry.tool.invoke({ input }, { isCancellationRequested: false })) as {
      content?: { value?: string }[];
    };
    return (result?.content ?? []).map((c) => c.value ?? "").join("");
  }

  /** Resolve as definições de um @McpServers registrado. */
  async mcpServers(providerId: string): Promise<Record<string, unknown>[]> {
    const entry = this.state.mcpProviders.find((p) => p.id === providerId);
    if (!entry) {
      throw new Error(
        `sigil-test: provedor MCP '${providerId}' não registrado (registrados: ${this.state.mcpProviders.map((p) => p.id).join(", ") || "nenhum"})`
      );
    }
    return ((await entry.provider.provideMcpServerDefinitions()) ?? []) as Record<string, unknown>[];
  }

  /** Ghost text: roda o @InlineCompletion como o editor faria. */
  async provideInlineCompletions(languageId: string, text = "", position = { line: 0, character: 0 }) {
    const entry = this.state.inlineProviders.find((p) =>
      Array.isArray(p.selector) ? (p.selector as string[]).includes(languageId) : p.selector === languageId
    );
    if (!entry) {
      throw new Error(`sigil-test: nenhum provider de inline completion para '${languageId}'`);
    }
    const doc = new TextDocumentMock(text, languageId, uriFile(`/fake/inline.${languageId}`));
    return entry.provider.provideInlineCompletionItems(doc, position, { triggerKind: 0 }, { isCancellationRequested: false });
  }

  /** Valor corrente de uma @ContextKey (publicada via setContext). */
  contextKey(id: string): unknown {
    return this.state.contextKeys.get(id);
  }

  /** Memento global fake (ctx.globalState). */
  get globalState() {
    return this.state.globalState;
  }

  /** Memento de workspace fake (ctx.workspaceState). */
  get workspaceState() {
    return this.state.workspaceState;
  }

  /** SecretStorage fake (ctx.secrets) — use antes do activate para semear. */
  get secretsStorage() {
    return this.state.secretStorage;
  }

  /** Execuções de window.withProgress ({ title }). */
  get progressRuns() {
    return [...this.state.progressRuns];
  }

  /** Dispara os FileSystemWatchers cujo glob casa com o caminho. */
  fireFileChange(filePath: string, kind: "change" | "create" | "delete" = "change"): number {
    let fired = 0;
    for (const watcher of this.state.fileWatchers) {
      if (!watcher.matches(filePath)) continue;
      const listeners =
        kind === "change" ? watcher.changeListeners : kind === "create" ? watcher.createListeners : watcher.deleteListeners;
      for (const listener of listeners) {
        listener(uriFile(filePath));
        fired++;
      }
    }
    return fired;
  }

  /** Entrega um deep link ao @UriHandler registrado. */
  openUri(pathAndQuery: string): void {
    if (!this.state.uriHandler) throw new Error("sigil-test: nenhum @UriHandler registrado");
    this.state.uriHandler.handleUri(uriFile(pathAndQuery));
  }

  /** Dispara onDidSaveTextDocument para o documento. */
  saveTextDocument(doc: TextDocumentMock): void {
    (this.vscode as { __fireDoc?: { save(d: TextDocumentMock): void } }).__fireDoc?.save(doc);
  }

  /** Enfileira respostas para llm.ask/stream/agent — a forma objeto roteiriza tool calls. */
  queueLlmResponse(...responses: import("./vscode-mock").LlmScriptedReply[]): void {
    this.state.llmQueue.push(...responses);
  }

  /** As mensagens de cada sendRequest, na ordem — para asserir o protocolo do llm.agent. */
  get llmRequests(): unknown[][] {
    return this.state.llmRequests;
  }

  private testController(id: string) {
    const c = this.state.testControllers.find((tc) => tc.id === id);
    if (!c) {
      throw new Error(
        `sigil-test: test controller '${id}' não registrado (registrados: ${this.state.testControllers.map((tc) => tc.id).join(", ") || "nenhum"})`
      );
    }
    return c;
  }

  /** Árvore de testes do @TestDiscover (re-executa o discover antes, determinístico). */
  async testItems(controllerId: string): Promise<{ id: string; label: string; children: unknown[] }[]> {
    const c = this.testController(controllerId);
    await c.refreshHandler?.();
    const collect = (col: { forEach(cb: (i: { id: string; label: string; children: unknown }) => void): void }): { id: string; label: string; children: unknown[] }[] => {
      const out: { id: string; label: string; children: unknown[] }[] = [];
      col.forEach((i) => out.push({ id: i.id, label: i.label, children: collect(i.children as never) }));
      return out;
    };
    return collect(c.items);
  }

  /** Roda o profile do @TestRun (todos os testes, ou só os ids dados). */
  async runTests(
    controllerId: string,
    ids?: string[]
  ): Promise<{ id: string; status: "passed" | "failed" | "skipped"; message?: string }[]> {
    const c = this.testController(controllerId);
    await c.refreshHandler?.();
    const profile = c.profiles.find((p) => p.isDefault) ?? c.profiles[0];
    if (!profile) {
      throw new Error(`sigil-test: controller '${controllerId}' não tem run profile — a classe tem @TestRun?`);
    }
    let include: unknown[] | undefined;
    if (ids) {
      type Item = { id: string; children: { forEach(cb: (i: Item) => void): void } };
      const find = (col: Item["children"], id: string): Item | undefined => {
        let hit: Item | undefined;
        col.forEach((i) => {
          if (i.id === id) hit = i;
          hit ??= find(i.children, id);
        });
        return hit;
      };
      include = ids.map((id) => {
        const item = find(c.items as never, id);
        if (!item) throw new Error(`sigil-test: teste '${id}' não encontrado no controller '${controllerId}'`);
        return item;
      });
    }
    await profile.handler({ include }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) });
    return c.runs.at(-1)?.results ?? [];
  }

  /** Abre um documento num @CustomEditor (resolve o provider com um painel fake). */
  async openCustomEditor(viewType: string, doc: TextDocumentMock): Promise<WebviewPanelMock> {
    const provider = this.state.customEditorProviders.get(viewType);
    if (!provider) {
      throw new Error(
        `sigil-test: custom editor '${viewType}' não registrado (registrados: ${[...this.state.customEditorProviders.keys()].join(", ") || "nenhum"})`
      );
    }
    const panel = new WebviewPanelMock(viewType, viewType);
    await provider.resolveCustomTextEditor(doc, panel);
    return panel;
  }

  /** Abre um documento fake e o torna o activeTextEditor. */
  async openTextDocument(content: string, languageId = "plaintext") {
    const workspace = this.vscode.workspace as {
      openTextDocument(o: { content: string; language: string }): Promise<unknown>;
    };
    const window = this.vscode.window as { showTextDocument(doc: unknown): Promise<unknown> };
    const doc = await workspace.openTextDocument({ content, language: languageId });
    return window.showTextDocument(doc);
  }

  /** O editor ativo (o último showTextDocument) — sonda para editor.openText do core. */
  get activeTextEditor(): TextEditorMock | undefined {
    return this.state.activeTextEditor;
  }

  get infoMessages(): string[] {
    return [...this.state.infoMessages];
  }
  get warnMessages(): string[] {
    return [...this.state.warnMessages];
  }
  get errorMessages(): string[] {
    return [...this.state.errorMessages];
  }

  /** Sonda para a view registrada com o id dado (ex.: "hello.tasks"). */
  tree(viewId: string): TreeProbe {
    const provider = this.state.treeProviders.get(viewId);
    if (!provider) {
      throw new Error(
        `sigil-test: nenhuma TreeView registrada como '${viewId}' (registradas: ${[...this.state.treeProviders.keys()].sort().join(", ") || "nenhuma"})`
      );
    }
    return new TreeProbe(provider);
  }

  /** Todos os painéis webview já criados (incluindo descartados). */
  get webviewPanels(): WebviewPanelMock[] {
    return [...this.state.panels];
  }

  /** Itens de status bar criados na ativação, na ordem de criação. */
  get statusBarItems() {
    return [...this.state.statusBarItems];
  }

  /**
   * Resolve (se necessário) e retorna a webview de SIDEBAR com o viewId dado —
   * o mesmo que o VSCode faz no primeiro show da view.
   */
  webviewView(viewId: string): Promise<WebviewPanelMock> {
    const resolve = (this.vscode as { __resolveWebviewView?: (id: string) => Promise<WebviewPanelMock> })
      .__resolveWebviewView;
    if (!resolve) throw new Error("sigil-test: mock sem suporte a webview views");
    return resolve(viewId);
  }

  /** O painel vivo com o viewType dado (ex.: "hello.settings"). */
  panel(viewType: string): WebviewPanelMock {
    const found = this.state.panels.find((p) => p.viewType === viewType && !p.disposed);
    if (!found) {
      throw new Error(
        `sigil-test: nenhum painel vivo com viewType '${viewType}' — execute o comando que o abre primeiro`
      );
    }
    return found;
  }

  /** Descarta subscriptions (na ordem inversa) e chama o deactivate() da extensão. */
  async dispose(): Promise<void> {
    for (const d of [...this.ctx.subscriptions].reverse()) d.dispose?.();
    await this.ext.deactivate?.();
  }
}
