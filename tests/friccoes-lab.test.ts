import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { activateExtension, SigilTestHost } from "@sigilkit/test";

// Lab das fricções do primeiro dogfood externo (Mockeasy): cada F do diário
// vira asserção permanente — F4 (contributes.languages está no language-lab),
// F5 (Proxy R6 + findFiles/asRelativePath/fs), F6 (sondas aceitam editor),
// F7 (getWordRangeAtPosition/MarkdownString/Range numérico + guard acusado).

const ROOT = process.cwd();
const BIN = path.join(ROOT, "packages/cli/bin/sigil.js");
const TMP = path.join(ROOT, "tests/.tmp/friclab");

const EXTENSION = `import * as vscode from "vscode";
import { Extension, Command, Activate, Language, Hover, log, prompt } from "@sigilkit/core";

@Extension({ prefix: "friclab" })
export class FricLab {
  arquivos: string[] = [];

  @Activate
  async ativar() {
    // F5: as APIs feijão-com-arroz que faltavam no mock
    const uris = (await vscode.workspace.findFiles("docs/**/*.txt")) as { fsPath: string }[];
    this.arquivos = uris.map((u) => vscode.workspace.asRelativePath(u));
    const bytes = await vscode.workspace.fs.readFile(uris[0] as never);
    log.info(\`achados: \${this.arquivos.join(", ")} | primeiro: \${new TextDecoder().decode(bytes).trim()}\`);
    log.info(\`pasta: \${vscode.workspace.workspaceFolders?.[0]?.name}\`);
    // F9: atraso REAL — sem o await do @Activate no wire, a ativação
    // "terminaria" antes desta linha e o teste veria estado pela metade
    await new Promise((r) => setTimeout(r, 30));
    log.info("ativação completa");
  }

  @Command({ title: "Ping" })
  ping() {
    log.info("pong");
  }

  // F3: pick AVULSO (await direto, sem steps) com itens ricos {label, value}
  @Command({ title: "Escolher cor" })
  async escolherCor() {
    const cor = await prompt.pick([
      { label: "Vermelho", description: "quente", value: "#f00" },
      { label: "Azul", description: "frio", value: "#00f" },
    ]);
    log.info(\`cor: \${cor ?? "cancelado"}\`);
  }
}

@Language({ id: "notas" })
export class NotasLanguage {
  // F7: o hover CANÔNICO — getWordRangeAtPosition + MarkdownString
  @Hover()
  hover(doc: vscode.TextDocument, pos: vscode.Position) {
    const range = doc.getWordRangeAtPosition(pos, /\\d{3}/);
    if (!range) return undefined;
    // F10: o caminho CANÔNICO — getText(range) fatiando de verdade
    const status = doc.getText(range);
    if (status === "500") throw new Error("hover explodiu de propósito");
    return new vscode.Hover(new vscode.MarkdownString(\`**status \${status}**\`), range);
  }
}
`;

function sigil(cmd: string): { status: number; out: string } {
  const r = spawnSync(process.execPath, [BIN, cmd, TMP], { encoding: "utf8" });
  return { status: r.status ?? -1, out: `${r.stdout}\n${r.stderr}` };
}

describe("friccoes-lab — as correções do primeiro dogfood externo", () => {
  let host: SigilTestHost;

  beforeAll(async () => {
    fs.rmSync(TMP, { recursive: true, force: true });
    expect(sigil("init").status).toBe(0);
    fs.writeFileSync(path.join(TMP, "src/extension.ts"), EXTENSION);
    fs.mkdirSync(path.join(TMP, "docs"), { recursive: true });
    fs.writeFileSync(path.join(TMP, "docs/a.txt"), "alfa\n");
    fs.writeFileSync(path.join(TMP, "docs/b.txt"), "beta\n");
    const build = sigil("build");
    expect(build.status, build.out).toBe(0);
    const bundle = spawnSync(
      "npx",
      ["esbuild", "src/.generated/wire.ts", "--bundle", "--platform=node", "--format=cjs", "--target=es2022", "--external:vscode", "--outfile=out/extension.js"],
      { cwd: TMP, encoding: "utf8", shell: process.platform === "win32" }
    );
    expect(bundle.status, bundle.stderr).toBe(0);
    host = await activateExtension({ projectDir: TMP });
  });

  afterAll(async () => {
    await host.dispose();
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("F5: findFiles + asRelativePath + workspace.fs + workspaceFolders funcionam sobre o projectDir", () => {
    expect(host.logText()).toContain("achados: docs/a.txt, docs/b.txt | primeiro: alfa");
    expect(host.logText()).toContain("pasta: friclab");
  });

  it("F9: @Activate async é AGUARDADO — a ativação só completa com o estado inteiro", () => {
    // sem await no wire, o setTimeout de 30ms ainda estaria pendente aqui
    expect(host.logText()).toContain("ativação completa");
  });

  it("F5: membro DESCONHECIDO de namespace lança o erro R6 descritivo (Proxy)", () => {
    const w = host.vscode.window as Record<string, unknown>;
    expect(() => w.createTerminal).toThrow(/'window\.createTerminal' não é simulado/);
    const ws = host.vscode.workspace as Record<string, unknown>;
    expect(() => ws.registerFileSystemProvider).toThrow(/não é simulado/);
  });

  it("F6/F7: sonda aceita o EDITOR direto; hover canônico com MarkdownString responde", async () => {
    const editor = await host.openTextDocument("veja 404 aqui", "notas");
    const hover = (await host.provideHover(editor, { line: 0, character: 6 })) as {
      contents: { value: string }[] | { value: string };
    };
    const conteudo = Array.isArray(hover.contents) ? hover.contents[0] : hover.contents;
    expect(JSON.stringify(conteudo)).toContain("status 404");
  });

  it("F7: handler que LANÇA vira erro ALTO na sonda (não undefined silencioso)", async () => {
    const editor = await host.openTextDocument("erro 500 fatal", "notas");
    await expect(host.provideHover(editor, { line: 0, character: 6 })).rejects.toThrow(
      /capturado pelo guard[\s\S]*hover explodiu de propósito/
    );
  });

  it("F3: prompt.pick avulso é aguardável e itens ricos devolvem o value", async () => {
    host.queueQuickPick("Azul");
    await host.executeCommand("friclab.escolherCor");
    expect(host.logText()).toContain("cor: #00f");
  });

  it("F7: Range aceita o overload numérico do vscode real", () => {
    const RangeClass = host.vscode.Range as new (a: number, b: number, c: number, d: number) => {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    const r = new RangeClass(1, 2, 3, 4);
    expect(r.start).toMatchObject({ line: 1, character: 2 });
    expect(r.end).toMatchObject({ line: 3, character: 4 });
  });
});
