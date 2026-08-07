# Referência do sigil — a API inteira numa página

> Página única e densa, pensada para humanos com pressa e para máquinas
> (RAG, contexto de agentes). Fatos, assinaturas e pegadinhas; a motivação e
> o design estão no [spec](spec.md), o passo a passo no [tutorial](tutorial.md).
> Vale para `@sigilkit/*` >= 0.8.

## Conceitos em dez linhas

O TypeScript é a fonte única: **identidade** (ids, títulos, schemas, `when`)
sai da AST em build time e vira `package.json` + `src/.generated/wire.ts` +
`src/.generated/config.d.ts`; **comportamento** (handlers) sai do registry em
runtime via decorators stage 3. O join entre os dois é por chave estável
`Classe.membro`, verificado nas duas pontas: manifesto stale = erro de build
com posição (`SIGIL1000–1022`); handler ausente = exceção na ativação (R6 —
erros altos, nunca silêncio). Nunca edite `src/.generated/**` nem as chaves
gerenciadas do `package.json`. Os pacotes versionam em lockstep — use a
mesma versão de todos.

## CLI (`@sigilkit/cli`, binário `sigil`)

| Comando | Efeito |
|---|---|
| `sigil init <dir> [--template=react-webview]` | scaffold completo (inclui `AGENTS.md` para agentes de IA) |
| `sigil build <dir>` | AST → IR → manifesto + wire + tipos (cache por hash do IR) |
| `sigil check <dir>` | sai com erro se o manifesto commitado está stale (guardião de CI) |
| `sigil dev <dir>` | watch incremental (~3ms por rebuild) |
| `sigil sim <dir>` | simulador com hot reload + REPL (`run`, `set`, `tree`, `msg`, `input`, `logs`) |
| `sigil sim --ui <dir>` | workbench visual no browser (http://127.0.0.1:4400), webviews reais em iframes |
| `sigil sandbox <dir>` | VSCode real isolado com hot swap sem F5 (hash do IR decide swap vs reload) |

Chaves no `package.json` do projeto: `"sigil": { "uiDev": "<cmd>" }` (o
sim/sandbox sobem o watch da UI junto e recarregam o painel aberto);
`"sigil": { "graft": true }` (modo enxerto: o merge preserva o `contributes`
manual entrada por entrada — adoção incremental; entrada ex-gerenciada
removida do código sai à mão).

## Decorators da classe `@Extension`

`@Extension({ prefix, settings? })` — marca a classe principal (uma por
projeto). `settings: true` gera o comando `<prefix>.configure` com formulário
derivado do schema das `@Config`.

- `@Command({ title, id?, category?, keybinding?, menu?, when?, enablement?, progress? })`
  método → comando `<prefix>.<id ?? nomeDoMétodo>`. `keybinding` aceita
  forma com variantes por plataforma (`mac`, `linux`, `win`). `progress`
  envolve em `withProgress` — o token de cancelamento chega como ÚLTIMO
  argumento do método. `enablement`/`when` são validados no build.
- `@Config({ description?, minimum?, maximum? })` **accessor** → configuração
  `<prefix>.<nome>`: tipo, default e enum saem da declaração TS (união de
  literais → enum; aliases/`keyof typeof` resolvem via checker).
- `@Watch("chave")` método → chamado com `(next, prev)` quando a config muda
  (semântica de `affectsConfiguration`).
- `@Activate` / `@Deactivate` métodos → lifecycle (rodam depois/antes do
  wiring; a forma sem parênteses é válida — decorators zero-arg são duais).
- `@StatusBar({ alignment?, priority?, command?, tooltip? })` **accessor** →
  item de status bar vivo: atribuir ao accessor atualiza o texto.
- `@State("global" | "workspace")` **accessor** → persistência em `Memento`,
  tipada. **REATRIBUA** (`this.x = [...x, novo]`) — mutação interna (`push`)
  não persiste.
- `@Secret()` **accessor** → `SecretStorage` com cache síncrono (o wire
  pré-carrega; leitura é síncrona, escrita persiste).
- `@ContextKey()` **accessor** → `setContext` a cada atribuição e habilita a
  validação de `when` (token `<prefix>.<nome>`).
- `@On("ns.evento", { debounce? })` método → evento da API do vscode com
  auto-dispose (ex.: `"window.onDidChangeActiveTextEditor"`).
- `@OnFile(glob, "create" | "change" | "delete", { debounce? })` método →
  `FileSystemWatcher` declarativo.
- `@UriHandler()` método → deep links `vscode://publisher.ext/...`
  (+ `activationEvent onUri` automático).
- `@Every(ms)` método → timer da ativação à desativação. (Num `@Webview`,
  vive enquanto o painel está aberto.)
- `@LmTool({ description, name?, displayName?, userDescription?, referenceName?, invocationMessage?, tags? })`
  método → tool do agent mode `<prefix>_<name ?? método>`; o **inputSchema é
  DERIVADO do tipo do 1º parâmetro** (JSDoc → description, união de literais
  → enum, opcional → não-required, arrays/objetos aninhados ok; `Map`/`Date`/
  funções → `SIGIL1021`). Retorne `string` (vira `LanguageModelToolResult`)
  ou o result pronto. `referenceName` habilita `#nome` no prompt.
- `@McpServers({ label, id? })` método → provedor MCP; retorne
  `{ label, command, args?, env?, cwd? }` (stdio) ou `{ label, uri, headers? }`
  (http) — viram as classes `Mcp*` do host.

## Outras classes (uma responsabilidade por classe)

- `@TreeView({ name, container?, when? })` + `@TreeRoot`/`@TreeChildren`/
  `@TreeItem` (+ `@Command` com `menu: "view/title"` — ganha `when` escopado
  na view automaticamente). `container` aceita string ou spec inline de
  `viewsContainers`. Id da view: `<prefix>.<id ?? nome>`.
- `@Webview({ id, title, ui, location?, name?, container?, when? })` +
  `@OnMessage("tipo")`/`@OnRequest("tipo")` + `@OnOpen`/`@OnDispose`.
  `location`: `"panel"` (default), `"sidebar"` (vira view em
  `contributes.views`) ou `"dual"` (painel E sidebar numa classe: post em
  broadcast, RPC responde a quem perguntou, `@OnOpen` na primeira superfície
  e `@OnDispose` na última). `ui:` é relativo à RAIZ do projeto. Declare
  `post!: (msg: ...) => void` — o wire injeta; o tipo do parâmetro alimenta
  `registry.panel()` e o `sigil-env.d.ts`. Shell HTML com CSP + nonce é do
  sigil; `@OnRequest` responde ao `callHost` da UI com correlação automática.
- `@Language({ id: string | string[] })` + providers (um de cada por classe):
  `@Hover`, `@Completion({ triggerCharacters? })`, `@CodeLens`,
  `@Diagnostics({ on: "change" | "save" })` (collection gerenciada: revalida
  em open/change/save, limpa no close), `@InlineCompletion` (retorne string,
  string[] ou itens — strings viram `{ insertText }`),
  `@CodeAction({ kinds? })`, `@Definition`, `@References`, `@Rename`,
  `@Formatting` (**retorne o documento inteiro como string** e o sigil faz o
  `TextEdit` de range completo — ou retorne `TextEdit[]`), `@Symbols`,
  `@InlayHints`. Emite `activationEvents: onLanguage:<id>` (subconjunto
  gerenciado — o resto do array é seu).
- `@ChatParticipant({ id, name, fullName?, description?, isSticky? })` +
  `@ChatRequest()` (handler `(request, context, stream, token)`),
  `@ChatCommand("nome", { description? })` (slash command — manifesto +
  roteamento por `request.command`; sem match cai no `@ChatRequest`),
  `@ChatFollowups()`.
- `@CustomEditor({ id, displayName, filenamePattern, ui, priority? })` +
  `@OnMessage`/`@OnRequest` — handlers recebem `SigilEditorContext` como 2º
  argumento: `editor.getText()`, `editor.applyEdit(novoTexto)` (undo
  funciona), `editor.uri`. A UI recebe o documento no load e a cada mudança
  (`onDocument` em `@sigilkit/core/ui`).
- `@TestController({ label, id? })` + `@TestDiscover()` (retorne
  `TestNode[]`: `{ id, label, children?, uri? }` — vira a árvore do Test
  Explorer; o botão refresh re-executa) + `@TestRun()` (chamado por FOLHA:
  retorne `void`/`true` = passou, `false` = falhou,
  `{ passed, message? }` = controle fino; exceção = falha com a mensagem).
  Runtime-only — o sigil emite `onStartupFinished` no manifesto.

## Plataforma de runtime (`@sigilkit/core`)

- `log.info/warn/error/debug/trace(msg)` — `LogOutputChannel`; funciona
  antes da ativação (buffer).
- `guard(rotulo, fn, { notify? })` — erro vira log com stack (+ notificação
  "Abrir logs"); todo handler gerenciado já passa por ele.
- `http.get/post/put/del(url, body?, { timeout?, headers? })` — fetch com
  JSON automático; não-2xx lança `HttpError` (status, corpo).
  `http.send(method, url, body?, opts?)` — resposta crua
  `{ ok, status, statusText, headers, text, json() }` sem lançar em não-2xx.
  `http.fetchImpl` trocável em teste (resolução tardia — lido a cada chamada).
- `resources.readText/readJson/readBytes(caminhoRelativo)` — arquivos
  empacotados via `workspace.fs` (funciona no vscode.dev).
- `prompt.text/pick/confirm(...)` e `prompt.steps([...])` — wizard em passos
  (ESC volta um passo).
- `editor.openText(conteudo, { language?, beside? })` — documento virtual num
  editor real (highlight/folding/busca do tema do usuário).
- `llm.ask(prompt, opts?)` / `llm.stream(prompt, onChunk, opts?)` /
  `llm.agent(prompt, { maxRounds?, tools?, toolInvocationToken?, ... })` —
  sobre `vscode.lm`; `agent` roda o loop de tool-calling com o pareamento
  real `Assistant([ToolCallPart])`/`User([ToolResultPart])`. `LlmOptions`:
  `family?`, `system?`, `token?` (propague o do handler de chat).
- `registry.instance(Classe)` — instância viva e tipada de qualquer classe
  gerenciada (chaveada pelo construtor; classe não gerenciada lança).
- `registry.panel(ClasseWebview)` — `SigilPanelHandle`: `post(msg)` (tipado
  pelo `post!` da classe; retorna `false` se fechado), `open()`, `isOpen`.
- `getConfig("prefix.chave")` / `setConfig("prefix.chave", valor, target?)` —
  tipados por chave via `config.d.ts` gerado; chave fora do registro retorna
  `unknown`.
- `adoptRegistrations`, `bind*` — usados pelo wire gerado; não chame à mão.

## Lado UI (`@sigilkit/core/ui`)

O `sigil build` gera `sigil-env.d.ts` na pasta do `ui:` de cada webview —
arquivo-módulo que tipa `acquireVsCodeApi()` e os helpers pelas chaves dos
handlers do host (typo = erro de typecheck da UI, até em JS com `@ts-check`):

- `postToHost({ type, value })` — fire-and-forget para um `@OnMessage`.
- `await callHost(type, value?)` — RPC para um `@OnRequest`; o retorno é o
  do handler (correlação automática).
- `onHostMessage(handler)` — união das mensagens host→UI (derivada do tipo
  do `post!`); retorna unsubscribe.
- `onDocument(handler)` — custom editors: recebe `{ text, uri }` no load e a
  cada mudança.
- `resourceBase()` — base de URL para mídia construída em runtime.

Convenção: uma pasta (com tsconfig `lib: DOM` + `checkJs` e `include` do
`../src/.generated/config.d.ts`) por webview. Bundling da UI é seu
(qualquer bundler ou nenhum).

## Testes (`@sigilkit/test`)

`const host = await activateExtension({ projectDir })` — intercepta
`require("vscode")`, ativa o **bundle real** (`out/extension.js`), semeia os
defaults do manifesto. API não simulada lança erro descritivo (R6).

Sondas do `SigilTestHost` (principais):

- Comandos/estado: `executeCommand(id, ...args)`, `commands`,
  `configuration.set/get`, `contextKey(id)`, `secretsStorage`,
  `infoMessages`, `warnMessages`, `statusBarItems`, `logs`, `logText()`.
- Documentos/linguagem: `openTextDocument(texto, languageId)`,
  `provideHover/Completions/CodeLenses(doc, pos?)`, `diagnosticsFor(doc)`,
  `provideInlineCompletions(languageId, texto, pos?)`,
  `provideCodeActions/Definition/References(doc, ...)`,
  `provideRenameEdits(doc, pos, novoNome)`, `provideFormattingEdits(doc)`,
  `provideDocumentSymbols(doc)`, `provideInlayHints(doc, range?)`,
  `saveTextDocument(doc)`, `activeTextEditor`.
- Trees/webviews: `tree(viewId).roots()/children(nó)`, `panel(viewId)`
  (`WebviewPanelMock`: `html`, `posted`, `receive(msg)`,
  `request(tipo, valor)` — RPC como a UI real), `webviewView(viewId)`,
  `webviewViewIds`, `openCustomEditor(viewType, doc)`.
- IA: `lmTools`, `invokeTool(nome, input?)`, `mcpServers(providerId)`,
  `chatRequest(participantId, prompt, { command? })`,
  `queueLlmResponse(...respostas)` (string ou `{ text?, toolCalls? }` —
  roteiriza `llm.*`), `llmRequests` (mensagens de cada `sendRequest`).
- Testing API: `testItems(controllerId)`, `runTests(controllerId, ids?)`.
- Ciclo: `dispose()` (desativa e limpa o estado do mock).

## Diagnósticos (`SIGIL1000–1022`, todos com arquivo/linha)

| Código | Significado |
|---|---|
| 1000 | nenhuma classe `@Extension` no projeto |
| 1001 | argumento de decorator não é literal estático |
| 1002 | id de comando duplicado |
| 1003 | id de config duplicado |
| 1004 | `@Watch` referencia config inexistente |
| 1005 | keybinding duplicado |
| 1006 | `@Config` sem `accessor` |
| 1007 | tipo de config não suportado |
| 1008 | membro decorado em classe sem marcador do sigil |
| 1009 | mais de uma classe `@Extension` |
| 1010 | `@Command` sem `title` |
| 1011 | `@Config` sem default literal |
| 1012 | classe incompleta (ex.: `@TreeView` sem `@TreeRoot`) ou marcador duplicado |
| 1013 | id de view/webview duplicado |
| 1014 | decorator de membro incompatível com o tipo da classe |
| 1015 | tipo duplicado em `@OnMessage`/`@ChatCommand` |
| 1016 | opção obrigatória ausente |
| 1017 | referência a comando inexistente |
| 1018 | `when`/`enablement` com token do prefixo não declarado |
| 1019 | `when` com sintaxe inválida |
| 1020 | `%chave%` sem correspondente no `package.nls.json` |
| 1021 | input de `@LmTool` não derivável em schema |
| 1022 | `@OnOpen`/`@OnDispose`/`@Every` em classe que os ignora |

## Requisitos e pegadinhas

- tsconfig: `target: ES2022`, `experimentalDecorators: false`,
  `useDefineForClassFields: true`, e `"include"` com `"src/.generated/**/*"`
  (globs do tsc não atravessam diretórios com ponto).
- Bundle: esbuild com `--target=es2022` e `--external:vscode`;
  `--keep-names` NÃO é necessário (join por `Symbol.metadata`; minificar é
  seguro e testado).
- `engines.vscode >= 1.75`; chat exige host ≥ 1.90 em runtime, `lm.*` tools
  ≥ 1.95, MCP ≥ 1.101 — API acessada dinamicamente (sem exigir
  `@types/vscode` novo; host antigo = erro alto no bind, nunca crash).
- Decorators de accessor (`@Config`/`@StatusBar`/`@State`/`@Secret`/
  `@ContextKey`) exigem a sintaxe `accessor nome = default`.
- Empacotamento: `vsce package --no-dependencies` (o bundle já embute o
  core); `.vscodeignore` gerado pelo init.
