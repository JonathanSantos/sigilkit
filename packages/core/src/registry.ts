export type CommandHandler = (...args: unknown[]) => unknown;
export type LifecycleHandler = (...args: unknown[]) => unknown;
export type WatchHandler = (next: unknown, prev: unknown) => unknown;

export interface TreeHandle {
  fire(): void;
}

export interface WebviewHandle {
  /** Painel: cria (ou revela). Sidebar: foca a view (o resolve acontece no primeiro show). */
  open(): Promise<void>;
  /** Envia mensagem para o lado UI; descarta com warning se o alvo não estiver visível. */
  post(msg: unknown): void;
}

export interface StatusBarItemLike {
  text: string;
  dispose(): void;
}

/** Subconjunto de vscode.LogOutputChannel que o sigil usa. */
export interface LogChannelLike {
  trace(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  show(): void;
  dispose(): void;
}

/**
 * Metade "comportamento" do modelo de propriedade (§4 do spec): os decorators
 * preenchem estes Maps na construção da instância; o wire gerado faz o join
 * com as chaves emitidas pelo compilador e lança erro se faltar alguma (R6).
 *
 * A chave é sempre `${NomeDaClasse}.${nomeDoMembro}` — por isso o bundle da
 * extensão precisa de `--keep-names` (§13).
 */
export class Registry {
  /** Prefixo resolvido da extensão. O wire gerado preenche antes de instanciar a classe. */
  prefix = "";
  /** ExtensionContext corrente; o wire define no início do activate. */
  context?: import("vscode").ExtensionContext;
  /** Canal de log da extensão; bindLog define no activate. */
  logChannel?: LogChannelLike;
  readonly commands = new Map<string, CommandHandler>();
  readonly lifecycle = new Map<string, LifecycleHandler>();
  readonly watches = new Map<string, WatchHandler>();
  readonly configDefaults = new Map<string, unknown>();
  readonly trees = new Map<string, TreeHandle>();
  readonly treeHandlers = new Map<string, (...args: unknown[]) => unknown>();
  readonly webviews = new Map<string, WebviewHandle>();
  readonly webviewHandlers = new Map<string, (value: unknown) => unknown>();
  /** post de cada webview (preenchido pelo bind); o wire injeta forwarders nas instâncias */
  readonly webviewPosts = new Map<string, (msg: unknown) => void>();
  /** buckets adotados por nome declarado de classe (ver metadata.ts) */
  readonly buckets = new Map<string, import("./metadata").Bucket>();
}

export const registry = new Registry();
