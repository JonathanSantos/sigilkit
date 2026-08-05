import ts from "typescript";
import path from "node:path";
import { formatDiagnostics } from "../diagnostics";

/** Cria o ts.Program a partir do tsconfig.json do projeto do usuário. */
export function createProgramFromTsconfig(projectDir: string): ts.Program {
  const configPath = ts.findConfigFile(projectDir, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) {
    throw new Error(`sigil: tsconfig.json não encontrado a partir de ${projectDir}`);
  }
  const jsonFile = ts.readJsonConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonSourceFileConfigFileContent(jsonFile, ts.sys, path.dirname(configPath));
  if (parsed.errors.length > 0) {
    throw new Error(`sigil: erro ao ler ${configPath}\n${formatDiagnostics(parsed.errors)}`);
  }
  return ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
}
