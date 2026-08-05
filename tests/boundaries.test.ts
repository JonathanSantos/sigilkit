import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

// §2: "Adicione um teste que percorre os imports de packages/core e
// packages/compiler e falha se R1 ou R2 forem violadas."
//
// Os imports são extraídos via AST (não regex): o emitter de wire contém
// `import ... from "vscode"` DENTRO de um template string — é código emitido,
// não importado, e não pode dar falso positivo aqui.

const ROOT = process.cwd();

function tsFilesIn(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFilesIn(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function importsOf(file: string): string[] {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const specs: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specs.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      ((ts.isIdentifier(node.expression) && node.expression.text === "require") ||
        node.expression.kind === ts.SyntaxKind.ImportKeyword) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specs.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return specs;
}

describe("fronteiras de arquitetura", () => {
  it("R1 — core nunca importa typescript (nem o compiler)", () => {
    for (const file of tsFilesIn(path.join(ROOT, "packages/core/src"))) {
      for (const spec of importsOf(file)) {
        expect(spec, `${file} importa '${spec}'`).not.toBe("typescript");
        expect(spec, `${file} importa '${spec}'`).not.toMatch(/^@sigilkit\/compiler/);
      }
    }
  });

  it("core é web-ready: nenhum import de node:* (vscode.dev / --platform=browser)", () => {
    const NODE_BUILTINS = new Set(["fs", "path", "crypto", "os", "child_process", "util", "module"]);
    for (const file of tsFilesIn(path.join(ROOT, "packages/core/src"))) {
      for (const spec of importsOf(file)) {
        expect(spec, `${file} importa '${spec}'`).not.toMatch(/^node:/);
        expect(NODE_BUILTINS.has(spec), `${file} importa '${spec}'`).toBe(false);
      }
    }
  });

  it("R2 — compiler nunca importa vscode (nem o core, que importa vscode)", () => {
    for (const file of tsFilesIn(path.join(ROOT, "packages/compiler/src"))) {
      for (const spec of importsOf(file)) {
        expect(spec, `${file} importa '${spec}'`).not.toBe("vscode");
        expect(spec, `${file} importa '${spec}'`).not.toMatch(/^@sigilkit\/core/);
      }
    }
  });

  it("@sigilkit/test não importa vscode (ele O SIMULA) nem typescript", () => {
    for (const file of tsFilesIn(path.join(ROOT, "packages/test/src"))) {
      for (const spec of importsOf(file)) {
        expect(spec, `${file} importa '${spec}'`).not.toBe("vscode");
        expect(spec, `${file} importa '${spec}'`).not.toBe("typescript");
      }
    }
  });
});
