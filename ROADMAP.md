# Roadmap

O sigil evolui por **dogfood**: extensões reais expõem fricções, fricções
viram features testadas. Este roadmap é a fila atual — issues e PRs que
ataquem qualquer item (ou tragam fricções novas) são bem-vindos.

## Agora

- ~~Tools do agent mode, slash commands, ghost text, MCP~~ — **entregue**
  (`@LmTool` com schema derivado, `@ChatCommand`, `@InlineCompletion`,
  `@McpServers`, `llm.agent`).

- **Estabilizar o modo enxerto** com casos reais: adotar o sigil em extensões
  existentes sem reescrever nada (`"sigil": { "graft": true }` — ver README).
- **Publicar uma extensão real no Marketplace** construída com sigil.
- ~~**README.en.md** — versão em inglês mantendo o pt-BR como principal.~~ ✅
  Feito: [README.en.md](README.en.md) com seletor de idioma nos dois.

## Em seguida

- CI em matrix (Windows/macOS) — hoje só ubuntu.
- E2E electron cobrindo as superfícies novas (language/chat/custom editor) —
  ✅ tools de IA e MCP já cobertos (`@LmTool` invocada via `lm.invokeTool`
  real no `npm run test:e2e`); falta chat/custom editor.
- Robustez do resolvedor de decorators com pnpm/Yarn PnP.
- Uma classe `@Webview` servindo painel E sidebar (o vscode-pets alterna por
  config; hoje exigimos duas classes).
- Diagnóstico para `@OnOpen`/`@OnDispose`/`@Every` em classe errada (hoje são
  runtime-only e silenciosos fora do lugar).

## Sob demanda (sinalize numa issue se precisa)

- Bundling de UI gerenciado (`script:` no `@Webview`) — hoje o nível 0 cobre
  qualquer bundler externo.
- Plugin de language service para tipos de UI por arquivo em projeto único.
- Superfícies restantes do marketplace: debug adapters, notebooks, SCM.
- l10n completa (geração de package.nls.* por locale; hoje validamos %chaves%).

## Bons primeiros PRs

- Exemplo novo pequeno (um `@Language` para um formato que você usa).
- Mensagem de diagnóstico que te confundiu → melhore o texto + fixture.
- Um caso de borda no simulador (`@sigilkit/test`) que devolve algo diferente
  do VSCode real → teste + correção.
