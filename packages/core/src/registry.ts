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
  /** Re-preenche o HTML no painel ABERTO (hot reload de UI) — no-op se fechado.
   *  A página recarrega e o handshake da UI (ex.: ready→init) se repete. */
  refresh?(): Promise<void>;
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
  readonly webviewHandlers = new Map<string, (...args: unknown[]) => unknown>();
  readonly languageHandlers = new Map<string, (...args: unknown[]) => unknown>();
  readonly chatHandlers = new Map<string, (...args: unknown[]) => unknown>();
  readonly events = new Map<string, (...args: unknown[]) => unknown>();
  /** valores vivos de @ContextKey (id completo → valor) */
  readonly contextValues = new Map<string, unknown>();
  /** cache síncrono dos @Secret (SecretStorage é async; bindSecrets pré-carrega) */
  readonly secretsCache = new Map<string, string>();
  /** post de cada webview (preenchido pelo bind); o wire injeta forwarders nas instâncias */
  readonly webviewPosts = new Map<string, (msg: unknown) => void>();
  /** construtor → nome declarado da classe @Webview (o wire preenche no hydrate) */
  readonly webviewKeys = new WeakMap<abstract new (...args: never[]) => unknown, string>();
  /** painel/view aberto agora? (o bind mantém; alimenta panel().isOpen) */
  readonly webviewLive = new Map<string, boolean>();
  /** handlers @OnOpen/@OnDispose por chave Classe.membro */
  readonly webviewOpenHandlers = new Map<string, () => unknown>();
  readonly webviewDisposeHandlers = new Map<string, () => unknown>();
  /** timers @Every(ms) por chave Classe.membro */
  readonly everyHandlers = new Map<string, { ms: number; fn: () => unknown }>();
  /** handlers @LmTool e @McpServers por chave Classe.membro */
  readonly lmToolHandlers = new Map<string, (...args: unknown[]) => unknown>();
  readonly mcpServerHandlers = new Map<string, (...args: unknown[]) => unknown>();
  /** buckets adotados por nome declarado de classe (ver metadata.ts) */
  readonly buckets = new Map<string, import("./metadata").Bucket>();
  /** instâncias criadas pelo wire, chaveadas pelo CONSTRUTOR (minificação-safe;
   *  no hot swap o hydrate re-registra com as classes frescas do módulo novo) */
  readonly instances = new WeakMap<abstract new (...args: never[]) => unknown, unknown>();

  /**
   * A ponte abençoada entre classes: de qualquer @Webview/@TreeView/etc.,
   * alcance a instância viva de outra classe gerenciada — tipada.
   * Lança se a classe não for gerenciada pelo wire (R6).
   */
  instance<T>(cls: abstract new (...args: never[]) => T): T {
    const found = this.instances.get(cls);
    if (found === undefined) {
      throw new Error(
        `sigil: nenhuma instância viva de ${cls.name || "(classe)"} — ela não é uma classe gerenciada (@Extension/@TreeView/@Webview/…) deste wire. Rode 'sigil build' se acabou de decorá-la.`
      );
    }
    return found as T;
  }

  /**
   * Acesso TIPADO ao webview de uma classe, pelo construtor — sem strings.
   * `post` envia se o painel estiver aberto (true) ou descarta (false) — a
   * semântica "poste se aberto" explícita; `open()` abre/foca; `isOpen` diz.
   */
  panel<T extends { post(msg: never): void }>(
    cls: abstract new (...args: never[]) => T
  ): SigilPanelHandle<Parameters<T["post"]>[0]> {
    const key = this.webviewKeys.get(cls);
    if (!key) {
      throw new Error(
        `sigil: ${cls.name || "(classe)"} não é uma classe @Webview gerenciada deste wire. Rode 'sigil build' se acabou de decorá-la.`
      );
    }
    const self = this;
    return {
      get isOpen() {
        return self.webviewLive.get(key) === true;
      },
      post(msg) {
        if (self.webviewLive.get(key) !== true) return false;
        self.webviewPosts.get(key)?.(msg);
        return true;
      },
      async open() {
        const handle = self.webviews.get(key);
        if (!handle) throw new Error(`sigil: webview '${key}' ainda não registrado — activate rodou?`);
        await handle.open();
      },
    };
  }
}

export interface SigilPanelHandle<M> {
  /** true = painel aberto agora */
  readonly isOpen: boolean;
  /** envia se aberto (true); descarta se fechado (false) */
  post(msg: M): boolean;
  /** abre o painel / foca a view */
  open(): Promise<void>;
}

export const registry = new Registry();
