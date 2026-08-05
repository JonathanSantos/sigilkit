# pets — case de rewrite: o host do vscode-pets em sigil

O experimento: pegar uma extensão real e querida do marketplace —
[vscode-pets](https://github.com/tonybaloney/vscode-pets) (⭐4k, MIT, de
Anthony Shaw) — e reescrever **só o host** com sigil, mantendo o app dos
bichinhos **intacto**.

## Os números

| | upstream | este case |
|---|---|---|
| host (`src/extension`) | **1.347 linhas** | **~260 linhas** |
| `contributes` no package.json | **293 linhas à mão** | **0 (derivado)** |
| app da UI (`ui-src/`) | — | **byte-idêntico** (cópia de `src/panel` + `src/common`) |
| código novo do lado UI | — | `ui/boot.js`: **~35 linhas** de adaptação |
| ids públicos dos comandos | `vscode-pets.start`, … | **os mesmos** — via `@Command({ id })` |

## O que o rewrite exercita

- `@Command({ id })` mantendo os ids públicos do upstream (um drop-in não
  quebraria keybindings de usuários);
- **enum de config derivado de tipo SEMÂNTICO**: `accessor petType: PetType`
  onde `PetType = keyof typeof CORES_POR_TIPO` — a inferência resolve o alias
  via checker (melhoria do sigil que este case fez nascer);
- `@State("global")` para os bichos adotados (os 3 arrays paralelos de
  Memento do upstream viram um array de objetos);
- `prompt.steps` com **passo dependente** (as cores oferecidas dependem do
  bicho escolhido; ESC volta um passo) — substitui o fluxo de QuickPicks
  encadeados na mão;
- `editor.openText` no export — as ~30 linhas de documento untitled do
  upstream viram 1 chamada;
- `@Watch` nas configs empurrando `set-size`/`throw-with-mouse`/
  `disable-effects` para o app, como o `onDidChangeConfiguration` deles;
- o **tick de animação** (100ms, como no upstream) vivendo no painel.

## As 3 descobertas do glue (`ui/boot.js`)

1. **Protocolos diferentes**: o app fala `{command, …}`; o roteador do sigil
   roteia por `type`. O boot adapta a direção UI→host em 3 linhas (e o
   `petPanelApp` aceita o `stateApi` injetado — nem foi preciso interceptar
   `acquireVsCodeApi`).
2. **Config por mensagem, não por interpolação**: o upstream injeta as
   configs no HTML a cada abertura; o shell do sigil serve HTML estático. O
   boot faz o handshake `ready` → `init`.
3. **O gate do `load`**: o app arma a animação num listener de `window.load` —
   que no boot-inline do upstream ainda não disparou, mas no nosso init
   por mensagem já passou. Um `dispatchEvent(new Event("load"))` destrava.

## Rodar

```bash
npm run build -w pets
node packages/cli/bin/sigil.js sim --ui examples/pets    # bichos no browser
node packages/cli/bin/sigil.js sandbox examples/pets     # bichos num VSCode real
```

## Atribuição

`ui-src/` e `media/` vêm de [tonybaloney/vscode-pets](https://github.com/tonybaloney/vscode-pets)
(MIT — [LICENSE-upstream](LICENSE-upstream)), com um subconjunto dos bichos
(dog, fox, crab) para manter o repositório leve. Este exemplo é um estudo de
caso do framework, não uma publicação concorrente da extensão original. ❤️
