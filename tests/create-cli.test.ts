import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// create-sigil = a porta `npm create sigil`: fino, delega ao sigil init.

const ROOT = process.cwd();
const BIN = path.join(ROOT, "packages/create/bin/create-sigil.js");
const TMP = path.join(ROOT, "tests/.tmp/create-target");

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe("create-sigil", () => {
  it("com dir e template nos args, delega ao init sem perguntar nada", () => {
    fs.rmSync(TMP, { recursive: true, force: true });
    const r = spawnSync(process.execPath, [BIN, TMP, "--template=react-webview"], { encoding: "utf8" });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(fs.existsSync(path.join(TMP, "src/extension.ts"))).toBe(true);
    expect(fs.existsSync(path.join(TMP, "ui/src/main.tsx"))).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(path.join(TMP, "package.json"), "utf8"));
    expect(pkg.dependencies.react).toBeDefined();
  });
});
