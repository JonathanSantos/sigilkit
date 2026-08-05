import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { collect, emitUiEnv } from "@sigilkit/compiler";

// Protocolo tipado da UI: o sigil-env.d.ts gerado tipa o acquireVsCodeApi da
// pasta apontada em `ui:`. O contrato tem dois lados: uso correto compila
// limpo, e um typo no `type` (ou um `value` com shape errado) é ERRO — o
// negativo é o teste que importa, como no getConfig.

const NOTES = path.resolve(process.cwd(), "examples/notes");

function notesUiEnv(): { dir: string; content: string }[] {
  const program = ts.createProgram({
    rootNames: [path.join(NOTES, "src/extension.ts")],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.Node16,
      moduleResolution: ts.ModuleResolutionKind.Node16,
      strict: true,
      useDefineForClassFields: true,
      skipLibCheck: true,
    },
  });
  const { ir, diagnostics } = collect(program, { defaultPrefix: "notes", projectDir: NOTES });
  expect(diagnostics).toEqual([]);
  return emitUiEnv(ir!);
}

/** Typecheck de um script de UI contra o sigil-env.d.ts REAL do notes. */
function checkUiScript(source: string): ts.Diagnostic[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sigil-ui-"));
  const file = path.join(dir, "probe.js");
  fs.writeFileSync(file, source);
  try {
    const program = ts.createProgram({
      rootNames: [
        path.join(NOTES, "ui/sigil-env.d.ts"),
        path.join(NOTES, "src/.generated/config.d.ts"), // augmentation do getConfig usado pelo host
        file,
      ],
      options: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
        allowJs: true,
        checkJs: true,
        noEmit: true,
        strict: true,
        useDefineForClassFields: true,
        skipLibCheck: true,
      },
    });
    return [...ts.getPreEmitDiagnostics(program)].filter((d) => d.file?.fileName.endsWith("probe.js"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("protocolo tipado da UI (sigil-env.d.ts)", () => {
  it("emite um arquivo por pasta de ui, com import relativo à pasta", () => {
    const files = notesUiEnv();
    expect(files.map((f) => f.dir)).toEqual(["ui"]);
    const env = files[0]!.content;
    expect(env).toContain(`import("../src/extension")["NotesPanel"]`);
    expect(env).toContain(`__SigilMsg<"add"`);
    expect(env).toContain(`__SigilMsg<"remove"`);
    expect(env).toContain(`__SigilReq<"count"`);
    expect(env).toContain("declare function acquireVsCodeApi");
    // arquivo global de propósito: sem import/export de topo (declarações ambient)
    expect(env).not.toMatch(/^import /m);
    expect(env).not.toMatch(/^export /m);
  });

  it("o arquivo em disco está em dia com o emitter (R5 — sigil check cobriria)", () => {
    const onDisk = fs.readFileSync(path.join(NOTES, "ui/sigil-env.d.ts"), "utf8");
    expect(onDisk).toBe(notesUiEnv()[0]!.content);
  });

  it("uso correto compila limpo — inclusive o shape do value derivado do handler", () => {
    const diags = checkUiScript(`// @ts-check
      const vscode = acquireVsCodeApi();
      vscode.postMessage({ type: "add", value: "texto" });      // onAdd(text: string)
      vscode.postMessage({ type: "remove", value: 7 });         // onRemove(id: number)
      vscode.postMessage({ type: "count", __sigilRpcId: 1 });   // @OnRequest sem parâmetro
    `);
    expect(diags.map((d) => d.messageText)).toEqual([]);
  });

  it("typo no type é erro (com sugestão do TS)", () => {
    const diags = checkUiScript(`// @ts-check
      acquireVsCodeApi().postMessage({ type: "addd", value: "x" });
    `);
    expect(diags.some((d) => d.code === 2820 || d.code === 2322 || d.code === 2345)).toBe(true);
    expect(JSON.stringify(diags.map((d) => d.messageText))).toContain("addd");
  });

  it("value com shape errado é erro — o tipo vem do parâmetro do handler", () => {
    const diags = checkUiScript(`// @ts-check
      acquireVsCodeApi().postMessage({ type: "remove", value: "não é número" });
    `);
    expect(diags.length).toBeGreaterThan(0);
  });

  it("webview sem handlers → postMessage(never): qualquer post é erro honesto (R6)", () => {
    const files = emitUiEnv({
      webviews: [
        {
          key: "Vazio",
          id: "x.v",
          title: "V",
          uiEntry: "ui/vazio.html",
          location: "panel",
          messageHandlers: [],
          requestHandlers: [],
          sourceFile: "src/extension.ts",
          loc: { file: "src/extension.ts", start: 0, length: 1 },
        },
      ],
      customEditors: [],
      // o emitter só olha webviews/customEditors
    } as never);
    expect(files[0]!.content).toContain("postMessage(message: never)");
  });
});
