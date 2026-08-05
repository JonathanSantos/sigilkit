# Sua primeira extensão em 5 minutos

Vamos criar uma extensão de frases motivacionais — com comando, atalho,
configurações, status bar, logs e aba de opções — **sem escrever uma linha de
`package.json`** e vendo tudo funcionar **sem abrir o VSCode**.

> **Pré-requisito (por enquanto):** clone deste repositório, `npm install` e
> `npm run build` na raiz. Quando o sigil for publicado no npm, este passo
> vira `npm create sigil`. Os comandos abaixo rodam da **raiz do repo**.

## Minuto 1 — criar o projeto

```bash
npx sigil init playground/frases
```

Olhe o que foi gerado: `package.json` **sem** bloco `contributes` (ele será
derivado), `tsconfig.json` com decorators stage 3, `src/extension.ts` mínimo,
`.vscodeignore` e `launch.json`. Nada para decorar, nada para sincronizar.

## Minuto 2 — o manifesto nasce do código

```bash
npx sigil build playground/frases
```

Abra o `playground/frases/package.json`: o bloco `contributes` apareceu —
comando `frases.hello`, config `frases.greeting` — derivado dos decorators de
`src/extension.ts`. Renomeie um método, rode o build de novo, e o manifesto
acompanha. **Dessincronizar é impossível**: se você esquecer o build, o
`sigil check` (e a ativação, em runtime) falham alto.

## Minuto 3 — ver funcionando sem VSCode

```bash
npx sigil sim --ui playground/frases
```

Abra **http://127.0.0.1:4400**: um workbench com a command palette, as
configurações e a status bar da sua extensão. Clique em `Hello` — a
notificação aparece como toast. Deixe rodando: tudo que você salvar a partir
de agora recarrega sozinho na página.

## Minuto 4 — a extensão de verdade

Substitua o conteúdo de `playground/frases/src/extension.ts` por:

```ts
import * as vscode from "vscode";
import { Extension, Command, Config, StatusBar, Watch, log } from "@sigil/core";

// settings: true → o comando frases.configure abre uma aba de opções
// gerada a partir do schema das @Config
@Extension({ settings: true })
export class FrasesExtension {
  @Config({ description: "Frases para sortear" })
  accessor frases: string[] = [
    "Você consegue!",
    "Um passo de cada vez.",
    "Código bom é código testado.",
  ];

  @Config({ description: "Tom das frases" })
  accessor tom: "zen" | "energia" = "zen";

  // atribuir ao accessor atualiza o item na status bar
  @StatusBar({ alignment: "left", priority: 50, command: "frases.sortear", tooltip: "Sortear uma frase" })
  accessor humor: string = "$(sparkle) Clique para uma frase";

  @Command({
    title: "Sortear frase",
    category: "Frases",
    keybinding: { key: "ctrl+alt+f", mac: "cmd+alt+f" },
  })
  sortear() {
    const frase = this.frases[Math.floor(Math.random() * this.frases.length)]!;
    const emoji = this.tom === "energia" ? "🔥" : "🍃";
    log.info(`sorteada: ${frase}`);
    vscode.window.showInformationMessage(`${frase} ${emoji}`);
    this.humor = `$(sparkle) ${frase}`;
  }

  @Watch("tom")
  aoMudarTom(novo: string) {
    log.info(`tom mudou para ${novo}`);
    this.humor = `$(sparkle) tom: ${novo}`;
  }
}
```

Salve e olhe o browser — **sem apertar nada**: a palette agora tem `Sortear
frase` e `Configure`, a config `frases.tom` virou um select, e a status bar
mostra `$(sparkle) Clique para uma frase`. O que você acabou de usar:

- `frases` (array) e `tom` (união de literais → enum no Settings) — **tipo e
  default saem da declaração TypeScript**, não de um schema duplicado;
- `@StatusBar` — um accessor cujo `set` atualiza o item; note o
  `command: "frases.sortear"` (se você digitar um id errado, o build falha
  com `SIGIL1017` apontando a linha);
- `@Watch("tom")` — mude o select `frases.tom` na página e veja a status bar
  reagir na hora;
- `log.info` — as linhas aparecem no painel Output da página (e, no VSCode
  real, num Output Channel com nível controlado pelo usuário);
- se `sortear()` lançar um erro, ele **não some**: vira log com stack e
  notificação com botão "Abrir logs" (filosofia R6, em runtime).

Clique em `Sortear frase` e veja o toast, a status bar e o log mudarem juntos.

## Minuto 5 — VSCode de verdade e o pacote final

```bash
npx sigil sandbox playground/frases
```

Abre um **VSCode real e isolado** (não toca no seu) com a extensão carregada:
`cmd+alt+f` sorteia, a status bar responde, `Frases: Configure` abre a aba de
opções. Edite o corpo de `sortear()` com a janela aberta — o terminal mostra
`🔥 hot swap aplicado (~3ms)` e o comportamento novo já vale, **sem reload**.
Mude algo de identidade (um `title`, uma config nova) e a janela recarrega
sozinha. Para gerar o `.vsix` instalável:

```bash
cd playground/frases && npm run package
```

## O que você NÃO fez

Nenhum `contributes` à mão. Nenhum `registerCommand`. Nenhum boilerplate de
output channel, try/catch de handler ou schema de configuração. Nenhum F5.

## Próximos passos

- **TreeView e Webview**: veja [examples/todos](../examples/todos) (tree
  interativa com container próprio na activity bar) e
  [examples/notes](../examples/notes) (webview de sidebar com RPC tipado).
- **Testes**: `@sigil/test` ativa o bundle real num simulador —
  [examples/counter/test](../examples/counter/test/extension.test.ts) é o
  padrão a copiar.
- **Referência completa**: [README](../README.md) e [spec](spec.md).
