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
      "AGENTS.md",
      "CLAUDE.md",
      ".mcp.json",
      ".vscode/mcp.json",
    ]) {
      expect(fs.existsSync(path.join(TMP, rel)), rel).toBe(true);
    }
    // o servidor MCP auto-descoberto pelos dois ecossistemas
    expect(JSON.parse(fs.readFileSync(path.join(TMP, ".mcp.json"), "utf8")).mcpServers.sigil.args).toEqual(["sigil", "mcp"]);
    expect(JSON.parse(fs.readFileSync(path.join(TMP, ".vscode/mcp.json"), "utf8")).servers.sigil.type).toBe("stdio");
    // o manual para agentes: regras de ouro + loop de verificação + o
    // CLAUDE.md importando via @ (dois ecossistemas com um arquivo)
    const agents = fs.readFileSync(path.join(TMP, "AGENTS.md"), "utf8");
    expect(agents).toContain("NUNCA edite `src/.generated/**`");
    expect(agents).toContain("activateExtension");
    expect(agents).toContain("init-target.minhaAcao");
    expect(agents).not.toContain("A UI React"); // seção só no template react
    expect(fs.readFileSync(path.join(TMP, "CLAUDE.md"), "utf8")).toContain("@AGENTS.md");
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

describe("sigil init --template react-webview", () => {
  const REACT_TMP = path.join(ROOT, "tests/.tmp/init-react");
  const react = (cmd: string) => {
    const r = spawnSync(process.execPath, [BIN, cmd, REACT_TMP, "--template=react-webview"], {
      encoding: "utf8",
    });
    return { status: r.status ?? -1, out: `${r.stdout}\n${r.stderr}` };
  };

  beforeAll(() => fs.rmSync(REACT_TMP, { recursive: true, force: true }));
  afterAll(() => fs.rmSync(REACT_TMP, { recursive: true, force: true }));

  it("scaffolda a UI React com tsconfig próprio e scripts de bundle", () => {
    expect(react("init").status).toBe(0);
    for (const rel of [
      "ui/index.html",
      "ui/src/main.tsx",
      "ui/src/App.tsx",
      "ui/src/hooks/useHost.ts",
      "ui/src/components/TaskInput.tsx",
      "ui/src/components/TaskList.tsx",
      "ui/src/styles.css",
      "ui/tsconfig.json",
    ]) {
      expect(fs.existsSync(path.join(REACT_TMP, rel)), rel).toBe(true);
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(REACT_TMP, "package.json"), "utf8"));
    expect(pkg.dependencies.react).toBeDefined();
    expect(pkg.scripts["build:ui"]).toContain("--jsx=automatic");
    expect(pkg.scripts.typecheck).toContain("tsc -p ui");
    // no template react o AGENTS.md ganha a seção do protocolo tipado da UI
    const agents = fs.readFileSync(path.join(REACT_TMP, "AGENTS.md"), "utf8");
    expect(agents).toContain("A UI React");
    expect(agents).toContain("sigil-env.d.ts");
  });

  it("sigil build gera manifesto + sigil-env.d.ts do painel", () => {
    const r = spawnSync(process.execPath, [BIN, "build", REACT_TMP], { encoding: "utf8" });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    const pkg = JSON.parse(fs.readFileSync(path.join(REACT_TMP, "package.json"), "utf8"));
    expect(pkg.contributes.commands.map((c: { command: string }) => c.command)).toContain(
      "init-react.openPanel"
    );
    const env = fs.readFileSync(path.join(REACT_TMP, "ui/sigil-env.d.ts"), "utf8");
    expect(env).toContain(`__SigilReq<"tarefas"`);
    expect(env).toContain(`__SigilMsg<"adicionar"`);
    expect(env).toContain(`__SigilMsg<"alternar"`);
    expect(env).toContain("MainPanelHostMessage");
  });

  it("template desconhecido falha alto", () => {
    const r = spawnSync(
      process.execPath,
      [BIN, "init", path.join(ROOT, "tests/.tmp/init-x"), "--template=vue"],
      { encoding: "utf8" }
    );
    expect(r.status).toBe(1);
    expect(`${r.stdout}\n${r.stderr}`).toContain("template desconhecido");
  });
});
