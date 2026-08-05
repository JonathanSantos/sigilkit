#!/usr/bin/env node
// Bump de versão em lockstep dos quatro pacotes @sigilkit/* — atualiza
// `version` e TODAS as referências internas (deps dos pacotes E dos exemplos,
// que pinam exato: sem isso o npm baixa a versão publicada do registry em vez
// de linkar o workspace). Ao final sincroniza o package-lock.json (o npm ci
// do CI exige lock em dia).
//
//   node scripts/version.mjs 0.2.0
//   git commit -am "release: v0.2.0" && git tag -a v0.2.0 -m v0.2.0 && git push --follow-tags
// (tag ANOTADA: --follow-tags ignora tags leves — git tag sem -a não sobe)
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";

const v = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(v ?? "")) {
  console.error("uso: node scripts/version.mjs <x.y.z>");
  process.exit(1);
}

const PKGS = readdirSync("packages");
const names = new Set(PKGS.map((p) => `@sigilkit/${p}`));

function update(path, { bumpVersion }) {
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  let touched = false;
  if (bumpVersion && pkg.version !== v) {
    pkg.version = v;
    touched = true;
  }
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    for (const dep of Object.keys(pkg[field] ?? {})) {
      if (names.has(dep) && pkg[field][dep] !== v) {
        pkg[field][dep] = v;
        touched = true;
      }
    }
  }
  if (touched) {
    writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
    console.log(`${path} → ${v}`);
  }
}

for (const p of PKGS) update(`packages/${p}/package.json`, { bumpVersion: true });
for (const e of readdirSync("examples")) update(`examples/${e}/package.json`, { bumpVersion: false });

console.log("sincronizando package-lock.json…");
execSync("npm install --package-lock-only", { stdio: "inherit" });

console.log(`\nagora: git commit -am "release: v${v}" && git tag -a v${v} -m v${v} && git push --follow-tags`);
