import fs from "node:fs";
import { computeProject, reportFailure } from "./pipeline";

/**
 * §11 — regenera tudo em memória e compara com o disco. Sai com 1 se divergir.
 * Vai no CI: garante que ninguém commita manifesto desatualizado. A comparação
 * é estável porque o IR é ordenado deterministicamente (§8.5).
 */
export function runCheck(projectDir: string): number {
  const result = computeProject(projectDir);
  if (!result.ok) {
    reportFailure(result);
    return 1;
  }

  const stale: string[] = [];
  for (const f of result.files) {
    const current = fs.existsSync(f.path) ? fs.readFileSync(f.path, "utf8") : undefined;
    if (current !== f.content) stale.push(f.label);
  }

  if (stale.length > 0) {
    console.error(
      `sigil check: arquivos desatualizados em relação ao código:\n` +
        stale.map((s) => `  - ${s}`).join("\n") +
        `\nRode 'sigil build'.`
    );
    return 1;
  }
  console.log("sigil check: manifesto e arquivos gerados em dia.");
  return 0;
}
