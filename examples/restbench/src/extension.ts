import {
  Activate,
  Command,
  Config,
  ContextKey,
  Extension,
  HttpError,
  OnMessage,
  OnRequest,
  Secret,
  State,
  StatusBar,
  Watch,
  Webview,
  http,
  log,
  registry,
} from "@sigilkit/core";

// Repare: nenhum `import * as vscode`. Status bar, estado persistente,
// secrets, config, comandos e o webview vêm todos da plataforma do core.

export interface RequestSpec {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  /** corpo JSON, como texto (opcional) */
  body?: string;
}

export interface RequestResult {
  ok: boolean;
  /** status HTTP; 0 = falha antes da resposta (rede, timeout, JSON inválido) */
  status: number;
  ms: number;
  /** corpo da resposta, pretty-printed quando JSON */
  body: string;
  error?: string;
}

export interface HistoryItem {
  spec: RequestSpec;
  result: RequestResult;
  at: string;
}

type HostToUi = { type: "history"; value: HistoryItem[] };

let bench: RestBench; // instância viva da extensão — o painel delega para cá

@Extension({ prefix: "restbench", settings: true })
export class RestBench {
  @Config({ description: "Prefixo para URLs relativas (ex: https://api.exemplo.com)" })
  accessor baseUrl: string = "";

  @Config({ description: "Timeout de cada requisição (ms)", minimum: 100, maximum: 120000 })
  accessor timeoutMs: number = 10000;

  @Config({ description: "Máximo de entradas no histórico", minimum: 1, maximum: 100 })
  accessor historyLimit: number = 20;

  /** Histórico persistido por workspace — sobrevive a fechar o VSCode. */
  @State("workspace")
  accessor historico: HistoryItem[] = [];

  /** Token de autorização — vai para o SecretStorage, nunca para settings.json. */
  @Secret()
  accessor token: string | undefined;

  /** Alimenta o `enablement` do Clear History — typo aqui seria SIGIL1018. */
  @ContextKey()
  accessor temHistorico = false;

  @StatusBar({ alignment: "left", priority: 60, command: "restbench.abrir", tooltip: "Abrir o REST Bench" })
  accessor status: string = "$(radio-tower) REST Bench";

  @Activate()
  ativar() {
    bench = this;
    this.temHistorico = this.historico.length > 0;
  }

  @Command({ title: "Open", category: "REST Bench" })
  abrir() {
    return registry.webviews.get("RestBenchPanel")!.open();
  }

  @Command({ title: "Clear History", category: "REST Bench", enablement: "restbench.temHistorico" })
  limparHistorico() {
    this.historico = [];
    this.temHistorico = false;
    this.status = "$(radio-tower) REST Bench";
    registry.webviewPosts.get("RestBenchPanel")?.({ type: "history", value: [] } satisfies HostToUi);
  }

  registrar(item: HistoryItem) {
    this.historico = [item, ...this.historico].slice(0, this.historyLimit);
    this.temHistorico = true;
    const r = item.result;
    this.status = `$(radio-tower) ${r.ok ? "" : "$(error) "}${r.status || "erro"} · ${r.ms}ms`;
  }

  @Watch("baseUrl")
  aoMudarBase(nova: string) {
    log.info(`baseUrl agora é ${nova || "(vazia)"}`);
  }
}

@Webview({ id: "panel", title: "REST Bench", ui: "./ui/index.html" })
export class RestBenchPanel {
  /** A UI pede o histórico ao montar (callHost("history")). */
  @OnRequest("history")
  historico(): HistoryItem[] {
    return bench.historico;
  }

  /** O coração: a UI envia a spec, o host executa via plataforma http. */
  @OnRequest("send")
  async enviar(spec: RequestSpec): Promise<RequestResult> {
    const result = await executar(spec);
    bench.registrar({ spec, result, at: new Date().toISOString() });
    this.post({ type: "history", value: bench.historico });
    return result;
  }

  /** true = token guardado; string vazia remove. */
  @OnRequest("setToken")
  guardarToken(token: string): boolean {
    bench.token = token.trim() === "" ? undefined : token.trim();
    return bench.token !== undefined;
  }

  @OnMessage("clear")
  limpar() {
    bench.limparHistorico();
  }

  post!: (msg: HostToUi) => void; // injetado pelo wire
}

async function executar(spec: RequestSpec): Promise<RequestResult> {
  const started = Date.now();
  const url = /^https?:\/\//.test(spec.url) ? spec.url : bench.baseUrl + spec.url;

  let body: unknown;
  if (spec.body !== undefined && spec.body.trim() !== "") {
    try {
      body = JSON.parse(spec.body);
    } catch {
      return { ok: false, status: 0, ms: 0, body: "", error: "o corpo precisa ser JSON válido" };
    }
  }

  const headers: Record<string, string> = bench.token
    ? { authorization: `Bearer ${bench.token}` }
    : {};

  try {
    // http.request lança HttpError em não-2xx, então sucesso aqui é 2xx.
    const value = await http.request<unknown>(spec.method, url, body, {
      timeout: bench.timeoutMs,
      headers,
    });
    return { ok: true, status: 200, ms: Date.now() - started, body: pretty(value) };
  } catch (err) {
    if (err instanceof HttpError) {
      return { ok: false, status: err.status, ms: Date.now() - started, body: err.body, error: err.message };
    }
    return {
      ok: false,
      status: 0,
      ms: Date.now() - started,
      body: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function pretty(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
