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

Fornada de IA (IR v8): @LmTool (bucket lmTools; nome <prefix>_<membro>;
inputSchema DERIVADO via typeToToolSchema — checker, JSDoc→description,
call signatures rejeitadas [Map/Date/fn = SIGIL1021]; wrap de retorno
string→LanguageModelToolResult dinâmico); @ChatCommand (chatHandlers;
manifesto chatParticipants[].commands; bindChatParticipant roteia por
request.command com fallback no @ChatRequest); @InlineCompletion
(languageHandlers; strings viram itens); @McpServers (bucket mcpServers;
defs simples {label,command,args}/{label,uri} viram classes Mcp* do host
dinamicamente); llm.agent() (loop invokeTool duck-typed sobre parts).
Tudo lm.* dinâmico (tools >=1.95, MCP >=1.101; host velho = erro alto).
Sondas: lmTools/invokeTool/mcpServers/provideInlineCompletions/chatRequest
com command. tests/ai-lab.test.ts exercita tudo do zero.

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

Protocolo de UI tipado (emit/ui-env.ts): sigil build gera sigil-env.d.ts na
pasta do `ui:` de cada webview/custom editor — arquivo MÓDULO (`export {}`)
com `declare global` (acquireVsCodeApi + tipos nomeados) e `declare module
"@sigilkit/core/ui"` (augmentation de SigilUiMessages/SigilUiRequests/
SigilUiFromHost → postToHost/callHost/onHostMessage tipados por chave; os
overloads seguem a lição do getConfig: fallback vira `never` quando o
registro está preenchido). `value` derivado do handler via __SigilValueOf
(extração LAZY — Parameters<F>[0] direto em handler SEM parâmetro é TS2493
em tupla vazia e degrada TUDO para any sob skipLibCheck; idem __SigilHostOf
p/ o post: checagem estrutural, nunca indexar chave possivelmente ausente).
Uma pasta+tsconfig por webview (globais colidem em pasta compartilhada). O
tsconfig da UI precisa incluir "../src/.generated/config.d.ts". JS puro +
// @ts-check funciona (checkJs). Vitrines: examples/notes (JS puro) e
examples/restbench (React/tsx, inferência completa sem generics). Sem
bundling de UI por decisão (nível 0). tests/ui-types.test.ts tem os
negativos (postMessage, callHost e postToHost com typo).

DX do dogfood (0.3.0): registry.instance(Classe) — WeakMap por CONSTRUTOR
em registry.instances, preenchido pelo wire no hydrate (hot-swap safe);
http.send() cru (request usa send por baixo); decorators zero-arg são
DUAIS via dual() em decorators/dual.ts (@Activate ≡ @Activate(); detecção:
2º arg com "kind"); @Command({id}) troca só o sufixo do id público (key
continua Classe.membro — join intacto); panel.request()/host.logText() no
test; sigil init --template=react-webview (registry.instance + protocolo
tipado no template). Princípio nomeado no CONTRIBUTING: resolução tardia
de dependências externas (fetch/vscode.* lidos na chamada, nunca no load).

Hot reload de UI: WebviewHandle.refresh?() re-preenche html do painel
aberto (fillWebview de novo; handshake ready→init da UI se repete; @Every/
@OnOpen NÃO re-disparam — painel não fechou); wire exporta
__sigilRefreshWebviews; sim/sandbox observam pastas de ui: (watchUiDirs em
cli/src/ui-dev.ts — ignora sigil-env.d.ts e ui/src/** [fonte é insumo do
uiDev; gatilho é o artefato]) e recarregam (sim: host.module.__sigilRefresh…
+ notifyChange; sandbox: op refresh-ui no companion, require CACHEADO do
chunk). sigil.uiDev no package.json → spawnUiDev sobe junto (stdin PIPE
aberto — esbuild --watch morre com stdin fechado; template usa
--watch=forever). Modo enxerto: "sigil": {"graft": true} no package.json do usuário →
mergePackageJson({graft}) troca substituição integral por merge POR
IDENTIDADE (command/id; configuration por properties, aceita forma array
de seções; menus/views por sub-chave). Trade documentado: entrada
ex-gerenciada removida do código sai à mão. tests/graft.test.ts prova
extensão legada + sigil convivendo (activate manual chama o do wire).
packages/create = create-sigil (npm create sigil): bin fino que delega ao
sigil init via require.resolve("@sigilkit/cli/bin/sigil.js"); publicado
pelo release.yml junto com os 4 (loops incluem "create"). Tutorial usa
npm create sigil (código do minuto 4 segue PINADO pelo teste — só prosa
mudou). ROADMAP.md + templates de issue/PR em .github/.

Fornada webview (pós-case): registry.panel(Classe) tipado por
Parameters<T["post"]>[0] (webviewKeys WeakMap ctor→nome preenchido pelo
wire; webviewLive mantido pelos binds; post devolve boolean, nunca lança);
@OnOpen/@OnDispose (buckets webviewOpen/webviewDispose; lifecycleFor no
webview-host liga no open/resolve e desliga no dispose); @Every(ms)
(bucket every {ms,fn}; em @Webview vive no ciclo do painel, em @Extension
via bindEvery(className) chamado pelo wire — handlers resolvem do registry
a cada disparo, hot-swap safe); when em @Webview sidebar/@TreeView (IR v7;
manifest emite; validate cobre com SIGIL1018/1019; when em panel → erro);
l10n: %chaves% validadas contra package.nls.json (SIGIL1020; pipeline lê o
arquivo e passa nlsKeys ao validate — compiler sem IO); resourceBase() no
core/ui. Ainda de fora (consciente): classe única painel+sidebar; replay
de mensagens do sim em iframe recriado; @OnOpen em classe errada é
silenciosamente ignorado (runtime-only, sem IR).

Case de rewrite: examples/pets = host do vscode-pets (MIT, upstream em
ui-src/ INTACTO + subconjunto de media) reescrito em sigil (~260 linhas vs
1347). ui/boot.js (~35 linhas) adapta {command}→{type,value}, faz handshake
ready→init (config por mensagem, não interpolada no HTML) e re-dispara
window 'load' (o app gateia a animação nele; com init por mensagem o load
já passou). Animação é dirigida por tick de 100ms do HOST (como upstream).
Melhorias nascidas do case: type-to-schema resolve aliases/keyof/indexed
via checker (resolvedTypeToSchema; tsType = união EXPANDIDA — o nome do
alias não existe no config.d.ts); sim-ui ganhou fallback estático (GET de
arquivo do projeto com guarda de path — sprites construídos em runtime).

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
