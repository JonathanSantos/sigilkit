# @sigilkit/core

O **runtime** do sigil — a única parte que entra no bundle da extensão.

Exporta os decorators (`@Extension`, `@Command`, `@Config`, `@Watch`,
`@TreeView`, `@Webview`, `@Language`, `@ChatParticipant`, `@CustomEditor`,
`@On`, `@State`, `@Secret`, `@ContextKey`, …), o registry que faz o join com o
wire gerado, e a plataforma de runtime: `log`, `guard`, `http`, `resources`,
`prompt`, `llm`, `getConfig`/`setConfig` tipados. O lado browser dos webviews
importa de `@sigilkit/core/ui` (`postToHost`, `onHostMessage`, `callHost`,
`onDocument`).

Regras invioláveis (testadas em `tests/boundaries.test.ts`):

- **nunca** importa `typescript` (R1) — iria para o bundle da extensão;
- **nunca** importa `node:*` — o runtime é web-ready (vscode.dev).

Documentação completa no [README do repositório](../../README.md).
