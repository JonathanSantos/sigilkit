# REST Bench

A REST client inside VS Code — send requests, inspect responses in **real
editors**, and let **Copilot call your API**.

## Features

- **Send requests** from a panel UI: method, URL, JSON body, response with
  status, time, size and headers — with theme-native JSON highlighting.
- **Open any response in a real editor** (virtual document, side by side):
  full syntax highlighting, folding and search, in your own theme.
- **Copilot agent-mode tools** — ask Copilot things like *"call GET /users on
  my API and summarize the response"*:
  - `restbench_request` (`#request`) executes a request through REST Bench,
    using your configured base URL, authorization token and timeout;
  - `restbench_history` lets the model inspect your recent requests and
    responses.
  - Agent mode asks for your confirmation before each invocation.
- **Authorization token in `SecretStorage`** — never in `settings.json`; sent
  as a `Bearer` header.
- **Per-workspace history** that survives restarts, a live status bar item,
  and a generated settings page (`REST Bench: Configure`).

| Setting | Default | |
|---|---|---|
| `restbench.baseUrl` | `""` | prefix for relative URLs |
| `restbench.timeoutMs` | `10000` | per-request timeout |
| `restbench.historyLimit` | `20` | max history entries |

Requires VS Code ≥ 1.75; the Copilot tools need VS Code ≥ 1.95 (older hosts
just don't get the tools — everything else works).

## Built with sigil

This extension is written with [sigil](https://github.com/JonathanSantos/sigilkit),
a declarative framework where TypeScript is the single source of truth and
`package.json` is derived from it — the whole host is ~250 lines of
decorators, `contributes` is 100% generated, and the Copilot tools'
`inputSchema` is **derived from the TypeScript input types**. It also serves
as sigil's flagship example: the full source lives in
[`examples/restbench`](https://github.com/JonathanSantos/sigilkit/tree/main/examples/restbench).

---

## O exemplo por dentro (pt-BR)

O exemplo "extensão de verdade" do sigil: um cliente HTTP dentro do VSCode,
com a UI em React e o host inteiro escrito em decorators — repare que
`src/extension.ts` não importa `vscode` nenhuma vez.

O que ele demonstra, por camada:

- **React no webview (nível 0 do sigil)**: o `ui:` aponta para
  `ui/index.html`, e quem bundla o React é o esbuild do próprio exemplo
  (`npm run build:ui`) — o sigil não tem opinião sobre o toolchain da UI.
- **Protocolo tipado dos dois lados**: `ui/sigil-env.d.ts` (gerado) dá à UI os
  tipos `RestBenchPanelMessage`/`RestBenchPanelResponse` derivados dos
  handlers — `postToHost<RestBenchPanelMessage>(…)` valida o `type` da
  mensagem, e `RestBenchPanelResponse["send"]` tipa o retorno do `callHost`
  (indexar com uma chave inexistente é erro de build da UI).
- **RPC**: `@OnRequest("send")` executa a requisição no host (plataforma
  `http`: timeout, HttpError, JSON automático) e o retorno resolve a Promise
  do `callHost` na UI.
- **Tools do agent mode**: `@LmTool` com o `inputSchema` DERIVADO do tipo
  `LmRequestInput` (JSDoc → description, união → enum, opcional →
  não-required); a requisição do agente entra no MESMO histórico da UI, e
  `host.invokeTool("restbench_request", …)` testa tudo sem Copilot.
- **Estado e segredos**: histórico em `@State("workspace")` (sobrevive a
  fechar o VSCode), token em `@Secret()` (SecretStorage, vira header
  `Authorization`).
- **`enablement` validado**: o comando Clear History só habilita com
  `restbench.temHistorico` — uma `@ContextKey` que o build verifica
  (SIGIL1018 se você errar o nome).
- **Status bar viva** e **aba de opções gerada** (`settings: true`).
- **Payload renderizado em duas camadas**: highlight de JSON dentro do painel
  (tokenizer de ~30 linhas usando as cores do TEMA via `--vscode-*`) e o botão
  **"Abrir no editor"** — `editor.openText` do core abre o corpo num editor
  REAL do VSCode (documento virtual, ao lado): highlight completo, folding e
  busca de graça. Headers e tamanho da resposta vêm do `http.send`.

Rodar:

```bash
npm run build -w restbench
node packages/cli/bin/sigil.js sim --ui examples/restbench   # workbench no browser
```

Os testes (`test/extension.test.ts`) trocam o `fetch` global e exercitam o
fluxo inteiro sem VSCode e sem rede — inclusive as tools, via
`host.invokeTool`.

## License

[MIT](https://github.com/JonathanSantos/sigilkit/blob/main/LICENSE)
