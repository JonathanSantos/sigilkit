import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// E2E do `sigil mcp`: um cliente JSON-RPC de verdade falando o protocolo por
// stdio — handshake, tools/list, check estruturado, probe com auto-rebuild
// (a tese da era dos agentes: editar → sondar, sem pensar em build).

const ROOT = process.cwd();
const BIN = path.join(ROOT, "packages/cli/bin/sigil.js");
const TMP = path.join(ROOT, "tests/.tmp/mcplab");

const EXTENSION = `import { Extension, Command, LmTool, log } from "@sigilkit/core";

@Extension({ prefix: "mcplab" })
export class McpLab {
  @Command({ title: "Ping" })
  ping() {
    log.info("pong v1");
  }

  @LmTool({ description: "Soma dois números" })
  somar(input: { a: number; b: number }): string {
    return String(input.a + input.b);
  }
}
`;

type RpcResponse = {
  id?: number;
  result?: { tools?: { name: string }[]; content?: { type: string; text: string }[]; isError?: boolean; serverInfo?: { name: string } };
  error?: { code: number; message: string };
};

class McpClient {
  private child: ChildProcess;
  private buf = "";
  private pending = new Map<number, (v: RpcResponse) => void>();
  private nextId = 1;

  constructor(projectDir: string) {
    this.child = spawn(process.execPath, [BIN, "mcp", projectDir], { stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout!.on("data", (d: Buffer) => {
      this.buf += d.toString();
      let i: number;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line) as RpcResponse;
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          this.pending.get(msg.id)!(msg);
          this.pending.delete(msg.id);
        }
      }
    });
  }

  request(method: string, params?: unknown): Promise<RpcResponse> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  notify(method: string): void {
    this.child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
  }

  /** tools/call devolvendo o payload JSON parseado do content[0].text. */
  async call(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const r = await this.request("tools/call", { name, arguments: args });
    const text = r.result!.content![0]!.text;
    try {
      return JSON.parse(text);
    } catch {
      return text; // sigil_docs devolve markdown
    }
  }

  close(): void {
    this.child.stdin!.end();
  }
}

describe("sigil mcp — o loop de verificação como servidor MCP", () => {
  let client: McpClient;

  beforeAll(async () => {
    fs.rmSync(TMP, { recursive: true, force: true });
    expect(spawnSync(process.execPath, [BIN, "init", TMP], { encoding: "utf8" }).status).toBe(0);
    fs.writeFileSync(path.join(TMP, "src/extension.ts"), EXTENSION);
    client = new McpClient(TMP);
    const init = await client.request("initialize", { protocolVersion: "2025-03-26", capabilities: {} });
    expect(init.result?.serverInfo?.name).toBe("sigil");
    client.notify("notifications/initialized");
  }, 60000);

  afterAll(() => {
    client.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("tools/list expõe as quatro tools", async () => {
    const r = await client.request("tools/list");
    expect(r.result!.tools!.map((t) => t.name).sort()).toEqual([
      "sigil_build",
      "sigil_check",
      "sigil_docs",
      "sigil_probe",
    ]);
  });

  it("sigil_check: projeto recém-criado tem gerados stale; sigil_build resolve", async () => {
    const check = await client.call("sigil_check");
    expect(check.ok).toBe(false);
    expect(check.staleFiles.length).toBeGreaterThan(0);
    const build = await client.call("sigil_build");
    expect(build.ok).toBe(true);
    expect((await client.call("sigil_check")).ok).toBe(true);
  }, 60000);

  it("sigil_probe: primeiro probe ativa o simulador e executa o comando", async () => {
    const r = await client.call("sigil_probe", { kind: "command", id: "mcplab.ping" });
    expect(r.ok).toBe(true);
    expect(r.rebuilt).toBe(true);
    expect(r.logs.join("\n")).toContain("pong v1");
    // sem edição, o probe seguinte NÃO rebuilda
    const r2 = await client.call("sigil_probe", { kind: "command", id: "mcplab.ping" });
    expect(r2.rebuilt).toBe(false);
  }, 120000);

  it("sigil_probe: invokeTool exercita a @LmTool sem Copilot", async () => {
    const r = await client.call("sigil_probe", { kind: "invokeTool", name: "mcplab_somar", input: { a: 2, b: 3 } });
    expect(r.ok).toBe(true);
    expect(r.result).toBe("5");
  }, 60000);

  it("editar o código → probe rebuilda e reativa SOZINHO (a tese do servidor)", async () => {
    fs.writeFileSync(path.join(TMP, "src/extension.ts"), EXTENSION.replace("pong v1", "pong v2"));
    const r = await client.call("sigil_probe", { kind: "command", id: "mcplab.ping" });
    expect(r.ok).toBe(true);
    expect(r.rebuilt).toBe(true);
    expect(r.logs.join("\n")).toContain("pong v2");
  }, 120000);

  it("sigil_check devolve diagnóstico ESTRUTURADO (code/file/line) para erro de when", async () => {
    fs.writeFileSync(
      path.join(TMP, "src/extension.ts"),
      EXTENSION.replace('@Command({ title: "Ping" })', '@Command({ title: "Ping", enablement: "mcplab.naoExiste" })')
    );
    const check = await client.call("sigil_check");
    expect(check.ok).toBe(false);
    const diag = check.diagnostics.find((d: { code: number }) => d.code === 1018);
    expect(diag.file).toContain("extension.ts");
    expect(diag.line).toBeGreaterThan(0);
    // restaura para os próximos
    fs.writeFileSync(path.join(TMP, "src/extension.ts"), EXTENSION);
  }, 60000);

  it("sigil_docs busca na referência de página única", async () => {
    const doc = await client.call("sigil_docs", { query: "LmTool inputSchema" });
    expect(String(doc)).toContain("inputSchema");
    expect(String(doc)).toContain("DERIVADO");
  });

  it("método desconhecido → erro JSON-RPC; tool desconhecida → -32602", async () => {
    const bad = await client.request("nao/existe");
    expect(bad.error?.code).toBe(-32601);
    const badTool = await client.request("tools/call", { name: "sigil_nada", arguments: {} });
    expect(badTool.error?.code).toBe(-32602);
  });
});
