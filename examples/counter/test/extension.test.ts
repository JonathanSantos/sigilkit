import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { activateExtension, SigilTestHost } from "@sigil/test";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("counter — o menor sigil possível", () => {
  let host: SigilTestHost;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    host = await activateExtension({ projectDir });
  });

  afterAll(async () => {
    await host.dispose();
    logSpy.mockRestore();
  });

  it("manifesto derivado: enum de união, min/max e keybinding com mac", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
    const props = pkg.contributes.configuration.properties;
    expect(props["counter.mode"].enum).toEqual(["silent", "verbose"]);
    expect(props["counter.step"]).toMatchObject({ type: "number", minimum: 1, maximum: 100 });
    expect(pkg.contributes.keybindings).toEqual([
      { command: "counter.increment", key: "ctrl+alt+i", mac: "cmd+alt+i" },
    ]);
  });

  it("prefix deriva do name do package.json quando @Extension() não o define", () => {
    expect(host.commands).toEqual(["counter.increment", "counter.reset"]);
  });

  it("incrementa com o step vivo da config", async () => {
    await host.executeCommand("counter.increment");
    expect(host.infoMessages.at(-1)).toBe("Counter: 1");
    host.configuration.set("counter.step", 10);
    expect(logSpy).toHaveBeenCalledWith("step: 1 → 10");
    await host.executeCommand("counter.increment");
    expect(host.infoMessages.at(-1)).toBe("Counter: 11");
  });

  it("modo silent suprime notificações", async () => {
    host.configuration.set("counter.mode", "silent");
    const before = host.infoMessages.length;
    await host.executeCommand("counter.increment");
    expect(host.infoMessages.length).toBe(before);
  });

  it("reset zera o contador e devolve o step para 1 via setConfig tipado", async () => {
    host.configuration.set("counter.mode", "verbose");
    await host.executeCommand("counter.reset");
    expect(host.infoMessages.at(-1)).toBe("Counter: 0");
    // setConfig("counter.step", 1) escreveu no workspace e disparou o @Watch
    expect(host.configuration.get("counter.step")).toBe(1);
    expect(logSpy).toHaveBeenCalledWith("step: 10 → 1");
  });
});
