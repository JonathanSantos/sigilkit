export { registry, Registry } from "./registry";
export type {
  CommandHandler,
  LifecycleHandler,
  WatchHandler,
  TreeHandle,
  WebviewHandle,
} from "./registry";

export { Extension, Activate, Deactivate } from "./decorators/extension";
export type { ExtensionOptions } from "./decorators/extension";

export { Command } from "./decorators/command";
export type { CommandOptions } from "./decorators/command";

export { Config } from "./decorators/config";
export type { ConfigOptions } from "./decorators/config";

export { Watch, bindConfigWatchers } from "./decorators/watch";
export type { WatchBinding } from "./decorators/watch";

export { TreeView, TreeRoot, TreeChildren, TreeItem, bindTreeView } from "./decorators/tree-view";
export type { TreeViewOptions, TreeViewBinding } from "./decorators/tree-view";

export { Webview, OnMessage } from "./decorators/webview";
export type { WebviewOptions } from "./decorators/webview";

export { bindWebview } from "./webview-host";
export type { WebviewBinding } from "./webview-host";

export { renderWebviewHtml } from "./webview-html";
export type { WebviewHtmlOptions } from "./webview-html";

export { readWorkspaceConfig, writeWorkspaceConfig, getConfig } from "./config-access";
