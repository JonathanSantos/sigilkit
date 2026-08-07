import {
  Activate,
  Command,
  Config,
  ContextKey,
  Extension,
  LmTool,
  OnMessage,
  OnRequest,
  Secret,
  State,
  StatusBar,
  Watch,
  Webview,
  editor,
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
  /** headers da resposta (para a seção expansível da UI) */
  headers: Record<string, string>;
  /** tamanho do corpo cru, em bytes */
  size: number;
  /** language id do VSCode para renderizar o corpo ("json", "html", …) */
  language: string;
  error?: string;
}

export interface HistoryItem {
  spec: RequestSpec;
  result: RequestResult;
  at: string;
}

type HostToUi = { type: "history"; value: HistoryItem[] };

/** Input da tool `restbench_request` — o inputSchema sai DAQUI, deste tipo. */
export interface LmRequestInput {
  /** URL absoluta, ou caminho relativo à baseUrl configurada */
  url: string;
  /** método HTTP (default: GET) */
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** corpo JSON, como texto */
  body?: string;
}

export interface LmHistoryInput {
  /** quantas entradas recentes retornar (default: 5) */
  max?: number;
}

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

  @StatusBar({ alignment: "left", priority: 60, command: "restbench.open", tooltip: "Abrir o REST Bench" })
  accessor status: string = "$(radio-tower) REST Bench";

  @Activate
  ativar() {
    this.temHistorico = this.historico.length > 0;
  }

  @Command({ id: "open", title: "Open", category: "REST Bench" })
  abrir() {
    return registry.webviews.get("RestBenchPanel")!.open();
  }

  @Command({ id: "clearHistory", title: "Clear History", category: "REST Bench", enablement: "restbench.temHistorico" })
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

  // ── tools do agent mode: o Copilot chama a sua API pelo REST Bench ────────
  // O agent mode pede confirmação do usuário antes de invocar (e a
  // invocationMessage diz o que está acontecendo); a requisição usa a
  // baseUrl, o token e o timeout já configurados, e entra no histórico.

  @LmTool({
    name: "request",
    description:
      "Executa uma requisição HTTP pelo REST Bench, usando a baseUrl, o token de autorização e o timeout configurados pelo usuário. Retorna status, tempo e corpo da resposta.",
    referenceName: "request",
    invocationMessage: "Executando requisição pelo REST Bench…",
  })
  async requisitar(input: LmRequestInput): Promise<string> {
    const spec: RequestSpec = { method: input.method ?? "GET", url: input.url, body: input.body };
    const result = await executar(spec);
    this.registrar({ spec, result, at: new Date().toISOString() });
    registry.webviewPosts.get("RestBenchPanel")?.({ type: "history", value: this.historico } satisfies HostToUi);
    return toolText(spec, result);
  }

  @LmTool({
    name: "history",
    description:
      "Retorna as requisições recentes do histórico do REST Bench, com método, URL, status e corpo das respostas — útil para inspecionar o que a API devolveu.",
  })
  historicoRecente(input: LmHistoryInput): string {
    const itens = this.historico.slice(0, input?.max ?? 5);
    if (itens.length === 0) return "histórico vazio — nenhuma requisição feita ainda";
    return itens.map((i) => toolText(i.spec, i.result)).join("\n---\n");
  }
}

/** Resumo de uma requisição para o MODELO ler — corpo truncado para não estourar contexto. */
function toolText(spec: RequestSpec, r: RequestResult): string {
  const head = `${spec.method} ${spec.url} → ${r.status || "erro"} em ${r.ms}ms${r.error ? ` (${r.error})` : ""}`;
  const corpo = r.body.length > 4000 ? `${r.body.slice(0, 4000)}\n… (truncado; ${r.size} bytes no total)` : r.body;
  return corpo ? `${head}\n${corpo}` : head;
}

@Webview({ id: "panel", title: "REST Bench", ui: "./ui/index.html" })
export class RestBenchPanel {
  /** A UI pede o histórico ao montar (callHost("history")). */
  @OnRequest("history")
  historico(): HistoryItem[] {
    return registry.instance(RestBench).historico;
  }

  /** O coração: a UI envia a spec, o host executa via plataforma http. */
  @OnRequest("send")
  async enviar(spec: RequestSpec): Promise<RequestResult> {
    const result = await executar(spec);
    const ext = registry.instance(RestBench);
    ext.registrar({ spec, result, at: new Date().toISOString() });
    this.post({ type: "history", value: ext.historico });
    return result;
  }

  /** true = token guardado; string vazia remove. */
  @OnRequest("setToken")
  guardarToken(token: string): boolean {
    const ext = registry.instance(RestBench);
    ext.token = token.trim() === "" ? undefined : token.trim();
    return ext.token !== undefined;
  }

  @OnMessage("clear")
  limpar() {
    registry.instance(RestBench).limparHistorico();
  }

  /** Renderização vscode-native: o corpo abre num editor REAL, ao lado —
   *  syntax highlight, folding e busca do próprio VSCode, no tema do usuário. */
  @OnMessage("openInEditor")
  abrirNoEditor(value: { body: string; language: string }) {
    void editor.openText(value.body, { language: value.language, beside: true });
  }

  post!: (msg: HostToUi) => void; // injetado pelo wire
}

async function executar(spec: RequestSpec): Promise<RequestResult> {
  const started = Date.now();
  const ext = registry.instance(RestBench);
  const url = /^https?:\/\//.test(spec.url) ? spec.url : ext.baseUrl + spec.url;

  let body: unknown;
  if (spec.body !== undefined && spec.body.trim() !== "") {
    try {
      body = JSON.parse(spec.body);
    } catch {
      return { ok: false, status: 0, ms: 0, body: "", headers: {}, size: 0, language: "plaintext", error: "o corpo precisa ser JSON válido" };
    }
  }

  const headers: Record<string, string> = ext.token
    ? { authorization: `Bearer ${ext.token}` }
    : {};

  try {
    // http.send: a resposta como ela é — status real, sem lançar em não-2xx
    const res = await http.send(spec.method, url, body, { timeout: ext.timeoutMs, headers });
    return {
      ok: res.ok,
      status: res.status,
      ms: Date.now() - started,
      body: pretty(res.json()),
      headers: res.headers,
      size: res.text.length,
      language: languageOf(res.headers["content-type"] ?? ""),
      error: res.ok ? undefined : `HTTP ${res.status} ${res.statusText}`.trim(),
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - started,
      body: "",
      headers: {},
      size: 0,
      language: "plaintext",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function pretty(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/** content-type → language id do VSCode (alimenta o highlight e o editor). */
function languageOf(contentType: string): string {
  if (contentType.includes("json")) return "json";
  if (contentType.includes("html")) return "html";
  if (contentType.includes("xml")) return "xml";
  return "plaintext";
}
