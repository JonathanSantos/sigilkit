# Changelog

Os pacotes (`@sigilkit/*` e `create-sigil`) versionam em lockstep — cada
entrada aqui vale para todos na mesma versão. Pré-1.0, mudanças de API podem
acontecer entre versões minor; sempre listadas aqui.

## 0.7.2 — 2026-08-06

A fornada de IA — as superfícies que o Copilot invoca. (Release consolidado
após um incidente de billing no Actions: a 0.7.0 saiu num run atrasado com
o mesmo conteúdo, e a 0.7.1 nunca foi publicada — use a 0.7.2.)

- **`@LmTool`** — tools do agent mode com `inputSchema` **derivado do tipo do
  parâmetro** (JSDoc → description, uniões → enum, opcionais → não-required,
  aliases via checker); `contributes.languageModelTools` + `lm.registerTool`
  + join no wire. `host.invokeTool()` testa sem Copilot. Input não-derivável
  é `SIGIL1021` com caret.
- **`@ChatCommand("fix")`** — slash commands declarados no manifesto e
  roteados por `request.command` (fallback no `@ChatRequest`).
- **`@InlineCompletion`** — ghost text; strings viram itens.
- **`@McpServers`** — provedores de servidores MCP (stdio e http) com
  `contributes.mcpServerDefinitionProviders` derivado.
- **`llm.agent()`** — o loop de tool-calling (invokeTool → resultado → nova
  rodada) sem boilerplate.
- Sondas novas no `@sigilkit/test`: `lmTools`, `invokeTool`, `mcpServers`,
  `provideInlineCompletions`, `chatRequest` com `command`.

Revisão contra o host real (correções antes do release):

- **Fix crítico**: `llm.ask/stream/agent` passavam um token de cancelamento
  cru ao `sendRequest`; o host real embrulha o token e chama
  `onCancellationRequested` — crash na primeira chamada fora do simulador.
  Agora usa `CancellationTokenSource` de verdade, e `opts.token` propaga o
  token do handler de chat.
- **`llm.agent` fala o protocolo real**: os resultados de tool voltam como
  `Assistant([ToolCallPart])` + `User([ToolResultPart])` pareados por
  `callId` (antes: texto plano — modelos re-chamavam a mesma tool em loop);
  `opts.toolInvocationToken` propaga a atribuição da sessão de chat.
- `@McpServers`: `cwd` do stdio agora é aplicado (era prometido na doc e
  descartado); `@LmTool` ganhou `userDescription` própria (antes duplicava a
  `modelDescription` no picker).
- Simulador: `queueLlmResponse` aceita respostas roteirizadas com
  `toolCalls`, e `host.llmRequests` expõe as mensagens de cada rodada — o
  loop do `llm.agent` é testável de ponta a ponta.
- **E2E no VSCode real cobre a fornada**: o exemplo `hello` ganhou `@LmTool`
  e `@McpServers`, e o `npm run test:e2e` invoca a tool via
  `vscode.lm.invokeTool` de verdade — o host valida nome × contributes,
  token, RPC e o `LanguageModelToolResult`; o contrato de classes que o
  `llm.agent` monta (ToolCallPart/ToolResultPart) é conferido contra o host.

## 0.6.2 — 2026-08-06

- **Hot reload de UI no `sim` e no `sandbox`** — `WebviewHandle.refresh()`
  re-preenche o HTML do painel aberto (o wire exporta
  `__sigilRefreshWebviews`); os modos de dev observam as pastas de `ui:` e
  recarregam o painel quando o bundle/HTML/CSS muda. Com
  `"sigil": { "uiDev": "..." }` no package.json, o watch da UI sobe junto —
  host e UI num comando só. Template React já configurado (`npm run sim`).
  Pegadinha real: esbuild `--watch` morre com stdin fechado — o spawn usa
  stdin aberto e o template usa `--watch=forever`.

## 0.6.1 — 2026-08-06

- **Template React estruturado** — `--template=react-webview` agora scaffolda
  um app funcional de verdade: `components/` + `hooks/` (`useHostRequest`/
  `useHostMessage`, os hooks React por cima do protocolo tipado), CSS com as
  variáveis de tema do VSCode, e uma lista de tarefas persistida com `@State`
  demonstrando request/message/push, `registry.panel` e `registry.instance`.
- **Release idempotente** — o publish pula versões já publicadas: um release
  que falhou no meio (ex.: token sem permissão num pacote) pode ser
  re-emitido sem conflito de "cannot publish over".

## 0.6.0 — 2026-08-06

- **Modo enxerto (adoção incremental)** — `"sigil": { "graft": true }` no
  package.json: o merge preserva o `contributes` manual entrada por entrada e
  soma o derivado; seu `activate()` chama o do wire com uma linha. Migre uma
  extensão existente um comando por vez.
- **`create-sigil`** — `npm create sigil minha-extensao` (com
  `--template=react-webview` opcional); a porta de entrada oficial.
- **Tutorial** atualizado para o fluxo npm real (sem clonar o repo).
- Templates de issue/PR e [ROADMAP.md](ROADMAP.md) público.

## 0.5.0 — 2026-08-06

- **`registry.panel(Classe)`** — acesso tipado ao webview de outra classe,
  sem strings: `post` (envia se aberto → `true`; fechado → `false`), `open()`
  e `isOpen`. O último reduto stringly do dogfood caiu.
- **`@OnOpen` / `@OnDispose`** — ciclo de vida de painel/view; e
  **`@Every(ms)`**: timer declarativo com o ciclo certo (extensão: ativação↔
  desativação; webview: aberto↔fechado). O leak de setInterval do case pets
  virou o teste de regressão.
- **`when` em views** — `@Webview({ location: "sidebar", when })` e
  `@TreeView({ when })`, passando pela mesma validação SIGIL1018/1019.
- **l10n pragmática** — strings `%chave%` no manifesto validadas contra o
  `package.nls.json` do projeto (SIGIL1020 para chave inexistente ou arquivo
  ausente; o CLI lê o arquivo — o compiler segue sem IO).
- **`resourceBase()`** em `@sigilkit/core/ui` — base de mídia derivada da URI
  do próprio script, para URLs construídas em runtime.
- **Inferência de schema segue aliases** — `accessor petType: PetType` (alias,
  `keyof typeof`, indexed access) resolve via checker para união de literais →
  enum no manifesto; antes só uniões inline funcionavam (SIGIL1007).
- **`sim --ui` serve assets estáticos do projeto** — URLs que a UI constrói em
  runtime (sprites, imagens) resolvem no workbench do browser, com a mesma
  guarda de path do `/webview-resource`.
- **examples/pets** — case de rewrite do host do vscode-pets (a UI fica
  intacta): 1.347 linhas → ~260, manifesto derivado, mesmos ids públicos.

## 0.4.0 — 2026-08-05

- **`editor.openText(conteudo, { language, beside })`** no core — renderização
  vscode-native: abre um documento virtual num editor real (highlight, folding
  e busca do tema do usuário). Sonda `host.activeTextEditor` no
  `@sigilkit/test`.
- **restbench polido**: highlight de JSON no painel com as cores do tema,
  botão "Abrir no editor", headers da resposta expansíveis, tamanho e botão
  copiar — headers/size/language agora fazem parte do `RequestResult`. O
  visualizador de resposta ocupa todo o height restante do painel (layout de
  app com lateral de histórico/autorização; empilha em painéis estreitos), e
  o `.vscodeignore` do exemplo empacota um `.vsix` de 210 KB só com o
  essencial.

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
