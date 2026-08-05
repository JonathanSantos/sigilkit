import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { activateExtension, SigilTestHost } from "@sigil/test";
import { buildSnapshot } from "@sigil/cli/dist/sim-ui";

// O snapshot é o contrato entre o simulador e o workbench visual (sim --ui):
// tudo que a página renderiza sai daqui.

const helloDir = path.resolve(process.cwd(), "examples/hello");
const todosDir = path.resolve(process.cwd(), "examples/todos");

describe("sim --ui — snapshot do workbench", () => {
  let host: SigilTestHost;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    host = await activateExtension({ projectDir: helloDir });
  });

  afterAll(async () => {
    await host.dispose();
    logSpy.mockRestore();
  });

  it("serializa palette com títulos do manifesto, configs com valores e status bar", async () => {
    const snap = (await buildSnapshot(host, helloDir, null)) as Record<string, any>;
    expect(snap.project.displayName).toBe("Hello (exemplo sigil)");
    expect(snap.commands).toContainEqual({ id: "hello.sayHello", title: "Say hello" });
    const greeting = snap.config.find((c: { id: string }) => c.id === "hello.greeting");
    expect(greeting).toMatchObject({ type: "string", value: "Olá", default: "Olá" });
    expect(snap.statusBar[0].text).toBe("$(megaphone) Olá");
  });

  it("serializa a tree recursivamente com labels e colapsáveis", async () => {
    const snap = (await buildSnapshot(host, helloDir, null)) as Record<string, any>;
    const tasks = snap.trees.find((t: { viewId: string }) => t.viewId === "hello.tasks");
    expect(tasks.name).toBe("Tasks");
    expect(tasks.nodes.map((n: { label: string }) => n.label)).toEqual(["Build", "Testes"]);
    expect(tasks.nodes[0].collapsible).toBe(true);
    expect(tasks.nodes[0].children.map((n: { label: string }) => n.label)).toEqual(["Compilar", "Bundle"]);
  });

  it("inclui webviews abertas com html e mensagens postadas", async () => {
    await host.executeCommand("hello.openSettings");
    const panel = host.panel("hello.settings");
    panel.receive({ type: "reset" });
    const snap = (await buildSnapshot(host, helloDir, null)) as Record<string, any>;
    const wv = snap.webviews.find((w: { key: string }) => w.key === "hello.settings");
    expect(wv.kind).toBe("panel");
    expect(wv.html).toContain("Content-Security-Policy");
    expect(wv.posted.at(-1)).toEqual({ type: "state", value: { greeting: "Olá" } });
  });

  it("logs e notificações entram no snapshot", async () => {
    await host.executeCommand("hello.sayHello");
    const snap = (await buildSnapshot(host, helloDir, null)) as Record<string, any>;
    expect(snap.notifications.info.length).toBeGreaterThan(0);
    expect(snap.logs.some((l: { message: string }) => l.message.includes("saudação"))).toBe(true);
  });
});

describe("sim --ui — input interativo", () => {
  it("showInputBox com fila vazia delega para o handler (modal da UI)", async () => {
    const host = await activateExtension({ projectDir: todosDir });
    host.onInputRequest(async (kind) => (kind === "inputBox" ? "Da UI" : undefined));
    await host.executeCommand("todos.addTodo");
    const roots = (await host.tree("todos.list").roots()) as { label: string }[];
    expect(roots.map((r) => r.label)).toContain("Da UI");
    await host.dispose();
  });
});
