# sigil — contexto para agentes

Framework declarativo para extensões do VSCode (renomeado de `vscx` para
`sigil`). O spec completo e normativo está em **docs/spec.md** — leia as seções
2 (regras R1–R6), 4 (modelo de propriedade) e 13 (armadilhas) antes de editar.

Regras que quebram o build se violadas (há teste de fronteira em tests/):

- `packages/core` NUNCA importa `typescript` (R1) — vai para o bundle da extensão.
- `packages/compiler` NUNCA importa `vscode` nem `@sigil/core` (R2).
- O compilador nunca executa código do usuário — só leitura de AST (R3).
- Emitters (`compiler/src/emit/*`) são funções puras, sem IO (R4). IO fica no CLI.
- Ordem determinística do IR é requisito do `sigil check`, não polimento.

Desvios conscientes do spec (documentados na implementação; erratas no fim de
docs/spec.md):

- emitTypes (§10.3) emite module augmentation de "@sigil/core"
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

Quarto pacote: @sigil/test (packages/test) — simulador do vscode para testar
extensões sem host: ativa o bundle real interceptando require("vscode"),
semeia defaults do manifesto, expõe sondas (commands/config/tree/panel).
Nunca importa vscode nem typescript (há teste de fronteira). API não simulada
lança erro descritivo (R6), nunca undefined silencioso.
Decisões da Fase 3: ids de view/webview ganham prefixo (`hello.tasks`);
comando de @TreeView em menu "view/title" sem `when` explícito é escopado
automaticamente com `view == <viewId>`; `ui:` do @Webview é relativo à RAIZ
da extensão; o shell HTML é função pura (packages/core/src/webview-html.ts)
para ser testável sem vscode; lado UI importa `@sigil/core/ui`.
