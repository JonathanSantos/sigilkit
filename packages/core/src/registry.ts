export type CommandHandler = (...args: unknown[]) => unknown;
export type LifecycleHandler = (...args: unknown[]) => unknown;
export type WatchHandler = (next: unknown, prev: unknown) => unknown;

export interface TreeHandle {
  fire(): void;
}

export interface WebviewHandle {
  /** Cria o painel (ou revela, se já aberto). */
  open(): void;
  /** Envia mensagem para o lado UI; descarta com warning se o painel estiver fechado. */
  post(msg: unknown): void;
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
  readonly commands = new Map<string, CommandHandler>();
  readonly lifecycle = new Map<string, LifecycleHandler>();
  readonly watches = new Map<string, WatchHandler>();
  readonly configDefaults = new Map<string, unknown>();
  readonly trees = new Map<string, TreeHandle>();
  readonly treeHandlers = new Map<string, (...args: unknown[]) => unknown>();
  readonly webviews = new Map<string, WebviewHandle>();
  readonly webviewHandlers = new Map<string, (value: unknown) => unknown>();
}

export const registry = new Registry();
