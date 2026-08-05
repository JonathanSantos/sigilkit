# sigil — contexto para agentes

Framework declarativo para extensões do VSCode (renomeado de `vscx` para
`sigil`). O spec completo e normativo está em **docs/spec.md** — leia as seções
2 (regras R1–R6), 4 (modelo de propriedade) e 13 (armadilhas) antes de editar.

Regras que quebram o build se violadas (há teste de fronteira em tests/):

- `packages/core` NUNCA importa `typescript` (R1) — vai para o bundle da extensão.
- `packages/compiler` NUNCA importa `vscode` nem `@sigilkit/core` (R2).
- O compilador nunca executa código do usuário — só leitura de AST (R3).
- Emitters (`compiler/src/emit/*`) são funções puras, sem IO (R4). IO fica no CLI.
- Ordem determinística do IR é requisito do `sigil check`, não polimento.

Arquitetura de runtime (pós-item 9): decorators registram em BUCKETS por
classe via ctx.metadata (Symbol.metadata + polyfill Symbol.for em
core/src/metadata.ts); o wire chama adoptRegistrations("Nome", Classe) após
cada `new` — o nome declarado vem do compilador, nunca de
this.constructor.name. Minificação-safe (tests/minified.test.ts prova);
--keep-names removido de todo bundle. O webview-host é web-ready
(workspace.fs + WebCrypto, zero node:*); core não pode importar node:*
(teste de fronteira). WebviewHandle.open() é async.

Desvios conscientes do spec (documentados na implementação; erratas no fim de
docs/spec.md):

- emitTypes (§10.3) emite module augmentation de "@sigilkit/core"
  (SigilConfigRegistry) em vez do declare órfão do spec — getConfig fica
  tipado por chave. A interface é declarada DIRETO no index.ts do core:
  augmentation não faz merge com re-export (pitfall vue/@vue-runtime-core).
  O overload fallback retorna `unknown` fixo, NUNCA um genérico <T> — um
  genérico seria inferido do tipo do destino e engoliria typos de chave.
- tsconfig de usuário: include precisa de "src/.generated/**/*" — globs do
  tsc não atravessam diretórios com ponto, nem nomeados sem wildcard.

- `resolveDecoratorName` resolve o alias de import ANTES de olhar declarations
  (o snippet da §8.2 olharia o ImportSpecifier no arquivo do usuário).
- O wire gerado inclui `registry.prefix = "<prefix>"` no activate — o runtime
  precisa do prefix para ler configs e o spec não previa essa ponte.
- O bundle esbuild exige `--target=es2022` além de `--keep-names` — sem target,
  decorators ficam crus no bundle e o Node não os executa.

Status: Fases 1, 2 e 3 completas — build/check/dev/init, cache por hash de IR,
diagnósticos SIGIL1000–1016 testados por fixture com asserção de linha,
TreeView e Webview (§15). `npm test` = build + sigil build + bundle do exemplo
+ vitest (fronteira, merge, snapshots, diagnósticos, shell HTML, E2E de
init/check, simulador). `npm run test:e2e` = extension host real via
@vscode/test-electron (exige >=3.x — o binário do mac chama "Code" agora).
O pipeline compartilhado de build/check/dev vive em packages/cli/src/pipeline.ts.

Plataforma de runtime no core: log (LogOutputChannel + buffer pré-ativação),
guard (R6 em runtime — wire envolve comandos/watches/webviews/trees), http
(fetch global + HttpError + fetchImpl trocável), resources (workspace.fs via
registry.context), RPC @OnRequest/callHost (correlação __sigilRpcId), settings
app pronto (@Extension({settings:true}) → comando <prefix>.configure + form
derivado do schema; comando registrado direto no wire, fora do join). `sigil
sim` = hot reload simulado (watch incremental → esbuild → activateExtension
no @sigilkit/test, configs preservadas entre reloads) com REPL; cli depende de
@sigilkit/test e esbuild.

DX sobre a API (IR v6): @On/@OnFile (bucket "events", bindEvents/
bindFileWatchers, debounce trailing), @UriHandler (activationEvent "onUri"
no subconjunto gerenciado), @State (Memento; sem IR — só requireAccessor),
@Secret (cache síncrono em registry.secretsCache; bindSecrets pré-carrega e
segue onDidChange; wire activate é ASYNC), @ContextKey (registry.contextValues
+ setContext; ids alimentam a validação de when), progress em @Command
(withCommandProgress; token como ÚLTIMO arg), prompt.steps (ESC volta passo),
llm (vscode.lm dinâmico). Validação de when em validate.ts: SIGIL1018 (token
`<prefix>.*` precisa ser @ContextKey/view/comando declarado) e SIGIL1019
(sintaxe via tokenizer sticky + parênteses).

Superfícies de linguagem/chat/editor: @Language({id}) com @Hover/@Completion/
@CodeLens/@Diagnostics (bindLanguage; activationEvents onLanguage:* são
SUBCONJUNTO gerenciado no merge — resto do array é do usuário);
@ChatParticipant/@ChatRequest/@ChatFollowups (bindChatParticipant; API de
chat acessada dinamicamente — sem exigir @types >= 1.90; host antigo → erro
alto no bind); @CustomEditor reusa o shell de webview + @OnMessage/@OnRequest
com SigilEditorContext como 2º argumento dos handlers (makeRouter aceita
`extra`); applyEdit via WorkspaceEdit; doc→UI por mensagens __sigilDocument
(helper onDocument em @sigilkit/core/ui). chatParticipants/customEditors são
chaves CONDICIONAIS no merge. adoptRegistrations tolera classe só com
marcador (bucket vazio) — o R6 real é o join por chave.

`sigil sim --ui` = workbench visual (cli/src/sim-ui.ts + sim-ui-page.ts):
servidor http sem deps, SSE para push de estado (buildSnapshot serializa
palette/trees/configs/statusbar/logs/webviews), POST /api/* para interações;
webviews em iframes srcdoc com shim de acquireVsCodeApi (CSP meta é removida
no iframe; sigil-webview:// → /webview-resource); input interativo via
state.interactiveInput no mock (fila vazia → modal na página em vez de ESC).

`sigil sandbox` = VSCode REAL isolado (download via @vscode/test-electron em
.vscode-test/; user-data/extensions próprios) + companion gerado (socket TCP,
JSON por linha) + hot swap: bundle com @sigilkit/core EXTERNO (registry singleton
entre swaps — exige node_modules), companion deleta require.cache e chama
__sigilHydrate()/__sigilActivateLifecycle() do wire; hash do IR decide swap
(igual) vs reload de janela (mudou). O wire tem dispatch DINÂMICO (comandos,
trees, webviews resolvem do registry a cada chamada) e __sigilHydrate
re-executável; adoptRegistrations migra statusBarItems vivos entre buckets;
binds de webview não recebem mais instância — post vai em registry.webviewPosts
e o wire injeta forwarders.

Quarto pacote: @sigilkit/test (packages/test) — simulador do vscode para testar
extensões sem host: ativa o bundle real interceptando require("vscode"),
semeia defaults do manifesto, expõe sondas (commands/config/tree/panel).
Nunca importa vscode nem typescript (há teste de fronteira). API não simulada
lança erro descritivo (R6), nunca undefined silencioso.
Decisões da Fase 3: ids de view/webview ganham prefixo (`hello.tasks`);
comando de @TreeView em menu "view/title" sem `when` explícito é escopado
automaticamente com `view == <viewId>`; `ui:` do @Webview é relativo à RAIZ
da extensão; o shell HTML é função pura (packages/core/src/webview-html.ts)
para ser testável sem vscode; lado UI importa `@sigilkit/core/ui`.
