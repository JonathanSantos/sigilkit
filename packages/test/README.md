# @sigilkit/test

Ambiente **simulado do VSCode** para testar extensões sigil sem extension
host — rápido, determinístico e fiel ao subconjunto da API que o sigil toca.

Ativa o **bundle real** da extensão interceptando `require("vscode")`, semeia
os defaults de configuração a partir do manifesto (como o VSCode faz) e expõe
sondas: comandos, configuração, mensagens, trees, webviews (com `receive`/
`posted` para o protocolo da UI), status bar, documentos/editores fake,
`Memento`/`SecretStorage`, progress, deep links, chat e LLM (`queueLlmResponse`).

```ts
import { activateExtension } from "@sigilkit/test";

const host = await activateExtension({ projectDir: "caminho/da/extensao" });
await host.executeCommand("hello.sayHello");
expect(host.infoMessages).toEqual(["Olá!"]);
await host.dispose();
```

Princípios:

- **nunca** importa `vscode` nem `typescript` (testado em
  `tests/boundaries.test.ts`);
- API não simulada **lança erro descritivo** (R6), nunca `undefined`
  silencioso — o que o simulador não cobre, o E2E cobre no host real.

Há também o modo inline (`activateInline`) para rodar o wire TS direto no
vitest, sem bundle. Documentação completa no
[README do repositório](../../README.md).
