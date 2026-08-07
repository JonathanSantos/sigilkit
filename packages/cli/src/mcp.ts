import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import ts from "typescript";
import { buildSync } from "esbuild";
import { activateExtension, SigilTestHost } from "@sigilkit/test";
import { computeProject, writeChanged, writeStoredHash } from "./pipeline";

/**
 * `sigil mcp` — o loop de verificação do sigil como servidor MCP (stdio).
 * Zero dependências: o núcleo do protocolo é JSON-RPC 2.0 com mensagens
 * delimitadas por newline (mesmo espírito do sim-ui sem deps e do companion
 * do sandbox). Um agente registra o servidor e ganha:
 *   sigil_check — diagnósticos ESTRUTURADOS (code/file/line), sem parsear texto
 *   sigil_build — regenera manifesto/wire/tipos
 *   sigil_probe — sessão VIVA do simulador; rebuilda/reativa sozinho se o
 *                 código mudou desde a última sonda (o agente nunca pensa
 *                 em "preciso buildar?")
 *   sigil_docs  — busca na referência de página única (RAG de bolso, sem rede)
 */

interface StructuredDiag {
  code: number;
  message: string;
  file?: string;
  line?: number;
  character?: number;
}

function toStructured(diags: readonly ts.Diagnostic[] | undefined): StructuredDiag[] {
  return (diags ?? []).map((d) => {
    const out: StructuredDiag = {
      code: typeof d.code === "number" ? d.code : 0,
      message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
    };
    if (d.file && d.start !== undefined) {
      const pos = d.file.getLineAndCharacterOfPosition(d.start);
      out.file = d.file.fileName;
      out.line = pos.line + 1;
      out.character = pos.character + 1;
    }
    return out;
  });
}

/** mtime mais novo sob os insumos do projeto (src + package.json + ui/). */
function newestSourceMtime(projectDir: string): number {
  let newest = 0;
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".generated" || entry.name.startsWith(".git")) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(abs);
      else newest = Math.max(newest, fs.statSync(abs).mtimeMs);
    }
  };
  for (const base of ["src", "ui"]) {
    const abs = path.join(projectDir, base);
    if (fs.existsSync(abs)) visit(abs);
  }
  const pkg = path.join(projectDir, "package.json");
  if (fs.existsSync(pkg)) newest = Math.max(newest, fs.statSync(pkg).mtimeMs);
  return newest;
}

/** Serialização segura para o agente: corta ciclos e funções. */
function safeJson(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (_k, v: unknown) => {
      if (typeof v === "function") return `[função]`;
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return "[ciclo]";
        seen.add(v);
      }
      return v;
    },
    2
  );
}

class SigilMcpSession {
  private host: SigilTestHost | undefined;
  private activatedAt = 0;
  private counts = { info: 0, warn: 0, error: 0, logs: 0 };

  constructor(private readonly projectDir: string) {}

  /** check sem escrever nada: diagnósticos + arquivos gerenciados stale. */
  check(): string {
    const result = computeProject(this.projectDir);
    if (!result.ok) {
      return safeJson({ ok: false, message: result.message, diagnostics: toStructured(result.diagnostics) });
    }
    const stale = result.files
      .filter((f) => !fs.existsSync(f.path) || fs.readFileSync(f.path, "utf8") !== f.content)
      .map((f) => f.label);
    return safeJson({ ok: stale.length === 0, staleFiles: stale, hash: result.hash });
  }

  /** build de verdade: escreve manifesto/wire/tipos. */
  build(): string {
    const result = computeProject(this.projectDir);
    if (!result.ok) {
      return safeJson({ ok: false, message: result.message, diagnostics: toStructured(result.diagnostics) });
    }
    const written = writeChanged(result.files);
    writeStoredHash(this.projectDir, result.hash);
    return safeJson({ ok: true, written, hash: result.hash });
  }

  /** garante host vivo refletindo o código ATUAL (rebuilda se algo mudou). */
  private async ensureFresh(): Promise<{ rebuilt: boolean } | { error: string; diagnostics?: StructuredDiag[] }> {
    const dirty = !this.host || newestSourceMtime(this.projectDir) > this.activatedAt;
    if (!dirty) return { rebuilt: false };

    const result = computeProject(this.projectDir);
    if (!result.ok) {
      return { error: result.message ?? "build falhou", diagnostics: toStructured(result.diagnostics) };
    }
    writeChanged(result.files);
    writeStoredHash(this.projectDir, result.hash);

    const bundlePath = path.join(this.projectDir, "out", "sigil-mcp.js");
    buildSync({
      entryPoints: [path.join(this.projectDir, "src", ".generated", "wire.ts")],
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "es2022",
      external: ["vscode"],
      outfile: bundlePath,
      sourcemap: "inline",
      logLevel: "silent",
    });

    // configs sobrevivem à reativação (como no sigil sim)
    const carried = this.host?.configuration.snapshot() ?? {};
    if (this.host) await Promise.resolve(this.host.dispose()).catch(() => {});
    this.host = await activateExtension({ projectDir: this.projectDir, bundlePath, configuration: carried });
    this.activatedAt = Date.now();
    this.counts = { info: 0, warn: 0, error: 0, logs: 0 };
    return { rebuilt: true };
  }

  /** o que aconteceu desde a última sonda (mensagens e logs novos). */
  private delta(): Record<string, unknown> {
    const h = this.host!;
    const out = {
      info: h.infoMessages.slice(this.counts.info),
      warn: h.warnMessages.slice(this.counts.warn),
      error: h.errorMessages.slice(this.counts.error),
      logs: h.logs.slice(this.counts.logs).map((l) => `[${l.level}] ${l.message}`),
    };
    this.counts = {
      info: h.infoMessages.length,
      warn: h.warnMessages.length,
      error: h.errorMessages.length,
      logs: h.logs.length,
    };
    return out;
  }

  async probe(args: Record<string, unknown>): Promise<string> {
    const fresh = await this.ensureFresh();
    if ("error" in fresh) return safeJson({ ok: false, ...fresh });
    const host = this.host!;
    const kind = String(args.kind ?? "");

    let result: unknown;
    switch (kind) {
      case "command":
        result = await host.executeCommand(String(args.id), ...((args.args as unknown[]) ?? []));
        break;
      case "config":
        host.configuration.set(String(args.key), args.value);
        result = "ok";
        break;
      case "tree":
        result = await host.tree(String(args.viewId)).roots();
        break;
      case "panelRequest":
        result = await host.panel(String(args.viewId)).request(String(args.type), args.value);
        break;
      case "invokeTool":
        result = await host.invokeTool(String(args.name), args.input);
        break;
      case "chatRequest": {
        const stream = await host.chatRequest(
          String(args.participantId),
          String(args.prompt),
          args.command ? { command: String(args.command) } : undefined
        );
        result = stream.calls.map((c) => c.value).join("");
        break;
      }
      case "runTests":
        result = await host.runTests(String(args.controllerId), args.ids as string[] | undefined);
        break;
      case "logs":
        result = "ver delta";
        break;
      default:
        return safeJson({
          ok: false,
          error: `kind desconhecido: '${kind}' — use command | config | tree | panelRequest | invokeTool | chatRequest | runTests | logs`,
        });
    }

    return safeJson({ ok: true, rebuilt: fresh.rebuilt, result, ...this.delta() });
  }

  docs(query: string): string {
    // publicado: reference.md na raiz do pacote cli; no monorepo: docs/reference.md
    const candidates = [
      path.join(__dirname, "..", "reference.md"),
      path.join(__dirname, "..", "..", "..", "docs", "reference.md"),
    ];
    const refPath = candidates.find((p) => fs.existsSync(p));
    if (!refPath) return safeJson({ ok: false, error: "reference.md não encontrado no pacote" });
    const texto = fs.readFileSync(refPath, "utf8");
    const secoes = texto.split(/^## /m).map((s, i) => (i === 0 ? s : `## ${s}`));
    const termos = query.toLowerCase().split(/\s+/).filter(Boolean);
    const nota = (s: string): number => {
      const lower = s.toLowerCase();
      return termos.reduce((acc, t) => acc + (lower.split(t).length - 1), 0);
    };
    const ranqueadas = secoes
      .map((s) => ({ s, n: nota(s) }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 2)
      .map((x) => x.s);
    if (ranqueadas.length === 0) {
      return `Nenhuma seção casa com "${query}". Seções disponíveis:\n${secoes
        .map((s) => s.split("\n")[0])
        .filter((t) => t?.startsWith("##"))
        .join("\n")}`;
    }
    return ranqueadas.join("\n\n").slice(0, 8000);
  }

  async dispose(): Promise<void> {
    if (this.host) await Promise.resolve(this.host.dispose()).catch(() => {});
  }
}

const TOOLS = [
  {
    name: "sigil_check",
    description:
      "Verifica o projeto sigil SEM escrever nada: diagnósticos do compilador (SIGIL1000–1022, estruturados com code/file/line) e arquivos gerados stale. Rode depois de editar decorators.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "sigil_build",
    description:
      "Regenera manifesto (package.json), wire e tipos a partir dos decorators. Retorna os arquivos escritos ou os diagnósticos estruturados.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "sigil_probe",
    description:
      "Executa uma sonda na sessão VIVA do simulador (@sigilkit/test) — a extensão real, sem VSCode. Se o código mudou desde a última sonda, rebuilda e reativa sozinho. Retorna o resultado + mensagens/logs novos. kinds: command {id, args?}, config {key, value}, tree {viewId}, panelRequest {viewId, type, value?} (o painel precisa estar aberto — abra pelo comando antes), invokeTool {name, input?} (@LmTool sem Copilot), chatRequest {participantId, prompt, command?}, runTests {controllerId, ids?}, logs {}.",
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["command", "config", "tree", "panelRequest", "invokeTool", "chatRequest", "runTests", "logs"],
        },
        id: { type: "string", description: "command: id do comando (ex.: prefixo.acao)" },
        args: { type: "array", description: "command: argumentos extras" },
        key: { type: "string", description: "config: chave (prefixo.nome)" },
        value: { description: "config: valor / panelRequest: value do request" },
        viewId: { type: "string", description: "tree/panelRequest: id da view (prefixo.id)" },
        type: { type: "string", description: "panelRequest: tipo do @OnRequest" },
        name: { type: "string", description: "invokeTool: nome da tool (prefixo_membro)" },
        input: { description: "invokeTool: input da tool" },
        participantId: { type: "string", description: "chatRequest: id do participante (prefixo.nome)" },
        prompt: { type: "string", description: "chatRequest: o prompt" },
        command: { type: "string", description: "chatRequest: slash command (sem a barra)" },
        controllerId: { type: "string", description: "runTests: id do controller (prefixo.classe)" },
        ids: { type: "array", items: { type: "string" }, description: "runTests: ids específicos" },
      },
      required: ["kind"],
    },
  },
  {
    name: "sigil_docs",
    description:
      "Busca na referência oficial do sigil (a API inteira numa página): decorators, opções, plataforma de runtime, sondas de teste, diagnósticos e pegadinhas. Use antes de escrever código que você não tem certeza da assinatura.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "termos de busca (ex.: 'LmTool inputSchema')" } },
      required: ["query"],
    },
  },
];

export function runMcp(projectDir: string): number {
  const session = new SigilMcpSession(path.resolve(projectDir));
  const version = (() => {
    try {
      return (JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")) as { version?: string })
        .version;
    } catch {
      return undefined;
    }
  })();

  const send = (msg: Record<string, unknown>): void => {
    process.stdout.write(JSON.stringify(msg) + "\n");
  };

  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let req: { jsonrpc?: string; id?: number | string; method?: string; params?: Record<string, unknown> };
    try {
      req = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
      return;
    }
    void handle(req);
  });

  async function handle(req: {
    id?: number | string;
    method?: string;
    params?: Record<string, unknown>;
  }): Promise<void> {
    const { id, method, params } = req;
    const isNotification = id === undefined;

    switch (method) {
      case "initialize":
        send({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: (params?.protocolVersion as string) ?? "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "sigil", version: version ?? "0.0.0" },
          },
        });
        return;
      case "notifications/initialized":
      case "notifications/cancelled":
        return;
      case "ping":
        if (!isNotification) send({ jsonrpc: "2.0", id, result: {} });
        return;
      case "tools/list":
        send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
        return;
      case "tools/call": {
        const name = String(params?.name ?? "");
        const args = (params?.arguments as Record<string, unknown>) ?? {};
        try {
          let text: string;
          if (name === "sigil_check") text = session.check();
          else if (name === "sigil_build") text = session.build();
          else if (name === "sigil_probe") text = await session.probe(args);
          else if (name === "sigil_docs") text = session.docs(String(args.query ?? ""));
          else {
            send({ jsonrpc: "2.0", id, error: { code: -32602, message: `tool desconhecida: ${name}` } });
            return;
          }
          send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
        } catch (e) {
          // R6 até aqui: o erro volta DESCRITIVO para o agente, nunca silêncio
          send({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: `erro: ${e instanceof Error ? e.message : String(e)}` }],
              isError: true,
            },
          });
        }
        return;
      }
      default:
        if (!isNotification) {
          send({ jsonrpc: "2.0", id, error: { code: -32601, message: `método desconhecido: ${String(method)}` } });
        }
    }
  }

  rl.on("close", () => {
    void session.dispose().then(() => process.exit(0));
  });

  return 0;
}
