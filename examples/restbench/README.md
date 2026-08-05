# restbench — cliente REST com UI em React

O exemplo "extensão de verdade": um cliente HTTP dentro do VSCode, com a UI em
React e o host inteiro escrito em decorators — repare que `src/extension.ts`
não importa `vscode` nenhuma vez.

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
- **Estado e segredos**: histórico em `@State("workspace")` (sobrevive a
  fechar o VSCode), token em `@Secret()` (SecretStorage, vira header
  `Authorization`).
- **`enablement` validado**: o comando Clear History só habilita com
  `restbench.temHistorico` — uma `@ContextKey` que o build verifica
  (SIGIL1018 se você errar o nome).
- **Status bar viva** e **aba de opções gerada** (`settings: true`).

Rodar:

```bash
npm run build -w restbench
node packages/cli/bin/sigil.js sim --ui examples/restbench   # workbench no browser
```

Os testes (`test/extension.test.ts`) trocam o `fetch` global e exercitam o
fluxo inteiro sem VSCode e sem rede.
