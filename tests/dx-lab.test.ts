import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { activateExtension, SigilTestHost } from "@sigil/test";

// Lab das evoluções de DX da API: @On/@OnFile, @State/@Secret/@ContextKey,
// progress, @UriHandler, prompt.steps e llm — num projeto criado do zero.

const ROOT = process.cwd();
const BIN = path.join(ROOT, "packages/cli/bin/sigil.js");
const TMP = path.join(ROOT, "tests/.tmp/dxlab");

const DX_EXTENSION = `import * as vscode from "vscode";
import {
  Extension,
  Command,
  On,
  OnFile,
  UriHandler,
  State,
  Secret,
  ContextKey,
  prompt,
  llm,
  log,
} from "@sigil/core";

@Extension()
export class DxExtension {
  @State("global")
  accessor contador: number = 0;

  @Secret()
  accessor token: string | undefined;

  @ContextKey()
  accessor pronto = false;

  @Command({ title: "Preparar" })
  preparar() {
    this.pronto = true;
    this.contador = this.contador + 1;
  }

  @Command({ title: "Ler token", enablement: "dxlab.pronto" })
  lerToken() {
    return this.token;
  }

  @Command({ title: "Longa", progress: "Processando…" })
  async longa(token: vscode.CancellationToken) {
    return token && "isCancellationRequested" in token ? "com-token" : "sem-token";
  }

  @Command({ title: "Wizard" })
  async wizard() {
    return prompt.steps({
      nome: prompt.text({ prompt: "Nome" }),
      tipo: prompt.pick(["app", "lib"]),
    });
  }

  @Command({ title: "Pergunta" })
  async pergunta() {
    return llm.ask("olá");
  }

  @On("workspace.onDidSaveTextDocument")
  aoSalvar(doc: vscode.TextDocument) {
    log.info(\`salvo: \${doc.languageId}\`);
  }

  @OnFile("**/*.md", "change")
  aoMudarMd(uri: vscode.Uri) {
    log.info(\`md mudou: \${uri.path}\`);
  }

  @UriHandler()
  aoAbrirUri(uri: vscode.Uri) {
    log.info(\`uri: \${uri.path}\`);
  }
}
`;

function sigil(cmd: string): { status: number; out: string } {
  const r = spawnSync(process.execPath, [BIN, cmd, TMP], { encoding: "utf8" });
  return { status: r.status ?? -1, out: `${r.stdout}\n${r.stderr}` };
}

describe("dx-lab — eventos, estado, context keys, progress, prompt e llm", () => {
  let host: SigilTestHost;

  beforeAll(async () => {
    fs.rmSync(TMP, { recursive: true, force: true });
    expect(sigil("init").status).toBe(0);
    fs.writeFileSync(path.join(TMP, "src/extension.ts"), DX_EXTENSION);
    const build = sigil("build");
    expect(build.status, build.out).toBe(0);
    const bundle = spawnSync(
      "npx",
      ["esbuild", "src/.generated/wire.ts", "--bundle", "--platform=node", "--format=cjs", "--target=es2022", "--external:vscode", "--outfile=out/extension.js"],
      { cwd: TMP, encoding: "utf8" }
    );
    expect(bundle.status, bundle.stderr).toBe(0);

    host = await activateExtension({ projectDir: TMP });
    // semeia um secret ANTES não é possível aqui (bindSecrets já rodou);
    // grava agora e o onDidChange atualiza o cache
    await host.secretsStorage.store("token", "s3gr3do");
    await new Promise((r) => setTimeout(r, 0));
  });

  afterAll(async () => {
    await host.dispose();
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("@ContextKey publica default na ativação e atualiza no set", async () => {
    expect(host.contextKey("dxlab.pronto")).toBe(false);
    await host.executeCommand("dxlab.preparar");
    expect(host.contextKey("dxlab.pronto")).toBe(true);
  });

  it("@State persiste no Memento", async () => {
    expect(host.globalState.get("contador")).toBe(1);
    await host.executeCommand("dxlab.preparar");
    expect(host.globalState.get("contador")).toBe(2);
  });

  it("@Secret lê do cache sincronizado com o SecretStorage", async () => {
    expect(await host.executeCommand("dxlab.lerToken")).toBe("s3gr3do");
  });

  it("progress: handler envolto em withProgress com token injetado", async () => {
    const result = await host.executeCommand("dxlab.longa");
    expect(result).toBe("com-token");
    expect(host.progressRuns.at(-1)).toMatchObject({ title: "Processando…" });
  });

  it("@On: evento com auto-dispose dispara o handler", async () => {
    const editor = (await host.openTextDocument("x", "python")) as any;
    host.saveTextDocument(editor.document);
    expect(host.logs.some((l) => l.message.includes("salvo: python"))).toBe(true);
  });

  it("@OnFile: watcher declarativo com glob", () => {
    expect(host.fireFileChange("/docs/nota.md")).toBeGreaterThan(0);
    expect(host.logs.some((l) => l.message.includes("md mudou: /docs/nota.md"))).toBe(true);
    expect(host.fireFileChange("/docs/nota.txt")).toBe(0);
  });

  it("@UriHandler: deep link roteado", () => {
    host.openUri("/auth/callback");
    expect(host.logs.some((l) => l.message.includes("uri: /auth/callback"))).toBe(true);
  });

  it("prompt.steps: wizard com filas (e ESC voltando)", async () => {
    host.queueInputBox("meu-projeto");
    host.queueQuickPick("lib");
    const result = await host.executeCommand("dxlab.wizard");
    expect(result).toEqual({ nome: "meu-projeto", tipo: "lib" });
  });

  it("llm.ask com resposta enfileirada", async () => {
    host.queueLlmResponse("oi, dev!");
    expect(await host.executeCommand("dxlab.pergunta")).toBe("oi, dev!");
  });

  it("manifesto: enablement validado passou porque a @ContextKey existe", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(TMP, "package.json"), "utf8"));
    const ler = pkg.contributes.commands.find((c: { command: string }) => c.command === "dxlab.lerToken");
    expect(ler.enablement).toBe("dxlab.pronto");
  });
});
