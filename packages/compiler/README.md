# @sigilkit/compiler

O **build time** do sigil: coleta a AST do projeto do usuário (via TypeScript
compiler API), produz um **IR determinístico** e o entrega aos emitters puros
de manifesto (`contributes` do `package.json`), wire (`activate()` gerado) e
tipos (`config.d.ts` com o registro de chaves).

Também é o dono dos diagnósticos `SIGIL1000`–`SIGIL1019` — cada um com caret
na posição exata do arquivo do usuário, incluindo a validação de expressões
`when`/`enablement` contra as `@ContextKey`, views e comandos declarados.

Regras invioláveis (testadas em `tests/boundaries.test.ts`):

- **nunca** importa `vscode` nem `@sigilkit/core` (R2);
- **nunca** executa código do usuário — só leitura de AST (R3);
- os emitters são funções puras `(ir) => string | object`, sem IO (R4);
- a ordem do IR é determinística — é requisito do `sigil check`, não polimento.

Documentação completa no [README do repositório](../../README.md); o design
está em [docs/spec.md](../../docs/spec.md).
