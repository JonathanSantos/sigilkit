import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { activateExtension, SigilTestHost, WebviewPanelMock } from "@sigilkit/test";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// O fetch é global e o http do core o lê na hora da chamada — dá para stubar
// sem tocar no bundle. Cada teste programa a próxima resposta.
const calls: { url: string; init?: RequestInit }[] = [];
let nextResponse: () => Response = () => okJson({});
const okJson = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

const originalFetch = globalThis.fetch;

// panel.request faz o RPC como a UI real (correlação por __sigilRpcId)
const rpc = (panel: WebviewPanelMock, type: string, value?: unknown) => panel.request(type, value);

describe("restbench — React na UI, http/estado/secret no host", () => {
  let host: SigilTestHost;
  let panel: WebviewPanelMock;

  beforeAll(async () => {
    globalThis.fetch = (async (url: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return nextResponse();
    }) as typeof globalThis.fetch;
    host = await activateExtension({ projectDir });
    await host.executeCommand("restbench.open");
    panel = host.panel("restbench.panel");
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await host.dispose();
  });

  it("ativação: comandos, settings app e status bar inicial", () => {
    expect(host.commands).toContain("restbench.open"); // id explícito — o método chama-se abrir()
    expect(host.commands).toContain("restbench.clearHistory");
    expect(host.commands).toContain("restbench.configure"); // settings: true
    expect(host.statusBarItems[0]?.text).toBe("$(radio-tower) REST Bench");
  });

  it("shell: React entra como script externo reescrito, com CSP e nonce", () => {
    expect(panel.html).toMatch(/Content-Security-Policy/);
    expect(panel.html).toContain('src="sigil-webview://');
    expect(panel.html).not.toContain('src="dist/main.js"');
  });

  it("send: executa via http, responde à UI e registra história/status/contextKey", async () => {
    nextResponse = () => okJson({ hello: "sigil" });
    const result = (await rpc(panel, "send", { method: "GET", url: "https://ex.dev/x" })) as {
      ok: boolean;
      status: number;
      body: string;
    };
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body).toContain('"hello": "sigil"');
    expect(host.contextKey("restbench.temHistorico")).toBe(true);
    expect(host.statusBarItems[0]?.text).toMatch(/200 · \d+ms/);
    // o host também faz o push do histórico para a UI
    const push = panel.posted.findLast((m) => (m as { type?: string }).type === "history") as {
      value: unknown[];
    };
    expect(push.value).toHaveLength(1);
  });

  it("resposta traz headers, tamanho e language derivada do content-type", async () => {
    nextResponse = () => okJson({ a: 1 });
    const result = (await rpc(panel, "send", { method: "GET", url: "https://ex.dev/meta" })) as {
      headers: Record<string, string>;
      size: number;
      language: string;
    };
    expect(result.language).toBe("json");
    expect(result.headers["content-type"]).toContain("json");
    expect(result.size).toBeGreaterThan(0);
  });

  it("openInEditor abre o corpo num editor REAL com a language certa (vscode-native)", async () => {
    panel.receive({ type: "openInEditor", value: { body: '{\n  "a": 1\n}', language: "json" } });
    await new Promise((r) => setTimeout(r, 10));
    const ed = host.activeTextEditor!;
    expect(ed).toBeDefined();
    expect(ed.document.languageId).toBe("json");
    expect(ed.document.getText()).toContain('"a": 1');
  });

  it("erro HTTP vira resultado estruturado, não exceção na UI", async () => {
    nextResponse = () => okJson({ motivo: "sem acesso" }, 403);
    const result = (await rpc(panel, "send", { method: "GET", url: "https://ex.dev/privado" })) as {
      ok: boolean;
      status: number;
      error?: string;
    };
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toContain("403");
    expect(host.statusBarItems[0]?.text).toContain("$(error)");
  });

  it("corpo que não é JSON é rejeitado antes de qualquer request", async () => {
    const antes = calls.length;
    const result = (await rpc(panel, "send", { method: "POST", url: "https://ex.dev/x", body: "{oops" })) as {
      ok: boolean;
      error?: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("JSON");
    expect(calls.length).toBe(antes);
  });

  it("@Secret: token guardado entra como Authorization nos requests seguintes", async () => {
    expect(await rpc(panel, "setToken", "abc123")).toBe(true);
    nextResponse = () => okJson({});
    await rpc(panel, "send", { method: "GET", url: "https://ex.dev/auth" });
    const last = calls.at(-1)!;
    expect((last.init?.headers as Record<string, string>).authorization).toBe("Bearer abc123");
    // string vazia remove o token
    expect(await rpc(panel, "setToken", "  ")).toBe(false);
    await rpc(panel, "send", { method: "GET", url: "https://ex.dev/anon" });
    expect((calls.at(-1)!.init?.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("baseUrl prefixa urls relativas e @Watch loga a mudança", async () => {
    host.configuration.set("restbench.baseUrl", "https://api.base.dev");
    await rpc(panel, "send", { method: "GET", url: "/status" });
    expect(calls.at(-1)!.url).toBe("https://api.base.dev/status");
    expect(host.logText()).toContain("baseUrl agora é https://api.base.dev");
  });

  it("histórico: @State persiste, history responde e clear zera tudo", async () => {
    const antes = (await rpc(panel, "history")) as unknown[];
    expect(antes.length).toBeGreaterThan(0);
    panel.receive({ type: "clear" });
    await new Promise((r) => setTimeout(r, 10));
    expect((await rpc(panel, "history")) as unknown[]).toHaveLength(0);
    expect(host.contextKey("restbench.temHistorico")).toBe(false);
    expect(host.statusBarItems[0]?.text).toBe("$(radio-tower) REST Bench");
  });

  it("@LmTool: manifesto com inputSchema DERIVADO do tipo LmRequestInput", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
    const req = pkg.contributes.languageModelTools.find((t: { name: string }) => t.name === "restbench_request");
    expect(req.inputSchema).toEqual({
      type: "object",
      properties: {
        url: { type: "string", description: "URL absoluta, ou caminho relativo à baseUrl configurada" },
        method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"], description: "método HTTP (default: GET)" },
        body: { type: "string", description: "corpo JSON, como texto" },
      },
      required: ["url"],
    });
    expect(host.lmTools).toContain("restbench_request");
    expect(host.lmTools).toContain("restbench_history");
  });

  it("@LmTool request/history: o agent mode chama a API e consulta o histórico", async () => {
    nextResponse = () => okJson({ usuarios: 3 });
    const texto = await host.invokeTool("restbench_request", { url: "https://ex.dev/usuarios" });
    expect(texto).toContain("GET https://ex.dev/usuarios → 200");
    expect(texto).toContain('"usuarios": 3');
    // a requisição do agente entra no MESMO histórico da UI…
    expect(((await rpc(panel, "history")) as unknown[]).length).toBe(1);
    // …e a tool de histórico devolve o resumo para o modelo
    const resumo = await host.invokeTool("restbench_history", { max: 3 });
    expect(resumo).toContain("usuarios");
  });
});
