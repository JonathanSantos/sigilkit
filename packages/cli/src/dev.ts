import fs from "node:fs";
import path from "node:path";
import { computeProject, reportFailure, summaryOf, writeChanged, writeStoredHash } from "./pipeline";

/**
 * Watch mode. Recompila a cada mudança relevante; se o hash do IR não mudou
 * (ex.: edição só no corpo de um método), não reemite nada (§7).
 *
 * Anti-loop: os próprios outputs disparam eventos do watcher — .generated/ é
 * filtrado por caminho e o package.json por janela de tempo pós-escrita; além
 * disso writeChanged não toca arquivos idênticos, então o ciclo converge.
 */
export function runDev(projectDir: string): number {
  let lastHash: string | undefined;
  let building = false;
  let pending = false;
  let timer: NodeJS.Timeout | undefined;
  const selfWrites = new Map<string, number>();

  const rebuild = (reason: string): void => {
    if (building) {
      pending = true;
      return;
    }
    building = true;
    const started = Date.now();
    try {
      const result = computeProject(projectDir);
      if (!result.ok) {
        reportFailure(result);
        console.error(`sigil dev: build com erros (${reason}) — aguardando mudanças…`);
        lastHash = undefined;
      } else if (result.hash === lastHash) {
        console.log(`sigil dev: IR inalterado (${reason}, ${Date.now() - started}ms) — nada a reemitir`);
      } else {
        const written = writeChanged(result.files);
        for (const f of result.files) selfWrites.set(f.path, Date.now());
        writeStoredHash(projectDir, result.hash);
        lastHash = result.hash;
        console.log(
          `sigil dev: ${summaryOf(result.ir)} (${reason}, ${Date.now() - started}ms)` +
            (written.length > 0 ? ` → ${written.join(", ")}` : " — nada mudou nos outputs")
        );
      }
    } catch (e) {
      console.error(`sigil dev: erro inesperado: ${(e as Error).stack ?? String(e)}`);
    } finally {
      building = false;
      if (pending) {
        pending = false;
        rebuild("mudanças acumuladas");
      }
    }
  };

  const relevant = (rel: string): boolean => {
    const p = rel.split(path.sep).join("/");
    if (p.startsWith("node_modules/") || p.startsWith("out/") || p.startsWith(".git/")) return false;
    if (p.includes(".generated/")) return false;
    return p.endsWith(".ts") || p === "package.json" || p === "tsconfig.json";
  };

  rebuild("inicial");
  fs.watch(projectDir, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const rel = String(filename);
    if (!relevant(rel)) return;
    const wrote = selfWrites.get(path.join(projectDir, rel));
    if (wrote !== undefined && Date.now() - wrote < 1000) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => rebuild(rel), 200);
  });
  console.log(`sigil dev: observando ${projectDir} (Ctrl+C para sair)`);
  return 0;
}
