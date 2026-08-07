import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { activateExtension, SigilTestHost } from "@sigilkit/test";

// @Webview dual: UMA classe servindo painel E sidebar (o caso vscode-pets).

const ROOT = process.cwd();
const BIN = path.join(ROOT, "packages/cli/bin/sigil.js");
const TMP = path.join(ROOT, "tests/.tmp/duallab");

const DUAL_EXTENSION = `import { Extension, Command, Webview, OnMessage, OnRequest, OnOpen, registry, log } from "@sigilkit/core";

@Extension({ prefix: "dual" })
export class DualExt {
  @Command({ title: "Abrir painel" })
  abrir() {
    return registry.webviews.get("Painel")!.open();
  }
}

@Webview({ id: "bicho", title: "Bicho", ui: "./ui/index.html", location: "dual" })
export class Painel {
  aberturas = 0;

  @OnOpen
  aoAbrir() {
    this.aberturas++;
    log.info(\`aberto \${this.aberturas}x\`);
  }

  @OnRequest("estado")
  estado(): string {
    return "dormindo";
  }

  @OnMessage("cutucar")
  cutucar() {
    this.post({ type: "acordou", value: this.aberturas });
  }

  post!: (msg: { type: "acordou"; value: number }) => void;
}
`;

function sigil(cmd: string): { status: number; out: string } {
  const r = spawnSync(process.execPath, [BIN, cmd, TMP], { encoding: "utf8" });
  return { status: r.status ?? -1, out: `${r.stdout}\n${r.stderr}` };
}

describe("dual-webview — painel e sidebar na mesma classe", () => {
  let host: SigilTestHost;

  beforeAll(async () => {
    fs.rmSync(TMP, { recursive: true, force: true });
    expect(sigil("init").status).toBe(0);
    fs.writeFileSync(path.join(TMP, "src/extension.ts"), DUAL_EXTENSION);
    fs.mkdirSync(path.join(TMP, "ui"), { recursive: true });
    fs.writeFileSync(path.join(TMP, "ui/index.html"), "<html><body>bicho</body></html>");
    const build = sigil("build");
    expect(build.status, build.out).toBe(0);
    const bundle = spawnSync(
      "npx",
      ["esbuild", "src/.generated/wire.ts", "--bundle", "--platform=node", "--format=cjs", "--target=es2022", "--external:vscode", "--outfile=out/extension.js"],
      { cwd: TMP, encoding: "utf8", shell: process.platform === "win32" }
    );
    expect(bundle.status, bundle.stderr).toBe(0);
    host = await activateExtension({ projectDir: TMP });
  });

  afterAll(async () => {
    await host.dispose();
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("manifesto: a view de sidebar existe E o painel abre pela mesma classe", async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(TMP, "package.json"), "utf8"));
    const views = Object.values(pkg.contributes.views).flat() as { id: string; type?: string }[];
    expect(views.some((v) => v.id === "dual.bicho" && v.type === "webview")).toBe(true);
    await host.executeCommand("dual.abrir");
    expect(host.panel("dual.bicho")).toBeDefined();
  });

  it("as DUAS superfícies vivem juntas: post é broadcast, RPC responde a cada uma", async () => {
    const panel = host.panel("dual.bicho");
    const view = await host.webviewView("dual.bicho");
    // RPC na view responde à view
    expect(await view.request("estado")).toBe("dormindo");
    // um @OnMessage dispara post → chega nos DOIS lados
    panel.receive({ type: "cutucar" });
    await new Promise((r) => setTimeout(r, 10));
    const dele = panel.posted.filter((m) => (m as { type?: string }).type === "acordou");
    const dela = view.posted.filter((m) => (m as { type?: string }).type === "acordou");
    expect(dele.length).toBeGreaterThan(0);
    expect(dela.length).toBeGreaterThan(0);
  });

  it("@OnOpen disparou UMA vez (primeira superfície) mesmo com as duas abertas", () => {
    expect(host.logText()).toContain("aberto 1x");
    expect(host.logText()).not.toContain("aberto 2x");
  });
});
