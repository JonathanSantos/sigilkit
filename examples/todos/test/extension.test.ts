import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { activateExtension, SigilTestHost } from "@sigil/test";
import type { Todo } from "../src/extension";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("todos — tree interativa", () => {
  let host: SigilTestHost;

  beforeAll(async () => {
    host = await activateExtension({ projectDir });
  });

  afterAll(async () => {
    await host.dispose();
  });

  it("manifesto: container inline, menus por entrada e when auto-escopado", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
    // container customizado declarado inline no @TreeView
    expect(pkg.contributes.viewsContainers).toEqual({
      activitybar: [{ id: "todos-suite", title: "Todos", icon: "media/icon.svg" }],
    });
    expect(pkg.contributes.views["todos-suite"]).toEqual([{ id: "todos.list", name: "Todos" }]);
    // título via const local (avaliador estático segue consts)
    const add = pkg.contributes.commands.find((c: { command: string }) => c.command === "todos.addTodo");
    expect(add.title).toBe("Add Todo");
    expect(pkg.contributes.menus["view/title"]).toEqual([
      { command: "todos.addTodo", when: "view == todos.list" },
    ]);
    // forma por-entrada: group definido só nesta entrada
    expect(pkg.contributes.menus["view/item/context"]).toEqual([
      { command: "todos.toggleDone", group: "inline", when: "view == todos.list" },
    ]);
  });

  it("adiciona via showInputBox e a tree reflete", async () => {
    const tree = host.tree("todos.list");
    expect(await tree.roots()).toEqual([]);
    host.queueInputBox("Comprar café", "Escrever spec");
    await host.executeCommand("todos.addTodo");
    await host.executeCommand("todos.addTodo");
    expect((await tree.roots()).map((t) => (t as Todo).label)).toEqual([
      "Comprar café",
      "Escrever spec",
    ]);
    expect(tree.refreshCount).toBe(2);
  });

  it("cancelar o input (ESC) não adiciona nada", async () => {
    await host.executeCommand("todos.addTodo"); // fila vazia = usuário cancelou
    expect(await host.tree("todos.list").roots()).toHaveLength(2);
  });

  it("toggle via menu de contexto recebe o elemento da tree como argumento", async () => {
    const tree = host.tree("todos.list");
    const [first] = await tree.roots();
    await host.executeCommand("todos.toggleDone", first);
    const item = await tree.item((await tree.roots())[0]);
    expect(item.label).toBe("✓ Comprar café");
    expect(item.contextValue).toBe("todo");
  });

  it("showCompleted=false esconde concluídos via @Watch → refresh", async () => {
    const tree = host.tree("todos.list");
    host.configuration.set("todos.showCompleted", false);
    expect(tree.refreshCount).toBe(1);
    expect((await tree.roots()).map((t) => (t as Todo).label)).toEqual(["Escrever spec"]);
  });

  it("clearCompleted remove os concluídos do estado de verdade", async () => {
    host.configuration.set("todos.showCompleted", true);
    await host.executeCommand("todos.clearCompleted");
    expect((await host.tree("todos.list").roots()).map((t) => (t as Todo).label)).toEqual([
      "Escrever spec",
    ]);
  });
});
