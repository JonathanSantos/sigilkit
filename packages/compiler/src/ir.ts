export const IR_VERSION = 6;

export interface SourceLoc {
  file: string;
  line: number;
  character: number;
}

export interface IRCommand {
  key: string; // "HelloExtension.sayHello"
  id: string; // "hello.sayHello"
  title: string;
  category?: string;
  icon?: string;
  when?: string;
  enablement?: string;
  keybinding?: { key: string; mac?: string; linux?: string; win?: string; when?: string };
  menus: { menu: string; group?: string; when?: string }[];
  /** window.withProgress no handler; token injetado como último argumento */
  progress?: { title: string; location?: "notification" | "window" | "statusBar"; cancellable?: boolean };
  loc: SourceLoc;
}

export interface IRConfig {
  key: string; // "HelloExtension.greeting"
  id: string; // "hello.greeting"
  jsonType: "string" | "number" | "boolean" | "array" | "object";
  tsType: string; // texto do tipo, para o config.d.ts
  default: unknown;
  description?: string;
  scope?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  deprecationMessage?: string;
  /** Schema do elemento para jsonType "array" (ex.: { type: "string" }). */
  items?: { type: string };
  loc: SourceLoc;
}

export interface IRWatch {
  key: string; // "HelloExtension.onGreetingChanged"
  targetConfigId: string; // "hello.greeting"
  loc: SourceLoc;
}

export interface IRTreeView {
  key: string;
  id: string;
  name: string;
  container: "explorer" | "scm" | "debug" | string;
  rootsKey: string;
  childrenKey?: string;
  itemKey: string;
  /** A classe @TreeView pode morar em arquivo próprio; o wire precisa importá-la. */
  sourceFile: string;
  loc: SourceLoc;
}

/** Container customizado declarado inline em @TreeView/@Webview (activity bar ou painel). */
export interface IRViewContainer {
  id: string;
  title: string;
  icon: string;
  location: "activitybar" | "panel";
  loc: SourceLoc;
}

/** Item de status bar declarado com @StatusBar em accessor da classe @Extension. */
export interface IRStatusBar {
  key: string; // "HelloExtension.status"
  text: string; // default lido da AST
  alignment?: "left" | "right";
  priority?: number;
  command?: string;
  tooltip?: string;
  name?: string;
  loc: SourceLoc;
}

export interface IRWebview {
  key: string;
  id: string;
  title: string;
  uiEntry: string; // caminho relativo do HTML (à raiz da extensão)
  /** "panel" = WebviewPanel sob demanda; "sidebar" = WebviewViewProvider em contributes.views. */
  location: "panel" | "sidebar";
  /** sidebar: nome exibido na view (default = title). */
  name?: string;
  /** sidebar: container da view (builtin ou id de container inline). */
  container?: string;
  messageHandlers: { type: string; key: string }[];
  /** @OnRequest: request/response (o retorno volta para o callHost da UI). */
  requestHandlers: { type: string; key: string }[];
  /** A classe @Webview pode morar em arquivo próprio; o wire precisa importá-la. */
  sourceFile: string;
  loc: SourceLoc;
}

/** Providers de linguagem de uma classe @Language. */
export interface IRLanguage {
  key: string; // nome da classe
  selector: string[]; // ids de linguagem (emite activationEvents onLanguage:*)
  hoverKey?: string;
  completionKey?: string;
  completionTriggers?: string[];
  codeLensKey?: string;
  diagnosticsKey?: string;
  diagnosticsOn?: "change" | "save";
  sourceFile: string;
  loc: SourceLoc;
}

/** Participante de chat (@ChatParticipant). */
export interface IRChatParticipant {
  key: string;
  id: string; // "hello.assist"
  name: string;
  fullName?: string;
  description?: string;
  isSticky?: boolean;
  requestKey: string;
  followupsKey?: string;
  sourceFile: string;
  loc: SourceLoc;
}

/** Editor customizado de texto (@CustomEditor). */
export interface IRCustomEditor {
  key: string;
  viewType: string; // "hello.preview"
  displayName: string;
  patterns: string[];
  priority?: "default" | "option";
  uiEntry: string;
  messageHandlers: { type: string; key: string }[];
  requestHandlers: { type: string; key: string }[];
  sourceFile: string;
  loc: SourceLoc;
}

/** @On: assinatura declarativa de evento do vscode. */
export interface IREventHandler {
  key: string;
  event: string; // "workspace.onDidSaveTextDocument"
  debounce?: number;
  loc: SourceLoc;
}

/** @OnFile: FileSystemWatcher declarativo. */
export interface IRFileWatcher {
  key: string;
  glob: string;
  kind: "change" | "create" | "delete" | "all";
  debounce?: number;
  loc: SourceLoc;
}

/** @Secret: nome pré-carregado no cache síncrono pelo wire. */
export interface IRSecret {
  key: string;
  name: string;
  loc: SourceLoc;
}

/** @ContextKey: id completo + default — e insumo da validação de `when`. */
export interface IRContextKey {
  key: string;
  id: string; // "hello.pronto"
  default: unknown;
  loc: SourceLoc;
}

/** Aba de configurações pronta, habilitada por @Extension({ settings }). */
export interface IRSettingsPanel {
  commandId: string; // "hello.configure"
  commandTitle: string;
  viewType: string; // "hello.sigilSettings"
  title: string;
  loc: SourceLoc;
}

export interface IR {
  version: number;
  prefix: string;
  /** displayName do package.json (?? name) — nome do canal de log, título default do settings. */
  displayName: string;
  extensionClass: string;
  sourceFile: string;
  activateKey?: string;
  deactivateKey?: string;
  settingsPanel?: IRSettingsPanel;
  commands: IRCommand[];
  configs: IRConfig[];
  watches: IRWatch[];
  treeViews: IRTreeView[];
  webviews: IRWebview[];
  viewContainers: IRViewContainer[];
  statusBars: IRStatusBar[];
  languages: IRLanguage[];
  chatParticipants: IRChatParticipant[];
  customEditors: IRCustomEditor[];
  events: IREventHandler[];
  fileWatchers: IRFileWatcher[];
  secrets: IRSecret[];
  contextKeys: IRContextKey[];
  uriHandlerKey?: string;
}
