#!/usr/bin/env node
// npm create sigil [dir] [--template=react-webview]
// Fino de propósito: o template é UM só e mora no @sigilkit/cli (sigil init) —
// este pacote existe para a porta de entrada `npm create sigil` funcionar.
const { spawnSync } = require("node:child_process");
const readline = require("node:readline");

async function main() {
  const args = process.argv.slice(2);
  let dir = args.find((a) => !a.startsWith("-"));
  const flags = args.filter((a) => a.startsWith("--"));

  if (!dir) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise((res) => rl.question(q, res));
    dir = ((await ask("Nome da extensão: ")) || "minha-extensao").trim();
    if (!flags.some((f) => f.startsWith("--template="))) {
      const t = ((await ask("Template — 1) básico  2) painel React [1]: ")) || "1").trim();
      if (t === "2") flags.push("--template=react-webview");
    }
    rl.close();
  }

  const sigil = require.resolve("@sigilkit/cli/bin/sigil.js");
  const r = spawnSync(process.execPath, [sigil, "init", dir, ...flags], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
