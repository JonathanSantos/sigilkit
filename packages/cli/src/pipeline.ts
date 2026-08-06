import fs from "node:fs";
import path from "node:path";
import type ts from "typescript";
import {
  IR,
  collect,
  createProgramFromTsconfig,
  emitActivationEvents,
  emitManifest,
  emitUiEnv,
  emitTypes,
  emitWire,
  formatDiagnostics,
  hashIR,
  validate,
} from "@sigilkit/compiler";
import { mergePackageJson } from "./merge-pkg";

export interface OutputFile {
  /** caminho absoluto */
  path: string;
  /** caminho relativo, para logs */
  label: string;
  content: string;
}

export type PipelineResult =
  | { ok: true; ir: IR; hash: string; files: OutputFile[] }
  | { ok: false; message?: string; diagnostics?: ts.Diagnostic[] };

/**
 * O pipeline completo em memória: package.json → programa → coleta → validação
 * → emissão → merge. Nenhuma escrita acontece aqui — build/check/dev decidem o
 * que fazer com os arquivos computados (check só compara, por exemplo).
 * O dev passa um Program incremental próprio; sem ele, cria um do zero.
 */
export function computeProject(projectDir: string, existingProgram?: ts.Program): PipelineResult {
  const pkgPath = path.join(projectDir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return { ok: false, message: `sigil: package.json não encontrado em ${projectDir}` };
  }
  const pkgText = fs.readFileSync(pkgPath, "utf8");
  let defaultPrefix: string;
  let displayName: string | undefined;
  try {
    const pkg = JSON.parse(pkgText) as { name?: string; displayName?: string };
    defaultPrefix = pkg.name ?? "extension";
    displayName = pkg.displayName ?? pkg.name;
  } catch {
    return { ok: false, message: `sigil: package.json inválido em ${pkgPath}` };
  }

  let program: ts.Program;
  if (existingProgram) {
    program = existingProgram;
  } else {
    try {
      program = createProgramFromTsconfig(projectDir);
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  const { ir, diagnostics } = collect(program, { defaultPrefix, displayName, projectDir });
  // l10n: o compiler não faz IO — o CLI lê o package.nls.json e passa as chaves
  const nlsPath = path.join(projectDir, "package.nls.json");
  let nlsKeys: string[] | null = null;
  try {
    nlsKeys = Object.keys(JSON.parse(fs.readFileSync(nlsPath, "utf8")) as Record<string, string>);
  } catch {
    nlsKeys = null; // sem arquivo (ou inválido): %chaves% usadas viram SIGIL1020
  }
  const all = [...diagnostics, ...(ir ? validate(ir, program, projectDir, { nlsKeys }) : [])];
  if (all.length > 0 || !ir) {
    return { ok: false, diagnostics: all };
  }

  const genDir = path.join(projectDir, "src", ".generated");
  const files: OutputFile[] = [
    {
      path: pkgPath,
      label: "package.json",
      content: mergePackageJson(pkgText, emitManifest(ir), emitActivationEvents(ir)),
    },
    { path: path.join(genDir, "wire.ts"), label: "src/.generated/wire.ts", content: emitWire(ir) },
    { path: path.join(genDir, "config.d.ts"), label: "src/.generated/config.d.ts", content: emitTypes(ir) },
  ];
  // protocolo tipado das UIs: um sigil-env.d.ts por pasta apontada em `ui:`
  for (const f of emitUiEnv(ir)) {
    files.push({
      path: path.join(projectDir, f.dir, "sigil-env.d.ts"),
      label: path.posix.join(f.dir, "sigil-env.d.ts"),
      content: f.content,
    });
  }
  return { ok: true, ir, hash: hashIR(ir), files };
}

export function reportFailure(result: { message?: string; diagnostics?: ts.Diagnostic[] }): void {
  if (result.diagnostics && result.diagnostics.length > 0) {
    console.error(formatDiagnostics(result.diagnostics));
  }
  if (result.message) console.error(result.message);
}

/**
 * Escreve apenas os arquivos cujo conteúdo mudou (o cache incremental na
 * prática: mtimes estáveis, sem loop no watch mode). Retorna os labels escritos.
 */
export function writeChanged(files: OutputFile[]): string[] {
  const written: string[] = [];
  for (const f of files) {
    const current = fs.existsSync(f.path) ? fs.readFileSync(f.path, "utf8") : undefined;
    if (current !== f.content) {
      fs.mkdirSync(path.dirname(f.path), { recursive: true });
      fs.writeFileSync(f.path, f.content);
      written.push(f.label);
    }
  }
  return written;
}

export function hashFilePath(projectDir: string): string {
  return path.join(projectDir, "src", ".generated", ".irhash");
}

export function readStoredHash(projectDir: string): string | undefined {
  const p = hashFilePath(projectDir);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8").trim() : undefined;
}

export function writeStoredHash(projectDir: string, hash: string): void {
  const p = hashFilePath(projectDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, hash + "\n");
}

export function summaryOf(ir: IR): string {
  return `${ir.commands.length} comando(s), ${ir.configs.length} config(s), ${ir.watches.length} watch(es)`;
}
