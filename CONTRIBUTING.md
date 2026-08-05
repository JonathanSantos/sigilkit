# Contribuindo com o sigil

## Setup

Node 22+ (o CI usa 22).

```bash
npm install
npm run build        # tsc -b nos quatro pacotes
npm test             # build + sigil build/bundle dos exemplos + vitest
npm run test:e2e     # extension host real (baixa o VSCode na primeira vez)
```

## As regras que quebram o build

O design do sigil se sustenta em fronteiras estritas — todas verificadas por
`tests/boundaries.test.ts` (imports extraídos por AST, não regex):

- **R1** — `packages/core` nunca importa `typescript` (iria para o bundle da
  extensão). Também nunca importa `node:*` (runtime web-ready).
- **R2** — `packages/compiler` nunca importa `vscode` nem `@sigilkit/core`.
- **R3** — o compilador nunca executa código do usuário; só leitura de AST.
- **R4** — emitters (`compiler/src/emit/*`) são funções puras; todo IO fica
  no CLI.
- **R5** — arquivos gerados (`src/.generated/*`, bloco `contributes`) nunca
  são editados à mão.
- **R6** — falhar alto, nunca em silêncio: join sem handler lança na
  ativação; API não simulada no `@sigilkit/test` lança erro descritivo.

O spec completo — modelo de propriedade (§4), IR, diagnósticos, armadilhas —
está em [docs/spec.md](docs/spec.md). Desvios conscientes do spec estão
documentados nas erratas ao final dele e no [CLAUDE.md](CLAUDE.md).

## Onde as coisas vivem

| Área | Caminho |
|---|---|
| decorators e runtime | `packages/core/src/` |
| coletor AST → IR | `packages/compiler/src/collect/` |
| validações e diagnósticos | `packages/compiler/src/validate.ts`, `diagnostics.ts` |
| emitters (manifesto/wire/tipos) | `packages/compiler/src/emit/` |
| pipeline build/check/dev | `packages/cli/src/pipeline.ts` |
| sim, sim --ui, sandbox | `packages/cli/src/sim*.ts`, `sandbox.ts` |
| simulador do vscode | `packages/test/src/vscode-mock.ts` |

## O que se espera de um PR

- **Diagnóstico novo ou alterado** → fixture em `tests/fixtures/` com asserção
  de código **e** linha do caret em `tests/diagnostics.test.ts`.
- **Mudança no IR ou emitters** → atualize os snapshots conscientemente
  (`vitest -u` só depois de conferir o diff); a ordem do IR é determinística
  por contrato.
- **Feature de runtime** → teste no simulador (`@sigilkit/test`); se o simulador
  não cobre a API, estenda o mock — API não simulada deve lançar, nunca
  devolver `undefined`.
- **Mudança de DX visível** → confira se o [tutorial](docs/tutorial.md)
  continua verdadeiro; ele é pinado por `tests/tutorial.test.ts` e o CI falha
  se o código do doc divergir.
- `npm test` verde e `sigil check` limpo nos exemplos (o CI roda ambos).

## Estilo

TypeScript estrito, sem dependências novas no core (zero deps em runtime é
requisito — o bundle da extensão embute tudo). Mensagens de erro em pt-BR,
descritivas e com próximo passo claro, no padrão das existentes.
