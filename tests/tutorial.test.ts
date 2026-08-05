import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { activateExtension, SigilTestHost } from "@sigil/test";

// Pina o docs/tutorial.md no CI: segue os passos de verdade (init → código do
// minuto 4 → build → bundle → runtime no simulador). Se este teste quebrar,
// o tutorial quebrou. MANTER O CÓDIGO ABAIXO EM SINCRONIA COM O TUTORIAL.

const ROOT = process.cwd();
const BIN = path.join(ROOT, "packages/cli/bin/sigil.js");
const TMP = path.join(ROOT, "tests/.tmp/tutorial-frases");

const TUTORIAL_EXTENSION = `import * as vscode from "vscode";
import { Extension, Command, Config, StatusBar, Watch, log } from "@sigil/core";

@Extension({ settings: true })
export class FrasesExtension {
  @Config({ description: "Frases para sortear" })
  accessor frases: string[] = [
    "Você consegue!",
    "Um passo de cada vez.",
    "Código bom é código testado.",
  ];

  @Config({ description: "Tom das frases" })
  accessor tom: "zen" | "energia" = "zen";

  @StatusBar({ alignment: "left", priority: 50, command: "frases.sortear", tooltip: "Sortear uma frase" })
  accessor humor: string = "$(sparkle) Clique para uma frase";

  @Command({
    title: "Sortear frase",
    category: "Frases",
    keybinding: { key: "ctrl+alt+f", mac: "cmd+alt+f" },
  })
  sortear() {
    const frase = this.frases[Math.floor(Math.random() * this.frases.length)]!;
    const emoji = this.tom === "energia" ? "🔥" : "🍃";
    log.info(\`sorteada: \${frase}\`);
    vscode.window.showInformationMessage(\`\${frase} \${emoji}\`);
    this.humor = \`$(sparkle) \${frase}\`;
  }

  @Watch("tom")
  aoMudarTom(novo: string) {
    log.info(\`tom mudou para \${novo}\`);
    this.humor = \`$(sparkle) tom: \${novo}\`;
  }
}
`;

function sigil(cmd: string): { status: number; out: string } {
  const r = spawnSync(process.execPath, [BIN, cmd, TMP], { encoding: "utf8" });
  return { status: r.status ?? -1, out: `${r.stdout}\n${r.stderr}` };
}

describe("tutorial — primeira extensão em 5 minutos", () => {
  let host: SigilTestHost;

  beforeAll(async () => {
    fs.rmSync(TMP, { recursive: true, force: true });
    expect(sigil("init").status).toBe(0);
    fs.writeFileSync(path.join(TMP, "src/extension.ts"), TUTORIAL_EXTENSION);
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

  it("minuto 2: o manifesto nasce do código", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(TMP, "package.json"), "utf8"));
    expect(pkg.contributes.commands.map((c: { command: string }) => c.command)).toEqual([
      "tutorial-frases.configure",
      "tutorial-frases.sortear",
    ]);
    const props = pkg.contributes.configuration.properties;
    expect(props["tutorial-frases.tom"].enum).toEqual(["zen", "energia"]);
    expect(props["tutorial-frases.frases"]).toMatchObject({ type: "array", items: { type: "string" } });
    expect(pkg.contributes.keybindings[0]).toMatchObject({ key: "ctrl+alt+f", mac: "cmd+alt+f" });
  });

  it("minuto 4: comando, status bar, watch, logs e settings app", async () => {
    expect(host.statusBarItems[0]!.text).toBe("$(sparkle) Clique para uma frase");

    await host.executeCommand("tutorial-frases.sortear");
    expect(host.infoMessages[0]!.endsWith("🍃")).toBe(true);
    expect(host.logs.some((l) => l.message.includes("sorteada"))).toBe(true);

    host.configuration.set("tutorial-frases.tom", "energia");
    expect(host.statusBarItems[0]!.text).toBe("$(sparkle) tom: energia");
    await host.executeCommand("tutorial-frases.sortear");
    expect(host.infoMessages[1]!.endsWith("🔥")).toBe(true);

    await host.executeCommand("tutorial-frases.configure");
    expect(host.panel("tutorial-frases.sigilSettings").html).toContain("tutorial-frases.tom");
  });
});
