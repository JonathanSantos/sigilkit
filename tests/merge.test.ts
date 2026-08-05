import { describe, expect, it } from "vitest";
import { mergePackageJson } from "@sigil/cli/dist/merge-pkg";

const userPkg = JSON.stringify(
  {
    name: "hello",
    version: "0.0.1",
    engines: { vscode: "^1.75.0" },
    main: "./out/extension.js",
    contributes: {
      languages: [{ id: "mylang", extensions: [".ml"] }],
      commands: [{ command: "stale.command", title: "Stale" }],
      grammars: [{ language: "mylang", scopeName: "source.ml", path: "./syntax.json" }],
    },
    scripts: { build: "sigil build" },
  },
  null,
  2
);

describe("merge do package.json (§11)", () => {
  it("substitui integralmente as chaves gerenciadas", () => {
    const out = JSON.parse(
      mergePackageJson(userPkg, { commands: [{ command: "hello.sayHello", title: "Say hello" }] })
    );
    expect(out.contributes.commands).toEqual([{ command: "hello.sayHello", title: "Say hello" }]);
  });

  it("preserva chaves não-gerenciadas dentro e fora de contributes", () => {
    const out = JSON.parse(mergePackageJson(userPkg, { commands: [{ command: "x", title: "X" }] }));
    expect(out.contributes.languages).toEqual([{ id: "mylang", extensions: [".ml"] }]);
    expect(out.contributes.grammars).toHaveLength(1);
    expect(out.scripts).toEqual({ build: "sigil build" });
    expect(out.engines).toEqual({ vscode: "^1.75.0" });
  });

  it("remove chave gerenciada quando o emitido é vazio ou ausente", () => {
    const out = JSON.parse(mergePackageJson(userPkg, { menus: {} }));
    expect(out.contributes).not.toHaveProperty("commands");
    expect(out.contributes).not.toHaveProperty("menus");
    expect(out.contributes.languages).toBeDefined();
  });

  it("cria contributes quando ausente e termina com newline", () => {
    const out = mergePackageJson(`{\n  "name": "x"\n}\n`, { commands: [{ command: "a", title: "A" }] });
    expect(out.endsWith("\n")).toBe(true);
    expect(JSON.parse(out).contributes.commands).toHaveLength(1);
  });

  it("preserva a ordem das chaves do usuário", () => {
    const out = mergePackageJson(userPkg, { commands: [{ command: "a", title: "A" }] });
    const keys = Object.keys(JSON.parse(out));
    expect(keys).toEqual(["name", "version", "engines", "main", "contributes", "scripts"]);
  });

  it("viewsContainers é condicional: preservado quando não emitido, substituído quando emitido", () => {
    const withContainers = JSON.stringify({
      name: "x",
      contributes: {
        viewsContainers: { activitybar: [{ id: "hand", title: "Hand", icon: "i.svg" }] },
      },
    });
    const kept = JSON.parse(mergePackageJson(withContainers, {}));
    expect(kept.contributes.viewsContainers.activitybar[0].id).toBe("hand");

    const replaced = JSON.parse(
      mergePackageJson(withContainers, {
        viewsContainers: { activitybar: [{ id: "gen", title: "G", icon: "g.svg" }] },
      })
    );
    expect(replaced.contributes.viewsContainers.activitybar[0].id).toBe("gen");
  });
});
