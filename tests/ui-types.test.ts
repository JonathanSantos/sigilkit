import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { collect, emitUiEnv } from "@sigilkit/compiler";

// Protocolo tipado da UI: o sigil-env.d.ts gerado tipa o acquireVsCodeApi da
// pasta apontada em `ui:` E os helpers postToHost/callHost/onHostMessage (via
// augmentation de "@sigilkit/core/ui"). O negativo é o teste que importa,
// como no getConfig: uso correto compila limpo; typo é erro.

const NOTES = path.resolve(process.cwd(), "examples/notes");
// dentro do repo: a resolução de "@sigilkit/core/ui" precisa achar o
// node_modules da raiz (um tmpdir do sistema ficaria fora da árvore)
const TMP = fs.mkdtempSync(path.join(process.cwd(), "tests", ".tmp-ui-"));

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

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
function checkUiScript(source: string, ext = ".ts"): ts.Diagnostic[] {
  const file = path.join(TMP, `probe-${Math.abs(hash(source))}${ext}`);
  fs.writeFileSync(file, source);
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
  return [...ts.getPreEmitDiagnostics(program)].filter((d) => d.file?.fileName.includes("probe-"));
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

describe("protocolo tipado da UI (sigil-env.d.ts)", () => {
  it("emite um arquivo por pasta de ui, com globais e augmentation do core/ui", () => {
    const files = notesUiEnv();
    expect(files.map((f) => f.dir)).toEqual(["ui"]);
    const env = files[0]!.content;
    expect(env).toContain(`import("../src/extension")["NotesPanel"]`);
    expect(env).toContain("declare global {");
    expect(env).toContain(`declare module "@sigilkit/core/ui" {`);
    expect(env).toContain(`__SigilMsg<"add"`);
    expect(env).toContain(`__SigilReq<"count"`);
    expect(env).toContain("function acquireVsCodeApi");
    expect(env).toContain("interface SigilUiMessages");
    expect(env).toContain("interface SigilUiRequests");
    expect(env).toContain("NotesPanelHostMessage");
  });

  it("o arquivo em disco está em dia com o emitter (R5 — sigil check cobriria)", () => {
    const onDisk = fs.readFileSync(path.join(NOTES, "ui/sigil-env.d.ts"), "utf8");
    expect(onDisk).toBe(notesUiEnv()[0]!.content);
  });

  it("uso correto do acquireVsCodeApi compila limpo — value derivado do handler", () => {
    const diags = checkUiScript(`// @ts-check
      const vscode = acquireVsCodeApi();
      vscode.postMessage({ type: "add", value: "texto" });      // onAdd(text: string)
      vscode.postMessage({ type: "remove", value: 7 });         // onRemove(id: number)
      vscode.postMessage({ type: "count", __sigilRpcId: 1 });   // @OnRequest sem parâmetro
    `, ".js");
    expect(diags.map((d) => d.messageText)).toEqual([]);
  });

  it("typo no type do postMessage é erro (com sugestão do TS)", () => {
    const diags = checkUiScript(`// @ts-check
      acquireVsCodeApi().postMessage({ type: "addd", value: "x" });
    `, ".js");
    expect(diags.length).toBeGreaterThan(0);
    expect(JSON.stringify(diags.map((d) => d.messageText))).toContain("addd");
  });

  it("value com shape errado é erro — o tipo vem do parâmetro do handler", () => {
    const diags = checkUiScript(`// @ts-check
      acquireVsCodeApi().postMessage({ type: "remove", value: "não é número" });
    `, ".js");
    expect(diags.length).toBeGreaterThan(0);
  });

  it("helpers do core/ui saem tipados pela augmentation: uso correto limpo", () => {
    const diags = checkUiScript(`
      import { callHost, postToHost, onHostMessage } from "@sigilkit/core/ui";
      // retorno inferido do handler: count devolve number
      void callHost("count").then((n) => n.toFixed(2));
      postToHost({ type: "add", value: "oi" });
      onHostMessage((msg) => {
        if (msg.type === "state") msg.value.map((n) => n.text); // Note[] do post do host
      });
    `);
    expect(diags.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "))).toEqual([]);
  });

  it("typo na chave do callHost é erro de build", () => {
    const diags = checkUiScript(`
      import { callHost } from "@sigilkit/core/ui";
      void callHost("countt");
    `);
    expect(diags.length).toBeGreaterThan(0);
  });

  it("typo no postToHost tipado é erro de build", () => {
    const diags = checkUiScript(`
      import { postToHost } from "@sigilkit/core/ui";
      postToHost({ type: "addd", value: "x" });
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
    } as never);
    expect(files[0]!.content).toContain("postMessage(message: never)");
  });
});
