import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { activateExtension, SigilTestHost } from "@sigil/test";

// O ambiente simulado (@sigil/test) ativando o bundle REAL de examples/hello:
// todo o ciclo comando/config/watch/tree/webview sem extension host.
// Requer o bundle construído — o script `npm test` já faz isso.

const projectDir = path.resolve(process.cwd(), "examples/hello");

describe("@sigil/test — hello no simulador", () => {
  let host: SigilTestHost;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    host = await activateExtension({ projectDir });
  });

  afterAll(async () => {
    await host.dispose();
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("join wire ↔ registry: todos os comandos do manifesto registrados", () => {
    expect(host.commands).toEqual([
      "hello.openSettings",
      "hello.refreshTasks",
      "hello.reset",
      "hello.sayHello",
    ]);
  });

  it("comando lê a config viva (default semeado do manifesto)", async () => {
    await host.executeCommand("hello.sayHello");
    expect(host.infoMessages).toEqual(["Olá!"]);
  });

  it("mudança de config (como em Settings) dispara @Watch com (next, prev)", () => {
    host.configuration.set("hello.greeting", "Oi");
    expect(logSpy).toHaveBeenCalledWith("greeting: Olá → Oi");
  });

  it("o accessor lê o valor novo — nada congelado na construção", async () => {
    await host.executeCommand("hello.sayHello");
    expect(host.infoMessages.at(-1)).toBe("Oi!");
  });

  it("set do accessor escreve no workspace e o watch dispara de volta", async () => {
    await host.executeCommand("hello.reset");
    expect(host.configuration.get("hello.greeting")).toBe("Olá");
    expect(logSpy).toHaveBeenCalledWith("greeting: Oi → Olá");
  });

  it("comando desconhecido rejeita com erro descritivo (R6)", async () => {
    await expect(host.executeCommand("hello.naoExiste")).rejects.toThrow("comando desconhecido");
  });

  it("tree: roots/children/item delegam para os handlers", async () => {
    const tree = host.tree("hello.tasks");
    const roots = await tree.roots();
    expect(roots.map((r) => (r as { label: string }).label)).toEqual(["Build", "Testes"]);
    const item = await tree.item(roots[0]);
    expect(item.label).toBe("Build");
    expect(item.collapsibleState).toBe(1); // Collapsed: tem filhos
    const children = await tree.children(roots[0]);
    expect(children.map((c) => (c as { label: string }).label)).toEqual(["Compilar", "Bundle"]);
  });

  it("comando de refresh dispara o EventEmitter da tree", async () => {
    const tree = host.tree("hello.tasks");
    await host.executeCommand("hello.refreshTasks");
    expect(tree.refreshCount).toBe(1);
  });

  it("webview: abre com CSP + nonce no HTML real lido do disco", async () => {
    await host.executeCommand("hello.openSettings");
    const panel = host.panel("hello.settings");
    expect(panel.title).toBe("Hello Settings");
    expect(panel.html).toMatch(/Content-Security-Policy/);
    expect(panel.html).toMatch(/script-src 'nonce-/);
    expect(panel.html).toMatch(/<script nonce="/);
  });

  it("roteador despacha por type e o handler responde via post injetado", () => {
    const panel = host.panel("hello.settings");
    panel.receive({ type: "save", value: { greeting: "Bom dia" } });
    expect(panel.posted.at(-1)).toEqual({ type: "state", value: { greeting: "Bom dia" } });
    panel.receive({ type: "reset" });
    expect(panel.posted.at(-1)).toEqual({ type: "state", value: { greeting: "Olá" } });
  });

  it("tipo de mensagem desconhecido vira warning, nunca silêncio (R6)", () => {
    host.panel("hello.settings").receive({ type: "inexistente" });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("inexistente"));
  });

  it("reabrir revela o painel existente em vez de duplicar", async () => {
    await host.executeCommand("hello.openSettings");
    expect(host.webviewPanels).toHaveLength(1);
    expect(host.panel("hello.settings").revealCount).toBe(1);
  });
});
