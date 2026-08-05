import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// E2E do `sigil init`: cria o projeto num diretório dentro do repo (para
// @sigilkit/core resolver via node_modules da raiz) e roda `sigil build` nele.

const ROOT = process.cwd();
const BIN = path.join(ROOT, "packages/cli/bin/sigil.js");
const TMP = path.join(ROOT, "tests/.tmp/init-target");

function sigil(cmd: string): { status: number; out: string } {
  const r = spawnSync(process.execPath, [BIN, cmd, TMP], { encoding: "utf8" });
  return { status: r.status ?? -1, out: `${r.stdout}\n${r.stderr}` };
}

beforeAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("sigil init", () => {
  it("cria o template completo", () => {
    const { status } = sigil("init");
    expect(status).toBe(0);
    for (const rel of [
      "package.json",
      "tsconfig.json",
      "src/extension.ts",
      ".vscode/launch.json",
      ".vscodeignore",
      ".gitignore",
      "README.md",
    ]) {
      expect(fs.existsSync(path.join(TMP, rel)), rel).toBe(true);
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(TMP, "package.json"), "utf8"));
    expect(pkg.name).toBe("init-target");
    expect(pkg.engines.vscode).toBe("^1.75.0");
    // --keep-names deixou de ser necessário: o join usa Symbol.metadata,
    // não nomes de função em runtime (item 9 do roadmap)
    expect(pkg.scripts.bundle).not.toContain("--keep-names");
    expect(pkg.scripts.bundle).toContain("--target=es2022");
    const tsconfig = JSON.parse(fs.readFileSync(path.join(TMP, "tsconfig.json"), "utf8"));
    expect(tsconfig.compilerOptions.experimentalDecorators).toBe(false);
    expect(tsconfig.compilerOptions.useDefineForClassFields).toBe(true);
  });

  it("o projeto gerado compila com sigil build de primeira", () => {
    const { status, out } = sigil("build");
    expect(status, out).toBe(0);
    const pkg = JSON.parse(fs.readFileSync(path.join(TMP, "package.json"), "utf8"));
    // prefix default = name do package.json (classe usa @Extension() sem prefix)
    expect(pkg.contributes.commands).toEqual([{ command: "init-target.hello", title: "Hello" }]);
    expect(pkg.contributes.configuration.properties["init-target.greeting"].default).toBe("Olá");
    expect(fs.existsSync(path.join(TMP, "src/.generated/wire.ts"))).toBe(true);
  });

  it("recusa rodar sobre projeto existente sem escrever nada", () => {
    const stamp = fs.readFileSync(path.join(TMP, "src/extension.ts"), "utf8");
    const { status, out } = sigil("init");
    expect(status).toBe(1);
    expect(out).toContain("já existem");
    expect(fs.readFileSync(path.join(TMP, "src/extension.ts"), "utf8")).toBe(stamp);
  });
});
