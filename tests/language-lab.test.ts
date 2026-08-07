import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { activateExtension, SigilTestHost } from "@sigilkit/test";

// Lab da fornada de linguagem: @CodeAction, @Definition, @References,
// @Rename, @Formatting (string → TextEdit de range completo), @Symbols e
// @InlayHints — num projeto criado do zero.

const ROOT = process.cwd();
const BIN = path.join(ROOT, "packages/cli/bin/sigil.js");
const TMP = path.join(ROOT, "tests/.tmp/langlab");

const LANG_EXTENSION = `import {
  Extension,
  Command,
  Language,
  CodeAction,
  Definition,
  References,
  Rename,
  Formatting,
  Symbols,
  InlayHints,
  log,
} from "@sigilkit/core";

@Extension({ prefix: "langlab" })
export class LangLab {
  @Command({ title: "Ping" })
  ping() {
    log.info("pong");
  }
}

// Providers devolvem objetos estruturais — o simulador repassa como o host.
@Language({ id: "recipes" })
export class RecipesLanguage {
  @CodeAction({ kinds: ["quickfix"] })
  acoes(doc: { getText(): string }) {
    return doc.getText().includes("sal?")
      ? [{ title: "Trocar sal? por sal", kind: "quickfix" }]
      : [];
  }

  @Definition()
  definicao(doc: { uri: unknown }) {
    return { uri: doc.uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } } };
  }

  @References()
  referencias(doc: { uri: unknown }) {
    return [
      { uri: doc.uri, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } } },
      { uri: doc.uri, range: { start: { line: 2, character: 0 }, end: { line: 2, character: 3 } } },
    ];
  }

  @Rename()
  renomear(doc: { uri: { toString(): string } }, _pos: unknown, newName: string) {
    return { changes: { [doc.uri.toString()]: [{ newText: newName }] } };
  }

  // O açúcar da fornada: retorne o DOCUMENTO formatado como string e o sigil
  // constrói o TextEdit de range completo.
  @Formatting()
  formatar(doc: { getText(): string }) {
    return doc.getText().trim() + "\\n";
  }

  @Symbols()
  simbolos(doc: { getText(): string }) {
    return doc
      .getText()
      .split("\\n")
      .flatMap((linha, i) =>
        linha.trim().startsWith("# ")
          ? [{ name: linha.trim().slice(2), kind: 14, range: { start: { line: i, character: 0 }, end: { line: i, character: linha.length } } }]
          : []
      );
  }

  @InlayHints()
  dicas() {
    return [{ position: { line: 0, character: 1 }, label: ": receita" }];
  }
}
`;

function sigil(cmd: string): { status: number; out: string } {
  const r = spawnSync(process.execPath, [BIN, cmd, TMP], { encoding: "utf8" });
  return { status: r.status ?? -1, out: `${r.stdout}\n${r.stderr}` };
}

describe("language-lab — a fornada de linguagem completa", () => {
  let host: SigilTestHost;
  let doc: any;

  beforeAll(async () => {
    fs.rmSync(TMP, { recursive: true, force: true });
    expect(sigil("init").status).toBe(0);
    fs.writeFileSync(path.join(TMP, "src/extension.ts"), LANG_EXTENSION);
    const build = sigil("build");
    expect(build.status, build.out).toBe(0);
    const bundle = spawnSync(
      "npx",
      ["esbuild", "src/.generated/wire.ts", "--bundle", "--platform=node", "--format=cjs", "--target=es2022", "--external:vscode", "--outfile=out/extension.js"],
      { cwd: TMP, encoding: "utf8", shell: process.platform === "win32" }
    );
    expect(bundle.status, bundle.stderr).toBe(0);
    host = await activateExtension({ projectDir: TMP });
    const editor = (await host.openTextDocument("  # Bolo\nsal? 1\nsal? 2", "recipes")) as any;
    doc = editor.document;
  });

  afterAll(async () => {
    await host.dispose();
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("manifesto: activationEvents onLanguage derivado", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(TMP, "package.json"), "utf8"));
    expect(pkg.activationEvents).toContain("onLanguage:recipes");
  });

  it("@CodeAction responde com as ações (e só quando aplicável)", async () => {
    const acoes = (await host.provideCodeActions(doc)) as { title: string }[];
    expect(acoes[0]!.title).toBe("Trocar sal? por sal");
  });

  it("@Definition e @References repassam locations", async () => {
    const def = (await host.provideDefinition(doc, { line: 1, character: 0 })) as { range: { end: { character: number } } };
    expect(def.range.end.character).toBe(5);
    const refs = (await host.provideReferences(doc, { line: 1, character: 0 })) as unknown[];
    expect(refs).toHaveLength(2);
  });

  it("@Rename devolve o WorkspaceEdit com o nome novo", async () => {
    const edit = (await host.provideRenameEdits(doc, { line: 0, character: 2 }, "acucar")) as {
      changes: Record<string, { newText: string }[]>;
    };
    expect(Object.values(edit.changes)[0]![0]!.newText).toBe("acucar");
  });

  it("@Formatting: string do handler vira TextEdit de range COMPLETO", async () => {
    const edits = (await host.provideFormattingEdits(doc)) as { range: { start: { line: number } }; newText: string }[];
    expect(edits).toHaveLength(1);
    expect(edits[0]!.newText).toBe("# Bolo\nsal? 1\nsal? 2\n");
    expect(edits[0]!.range.start.line).toBe(0);
  });

  it("@Symbols e @InlayHints respondem", async () => {
    const symbols = (await host.provideDocumentSymbols(doc)) as { name: string }[];
    expect(symbols.map((s) => s.name)).toEqual(["Bolo"]);
    const hints = (await host.provideInlayHints(doc)) as { label: string }[];
    expect(hints[0]!.label).toBe(": receita");
  });
});
