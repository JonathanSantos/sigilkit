# sigil

Framework declarativo para extensões do VSCode. O arquivo TypeScript é a
**fonte única de verdade**; o `contributes` do `package.json` é **derivado**
dele em build time. Renomear um comando no código e esquecer o manifesto deixa
de ser um comando fantasma — vira erro de build com posição no arquivo.

```ts
import * as vscode from "vscode";
import { Extension, Command, Config, Watch } from "@sigil/core";

@Extension({ prefix: "hello" })
export class HelloExtension {
  @Config({ description: "Texto exibido na saudação" })
  accessor greeting: string = "Olá";

  @Command({ title: "Say hello", category: "Hello", keybinding: "ctrl+alt+h" })
  sayHello() {
    vscode.window.showInformationMessage(`${this.greeting}!`);
  }

  @Watch("greeting")
  onGreetingChanged(next: string, prev: string) {}
}
```

Nenhuma linha de `contributes` é escrita à mão. `sigil build` gera:

- o bloco `contributes` no `package.json` (merge — chaves não gerenciadas são preservadas);
- `src/.generated/wire.ts` — o `activate()` real, que faz o join entre as chaves
  emitidas pelo compilador e os handlers registrados em runtime, e **lança erro**
  se faltar handler;
- `src/.generated/config.d.ts` — augmentation que tipa o `getConfig` do core
  por chave: `getConfig("hello.retries")` → `number`, com autocomplete; chave
  fora do registro (configs de terceiros) retorna `unknown` e exige cast.
  Requer `"include": ["src", "src/.generated/**/*"]` no tsconfig — globs do
  tsc não atravessam diretórios com ponto (o `sigil init` já gera assim).

## Estrutura

| Pacote | Papel | Regra inviolável |
|---|---|---|
| `@sigil/core` | runtime (vai para o bundle) | nunca importa `typescript` (R1) |
| `@sigil/compiler` | build time (AST → IR → emitters) | nunca importa `vscode` (R2); nunca executa código do usuário (R3) |
| `@sigil/cli` | orquestração e IO | emitters são puros; todo IO fica aqui (R4) |

O design completo está em [docs/spec.md](docs/spec.md). Leia a §4 (modelo de
propriedade) antes de mexer em qualquer coisa.

## Uso

Projeto novo:

```bash
sigil init minha-extensao
cd minha-extensao && npm install && npm run build
# abra no VSCode e aperte F5
```

Neste monorepo:

```bash
npm install          # workspaces
npm run build        # compila os quatro pacotes
npm run example:build
cd examples/hello && npm run bundle
# abra examples/hello no VSCode e aperte F5
```

## Empacotando (.vsix)

```bash
npm run package      # dentro do projeto da extensão
```

O script roda `vsce package --no-dependencies`: o `vsce` chama o
`vscode:prepublish` (= `sigil build` + esbuild) sozinho, e `--no-dependencies`
porque o bundle já embute `@sigil/core` — nada de `node_modules` no pacote.
O `.vscodeignore` (gerado pelo `sigil init`) exclui fonte/testes/sourcemaps e
deixa entrar `out/`, `ui/` e `media/`. O resultado é `nome-versão.vsix`,
instalável via "Install from VSIX…" ou `code --install-extension`.

Publicar no Marketplace é `vsce publish` — exige publisher registrado e PAT;
veja a doc do vsce.

## Testando extensões sem o VSCode — `@sigil/test`

Um ambiente simulado do subconjunto da API `vscode` que o sigil toca. Ativa o
**bundle real** da extensão interceptando `require("vscode")`, semeia os
defaults de config a partir do manifesto (como o VSCode faz) e expõe sondas:

```ts
import { activateExtension } from "@sigil/test";

const host = await activateExtension({ projectDir: "examples/hello" });
host.commands;                                  // ids registrados
await host.executeCommand("hello.sayHello");
host.infoMessages;                              // ["Olá!"]
host.configuration.set("hello.greeting", "Oi"); // simula editar Settings → dispara @Watch
const tree = host.tree("hello.tasks");
await tree.roots();                             // nós da view
const panel = host.panel("hello.settings");     // depois de abrir via comando
panel.receive({ type: "save", value: {...} });  // simula a UI → roteador @OnMessage
panel.posted;                                   // mensagens do host para a UI
await host.dispose();
```

Fidelidade onde importa (semântica de `affectsConfiguration`, update dispara
change, registro duplicado lança, painel singleton) e honestidade nas bordas:
API não simulada lança erro descritivo em vez de `undefined` silencioso (R6).
O que o simulador não cobre, o E2E cobre no host real:

```bash
npm run test:e2e     # @vscode/test-electron sobre examples/hello (caminho feliz)
```

Requisitos do projeto do usuário (ver §6 e §16 do spec):

- `target: ES2022`, `experimentalDecorators: false`, `useDefineForClassFields: true`
  (decorators **stage 3**; `@Config`/`@StatusBar` exigem a palavra-chave `accessor`);
- bundle com esbuild usando `--target=es2022` (sem target o esbuild deixa a
  sintaxe de decorator crua no bundle e o extension host não a executa).
  `--keep-names` **não** é necessário: o join usa `Symbol.metadata`, não nomes
  de função em runtime — há teste que ativa o bundle minificado para provar;
- `engines.vscode >= 1.75` — `activationEvents` de comandos são automáticos, o
  sigil não os emite. O runtime é web-ready (`workspace.fs` + WebCrypto): o
  mesmo código serve `--platform=browser` para vscode.dev.

## Status

- **Fase 1 — Núcleo: completa.** `@Extension`, `@Command`, `@Config`, `@Watch`,
  `@Activate`/`@Deactivate`, coletor AST, IR determinístico, emitters de
  manifesto/wire/tipos, merge de `package.json`, `sigil build`.
- **Fase 2 — Robustez: completa.** Todos os diagnósticos com caret na posição
  exata; `sigil check` (CI — exit 1 em manifesto stale); `sigil dev` (watch
  mode com anti-loop); cache incremental por hash do IR (mudança que não
  altera o IR não reemite nada).
- **Fase 3 — UI: completa.** `@TreeView`/`@TreeRoot`/`@TreeChildren`/`@TreeItem`
  com adaptador de `TreeDataProvider` e refresh via `registry.trees`; comandos
  dentro da classe da view (menus `view/*` ganham `when: view == <id>`
  automático); `@Webview`/`@OnMessage` com shell HTML (CSP + nonce +
  `asWebviewUri`), `retainContextWhenHidden`, roteador de mensagens tipado por
  `type` (tipo desconhecido vira warning — R6), `post` injetado e painel
  singleton via `registry.webviews.get(...)!.open()`; runtime do lado UI em
  `@sigil/core/ui` (`postToHost`/`onHostMessage`). Diagnósticos SIGIL1012–1017.
- **Pós-spec (roadmap H2+H3): completo.** `@Webview` em **sidebar**
  (`WebviewViewProvider`, `location: "sidebar"`); `@StatusBar` (accessor cujo
  set atualiza o item); menus com opções **por entrada** (`{ id, group, when }`),
  keybindings `linux`/`win`, `viewsContainers` inline (chave condicional no
  merge); `setConfig` tipado; avaliador estático seguindo **consts locais**
  (`as const`/`satisfies` transparentes); join por **`Symbol.metadata`**
  (minificação-safe, sem `--keep-names`); runtime web-ready; `sigil dev`
  incremental via `ts.createWatchProgram` (rebuilds de ~3ms); `@sigil/test`
  com editores/documentos fake, gravação de input/quickPick e **modo inline**
  (wire TS direto no vitest, sem bundle).

## Exemplos

Cada um valida um perfil de DX diferente, e todos têm testes com `@sigil/test`
em `test/extension.test.ts` — o mesmo padrão que uma extensão real usaria:

| Exemplo | Perfil | O que exercita |
|---|---|---|
| [examples/counter](examples/counter) | mínimo — 1 classe, 1 arquivo | prefix default do `name`, união → enum, min/max, keybinding com `mac` |
| [examples/todos](examples/todos) | TreeView interativa | tree rasa (sem `@TreeChildren`), estado mutável + refresh via `@Watch`, `showInputBox`, menu `view/item/context` recebendo o elemento como argumento, `when` auto-escopado |
| [examples/notes](examples/notes) | Webview | assets externos reescritos via `asWebviewUri`, protocolo tipado com resposta de erro, config lida no handler, estado que sobrevive a fechar/reabrir o painel |
| [examples/hello](examples/hello) | kitchen sink | tudo junto + E2E no extension host real |

## Testes

```bash
npm test             # unidade + simulador + E2E do CLI (inclui os testes dos exemplos)
npm run test:e2e     # extension host real (baixa o VSCode na primeira vez)
```

Camadas (§14): fixtures em `tests/fixtures/` com um caso por diagnóstico
(asserção de código **e** linha do caret), snapshot de IR e de emitters sobre
`examples/hello`, teste de merge (chaves não gerenciadas sobrevivem), teste de
fronteira (falha o build se R1/R2 forem violadas — imports extraídos por AST,
não regex), E2E dos comandos do CLI (`init`/`build`/`check` sobre cópias
isoladas), o simulador `@sigil/test` sobre o bundle real, e o caminho feliz no
extension host via `@vscode/test-electron`. O CI (GitHub Actions) roda tudo,
incluindo `sigil check` como guardião de manifesto stale.
