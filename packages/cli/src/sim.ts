import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import ts from "typescript";
import { buildSync } from "esbuild";
import { activateExtension, SigilTestHost } from "@sigilkit/test";
import { computeProject, reportFailure, writeChanged, writeStoredHash } from "./pipeline";
import { startSimUi, SimUiHandle } from "./sim-ui";
import { spawnUiDev, watchUiDirs } from "./ui-dev";

export interface SimOptions {
  /** sobe o workbench visual em http://127.0.0.1:<port> */
  ui?: boolean;
  port?: number;
}

/**
 * Hot reload da extensão em modo dev SIMULADO: watch incremental do TS →
 * re-bundle → re-ativação no simulador @sigilkit/test, preservando as configs
 * entre reloads. O REPL deixa exercitar a extensão sem abrir o VSCode —
 * e com --ui, um workbench fake no browser renderiza o estado ao vivo
 * (palette, trees, configs, status bar, logs e webviews DE VERDADE).
 */
export function runSim(projectDir: string, options: SimOptions = {}): number {
  const configPath = ts.findConfigFile(projectDir, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) {
    console.error(`sigil: tsconfig.json não encontrado a partir de ${projectDir}`);
    return 1;
  }

  const bundlePath = path.join(projectDir, "out", "sigil-sim.js");
  let host: SigilTestHost | undefined;
  let ui: SimUiHandle | undefined;
  let carriedConfig: Record<string, unknown> = {};
  let lastCounts = { info: 0, warn: 0, error: 0, logs: 0 };
  let lastHash: string | undefined;
  let reloadTimer: NodeJS.Timeout | undefined;
  let stopUiWatch: (() => void) | undefined;
  let uiDirsAtuais = "";
  const uiDev = spawnUiDev(projectDir);

  // hot reload de UI: bundle/HTML/CSS mudou → re-preenche os painéis abertos
  // no host simulado (o handshake da UI, ex. ready→init, se repete)
  const refreshUi = (): void => {
    const mod = host?.module as { __sigilRefreshWebviews?: () => void } | undefined;
    mod?.__sigilRefreshWebviews?.();
    ui?.notifyChange();
    console.log("sim: 🎨 UI recarregada");
    if (replOpen) rl.prompt();
  };

  const printNewMessages = (): void => {
    if (!host) return;
    for (const m of host.infoMessages.slice(lastCounts.info)) console.log(`  💬 info: ${m}`);
    for (const m of host.warnMessages.slice(lastCounts.warn)) console.log(`  ⚠️  warn: ${m}`);
    for (const m of host.errorMessages.slice(lastCounts.error)) console.log(`  ⛔ error: ${m}`);
    for (const l of host.logs.slice(lastCounts.logs)) console.log(`  📋 [${l.level}] ${l.message}`);
    lastCounts = {
      info: host.infoMessages.length,
      warn: host.warnMessages.length,
      error: host.errorMessages.length,
      logs: host.logs.length,
    };
  };

  const reload = async (): Promise<void> => {
    try {
      buildSync({
        entryPoints: [path.join(projectDir, "src", ".generated", "wire.ts")],
        bundle: true,
        platform: "node",
        format: "cjs",
        target: "es2022",
        external: ["vscode"],
        outfile: bundlePath,
        sourcemap: "inline",
        logLevel: "silent",
      });
    } catch (e) {
      console.error(`sim: bundle falhou — ${(e as Error).message}`);
      return;
    }
    if (host) {
      carriedConfig = host.configuration.snapshot();
      await Promise.resolve(host.dispose()).catch(() => {});
    }
    try {
      host = await activateExtension({ projectDir, bundlePath, configuration: carriedConfig });
    } catch (e) {
      console.error(`sim: ativação falhou — ${(e as Error).stack ?? String(e)}`);
      host = undefined;
      return;
    }
    lastCounts = { info: 0, warn: 0, error: 0, logs: 0 };
    const sb = host.statusBarItems.map((s) => JSON.stringify(s.text)).join(" ");
    console.log(
      `\nsim: 🔄 recarregado — comandos: ${host.commands.join(", ") || "nenhum"}${sb ? `\nsim: status bar: ${sb}` : ""}`
    );
    ui?.notifyChange();
    printNewMessages();
    if (replOpen) rl.prompt();
  };

  const scheduleReload = (): void => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => void reload(), 150);
  };

  // pipeline + watch incremental (mesma mecânica do sigil dev)
  const watchHost = ts.createWatchCompilerHost(
    configPath,
    { noEmit: true },
    ts.sys,
    ts.createSemanticDiagnosticsBuilderProgram,
    () => {},
    () => {}
  );
  watchHost.afterProgramCreate = (builder) => {
    const result = computeProject(projectDir, builder.getProgram());
    if (!result.ok) {
      reportFailure(result);
      console.error("sim: build com erros — aguardando mudanças…");
      return;
    }
    if (result.hash !== lastHash) {
      writeChanged(result.files);
      writeStoredHash(projectDir, result.hash);
      lastHash = result.hash;
    }
    // watch das pastas de ui: (recriado quando o conjunto muda)
    const uiDirs = [...result.ir.webviews, ...result.ir.customEditors].map((w) =>
      w.uiEntry.includes("/") ? w.uiEntry.slice(0, w.uiEntry.lastIndexOf("/")) : "."
    );
    const chave = uiDirs.sort().join("|");
    if (chave !== uiDirsAtuais) {
      uiDirsAtuais = chave;
      stopUiWatch?.();
      stopUiWatch = watchUiDirs(projectDir, uiDirs, refreshUi);
    }
    // qualquer mudança de código pede reload (mesmo sem mudar o IR)
    scheduleReload();
  };
  ts.createWatchProgram(watchHost);

  const HELP = `comandos do sim:
  run <id> [argJson]        executa um comando da extensão
  set <configId> <json>     simula editar Settings (dispara @Watch)
  get <configId>            lê uma config
  tree <viewId>             imprime os nós raiz da view
  msg <viewType> <json>     envia mensagem a uma webview (painel ou sidebar)
  input <texto>             enfileira resposta para o próximo showInputBox
  panels                    lista webviews vivas
  logs                      últimas entradas de log
  reload                    força reload
  help | exit`;

  let replOpen = true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "sigil> " });

  const handle = async (line: string): Promise<void> => {
    const [cmd, ...rest] = line.split(/\s+/);
    if (!cmd) return;
    if (cmd === "exit" || cmd === "quit") {
      rl.close();
      uiDev?.kill();
      process.exit(0);
    }
    if (cmd === "help") {
      console.log(HELP);
      return;
    }
    if (cmd === "reload") {
      await reload();
      return;
    }
    if (!host) {
      console.log("sim: extensão ainda não carregada — aguarde o primeiro build");
      return;
    }
    try {
      switch (cmd) {
        case "run": {
          const [id, ...argParts] = rest;
          const arg = argParts.length > 0 ? JSON.parse(argParts.join(" ")) : undefined;
          const result = await host.executeCommand(id!, ...(arg === undefined ? [] : [arg]));
          if (result !== undefined) console.log(`  ↩ ${JSON.stringify(result)}`);
          break;
        }
        case "set": {
          const [id, ...valueParts] = rest;
          host.configuration.set(id!, JSON.parse(valueParts.join(" ")));
          console.log(`  ✓ ${id} = ${valueParts.join(" ")}`);
          break;
        }
        case "get":
          console.log(`  ${JSON.stringify(host.configuration.get(rest[0]!))}`);
          break;
        case "tree": {
          const probe = host.tree(rest[0]!);
          const roots = (await probe.roots()) as Record<string, unknown>[];
          for (const node of roots) console.log(`  • ${JSON.stringify(node)}`);
          if (roots.length === 0) console.log("  (vazia)");
          break;
        }
        case "msg": {
          const [viewType, ...jsonParts] = rest;
          const message = JSON.parse(jsonParts.join(" "));
          const target =
            host.webviewPanels.find((p) => p.viewType === viewType && !p.disposed) ??
            (await host.webviewView(viewType!));
          target.receive(message);
          await new Promise((r) => setTimeout(r, 0));
          console.log(`  ⇄ postado de volta: ${JSON.stringify(target.posted.at(-1))}`);
          break;
        }
        case "input":
          host.queueInputBox(rest.join(" "));
          console.log("  ✓ resposta enfileirada");
          break;
        case "panels":
          for (const p of host.webviewPanels) {
            console.log(`  • painel ${p.viewType} (${p.disposed ? "fechado" : "vivo"})`);
          }
          break;
        case "logs":
          for (const l of host.logs.slice(-15)) console.log(`  [${l.level}] ${l.message}`);
          break;
        default:
          console.log(`sim: comando desconhecido '${cmd}' — use help`);
      }
    } catch (e) {
      console.error(`  ✗ ${(e as Error).message}`);
    }
    printNewMessages();
  };

  rl.on("line", (line) => {
    void handle(line.trim()).finally(() => {
      if (replOpen) rl.prompt();
    });
  });
  // fim do stdin (ex.: rodando em background/CI) encerra só o REPL —
  // o watch + hot reload continuam; `exit` ou Ctrl+C encerram o processo
  rl.on("close", () => {
    replOpen = false;
    console.log("sim: REPL encerrado — watch continua (Ctrl+C para sair)");
  });

  if (options.ui) {
    ui = startSimUi({ projectDir, port: options.port ?? 4400, getHost: () => host });
    console.log(`sigil sim: 🖥  workbench visual em ${ui.url}`);
  }

  console.log(`sigil sim: hot reload simulado em ${projectDir} — digite 'help'`);
  return 0;
}
