#!/usr/bin/env node
// Bump de versão em lockstep dos quatro pacotes @sigilkit/* — atualiza
// `version` e as dependências internas (pinadas exatas entre irmãos).
//
//   node scripts/version.mjs 0.2.0
//   git commit -am "release: v0.2.0" && git tag -a v0.2.0 -m v0.2.0 && git push --follow-tags
// (tag ANOTADA: --follow-tags ignora tags leves — git tag sem -a não sobe)
import { readFileSync, writeFileSync } from "node:fs";

const v = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(v ?? "")) {
  console.error("uso: node scripts/version.mjs <x.y.z>");
  process.exit(1);
}

const PKGS = ["core", "compiler", "cli", "test"];
const names = new Set(PKGS.map((p) => `@sigilkit/${p}`));

for (const p of PKGS) {
  const path = `packages/${p}/package.json`;
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  pkg.version = v;
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    for (const dep of Object.keys(pkg[field] ?? {})) {
      if (names.has(dep)) pkg[field][dep] = v;
    }
  }
  writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`${path} → ${v}`);
}

console.log(`\nagora: git commit -am "release: v${v}" && git tag -a v${v} -m v${v} && git push --follow-tags`);
