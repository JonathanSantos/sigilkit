export { registry, Registry } from "./registry";
export type {
  CommandHandler,
  LifecycleHandler,
  WatchHandler,
  TreeHandle,
  WebviewHandle,
  StatusBarItemLike,
} from "./registry";

export { Extension, Activate, Deactivate } from "./decorators/extension";
export type { ExtensionOptions } from "./decorators/extension";

export { Command } from "./decorators/command";
export type { CommandOptions, CommandMenuEntry } from "./decorators/command";

export { Config } from "./decorators/config";
export type { ConfigOptions } from "./decorators/config";

export { Watch, bindConfigWatchers } from "./decorators/watch";
export type { WatchBinding } from "./decorators/watch";

export { TreeView, TreeRoot, TreeChildren, TreeItem, bindTreeView } from "./decorators/tree-view";
export type { TreeViewOptions, TreeViewBinding, ViewContainerSpec } from "./decorators/tree-view";

export { Webview, OnMessage } from "./decorators/webview";
export type { WebviewOptions } from "./decorators/webview";

export { StatusBar, bindStatusBar } from "./decorators/status-bar";
export type { StatusBarOptions, StatusBarBinding } from "./decorators/status-bar";

export { adoptRegistrations, bucketOf } from "./metadata";
export type { Bucket } from "./metadata";

export { bindWebview, bindWebviewView } from "./webview-host";
export type { WebviewBinding } from "./webview-host";

export { renderWebviewHtml } from "./webview-html";
export type { WebviewHtmlOptions } from "./webview-html";

export { readWorkspaceConfig, writeWorkspaceConfig } from "./config-access";
export type { SigilConfigTarget } from "./config-access";

import { getConfig as getConfigById, setConfigById, type SigilConfigTarget } from "./config-access";

/**
 * Registro de tipos das configs da extensão. Vazio aqui; o `sigil build` emite
 * src/.generated/config.d.ts com uma augmentation deste módulo que o preenche:
 *
 *   declare module "@sigil/core" {
 *     interface SigilConfigRegistry { "hello.retries": number }
 *   }
 *
 * Com isso, getConfig("hello.retries") retorna number, com autocomplete.
 * A interface precisa ser declarada NESTE arquivo, não re-exportada —
 * augmentation não faz merge com alias de re-export.
 */
export interface SigilConfigRegistry {}

export function getConfig<K extends keyof SigilConfigRegistry & string>(
  key: K
): SigilConfigRegistry[K];
/**
 * Configs fora do registro (ex.: "editor.fontSize", de outra extensão)
 * retornam `unknown` DE PROPÓSITO — são valores não-confiáveis; faça cast
 * explícito. Um genérico `<T>` aqui deixaria typos de chave passarem em
 * silêncio, porque T seria inferido do tipo esperado no destino.
 */
export function getConfig(id: string): unknown;
export function getConfig(id: string): unknown {
  return getConfigById(id);
}

export function setConfig<K extends keyof SigilConfigRegistry & string>(
  key: K,
  value: SigilConfigRegistry[K],
  target?: SigilConfigTarget
): Thenable<void>;
export function setConfig(id: string, value: unknown, target?: SigilConfigTarget): Thenable<void>;
export function setConfig(id: string, value: unknown, target?: SigilConfigTarget): Thenable<void> {
  return setConfigById(id, value, target);
}
