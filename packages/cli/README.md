# @sigil/cli

A **orquestração e o IO** do sigil — todo efeito colateral vive aqui (os
emitters do compiler são puros).

| Comando | O que faz |
|---|---|
| `sigil init <dir>` | scaffolding completo (tsconfig stage 3, scripts, `.vscodeignore`, `launch.json`) |
| `sigil build <dir>` | AST → IR → manifesto + wire + tipos, com cache por hash do IR e write-if-changed |
| `sigil check <dir>` | exit 1 se o manifesto commitado está stale (guardião de CI) |
| `sigil dev <dir>` | watch incremental (`ts.createWatchProgram`, rebuilds de ~3ms) |
| `sigil sim <dir>` | hot reload no simulador `@sigil/test` + REPL (`--ui` abre o workbench visual no browser) |
| `sigil sandbox <dir>` | VSCode real e isolado com hot swap sem F5 (hash do IR decide swap vs reload) |

O pipeline compartilhado de build/check/dev vive em `src/pipeline.ts`.

Documentação completa no [README do repositório](../../README.md).
