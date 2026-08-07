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
- ~~**Publicar uma extensão real no Marketplace** construída com sigil~~ ✅
  [REST Bench no Marketplace](https://marketplace.visualstudio.com/items?itemName=sigilkit.restbench)
  (2026-08-07) — com tools de agent mode.
- ~~**README.en.md** — versão em inglês mantendo o pt-BR como principal.~~ ✅
  Feito: [README.en.md](README.en.md) com seletor de idioma nos dois.

## Em seguida

- ~~CI em matrix (Windows/macOS)~~ ✅ ubuntu + macOS obrigatórios; Windows
  experimental (`continue-on-error`) até a suíte ser 100% portável.
- ~~E2E electron cobrindo as superfícies novas (language/chat/custom
  editor)~~ ✅ tools de IA, MCP, chat (participante + slash command) e
  custom editor (`vscode.openWith` real) cobertos no `npm run test:e2e`.
- Robustez do resolvedor de decorators com pnpm/Yarn PnP.
- ~~Uma classe `@Webview` servindo painel E sidebar~~ ✅
  `location: "dual"` — post em broadcast, RPC por superfície, @OnOpen na
  primeira/@OnDispose na última.
- ~~Diagnóstico para `@OnOpen`/`@OnDispose`/`@Every` em classe errada~~ ✅
  `SIGIL1022` com caret.

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
