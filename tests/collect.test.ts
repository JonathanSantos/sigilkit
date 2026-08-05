import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  collect,
  createProgramFromTsconfig,
  emitManifest,
  emitWire,
  emitTypes,
} from "@sigil/compiler";

// §14 camada 1 (snapshot de IR) e camada 2 (snapshot de emitter) sobre a
// fixture real examples/hello. Requer `npm run build` antes (o script de
// teste já faz isso) — a resolução de @sigil/core precisa do dist.

const example = path.resolve(process.cwd(), "examples/hello");

function build() {
  const program = createProgramFromTsconfig(example);
  return collect(program, { defaultPrefix: "hello", projectDir: example });
}

describe("coletor sobre examples/hello", () => {
  const { ir, diagnostics } = build();

  it("coleta sem diagnósticos", () => {
    expect(diagnostics).toEqual([]);
    expect(ir).toBeDefined();
  });

  it("deriva identidade conforme §5", () => {
    expect(ir!.prefix).toBe("hello");
    expect(ir!.extensionClass).toBe("HelloExtension");
    expect(ir!.commands.map((c) => c.id)).toEqual([
      "hello.openSettings",
      "hello.refreshTasks",
      "hello.reset",
      "hello.sayHello",
    ]);
    expect(ir!.commands.map((c) => c.key)).toEqual([
      "HelloExtension.openSettings",
      "TasksView.refreshTasks",
      "HelloExtension.reset",
      "HelloExtension.sayHello",
    ]);
    expect(ir!.configs.map((c) => c.id)).toEqual(["hello.greeting", "hello.retries"]);
    expect(ir!.activateKey).toBe("HelloExtension.onActivate");
  });

  it("coleta @TreeView com as três chaves e when default em view/title (§15.1)", () => {
    expect(ir!.treeViews).toHaveLength(1);
    expect(ir!.treeViews[0]).toMatchObject({
      key: "TasksView",
      id: "hello.tasks",
      name: "Tasks",
      container: "explorer",
      rootsKey: "TasksView.roots",
      childrenKey: "TasksView.children",
      itemKey: "TasksView.render",
      sourceFile: "src/views/tasks.ts",
    });
    const refresh = ir!.commands.find((c) => c.id === "hello.refreshTasks")!;
    expect(refresh.menus).toEqual([{ menu: "view/title", when: "view == hello.tasks" }]);
  });

  it("coleta @Webview com handlers ordenados por type (§15.2)", () => {
    expect(ir!.webviews).toHaveLength(1);
    expect(ir!.webviews[0]).toMatchObject({
      key: "SettingsPanel",
      id: "hello.settings",
      title: "Hello Settings",
      uiEntry: "ui/settings.html",
      sourceFile: "src/panels/settings.ts",
      messageHandlers: [
        { type: "reset", key: "SettingsPanel.onReset" },
        { type: "save", key: "SettingsPanel.onSave" },
      ],
    });
  });

  it("lê default e schema da declaração da propriedade, não do decorator", () => {
    const greeting = ir!.configs.find((c) => c.id === "hello.greeting")!;
    expect(greeting.jsonType).toBe("string");
    expect(greeting.default).toBe("Olá");
    const retries = ir!.configs.find((c) => c.id === "hello.retries")!;
    expect(retries.jsonType).toBe("number");
    expect(retries.default).toBe(3);
    expect(retries.minimum).toBe(1);
    expect(retries.maximum).toBe(10);
  });

  it("resolve @Watch para o id completo da config", () => {
    expect(ir!.watches).toHaveLength(1);
    expect(ir!.watches[0]).toMatchObject({
      key: "HelloExtension.onGreetingChanged",
      targetConfigId: "hello.greeting",
    });
  });

  it("IR é determinístico (duas coletas idênticas)", () => {
    const second = build();
    expect(JSON.stringify(second.ir)).toBe(JSON.stringify(ir));
  });

  it("snapshot do IR", () => {
    expect(ir).toMatchSnapshot();
  });

  it("snapshot do manifesto", () => {
    expect(emitManifest(ir!)).toMatchSnapshot();
  });

  it("snapshot do wire", () => {
    expect(emitWire(ir!)).toMatchSnapshot();
  });

  it("snapshot dos tipos", () => {
    expect(emitTypes(ir!)).toMatchSnapshot();
  });
});
