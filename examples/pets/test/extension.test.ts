import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { activateExtension, SigilTestHost, WebviewPanelMock } from "@sigilkit/test";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// O case: host do vscode-pets em sigil. O protocolo do app deles usa
// `command:` — o ui/boot.js adapta para {type, value}; aqui simulamos a UI
// adaptada: receive({type, value: {command, ...}}).
const daUi = (panel: WebviewPanelMock, command: string, extra: Record<string, unknown> = {}) =>
  panel.receive({ type: command, value: { command, ...extra } });

const postados = (panel: WebviewPanelMock) =>
  panel.posted.filter((m): m is { command: string } => typeof (m as { command?: unknown }).command === "string" && (m as { command: string }).command !== "tick");

describe("pets — o host do vscode-pets reescrito em sigil", () => {
  let host: SigilTestHost;
  let panel: WebviewPanelMock;

  beforeAll(async () => {
    host = await activateExtension({ projectDir });
    await host.executeCommand("vscode-pets.start");
    panel = host.panel("vscode-pets.panel");
  });

  afterAll(async () => {
    await host.dispose();
  });

  it("manifesto: os MESMOS ids públicos do upstream, derivados com @Command({id})", () => {
    for (const id of ["start", "spawn-pet", "delete-pet", "remove-all-pets", "roll-call", "throw-ball", "throw-with-mouse", "export-pet-list"]) {
      expect(host.commands).toContain(`vscode-pets.${id}`);
    }
    // e o enum do petType veio de um ALIAS derivado (keyof typeof) — a
    // inferência semântica que este case fez nascer
    expect(host.configuration.get("vscode-pets.petType")).toBe("dog");
  });

  it("handshake ready→init: o boot pede, o host manda config + repovoa os salvos", async () => {
    daUi(panel, "ready");
    await new Promise((r) => setTimeout(r, 10));
    const init = postados(panel).find((m) => m.command === "init") as { type: string; size: string };
    expect(init).toBeDefined();
    expect(init.type).toBe("dog");
    expect(init.size).toBe("nano");
    // primeira abertura: adota o bicho padrão da config e persiste
    const spawns = postados(panel).filter((m) => m.command === "spawn-pet");
    expect(spawns).toHaveLength(1);
    expect((host.globalState.get("petsSalvos") as unknown[]).length).toBe(1);
  });

  it("spawn-pet: wizard com passo dependente (cores do tipo escolhido) + persistência", async () => {
    host.queueQuickPick("fox");
    host.queueQuickPick("red");
    host.queueInputBox("Faísca");
    await host.executeCommand("vscode-pets.spawn-pet");
    const spawns = postados(panel).filter((m) => m.command === "spawn-pet") as unknown as { type: string; name: string }[];
    expect(spawns.at(-1)).toMatchObject({ type: "fox", color: "red", name: "Faísca" });
    expect((host.globalState.get("petsSalvos") as unknown[]).length).toBe(2);
  });

  it("delete-pet: pede a lista ao app, QuickPick da resposta, remove e des-persiste", async () => {
    await host.executeCommand("vscode-pets.delete-pet");
    expect(postados(panel).at(-1)).toEqual({ command: "list-pets" });
    // o app responderia com "type,name,color" por linha:
    host.queueQuickPick("Faísca (red fox)");
    daUi(panel, "list-pets", { text: "dog,Rex,brown\nfox,Faísca,red" });
    await new Promise((r) => setTimeout(r, 20));
    expect(postados(panel).at(-1)).toMatchObject({ command: "delete-pet", name: "Faísca", type: "fox" });
    expect((host.globalState.get("petsSalvos") as unknown[]).length).toBe(1);
  });

  it("toggle por comando ESCREVE a config e o @Watch notifica a UI", async () => {
    await host.executeCommand("vscode-pets.throw-with-mouse");
    expect(host.configuration.get("vscode-pets.throwBallWithMouse")).toBe(false);
    expect(postados(panel).at(-1)).toEqual({ command: "throw-with-mouse", enabled: false });
  });

  it("mudar petSize nas settings chega na UI como set-size", async () => {
    host.configuration.set("vscode-pets.petSize", "large");
    await new Promise((r) => setTimeout(r, 10));
    expect(postados(panel).at(-1)).toEqual({ command: "set-size", size: "large" });
  });

  it("export: a lista abre num editor REAL como JSON (editor.openText)", async () => {
    await host.executeCommand("vscode-pets.export-pet-list");
    await new Promise((r) => setTimeout(r, 10));
    const ed = host.activeTextEditor!;
    expect(ed.document.languageId).toBe("json");
    expect(ed.document.getText()).toContain('"name"');
  });

  it("info/error do app viram notificações", async () => {
    daUi(panel, "info", { text: "🐶 Rex diz oi" });
    await new Promise((r) => setTimeout(r, 10));
    expect(host.infoMessages).toContain("🐶 Rex diz oi");
  });

  it("remove-all zera o estado e manda reset-pet", async () => {
    await host.executeCommand("vscode-pets.remove-all-pets");
    expect((host.globalState.get("petsSalvos") as unknown[]).length).toBe(0);
    expect(postados(panel).at(-1)).toEqual({ command: "reset-pet" });
  });
});
