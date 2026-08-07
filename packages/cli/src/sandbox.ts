import { spawn } from "node:child_process";
import { spawnUiDev, watchUiDirs } from "./ui-dev";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import readline from "node:readline";
import ts from "typescript";
import { buildSync } from "esbuild";
import { computeProject, reportFailure, writeChanged, writeStoredHash } from "./pipeline";

/**
 * VSCode standalone do projeto como ambiente de dev: instância REAL e isolada
 * (user-data/extensions próprios — zero poluição do VSCode do dev), com a
 * extensão carregada e um companion conectado via socket TCP local.
 *
 * O watch decide pelo HASH DO IR:
 *   hash igual   → 🔥 hot swap: o companion re-carrega o bundle e chama
 *                  __sigilHydrate() — handlers novos por baixo dos registros
 *                  vivos, sem reload de janela (~100ms)
 *   hash mudou   → manifesto mudou → reload de janela automático (~1-2s)
 *
 * O bundle do sandbox deixa @sigilkit/core EXTERNO (resolvido do node_modules do
 * projeto): o registry é um singleton estável entre swaps — é o que permite
 * trocar o chunk sem perder os registros.
 */
export function runSandbox(projectDir: string): number {
  const configPath = ts.findConfigFile(projectDir, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) {
    console.error(`sigil: tsconfig.json não encontrado a partir de ${projectDir}`);
    return 1;
  }
  const bundlePath = path.join(projectDir, "out", "extension.js");

  const bundleChunk = (): boolean => {
    try {
      buildSync({
        entryPoints: [path.join(projectDir, "src", ".generated", "wire.ts")],
        bundle: true,
        platform: "node",
        format: "cjs",
        target: "es2022",
        external: ["vscode", "@sigilkit/core"],
        outfile: bundlePath,
        sourcemap: "inline",
        logLevel: "silent",
      });
      return true;
    } catch (e) {
      console.error(`sandbox: bundle falhou — ${(e as Error).message}`);
      return false;
    }
  };

  // ── servidor de controle (protocolo: JSON por linha) ───────────────────────
  let client: net.Socket | undefined;
  let requestSeq = 0;
  const pending = new Map<number, (msg: Record<string, unknown>) => void>();

  const send = (msg: Record<string, unknown>): void => {
    client?.write(JSON.stringify(msg) + "\n");
  };
  const request = (msg: Record<string, unknown>, timeoutMs = 10_000): Promise<Record<string, unknown>> => {
    const id = ++requestSeq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, error: "timeout — a janela sandbox está aberta?" });
      }, timeoutMs);
      pending.set(id, (reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
      send({ ...msg, id });
    });
  };

  const server = net.createServer((socket) => {
    client = socket;
    let buffer = "";
    socket.on("data", (data) => {
      buffer += String(data);
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as Record<string, unknown>;
          if (msg.op === "hello") {
            console.log(`sandbox: 🔌 janela conectada (VSCode ${String(msg.version)})`);
            if (replOpen) rl.prompt();
          } else if (typeof msg.id === "number" && pending.has(msg.id)) {
            pending.get(msg.id)!(msg);
            pending.delete(msg.id);
          }
        } catch {
          /* linha inválida — ignora */
        }
      }
    });
    socket.on("close", () => {
      if (client === socket) client = undefined;
    });
    socket.on("error", () => {});
  });

  // ── companion: extensão minúscula gerada por rodada ────────────────────────
  const writeCompanion = (dir: string, port: number): void => {
    // a notificação de boas-vindas usa o nome real da extensão do projeto e
    // abre a palette já filtrada pela categoria dos comandos dela
    const projectPkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8")) as {
      name?: string;
      displayName?: string;
      contributes?: { commands?: { category?: string }[] };
    };
    const display = projectPkg.displayName ?? projectPkg.name ?? "extensão";
    const filter =
      projectPkg.contributes?.commands?.find((c) => c.category)?.category ?? display;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify(
        {
          name: "sigil-sandbox-companion",
          publisher: "sigil",
          version: "0.0.1",
          engines: { vscode: "^1.75.0" },
          main: "./extension.js",
          activationEvents: ["onStartupFinished"],
        },
        null,
        2
      )
    );
    fs.writeFileSync(
      path.join(dir, "extension.js"),
      `// GERADO POR sigil sandbox — NÃO EDITE
const net = require("net");
const vscode = require("vscode");
const PORT = ${port};
const CHUNK = ${JSON.stringify(bundlePath)};
const DISPLAY = ${JSON.stringify(display)};
const FILTER = ${JSON.stringify(filter)};

let sock;
let buffer = "";
let notified = false;

function connect() {
  sock = net.connect(PORT, "127.0.0.1");
  sock.on("connect", () => {
    send({ op: "hello", version: vscode.version });
    if (notified) return;
    notified = true;
    // dev extensions não aparecem na aba Extensions — a notificação é a prova
    // visível de que a extensão está carregada e o hot swap ativo
    void vscode.window
      .showInformationMessage(
        "🔥 sigil sandbox: '" + DISPLAY + "' carregada — hot swap ativo, sem F5",
        "Ver comandos"
      )
      .then((choice) => {
        if (choice === "Ver comandos") {
          void vscode.commands.executeCommand("workbench.action.quickOpen", ">" + FILTER + " ");
        }
      });
  });
  sock.on("data", (data) => {
    buffer += String(data);
    let idx;
    while ((idx = buffer.indexOf("\\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) handle(JSON.parse(line));
    }
  });
  sock.on("error", () => {});
  sock.on("close", () => setTimeout(connect, 1000));
}

function send(msg) {
  try { sock.write(JSON.stringify(msg) + "\\n"); } catch {}
}

async function handle(msg) {
  try {
    if (msg.op === "reload") {
      send({ op: "reply", id: msg.id, ok: true });
      await vscode.commands.executeCommand("workbench.action.reloadWindow");
      return;
    }
    if (msg.op === "refresh-ui") {
      const mod = require(require.resolve(CHUNK)); // instância VIVA (cache)
      if (typeof mod.__sigilRefreshWebviews === "function") mod.__sigilRefreshWebviews();
      send({ op: "reply", id: msg.id, ok: true });
      return;
    }
    if (msg.op === "swap") {
      const started = Date.now();
      const resolved = require.resolve(CHUNK);
      delete require.cache[resolved];
      const fresh = require(resolved);
      if (typeof fresh.__sigilHydrate !== "function") {
        send({ op: "reply", id: msg.id, ok: false, error: "bundle sem __sigilHydrate — rode sigil build" });
        return;
      }
      fresh.__sigilHydrate();
      if (typeof fresh.__sigilActivateLifecycle === "function") void fresh.__sigilActivateLifecycle();
      send({ op: "reply", id: msg.id, ok: true, ms: Date.now() - started });
      return;
    }
    if (msg.op === "exec") {
      const value = await vscode.commands.executeCommand(msg.command, ...(msg.args || []));
      let safe;
      try { safe = JSON.parse(JSON.stringify(value === undefined ? null : value)); } catch { safe = String(value); }
      send({ op: "reply", id: msg.id, ok: true, value: safe });
      return;
    }
  } catch (e) {
    send({ op: "reply", id: msg.id, ok: false, error: String((e && e.message) || e) });
  }
}

exports.activate = () => connect();
exports.deactivate = () => { try { sock.destroy(); } catch {} };
`
    );
  };

  // ── build inicial + watch ──────────────────────────────────────────────────
  let lastHash: string | undefined;
  let ready = false;
  let stopUiWatch: (() => void) | undefined;
  let uiDirsAtuais = "";
  const uiDev = spawnUiDev(projectDir);

  // hot reload de UI: o companion re-preenche o HTML dos painéis abertos
  const refreshUi = (): void => {
    void request({ op: "refresh-ui" }).then((reply) => {
      if (reply.ok) console.log("sandbox: 🎨 UI recarregada na janela");
      else console.error(`sandbox: refresh de UI falhou (${String(reply.error)})`);
      if (replOpen) rl.prompt();
    });
  };

  const onBuild = (program: ts.Program): void => {
    const result = computeProject(projectDir, program);
    if (!result.ok) {
      reportFailure(result);
      console.error("sandbox: build com erros — aguardando mudanças…");
      return;
    }
    writeChanged(result.files);
    writeStoredHash(projectDir, result.hash);
    if (!bundleChunk()) return;

    const uiDirs = [...result.ir.webviews, ...result.ir.customEditors].map((w) =>
      w.uiEntry.includes("/") ? w.uiEntry.slice(0, w.uiEntry.lastIndexOf("/")) : "."
    );
    const chave = uiDirs.sort().join("|");
    if (chave !== uiDirsAtuais) {
      uiDirsAtuais = chave;
      stopUiWatch?.();
      stopUiWatch = watchUiDirs(projectDir, uiDirs, refreshUi);
    }

    if (!ready) {
      lastHash = result.hash;
      ready = true;
      return;
    }
    if (result.hash === lastHash) {
      void request({ op: "swap" }).then((reply) => {
        if (reply.ok) console.log(`sandbox: 🔥 hot swap aplicado (${String(reply.ms)}ms)`);
        else console.error(`sandbox: hot swap falhou (${String(reply.error)}) — use 'reload'`);
        if (replOpen) rl.prompt();
      });
    } else {
      lastHash = result.hash;
      console.log("sandbox: manifesto mudou → recarregando a janela…");
      void request({ op: "reload" });
    }
  };

  const watchHost = ts.createWatchCompilerHost(
    configPath,
    { noEmit: true },
    ts.sys,
    ts.createSemanticDiagnosticsBuilderProgram,
    () => {},
    () => {}
  );
  watchHost.afterProgramCreate = (builder) => onBuild(builder.getProgram());
  ts.createWatchProgram(watchHost);

  // ── lança o VSCode standalone isolado ──────────────────────────────────────
  const sandboxRoot = path.resolve(".vscode-test", "sandbox");
  const companionDir = path.join(sandboxRoot, "companion");

  server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as net.AddressInfo).port;
    writeCompanion(companionDir, port);
    void (async () => {
      const { downloadAndUnzipVSCode } = await import("@vscode/test-electron");
      console.log("sandbox: garantindo o VSCode standalone (download só na primeira vez)…");
      const executable = await downloadAndUnzipVSCode();
      const child = spawn(
        executable,
        [
          `--user-data-dir=${path.join(sandboxRoot, "user-data")}`,
          `--extensions-dir=${path.join(sandboxRoot, "extensions")}`,
          `--extensionDevelopmentPath=${path.resolve(projectDir)}`,
          `--extensionDevelopmentPath=${companionDir}`,
          "--new-window",
          "--skip-welcome",
          "--skip-release-notes",
          "--disable-workspace-trust",
          "--disable-telemetry",
          path.resolve(projectDir),
        ],
        { stdio: "ignore" }
      );
      child.on("exit", () => {
        console.log("sandbox: janela fechada — encerrando");
        process.exit(0);
      });
      process.on("SIGINT", () => {
        child.kill();
        uiDev?.kill();
        process.exit(0);
      });
      process.on("SIGTERM", () => {
        child.kill();
        process.exit(0);
      });
      process.on("exit", () => {
        child.kill();
        uiDev?.kill();
        // F15 do dogfood externo: o bundle do sandbox (core EXTERNO, para o
        // hot swap) fica em out/extension.js — o MESMO artefato do pkg.main.
        // Deixá-lo assim contaminava testes e um vsix sem prepublish. Na
        // saída, devolvemos o formato padrão (core embutido).
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
          console.log("sandbox: out/extension.js devolvido ao formato padrão (core embutido)");
        } catch {
          console.warn("sandbox: não consegui re-bundlar out/extension.js — rode 'npm run build' antes de testar/empacotar");
        }
      });
      console.log("sandbox: 🚀 VSCode standalone aberto (isolado do seu VSCode)");
    })().catch((e) => {
      console.error(`sandbox: falha ao lançar o VSCode — ${(e as Error).message}`);
      process.exit(1);
    });
  });

  // ── REPL: dirige o VSCode REAL pelo socket ─────────────────────────────────
  const HELP = `comandos do sandbox:
  run <id> [argJson]   executa um comando NA JANELA REAL (via companion)
  swap                 força hot swap
  reload               força reload da janela
  help | exit`;

  let replOpen = true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "sandbox> " });
  rl.on("line", (line) => {
    void (async () => {
      const [cmd, ...rest] = line.trim().split(/\s+/);
      if (!cmd) return;
      if (cmd === "exit" || cmd === "quit") process.exit(0);
      else if (cmd === "help") console.log(HELP);
      else if (cmd === "reload") await request({ op: "reload" });
      else if (cmd === "swap") {
        const reply = await request({ op: "swap" });
        console.log(reply.ok ? `  🔥 swap ok (${String(reply.ms)}ms)` : `  ✗ ${String(reply.error)}`);
      } else if (cmd === "run") {
        const [id, ...argParts] = rest;
        const args = argParts.length > 0 ? [JSON.parse(argParts.join(" "))] : [];
        const reply = await request({ op: "exec", command: id, args });
        console.log(reply.ok ? `  ↩ ${JSON.stringify(reply.value)}` : `  ✗ ${String(reply.error)}`);
      } else console.log(`sandbox: comando desconhecido '${cmd}' — use help`);
    })().finally(() => {
      if (replOpen) rl.prompt();
    });
  });
  rl.on("close", () => {
    replOpen = false;
    console.log("sandbox: REPL encerrado — watch e janela continuam (Ctrl+C para sair)");
  });

  console.log(`sigil sandbox: dev num VSCode real e isolado — hot swap sem F5 (digite 'help')`);
  return 0;
}
