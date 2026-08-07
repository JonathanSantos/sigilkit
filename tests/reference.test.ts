import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SIGIL } from "@sigilkit/compiler";

// docs/reference.md é a página única para RAG/agentes — este teste a impede
// de apodrecer: toda export pública de VALOR do core e todo código SIGIL
// precisam aparecer nela (o mesmo espírito do tutorial pinado).

const ROOT = process.cwd();
const referencia = fs.readFileSync(path.join(ROOT, "docs/reference.md"), "utf8");
const coreIndex = fs.readFileSync(path.join(ROOT, "packages/core/src/index.ts"), "utf8");

// só exports de valor (export { A, B } from ...); binds/plumbing do wire ficam de fora
const PLUMBING = new Set([
  "Registry", "adoptRegistrations", "bucketOf", "renderWebviewHtml",
  "readWorkspaceConfig", "writeWorkspaceConfig", "withCommandProgress",
]);

function coreValueExports(): string[] {
  const names: string[] = [];
  for (const m of coreIndex.matchAll(/^export \{([^}]+)\}/gms)) {
    for (const raw of m[1]!.split(",")) {
      const name = raw.trim().split(/\s+as\s+/).pop()!.trim();
      if (name && !PLUMBING.has(name) && !name.startsWith("bind")) names.push(name);
    }
  }
  for (const m of coreIndex.matchAll(/^export function (\w+)/gm)) names.push(m[1]!);
  return [...new Set(names)];
}

describe("docs/reference.md — a página única não apodrece", () => {
  it("toda export pública do core aparece na referência", () => {
    const faltando = coreValueExports().filter((name) => !referencia.includes(name));
    expect(faltando, `exports do core ausentes em docs/reference.md: ${faltando.join(", ")}`).toEqual([]);
  });

  it("todo código SIGIL aparece na tabela de diagnósticos", () => {
    const codigos = Object.values(SIGIL) as number[];
    const faltando = codigos.filter((c) => !referencia.includes(`| ${c} |`));
    expect(faltando, `códigos ausentes: ${faltando.join(", ")}`).toEqual([]);
  });

  it("o llms.txt aponta para a referência e para os docs", () => {
    const llms = fs.readFileSync(path.join(ROOT, "llms.txt"), "utf8");
    for (const alvo of ["docs/reference.md", "README.md", "docs/tutorial.md", "docs/spec.md"]) {
      expect(llms).toContain(alvo);
    }
  });
});
