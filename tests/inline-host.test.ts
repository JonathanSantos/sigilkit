import { describe, expect, it, vi } from "vitest";
import path from "node:path";
// o wire TS entra DIRETO no vitest: "vscode" e "@sigil/core" vêm dos aliases
// do vitest.config (modo inline do item 12 — zero esbuild no ciclo de teste)
import * as wire from "../examples/hello/src/.generated/wire";
import { activateInline } from "../packages/test/src/inline";

const projectDir = path.resolve(process.cwd(), "examples/hello");

describe("modo inline — wire TS direto, sem bundle", () => {
  it("ativa, registra comandos e opera config viva", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const host = await activateInline(wire, { projectDir });

    expect(host.commands).toEqual([
      "hello.configure",
      "hello.openSettings",
      "hello.refreshTasks",
      "hello.reset",
      "hello.sayHello",
    ]);

    await host.executeCommand("hello.sayHello");
    expect(host.infoMessages.at(-1)).toBe("Olá!");
    expect(host.statusBarItems[0]!.text).toBe("$(megaphone) Olá!");

    host.configuration.set("hello.greeting", "Inline");
    expect(logSpy).toHaveBeenCalledWith("greeting: Olá → Inline");
    await host.executeCommand("hello.sayHello");
    expect(host.infoMessages.at(-1)).toBe("Inline!");

    const tree = host.tree("hello.tasks");
    expect(((await tree.roots()) as { label: string }[]).map((t) => t.label)).toEqual([
      "Build",
      "Testes",
    ]);

    await host.dispose();
    logSpy.mockRestore();
  });
});
