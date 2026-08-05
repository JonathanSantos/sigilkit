# Changelog

Os quatro pacotes `@sigilkit/*` versionam em lockstep — cada entrada aqui vale
para `core`, `compiler`, `cli` e `test` na mesma versão. Pré-1.0, mudanças de
API podem acontecer entre versões minor; sempre listadas aqui.

## 0.3.0 — 2026-08-05

O release do dogfood: cada item nasceu do feedback de construir uma extensão
real (examples/restbench) com o framework.

- **`registry.instance(Classe)`** — a ponte tipada entre classes gerenciadas
  (do painel para a extensão, por exemplo); chaveada pelo construtor
  (minificação-safe) e R6 para classe não gerenciada.
- **`http.send()`** — a resposta como ela é: `{ status, statusText, headers,
  text, json() }` sem lançar em não-2xx (rede/timeout continuam lançando).
- **Helpers da UI tipados** — o `sigil-env.d.ts` gerado agora também aumenta
  `@sigilkit/core/ui`: `callHost` infere valor e retorno por chave,
  `postToHost` valida a mensagem, `onHostMessage` recebe a união host→UI
  derivada do tipo do `post`. **BREAKING**: os genéricos explícitos de
  `callHost<T>`/`postToHost<T>` saíram — apague-os e deixe a inferência agir.
- **Sondas novas no `@sigilkit/test`** — `panel.request(type, value)` faz o
  RPC com correlação (adeus helpers manuais) e `host.logText()` devolve os
  logs como texto.
- **Decorators sem argumento aceitam a forma nua** — `@Activate` e
  `@Activate()` agora equivalem (idem `@Secret`, `@ContextKey`, `@TreeRoot`,
  `@Hover`, `@UriHandler`, …).
- **`@Command({ id })`** — id público estável, independente do nome do
  método: refatorar deixa de ser mudança de API.
- **`sigil init --template=react-webview`** — scaffold completo de painel
  React com protocolo tipado, esbuild configurado e tsconfig da UI.
- **Fix**: handler sem parâmetro degradava os tipos do `sigil-env.d.ts` para
  `any` sob `skipLibCheck` (indexação de tupla vazia); a extração agora é
  condicional e o d.ts compila limpo até sem `skipLibCheck`.

## 0.2.0 — 2026-08-05

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
