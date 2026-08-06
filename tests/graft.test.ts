import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { buildSync } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { activateExtension, SigilTestHost } from "@sigilkit/test";

// MODO ENXERTO (adoção incremental): uma extensão EXISTENTE — activate manual,
// contributes à mão — adota o sigil sem reescrever nada: "sigil.graft": true,
// uma classe nova, e o activate dela chama o do wire. O merge preserva o
// manifesto manual e soma o derivado.

const ROOT = process.cwd();
const BIN = path.join(ROOT, "packages/cli/bin/sigil.js");
const TMP = path.join(ROOT, "tests/.tmp/graft-legado");

function write(rel: string, content: string): void {
  const abs = path.join(TMP, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

const PKG = {
  name: "legado",
  displayName: "Legado",
  version: "1.0.0",
  publisher: "acme",
  engines: { vscode: "^1.75.0" },
  main: "./out/extension.js",
  sigil: { graft: true },
  activationEvents: ["onStartupFinished"],
  contributes: {
    commands: [{ command: "legado.ola", title: "Olá (manual, registrado à mão)" }],
    configuration: {
      title: "Legado",
      properties: { "legado.velho": { type: "string", default: "x" } },
    },
  },
};

beforeAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  write("package.json", JSON.stringify(PKG, null, 2) + "\n");
  write(
    "tsconfig.json",
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022", module: "Node16", moduleResolution: "Node16", lib: ["ES2022"],
          strict: true, experimentalDecorators: false, useDefineForClassFields: true,
          sourceMap: false, outDir: "out", skipLibCheck: true,
        },
        include: ["src", "src/.generated/**/*"],
      },
      null,
      2
    )
  );
  // o entrypoint DELES, intocado na estrutura — só ganhou duas linhas de enxerto
  write(
    "src/main.ts",
    `import * as vscode from "vscode";
import { activate as sigilActivate, deactivate as sigilDeactivate } from "./.generated/wire";

export async function activate(ctx: vscode.ExtensionContext) {
  // ...os registerCommand históricos continuam exatamente como sempre foram...
  ctx.subscriptions.push(
    vscode.commands.registerCommand("legado.ola", () => {
      void vscode.window.showInformationMessage("olá do legado");
    })
  );
  await sigilActivate(ctx); // ← o enxerto
}

export function deactivate() {
  return sigilDeactivate();
}
`
  );
  // o primeiro comando migrado: uma classe sigil nova, e mais nada
  write(
    "src/extension.ts",
    `import * as vscode from "vscode";
import { Extension, Command } from "@sigilkit/core";

@Extension({ prefix: "legado" })
export class Enxerto {
  @Command({ id: "novo", title: "Novo (sigil)" })
  novo() {
    void vscode.window.showInformationMessage("olá do sigil");
  }
}
`
  );
});

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("modo enxerto — adoção incremental sem reescrever", () => {
  it("sigil build preserva o manifesto manual e soma o derivado", () => {
    const r = spawnSync(process.execPath, [BIN, "build", TMP], { encoding: "utf8" });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    const pkg = JSON.parse(fs.readFileSync(path.join(TMP, "package.json"), "utf8"));
    const cmds = pkg.contributes.commands as { command: string; title: string }[];
    expect(cmds.find((c) => c.command === "legado.ola")?.title).toBe("Olá (manual, registrado à mão)");
    expect(cmds.find((c) => c.command === "legado.novo")?.title).toBe("Novo (sigil)");
    // config manual intacta (o sigil não emitiu configuration nenhuma)
    expect(pkg.contributes.configuration.properties["legado.velho"].default).toBe("x");
    // activationEvents do usuário preservado
    expect(pkg.activationEvents).toContain("onStartupFinished");
  });

  it("build repetido é idempotente — nada duplica", () => {
    const antes = fs.readFileSync(path.join(TMP, "package.json"), "utf8");
    const r = spawnSync(process.execPath, [BIN, "build", TMP], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(fs.readFileSync(path.join(TMP, "package.json"), "utf8")).toBe(antes);
  });

  it("em runtime os dois mundos convivem: comando manual E comando sigil", async () => {
    buildSync({
      entryPoints: [path.join(TMP, "src/main.ts")],
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "es2022",
      external: ["vscode"],
      outfile: path.join(TMP, "out/extension.js"),
    });
    const host: SigilTestHost = await activateExtension({ projectDir: TMP });
    await host.executeCommand("legado.ola");
    expect(host.infoMessages).toContain("olá do legado");
    await host.executeCommand("legado.novo");
    expect(host.infoMessages).toContain("olá do sigil");
    await host.dispose();
  });
});
