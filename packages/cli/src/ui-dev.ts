import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Hot reload de UI para os modos de dev (sim/sandbox), em duas metades:
 *
 * 1. `spawnUiDev`: se o package.json do projeto tiver
 *    `"sigil": { "uiDev": "npm run dev:ui" }`, o comando sobe JUNTO com o
 *    modo de dev (o esbuild --watch da UI, tipicamente) e morre com ele —
 *    um comando só para o loop completo.
 * 2. `watchUiDirs`: observa as pastas apontadas por `ui:` e avisa (debounced)
 *    quando o bundle/HTML/CSS da UI muda — quem chama decide como recarregar
 *    (sim: refresh no host simulado; sandbox: op refresh-ui no companion).
 */

export function spawnUiDev(projectDir: string): ChildProcess | undefined {
  let cmd: string | undefined;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8")) as {
      sigil?: { uiDev?: string };
    };
    cmd = pkg.sigil?.uiDev;
  } catch {
    return undefined;
  }
  if (!cmd) return undefined;
  console.log(`sigil: ⚙️  uiDev — ${cmd}`);
  // stdin em "pipe" (aberto): o esbuild --watch (e afins) encerra quando o
  // stdin fecha — com "ignore" o watcher morria no spawn
  const child = spawn(cmd, { cwd: projectDir, shell: true, stdio: ["pipe", "inherit", "inherit"] });
  child.on("exit", (code) => {
    if (code !== null && code !== 0) console.error(`sigil: uiDev saiu com código ${code}`);
  });
  return child;
}

export function watchUiDirs(
  projectDir: string,
  uiDirs: readonly string[],
  onChange: () => void
): () => void {
  const watchers: fs.FSWatcher[] = [];
  let timer: NodeJS.Timeout | undefined;
  for (const dir of new Set(uiDirs)) {
    const abs = path.join(projectDir, dir);
    if (!fs.existsSync(abs)) continue;
    try {
      watchers.push(
        fs.watch(abs, { recursive: true }, (_event, file) => {
          const rel = String(file ?? "");
          // o d.ts gerado muda em todo build do host — não é mudança de UI
          if (rel.endsWith("sigil-env.d.ts")) return;
          // fontes (ui/src/**) são insumo do uiDev — o gatilho é o ARTEFATO
          // buildado (dist/, html, css), senão recarregamos antes do rebuild
          if (rel.startsWith("src/") || rel.includes("/src/")) return;
          if (timer) clearTimeout(timer);
          timer = setTimeout(onChange, 150);
        })
      );
    } catch {
      // fs.watch recursivo indisponível na plataforma — segue sem watch de UI
    }
  }
  return () => {
    if (timer) clearTimeout(timer);
    for (const w of watchers) w.close();
  };
}
