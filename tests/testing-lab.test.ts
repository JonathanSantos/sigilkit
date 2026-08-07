import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { activateExtension, SigilTestHost } from "@sigilkit/test";

// Lab da Testing API declarativa: @TestController + @TestDiscover (nós
// simples → TestItems) + @TestRun (outcome por folha) — projeto do zero.

const ROOT = process.cwd();
const BIN = path.join(ROOT, "packages/cli/bin/sigil.js");
const TMP = path.join(ROOT, "tests/.tmp/testlab");

const TEST_EXTENSION = `import { Extension, Command, TestController, TestDiscover, TestRun, log } from "@sigilkit/core";
import type { TestNode, TestOutcome } from "@sigilkit/core";

@Extension({ prefix: "testlab" })
export class TestLab {
  @Command({ title: "Ping" })
  ping() {
    log.info("pong");
  }
}

@TestController({ label: "Receitas" })
export class RecipeTests {
  descobertas = 0;

  @TestDiscover()
  discover(): TestNode[] {
    this.descobertas++;
    return [
      {
        id: "bolos",
        label: "Bolos",
        children: [
          { id: "bolos/cenoura", label: "bolo de cenoura assa" },
          { id: "bolos/fuba", label: "bolo de fubá assa" },
        ],
      },
      { id: "pao", label: "pão cresce" },
    ];
  }

  @TestRun()
  run(test: { id: string }): TestOutcome {
    if (test.id === "bolos/fuba") return { passed: false, message: "faltou fermento" };
    if (test.id === "pao") throw new Error("forno frio");
    return true;
  }
}
`;

function sigil(cmd: string): { status: number; out: string } {
  const r = spawnSync(process.execPath, [BIN, cmd, TMP], { encoding: "utf8" });
  return { status: r.status ?? -1, out: `${r.stdout}\n${r.stderr}` };
}

describe("testing-lab — @TestController declarativo", () => {
  let host: SigilTestHost;

  beforeAll(async () => {
    fs.rmSync(TMP, { recursive: true, force: true });
    expect(sigil("init").status).toBe(0);
    fs.writeFileSync(path.join(TMP, "src/extension.ts"), TEST_EXTENSION);
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

  it("manifesto: onStartupFinished para o Test Explorer enxergar o controller", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(TMP, "package.json"), "utf8"));
    expect(pkg.activationEvents).toContain("onStartupFinished");
  });

  it("@TestDiscover: a árvore vira TestItems (grupos e folhas)", async () => {
    const items = await host.testItems("testlab.recipeTests");
    expect(items.map((i) => i.id)).toEqual(["bolos", "pao"]);
    expect((items[0]!.children as { id: string }[]).map((c) => c.id)).toEqual(["bolos/cenoura", "bolos/fuba"]);
  });

  it("@TestRun: outcome por folha — passa, falha com mensagem, exceção vira falha", async () => {
    const results = await host.runTests("testlab.recipeTests");
    const byId = Object.fromEntries(results.map((r) => [r.id, r]));
    expect(byId["bolos/cenoura"]!.status).toBe("passed");
    expect(byId["bolos/fuba"]).toMatchObject({ status: "failed", message: "faltou fermento" });
    expect(byId["pao"]).toMatchObject({ status: "failed", message: "forno frio" });
  });

  it("run com include roda SÓ as folhas pedidas (grupo expande para as filhas)", async () => {
    const results = await host.runTests("testlab.recipeTests", ["bolos"]);
    expect(results.map((r) => r.id).sort()).toEqual(["bolos/cenoura", "bolos/fuba"]);
  });
});
