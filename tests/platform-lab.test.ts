import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { activateExtension, SigilTestHost } from "@sigil/test";

// Lab dos itens 2 e 3 do roadmap de superfície: @ChatParticipant e
// @CustomEditor num projeto criado do zero (init → código → build → runtime).

const ROOT = process.cwd();
const BIN = path.join(ROOT, "packages/cli/bin/sigil.js");
const TMP = path.join(ROOT, "tests/.tmp/lab");

const LAB_EXTENSION = `import { Extension, ChatParticipant, ChatRequest, CustomEditor, OnMessage, OnRequest } from "@sigil/core";
import type { SigilEditorContext } from "@sigil/core";

@Extension()
export class LabExtension {}

@ChatParticipant({ id: "guru", name: "guru", description: "Responde com sabedoria" })
export class Guru {
  @ChatRequest()
  async responder(request: { prompt: string }, _ctx: unknown, stream: { markdown(v: string): void }) {
    stream.markdown(\`Você disse: \${request.prompt}\`);
  }
}

@CustomEditor({ id: "caps", displayName: "CAPS Editor", filenamePattern: "*.caps", ui: "./ui/editor.html" })
export class CapsEditor {
  @OnMessage("gritar")
  gritar(_value: unknown, editor: SigilEditorContext) {
    void editor.applyEdit(editor.getText().toUpperCase());
  }

  @OnRequest("tamanho")
  tamanho(_value: unknown, editor: SigilEditorContext): number {
    return editor.getText().length;
  }
}
`;

const EDITOR_HTML = `<!DOCTYPE html>
<html><head><title>CAPS</title></head>
<body><button id="go">GRITAR</button>
<script>
  const vscode = acquireVsCodeApi();
  document.getElementById("go").addEventListener("click", () => vscode.postMessage({ type: "gritar" }));
</script>
</body></html>
`;

function sigil(cmd: string): { status: number; out: string } {
  const r = spawnSync(process.execPath, [BIN, cmd, TMP], { encoding: "utf8" });
  return { status: r.status ?? -1, out: `${r.stdout}\n${r.stderr}` };
}

describe("lab — @ChatParticipant e @CustomEditor", () => {
  let host: SigilTestHost;

  beforeAll(async () => {
    fs.rmSync(TMP, { recursive: true, force: true });
    expect(sigil("init").status).toBe(0);
    fs.writeFileSync(path.join(TMP, "src/extension.ts"), LAB_EXTENSION);
    fs.mkdirSync(path.join(TMP, "ui"), { recursive: true });
    fs.writeFileSync(path.join(TMP, "ui/editor.html"), EDITOR_HTML);
    const build = sigil("build");
    expect(build.status, build.out).toBe(0);
    const bundle = spawnSync(
      "npx",
      [
        "esbuild",
        "src/.generated/wire.ts",
        "--bundle",
        "--platform=node",
        "--format=cjs",
        "--target=es2022",
        "--external:vscode",
        "--outfile=out/extension.js",
      ],
      { cwd: TMP, encoding: "utf8" }
    );
    expect(bundle.status, bundle.stderr).toBe(0);
    host = await activateExtension({ projectDir: TMP });
  });

  afterAll(async () => {
    await host.dispose();
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("manifesto: chatParticipants e customEditors derivados", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(TMP, "package.json"), "utf8"));
    expect(pkg.contributes.chatParticipants).toEqual([
      { id: "lab.guru", name: "guru", description: "Responde com sabedoria" },
    ]);
    expect(pkg.contributes.customEditors).toEqual([
      {
        viewType: "lab.caps",
        displayName: "CAPS Editor",
        selector: [{ filenamePattern: "*.caps" }],
      },
    ]);
  });

  it("@ChatRequest responde pelo stream", async () => {
    const stream = await host.chatRequest("lab.guru", "olá sigil");
    expect(stream.calls).toEqual([{ kind: "markdown", value: "Você disse: olá sigil" }]);
  });

  it("@CustomEditor: documento → UI, @OnMessage com applyEdit e @OnRequest com contexto", async () => {
    const editor = (await host.openTextDocument("abc", "plaintext")) as any;
    const doc = editor.document;
    const panel = await host.openCustomEditor("lab.caps", doc);

    // estado inicial do documento postado para a UI (com shell CSP aplicado)
    expect(panel.html).toContain("Content-Security-Policy");
    expect(panel.posted.at(-1)).toMatchObject({ type: "__sigilDocument", value: { text: "abc" } });

    // @OnMessage recebe o contexto do editor e aplica edit no documento real
    panel.receive({ type: "gritar" });
    await new Promise((r) => setTimeout(r, 0));
    expect(doc.getText()).toBe("ABC");
    // a mudança volta para a UI
    expect(panel.posted.at(-1)).toMatchObject({ type: "__sigilDocument", value: { text: "ABC" } });

    // @OnRequest com correlação e contexto
    panel.receive({ type: "tamanho", __sigilRpcId: 7 });
    await new Promise((r) => setTimeout(r, 0));
    expect(panel.posted.at(-1)).toEqual({ type: "__sigilRpcResult", id: 7, ok: true, value: 3 });
  });
});
