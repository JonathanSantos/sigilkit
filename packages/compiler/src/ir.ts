export const IR_VERSION = 2;

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
  keybinding?: { key: string; mac?: string; when?: string };
  menus: { menu: string; group?: string; when?: string }[];
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

export interface IRWebview {
  key: string;
  id: string;
  title: string;
  uiEntry: string; // caminho relativo do HTML (à raiz da extensão)
  messageHandlers: { type: string; key: string }[];
  /** A classe @Webview pode morar em arquivo próprio; o wire precisa importá-la. */
  sourceFile: string;
  loc: SourceLoc;
}

export interface IR {
  version: number;
  prefix: string;
  extensionClass: string;
  sourceFile: string;
  activateKey?: string;
  deactivateKey?: string;
  commands: IRCommand[];
  configs: IRConfig[];
  watches: IRWatch[];
  treeViews: IRTreeView[];
  webviews: IRWebview[];
}
