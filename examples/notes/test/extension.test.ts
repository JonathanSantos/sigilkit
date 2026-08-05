import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { activateExtension, SigilTestHost } from "@sigil/test";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("notes — webview de SIDEBAR com assets e config", () => {
  let host: SigilTestHost;

  beforeAll(async () => {
    host = await activateExtension({ projectDir });
    // open() de sidebar = focar a view → o VSCode resolve no primeiro show
    await host.executeCommand("notes.open");
  });

  afterAll(async () => {
    await host.dispose();
  });

  it("manifesto: a view entra em contributes.views com type webview", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
    expect(pkg.contributes.views.explorer).toEqual([
      { id: "notes.panel", name: "Notes", type: "webview" },
    ]);
  });

  it("shell: CSP + nonce e o css externo reescrito via asWebviewUri", async () => {
    const view = await host.webviewView("notes.panel");
    expect(view.html).toMatch(/Content-Security-Policy/);
    expect(view.html).toMatch(/<script nonce="/);
    expect(view.html).toContain('href="sigil-webview://');
    expect(view.html).not.toContain('href="notes.css"');
  });

  it("add/remove com estado no host e resposta tipada", async () => {
    const view = await host.webviewView("notes.panel");
    view.receive({ type: "add", value: "primeira" });
    expect(view.posted.at(-1)).toEqual({ type: "state", value: [{ id: 1, text: "primeira" }] });
    view.receive({ type: "add", value: "segunda" });
    view.receive({ type: "remove", value: 1 });
    expect(view.posted.at(-1)).toEqual({ type: "state", value: [{ id: 2, text: "segunda" }] });
  });

  it("limite vindo da config produz mensagem de erro tipada", async () => {
    host.configuration.set("notes.maxNotes", 1);
    const view = await host.webviewView("notes.panel");
    view.receive({ type: "add", value: "terceira" });
    expect(view.posted.at(-1)).toEqual({ type: "error", value: "limite de 1 notas atingido" });
  });

  it("@OnRequest: callHost recebe o retorno do handler com correlação", async () => {
    const view = await host.webviewView("notes.panel");
    view.receive({ type: "count", __sigilRpcId: 42 });
    await new Promise((r) => setTimeout(r, 0));
    expect(view.posted.at(-1)).toEqual({ type: "__sigilRpcResult", id: 42, ok: true, value: 1 });
  });

  it("@OnRequest de tipo desconhecido responde erro em vez de silêncio (R6)", async () => {
    const view = await host.webviewView("notes.panel");
    view.receive({ type: "inexistente", __sigilRpcId: 43 });
    await new Promise((r) => setTimeout(r, 0));
    expect(view.posted.at(-1)).toMatchObject({ type: "__sigilRpcResult", id: 43, ok: false });
  });

  it("estado sobrevive a fechar e reabrir a view", async () => {
    (await host.webviewView("notes.panel")).dispose();
    await host.executeCommand("notes.open");
    const reopened = await host.webviewView("notes.panel");
    reopened.receive({ type: "remove", value: 999 }); // no-op: só reposta o estado atual
    expect(reopened.posted.at(-1)).toEqual({ type: "state", value: [{ id: 2, text: "segunda" }] });
  });
});
