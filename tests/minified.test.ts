import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { buildSync } from "esbuild";
import path from "node:path";
import { activateExtension, SigilTestHost } from "@sigil/test";

// A prova do item 9 (Symbol.metadata): o bundle MINIFICADO, sem --keep-names,
// ativa e funciona — a chave de registry não depende mais de nomes de função
// em runtime (armadilha da §13 do spec, que só quebrava em produção).

const projectDir = path.resolve(process.cwd(), "examples/hello");
const outfile = path.join(projectDir, "out/extension.min.js");

describe("bundle minificado sem --keep-names", () => {
  let host: SigilTestHost;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    buildSync({
      entryPoints: [path.join(projectDir, "src/.generated/wire.ts")],
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "es2022",
      external: ["vscode"],
      minify: true,
      outfile,
    });
    host = await activateExtension({ projectDir, bundlePath: outfile });
  });

  afterAll(async () => {
    await host.dispose();
    logSpy.mockRestore();
  });

  it("o join wire ↔ registry sobrevive à minificação", () => {
    expect(host.commands).toEqual([
      "hello.configure",
      "hello.openSettings",
      "hello.refreshTasks",
      "hello.reset",
      "hello.sayHello",
    ]);
  });

  it("config viva, watch e status bar funcionam minificados", async () => {
    await host.executeCommand("hello.sayHello");
    expect(host.infoMessages.at(-1)).toBe("Olá!");
    expect(host.statusBarItems[0]!.text).toBe("$(megaphone) Olá!");

    host.configuration.set("hello.greeting", "Oi");
    expect(logSpy).toHaveBeenCalledWith("greeting: Olá → Oi");
    await host.executeCommand("hello.sayHello");
    expect(host.infoMessages.at(-1)).toBe("Oi!");
  });

  it("tree e webview funcionam minificados", async () => {
    const tree = host.tree("hello.tasks");
    expect(((await tree.roots()) as { label: string }[]).map((t) => t.label)).toEqual([
      "Build",
      "Testes",
    ]);
    await host.executeCommand("hello.openSettings");
    const panel = host.panel("hello.settings");
    panel.receive({ type: "reset" });
    expect(panel.posted.at(-1)).toEqual({ type: "state", value: { greeting: "Olá" } });
  });
});
