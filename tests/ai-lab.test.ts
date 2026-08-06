import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { activateExtension, SigilTestHost } from "@sigilkit/test";

// Lab da fornada de IA: @LmTool (schema DERIVADO do tipo!), @ChatCommand,
// @InlineCompletion, @McpServers e llm.agent — num projeto criado do zero.

const ROOT = process.cwd();
const BIN = path.join(ROOT, "packages/cli/bin/sigil.js");
const TMP = path.join(ROOT, "tests/.tmp/ailab");

const AI_EXTENSION = `import * as vscode from "vscode";
import {
  Extension,
  Command,
  LmTool,
  McpServers,
  ChatParticipant,
  ChatRequest,
  ChatCommand,
  Language,
  InlineCompletion,
  llm,
  log,
} from "@sigilkit/core";

interface BuscaInput {
  /** o texto a procurar nas issues */
  consulta: string;
  estado?: "aberta" | "fechada";
  max?: number;
  etiquetas?: string[];
}

@Extension({ prefix: "ailab" })
export class AiLab {
  @Command({ title: "Ping" })
  ping() {
    log.info("pong");
  }

  // O schema JSON que todo mundo escreve à mão sai DAQUI: do tipo BuscaInput.
  @LmTool({
    description: "Busca issues do projeto por texto, estado e etiquetas",
    referenceName: "issues",
    invocationMessage: "Buscando issues…",
  })
  buscarIssues(input: BuscaInput): string {
    const teto = input.max ?? 10;
    return \`\${teto} issues sobre "\${input.consulta}" (\${input.estado ?? "todas"})\`;
  }

  @LmTool({ description: "Diz a hora do host — tool sem input", userDescription: "Mostra a hora atual" })
  hora(): string {
    return "12:34";
  }

  // o loop agêntico de verdade: o modelo pede a tool, o agent executa e devolve
  @Command({ title: "Agente" })
  async agente() {
    const resposta = await llm.agent("que horas são?", { tools: ["ailab_hora"] });
    log.info(\`agente disse: \${resposta}\`);
  }

  @McpServers({ label: "Servidores do AiLab" })
  servidores() {
    return [
      { label: "docs", command: "npx", args: ["-y", "mcp-docs"], cwd: "./ferramentas" },
      { label: "api", uri: "https://mcp.exemplo.dev/sse" },
    ];
  }
}

@ChatParticipant({ id: "guru", name: "guru", description: "o guru do lab" })
export class Guru {
  @ChatRequest()
  async responder(_req: unknown, _ctx: unknown, stream: { markdown(t: string): void }) {
    stream.markdown("resposta livre");
  }

  @ChatCommand("fix", { description: "Corrige o problema apontado" })
  async fix(_req: unknown, _ctx: unknown, stream: { markdown(t: string): void }) {
    stream.markdown("consertando…");
  }

  @ChatCommand("explain", { description: "Explica o código" })
  async explain(_req: unknown, _ctx: unknown, stream: { markdown(t: string): void }) {
    stream.markdown("explicando…");
  }
}

@Language({ id: "markdown" })
export class GhostWriter {
  @InlineCompletion()
  ghost(doc: vscode.TextDocument): string[] {
    return [doc.getText().length === 0 ? "# Título sugerido" : "…continuação sugerida"];
  }
}
`;

function sigil(cmd: string): { status: number; out: string } {
  const r = spawnSync(process.execPath, [BIN, cmd, TMP], { encoding: "utf8" });
  return { status: r.status ?? -1, out: `${r.stdout}\n${r.stderr}` };
}

describe("ai-lab — tools do agent mode, slash commands, ghost text e MCP", () => {
  let host: SigilTestHost;
  let pkg: Record<string, any>;

  beforeAll(async () => {
    fs.rmSync(TMP, { recursive: true, force: true });
    expect(sigil("init").status).toBe(0);
    fs.writeFileSync(path.join(TMP, "src/extension.ts"), AI_EXTENSION);
    const build = sigil("build");
    expect(build.status, build.out).toBe(0);
    const bundle = spawnSync(
      "npx",
      ["esbuild", "src/.generated/wire.ts", "--bundle", "--platform=node", "--format=cjs", "--target=es2022", "--external:vscode", "--outfile=out/extension.js"],
      { cwd: TMP, encoding: "utf8" }
    );
    expect(bundle.status, bundle.stderr).toBe(0);
    pkg = JSON.parse(fs.readFileSync(path.join(TMP, "package.json"), "utf8"));
    host = await activateExtension({ projectDir: TMP });
  });

  afterAll(async () => {
    await host.dispose();
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("manifesto: inputSchema DERIVADO do tipo (com JSDoc, enum, opcionais e array)", () => {
    const tools = pkg.contributes.languageModelTools;
    const busca = tools.find((t: any) => t.name === "ailab_buscarIssues");
    expect(busca.modelDescription).toContain("Busca issues");
    expect(busca.toolReferenceName).toBe("issues");
    expect(busca.canBeReferencedInPrompt).toBe(true);
    expect(busca.inputSchema).toEqual({
      type: "object",
      properties: {
        consulta: { type: "string", description: "o texto a procurar nas issues" },
        estado: { type: "string", enum: ["aberta", "fechada"] },
        max: { type: "number" },
        etiquetas: { type: "array", items: { type: "string" } },
      },
      required: ["consulta"],
    });
    // tool sem input não emite schema; userDescription é opção própria
    const hora = tools.find((t: any) => t.name === "ailab_hora");
    expect(hora.inputSchema).toBeUndefined();
    expect(hora.userDescription).toBe("Mostra a hora atual");
  });

  it("manifesto: slash commands do participante e provedor MCP declarados", () => {
    expect(pkg.contributes.chatParticipants[0].commands).toEqual([
      { name: "explain", description: "Explica o código" },
      { name: "fix", description: "Corrige o problema apontado" },
    ]);
    expect(pkg.contributes.mcpServerDefinitionProviders).toEqual([
      { id: "ailab.servidores", label: "Servidores do AiLab" },
    ]);
  });

  it("@LmTool invocável como o agent mode faz — registrada e executando", async () => {
    expect(host.lmTools).toEqual(["ailab_buscarIssues", "ailab_hora"]);
    const texto = await host.invokeTool("ailab_buscarIssues", { consulta: "login", estado: "aberta", max: 3 });
    expect(texto).toBe('3 issues sobre "login" (aberta)');
    expect(await host.invokeTool("ailab_hora")).toBe("12:34");
  });

  it("@ChatCommand roteia por request.command; sem command cai no @ChatRequest", async () => {
    const livre = await host.chatRequest("ailab.guru", "oi");
    expect(livre.calls.map((c) => c.value).join("")).toBe("resposta livre");
    const fix = await host.chatRequest("ailab.guru", "conserta isso", { command: "fix" });
    expect(fix.calls.map((c) => c.value).join("")).toBe("consertando…");
    const explain = await host.chatRequest("ailab.guru", "o que é isso", { command: "explain" });
    expect(explain.calls.map((c) => c.value).join("")).toBe("explicando…");
  });

  it("@InlineCompletion: strings viram itens de ghost text", async () => {
    const vazio = (await host.provideInlineCompletions("markdown", "")) as { insertText: string }[];
    expect(vazio[0]!.insertText).toBe("# Título sugerido");
    const cheio = (await host.provideInlineCompletions("markdown", "olá")) as { insertText: string }[];
    expect(cheio[0]!.insertText).toBe("…continuação sugerida");
  });

  it("@McpServers: definições simples viram stdio (com cwd) e http", async () => {
    const defs = (await host.mcpServers("ailab.servidores")) as any[];
    expect(defs).toHaveLength(2);
    expect(defs[0]).toMatchObject({ label: "docs", command: "npx" });
    expect(String(defs[0].cwd?.fsPath ?? "")).toContain("ferramentas");
    expect(defs[1]).toMatchObject({ label: "api" });
  });

  it("llm.agent: executa a tool pedida e pareia call/resultado no protocolo real", async () => {
    host.queueLlmResponse(
      { toolCalls: [{ callId: "c1", name: "ailab_hora", input: {} }] },
      "são 12:34 no host"
    );
    await host.executeCommand("ailab.agente");
    expect(host.logText()).toContain("agente disse: são 12:34 no host");

    // a 2ª rodada precisa levar o par Assistant(tool call) + User(tool result)
    const rodada2 = host.llmRequests.at(-1) as any[];
    expect(rodada2).toHaveLength(3);
    expect(rodada2[1].role).toBe("assistant");
    expect(rodada2[1].content[0]).toMatchObject({ callId: "c1", name: "ailab_hora" });
    expect(rodada2[2].role).toBe("user");
    expect(rodada2[2].content[0].callId).toBe("c1");
    expect(rodada2[2].content[0].content[0].value).toBe("12:34");
  });
});
