import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { activateExtension, SigilTestHost } from "@sigil/test";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("notes — webview com assets e config", () => {
  let host: SigilTestHost;

  beforeAll(async () => {
    host = await activateExtension({ projectDir });
    await host.executeCommand("notes.open");
  });

  afterAll(async () => {
    await host.dispose();
  });

  it("shell: CSP + nonce e o css externo reescrito via asWebviewUri", () => {
    const panel = host.panel("notes.panel");
    expect(panel.title).toBe("Notes");
    expect(panel.html).toMatch(/Content-Security-Policy/);
    expect(panel.html).toMatch(/<script nonce="/);
    expect(panel.html).toContain('href="sigil-webview://');
    expect(panel.html).not.toContain('href="notes.css"');
  });

  it("add/remove com estado no host e resposta tipada", () => {
    const panel = host.panel("notes.panel");
    panel.receive({ type: "add", value: "primeira" });
    expect(panel.posted.at(-1)).toEqual({ type: "state", value: [{ id: 1, text: "primeira" }] });
    panel.receive({ type: "add", value: "segunda" });
    panel.receive({ type: "remove", value: 1 });
    expect(panel.posted.at(-1)).toEqual({ type: "state", value: [{ id: 2, text: "segunda" }] });
  });

  it("limite vindo da config produz mensagem de erro tipada", () => {
    host.configuration.set("notes.maxNotes", 1);
    const panel = host.panel("notes.panel");
    panel.receive({ type: "add", value: "terceira" });
    expect(panel.posted.at(-1)).toEqual({ type: "error", value: "limite de 1 notas atingido" });
  });

  it("estado sobrevive a fechar e reabrir o painel", async () => {
    host.panel("notes.panel").dispose();
    await host.executeCommand("notes.open");
    const reopened = host.panel("notes.panel");
    reopened.receive({ type: "remove", value: 999 }); // no-op: só reposta o estado atual
    expect(reopened.posted.at(-1)).toEqual({ type: "state", value: [{ id: 2, text: "segunda" }] });
  });
});
