import path from "node:path";
import { runBuild } from "./build";
import { runCheck } from "./check";
import { runDev } from "./dev";
import { runInit } from "./init";
import { runSim } from "./sim";
import { runSandbox } from "./sandbox";

const USAGE = `sigil — framework declarativo para extensões do VSCode

Uso:
  sigil init    [dir]   cria um projeto de extensão novo (template do §16)
  sigil build   [dir]   decorators → package.json + src/.generated/
  sigil check   [dir]   falha (exit 1) se o manifesto estiver desatualizado; use no CI
  sigil dev     [dir]   watch mode — reconstrói a cada mudança
  sigil sim     [dir]   hot reload SIMULADO: recarrega no @sigil/test + REPL interativo
  sigil sandbox [dir]   VSCode REAL isolado com hot swap sem F5 (swap vs reload pelo IR)
`;

export function main(argv: string[] = process.argv.slice(2)): void {
  const [cmd, ...rest] = argv;
  const dirArg = rest.find((a) => !a.startsWith("-")) ?? ".";
  const projectDir = path.resolve(dirArg);

  switch (cmd) {
    case "init":
      process.exitCode = runInit(projectDir);
      break;
    case "build":
      process.exitCode = runBuild(projectDir);
      break;
    case "check":
      process.exitCode = runCheck(projectDir);
      break;
    case "dev":
      process.exitCode = runDev(projectDir);
      break;
    case "sim":
      process.exitCode = runSim(projectDir);
      break;
    case "sandbox":
      process.exitCode = runSandbox(projectDir);
      break;
    case undefined:
    case "--help":
    case "-h":
      console.log(USAGE);
      break;
    default:
      console.error(`sigil: comando desconhecido '${cmd}'\n\n${USAGE}`);
      process.exitCode = 1;
  }
}
