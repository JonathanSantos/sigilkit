import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { computeProject, reportFailure, summaryOf, writeChanged, writeStoredHash } from "./pipeline";

/**
 * Watch mode sobre ts.createWatchProgram (item 10 do roadmap): o TS reparseia
 * só o que mudou em vez de recriar o Program inteiro a cada tecla. O cache por
 * hash de IR continua cortando a emissão; isto corta o parse.
 *
 * Anti-loop: as próprias escritas (wire/config.d.ts/package.json) disparam um
 * ciclo extra que produz o MESMO hash e não escreve nada — converge sozinho.
 */
export function runDev(projectDir: string): number {
  const configPath = ts.findConfigFile(projectDir, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) {
    console.error(`sigil: tsconfig.json não encontrado a partir de ${projectDir}`);
    return 1;
  }

  let lastHash: string | undefined;
  let currentProgram: ts.Program | undefined;

  const rebuild = (program: ts.Program | undefined, reason: string): void => {
    const started = Date.now();
    const result = computeProject(projectDir, program);
    if (!result.ok) {
      reportFailure(result);
      console.error(`sigil dev: build com erros (${reason}) — aguardando mudanças…`);
      lastHash = undefined;
      return;
    }
    if (result.hash === lastHash) {
      console.log(`sigil dev: IR inalterado (${reason}, ${Date.now() - started}ms) — nada a reemitir`);
      return;
    }
    const written = writeChanged(result.files);
    writeStoredHash(projectDir, result.hash);
    lastHash = result.hash;
    console.log(
      `sigil dev: ${summaryOf(result.ir)} (${reason}, ${Date.now() - started}ms)` +
        (written.length > 0 ? ` → ${written.join(", ")}` : " — nada mudou nos outputs")
    );
  };

  const host = ts.createWatchCompilerHost(
    configPath,
    { noEmit: true },
    ts.sys,
    ts.createSemanticDiagnosticsBuilderProgram,
    () => {}, // erros de tipo do usuário não bloqueiam o sigil (o tsc dele reporta)
    () => {} // status do watch silenciado — o log é nosso
  );
  host.afterProgramCreate = (builder) => {
    currentProgram = builder.getProgram();
    rebuild(currentProgram, "ts watch");
  };
  ts.createWatchProgram(host);

  // o prefix default vem do name do package.json — observado à parte
  const pkgPath = path.join(projectDir, "package.json");
  let timer: NodeJS.Timeout | undefined;
  if (fs.existsSync(pkgPath)) {
    fs.watch(pkgPath, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => rebuild(currentProgram, "package.json"), 200);
    });
  }

  console.log(`sigil dev: observando ${projectDir} (watch incremental do TS; Ctrl+C para sair)`);
  return 0;
}
