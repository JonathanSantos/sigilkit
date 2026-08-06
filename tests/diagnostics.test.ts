import { describe, expect, it } from "vitest";
import path from "node:path";
import ts from "typescript";
import { collect, validate, SIGIL, IR } from "@sigilkit/compiler";

// Critério de aceite da Fase 2: cada código da §9 dispara no caso certo, com
// caret (file + start) apontando para a linha certa.

const FIXTURES = path.resolve(process.cwd(), "tests/fixtures");

function collectFixture(name: string): { ir?: IR; diags: ts.Diagnostic[] } {
  const file = path.join(FIXTURES, name);
  const program = ts.createProgram({
    rootNames: [file],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.Node16,
      moduleResolution: ts.ModuleResolutionKind.Node16,
      strict: true,
      useDefineForClassFields: true,
      skipLibCheck: true,
    },
  });
  const { ir, diagnostics } = collect(program, { defaultPrefix: "fx", projectDir: FIXTURES });
  const diags = [...diagnostics, ...(ir ? validate(ir, program, FIXTURES) : [])];
  return { ir, diags };
}

function lineOf(d: ts.Diagnostic): number | undefined {
  if (!d.file || d.start === undefined) return undefined;
  return d.file.getLineAndCharacterOfPosition(d.start).line + 1;
}

function only(diags: ts.Diagnostic[], code: number): ts.Diagnostic {
  const matches = diags.filter((d) => d.code === code);
  expect(matches, `esperava exatamente 1 diagnóstico SIGIL${code}, veio: ${diags.map((d) => d.code)}`).toHaveLength(1);
  return matches[0]!;
}

describe("diagnósticos (§9)", () => {
  it("SIGIL1001 — argumento não literal, caret no identificador", () => {
    const { diags } = collectFixture("non-literal.ts");
    expect(lineOf(only(diags, SIGIL.NotStaticLiteral))).toBe(7);
  });

  it("SIGIL1002 — id de comando duplicado, caret na segunda ocorrência", () => {
    const { diags } = collectFixture("duplicate-command.ts");
    expect(lineOf(only(diags, SIGIL.DuplicateCommandId))).toBe(9);
  });

  it("SIGIL1004 — @Watch de config inexistente", () => {
    const { diags } = collectFixture("watch-unknown.ts");
    expect(lineOf(only(diags, SIGIL.WatchUnknownConfig))).toBe(9);
  });

  it("SIGIL1005 — keybinding duplicado", () => {
    const { diags } = collectFixture("duplicate-keybinding.ts");
    expect(lineOf(only(diags, SIGIL.DuplicateKeybinding))).toBe(9);
  });

  it("SIGIL1006 — @Config sem accessor", () => {
    const { diags } = collectFixture("config-no-accessor.ts");
    expect(lineOf(only(diags, SIGIL.ConfigWithoutAccessor))).toBe(8);
  });

  it("SIGIL1007 — tipo de config não suportado, caret no tipo", () => {
    const { diags } = collectFixture("unsupported-type.ts");
    expect(lineOf(only(diags, SIGIL.UnsupportedConfigType))).toBe(6);
  });

  it("SIGIL1008 — membro decorado fora de @Extension", () => {
    const { diags } = collectFixture("decorated-outside.ts");
    expect(lineOf(only(diags, SIGIL.DecoratedOutsideExtension))).toBe(7);
  });

  it("SIGIL1009 — mais de uma classe @Extension", () => {
    const { diags } = collectFixture("two-extensions.ts");
    expect(lineOf(only(diags, SIGIL.MultipleExtensionClasses))).toBe(7);
  });

  it("SIGIL1010 — @Command sem title", () => {
    const { diags } = collectFixture("no-title.ts");
    expect(lineOf(only(diags, SIGIL.CommandWithoutTitle))).toBe(7);
  });

  it("SIGIL1012 — @TreeView sem @TreeRoot", () => {
    const { diags } = collectFixture("treeview-incomplete.ts");
    expect(lineOf(only(diags, SIGIL.TreeViewIncomplete))).toBe(7);
  });

  it("SIGIL1014 — @Config em classe @TreeView, caret no decorator", () => {
    const { diags } = collectFixture("wrong-class-member.ts");
    expect(lineOf(only(diags, SIGIL.WrongClassForMember))).toBe(18);
  });

  it("SIGIL1015 — tipo de mensagem duplicado em @OnMessage", () => {
    const { diags } = collectFixture("onmessage-dup.ts");
    expect(lineOf(only(diags, SIGIL.DuplicateMessageType))).toBe(11);
  });

  it("SIGIL1016 — @TreeView sem 'name'", () => {
    const { diags } = collectFixture("missing-option.ts");
    expect(lineOf(only(diags, SIGIL.MissingRequiredOption))).toBe(6);
  });

  it("SIGIL1017 — @StatusBar referencia comando inexistente", () => {
    const { diags } = collectFixture("statusbar-bad-command.ts");
    expect(lineOf(only(diags, SIGIL.UnknownCommandReference))).toBe(6);
  });

  it("SIGIL1018 — when com typo em @ContextKey do próprio prefixo", () => {
    const { diags } = collectFixture("when-bad-key.ts");
    expect(lineOf(only(diags, SIGIL.UnknownContextKey))).toBe(9);
  });

  it("SIGIL1018 — when de VIEW (sidebar webview) com typo de context key", () => {
    const { diags } = collectFixture("when-view-bad.ts");
    expect(lineOf(only(diags, SIGIL.UnknownContextKey))).toBe(10);
  });

  it("SIGIL1020 — %chave% sem package.nls.json e chave inexistente", () => {
    const file = path.join(FIXTURES, "nls-keys.ts");
    const program = ts.createProgram({
      rootNames: [file],
      options: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.Node16,
        moduleResolution: ts.ModuleResolutionKind.Node16,
        strict: true,
        useDefineForClassFields: true,
        skipLibCheck: true,
      },
    });
    const { ir } = collect(program, { defaultPrefix: "fx", projectDir: FIXTURES });
    // sem package.nls.json no projeto → toda %chave% é erro
    const semArquivo = validate(ir!, program, FIXTURES, { nlsKeys: null });
    expect(semArquivo.filter((d) => d.code === SIGIL.UnknownNlsKey)).toHaveLength(2);
    // com o arquivo mas faltando uma chave → só a faltante é erro, com caret
    const faltando = validate(ir!, program, FIXTURES, { nlsKeys: ["fx.title"] });
    expect(lineOf(only(faltando, SIGIL.UnknownNlsKey))).toBe(6); // a @Config da %fx.desc%
    // com todas as chaves → limpo
    expect(validate(ir!, program, FIXTURES, { nlsKeys: ["fx.title", "fx.desc"] })).toEqual([]);
  });

  it("SIGIL1021 — input de @LmTool que o schema não deriva", () => {
    const { diags } = collectFixture("lmtool-bad-input.ts");
    expect(lineOf(only(diags, SIGIL.UnsupportedToolInput))).toBe(6);
  });

  it("SIGIL1019 — when com sintaxe inválida", () => {
    const { diags } = collectFixture("when-bad-syntax.ts");
    expect(lineOf(only(diags, SIGIL.InvalidWhenExpression))).toBe(9);
  });
});

describe("avaliador estático seguindo consts (item 8)", () => {
  it("resolve identificadores para const de literal — inclusive objetos e `as const`", () => {
    const { ir, diags } = collectFixture("const-options.ts");
    expect(diags).toEqual([]);
    expect(ir!.commands.map((c) => c.title)).toEqual(["From Const", "Object Const"]);
    expect(ir!.commands[1]!.category).toBe("Fx");
    expect(ir!.configs[0]).toMatchObject({ id: "fx.greeting", default: "hi" });
  });

  it("`let` continua sendo rejeitado (SIGIL1001)", () => {
    const { diags } = collectFixture("non-literal.ts");
    expect(diags.some((d) => d.code === SIGIL.NotStaticLiteral)).toBe(true);
  });
});

describe("inferência de schema (§8.3)", () => {
  const { ir, diags } = collectFixture("union-and-array.ts");

  it("coleta sem erros", () => {
    expect(diags).toEqual([]);
  });

  it("união de literais string → enum; array → items; sem anotação → infere do default", () => {
    expect(ir!.configs.map((c) => c.id)).toEqual(["fx.enabled", "fx.legacy", "fx.mode", "fx.tags"]);
    const [enabled, legacy, mode, tags] = ir!.configs;
    expect(enabled).toMatchObject({ jsonType: "boolean", default: true });
    expect(legacy).toMatchObject({ deprecationMessage: "use mode" });
    expect(mode).toMatchObject({
      jsonType: "string",
      enum: ["fast", "slow"],
      tsType: '"fast" | "slow"',
      default: "fast",
    });
    expect(tags).toMatchObject({ jsonType: "array", items: { type: "string" }, default: ["a", "b"] });
  });

  it("snapshot do IR", () => {
    expect(ir).toMatchSnapshot();
  });
});
