import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// E2E do CLI: critério de aceite da Fase 2 — `sigil check` falha em manifesto
// stale e volta a passar depois de `sigil build`. Roda numa cópia isolada do
// exemplo (dentro do repo, para @sigilkit/core continuar resolvível).

const ROOT = process.cwd();
const BIN = path.join(ROOT, "packages/cli/bin/sigil.js");
const TMP = path.join(ROOT, "tests/.tmp/hello-check");

function sigil(cmd: "build" | "check"): { status: number; out: string } {
  const r = spawnSync(process.execPath, [BIN, cmd, TMP], { encoding: "utf8" });
  return { status: r.status ?? -1, out: `${r.stdout}\n${r.stderr}` };
}

beforeAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const src = path.join(ROOT, "examples/hello");
  fs.copyFileSync(path.join(src, "package.json"), path.join(TMP, "package.json"));
  fs.copyFileSync(path.join(src, "tsconfig.json"), path.join(TMP, "tsconfig.json"));
  fs.cpSync(path.join(src, "src"), path.join(TMP, "src"), {
    recursive: true,
    filter: (p) => !p.includes(".generated"),
  });
  fs.cpSync(path.join(src, "ui"), path.join(TMP, "ui"), { recursive: true });
});

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("sigil check (§11)", () => {
  it("falha quando os arquivos gerados não existem", () => {
    const { status, out } = sigil("check");
    expect(status).toBe(1);
    expect(out).toContain("wire.ts");
  });

  it("passa logo depois de sigil build", () => {
    expect(sigil("build").status).toBe(0);
    const { status, out } = sigil("check");
    expect(status).toBe(0);
    expect(out).toContain("em dia");
  });

  it("falha em manifesto editado à mão e aponta o arquivo", () => {
    const pkgPath = path.join(TMP, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    pkg.contributes.commands[0].title = "Editado à mão";
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

    const { status, out } = sigil("check");
    expect(status).toBe(1);
    expect(out).toContain("package.json");
    expect(out).toContain("sigil build");
  });

  it("sigil build conserta e o check volta a passar", () => {
    expect(sigil("build").status).toBe(0);
    expect(sigil("check").status).toBe(0);
  });

  it("build repetido é idempotente e reporta cache de IR", () => {
    const { status, out } = sigil("build");
    expect(status).toBe(0);
    expect(out).toContain("tudo em dia");
    expect(out).toContain("IR inalterado");
  });
});
