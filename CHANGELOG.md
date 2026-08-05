# Changelog

Os quatro pacotes `@sigilkit/*` versionam em lockstep — cada entrada aqui vale
para `core`, `compiler`, `cli` e `test` na mesma versão. Pré-1.0, mudanças de
API podem acontecer entre versões minor; sempre listadas aqui.

## Não publicado

- **Protocolo do webview tipado** — `sigil build` gera `sigil-env.d.ts` na
  pasta do `ui:` de cada `@Webview`/`@CustomEditor`: `acquireVsCodeApi()`
  tipado com os `@OnMessage`/`@OnRequest` declarados, `value` derivado do
  parâmetro do handler via `Parameters<>`. Typo no `type` ou shape errado é
  erro de typecheck na UI — inclusive em JS puro com `// @ts-check`.

## 0.1.0 — 2026-08-05

Primeira versão publicada. Tudo abaixo é novo:

- **Núcleo declarativo** — `@Extension`, `@Command`, `@Config`, `@Watch`,
  `@Activate`/`@Deactivate`; manifesto (`contributes`), wire (`activate()`)
  e tipos por chave de config derivados do TypeScript em build time.
- **UI** — `@TreeView` (+`@TreeRoot`/`@TreeChildren`/`@TreeItem`), `@Webview`
  em painel e sidebar (+`@OnMessage`/`@OnRequest` com RPC), `@StatusBar`,
  `viewsContainers` inline, menus por entrada, keybindings por plataforma.
- **Linguagem, chat e editores** — `@Language` (+`@Hover`/`@Completion`/
  `@CodeLens`/`@Diagnostics`), `@ChatParticipant` (+`@ChatRequest`/
  `@ChatFollowups`), `@CustomEditor` com `SigilEditorContext`.
- **DX sobre a API** — `@On`/`@OnFile` (auto-dispose, debounce), `@State`/
  `@Secret`/`@ContextKey`, `@UriHandler`, progress em `@Command`,
  `prompt.steps`, `llm.ask/stream`; validação de `when`/`enablement` no build
  (`SIGIL1018`/`SIGIL1019`).
- **Plataforma de runtime** — `log`, `guard` (erros nunca somem), `http`,
  `resources`, aba de configurações gerada (`settings: true`).
- **Ferramentas** — `sigil init`/`build`/`check`/`dev` (incremental, ~3ms),
  `sigil sim` (+`--ui`, workbench no browser), `sigil sandbox` (VSCode real
  isolado com hot swap sem F5); empacotamento `.vsix` via vsce.
- **Testes** — `@sigilkit/test`: simulador do VSCode que ativa o bundle real;
  diagnósticos `SIGIL1000`–`SIGIL1019` com caret na posição exata.
