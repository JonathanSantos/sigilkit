> **Nota de rename:** o projeto foi batizado de **sigil** — leia `vscx` como
> `sigil` ao longo deste documento (`@vscx/core` → `@sigil/core`, `vscx build`
> → `sigil build`, códigos `VSCX####` → `SIGIL####` etc.). O texto abaixo é o
> spec original, preservado verbatim como fonte da verdade do design.
> Desvios conscientes da implementação estão listados no CLAUDE.md.

# vscx — framework declarativo para extensões do VSCode

Spec de implementação. Escrito para ser executado por um agente de codificação.

---

## 0. Como usar este documento

- As **fases** (seção 12) são a ordem de execução. Não pule fases.
- Cada fase tem **critério de aceite binário**. Só avance quando ele passar.
- A seção 13 lista armadilhas já conhecidas. Leia antes de escrever código.
- Onde houver código neste doc, ele é **normativo**: assinaturas e nomes devem bater.

---

## 1. Objetivo

Eliminar a dupla declaração no desenvolvimento de extensões do VSCode.

Hoje, todo comando/menu/keybinding/configuração precisa existir em dois lugares:
no bloco `contributes` do `package.json` **e** no código que registra o handler.
Nada garante sincronia. Renomear um id no código e esquecer do manifesto produz
um comando que simplesmente não aparece — sem erro, sem aviso.

`vscx` faz do arquivo TypeScript a **fonte única de verdade** e deriva o manifesto
dele em build time.

### Não-objetivos

- Não é um framework de UI reativa. É um **problema de codegen**.
- Não substitui a API `vscode`. O usuário continua chamando `vscode.window.*` à vontade.
- Não suporta todo o `contributes`. Suporta um subconjunto e **preserva** o resto.

---

## 2. Regras de arquitetura (invioláveis)

Estas regras não são preferência de estilo. Violá-las quebra o build de formas
difíceis de diagnosticar.

**R1 — `core` nunca importa `typescript`.**
`core` vai para dentro do bundle da extensão. Importar o compilador do TS levaria
dezenas de MB para o extension host.

**R2 — `compiler` nunca importa `vscode`.**
O módulo `vscode` só existe dentro do extension host. Ele não é resolvível em
build time. Qualquer import dele no compilador quebra o `vscx build`.

**R3 — O compilador nunca executa o código do usuário.**
Toda informação vem de leitura da AST. Nunca `import()`, nunca `require()`,
nunca `eval`. Isso é o que torna R2 possível.

**R4 — Emitters são funções puras.**
Assinatura `(ir: IR) => string | object`. Nenhum IO dentro de emitter. Todo
acesso a disco acontece nas bordas (CLI). Isso torna emitters testáveis por snapshot.

**R5 — Nenhum arquivo gerado é editado à mão.**
Todo arquivo emitido começa com header de aviso e está no `.gitignore`
(exceto o `package.json`, que é merge).

**R6 — Falhar alto, nunca silenciosamente.**
Chave faltando, id duplicado, literal não estático: tudo vira erro com posição
no arquivo. O modo de falha proibido é "não acontece nada".

> Adicione um teste que percorre os imports de `packages/core` e `packages/compiler`
> e falha se R1 ou R2 forem violadas. É barato e evita meses de dor.

---

## 3. Estrutura de pastas

```
vscx/
├── package.json                 workspaces
├── tsconfig.base.json
├── packages/
│   ├── core/                    RUNTIME — vai para o bundle da extensão
│   │   ├── src/
│   │   │   ├── index.ts         re-exports públicos
│   │   │   ├── registry.ts      Map<key, handler>
│   │   │   ├── decorators/
│   │   │   │   ├── extension.ts
│   │   │   │   ├── command.ts
│   │   │   │   ├── config.ts
│   │   │   │   ├── watch.ts
│   │   │   │   ├── tree-view.ts
│   │   │   │   └── webview.ts
│   │   │   ├── config-access.ts leitura tipada de workspace config
│   │   │   └── webview-host.ts  shell HTML, CSP, canal de mensagens
│   │   └── package.json
│   │
│   ├── compiler/                BUILD TIME — nunca entra no bundle
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── ir.ts            tipos do IR + versão do schema
│   │   │   ├── collect/
│   │   │   │   ├── program.ts   cria ts.Program
│   │   │   │   ├── visitor.ts   percorre classes e membros
│   │   │   │   ├── static-eval.ts
│   │   │   │   └── type-to-schema.ts
│   │   │   ├── validate.ts      regras semânticas → diagnósticos
│   │   │   ├── diagnostics.ts   construção de ts.Diagnostic
│   │   │   └── emit/
│   │   │       ├── manifest.ts  IR → contributes
│   │   │       ├── wire.ts      IR → wire.ts
│   │   │       └── types.ts     IR → config.d.ts
│   │   └── package.json
│   │
│   └── cli/                     ORQUESTRAÇÃO
│       ├── src/
│       │   ├── index.ts         entrypoint bin
│       │   ├── build.ts
│       │   ├── check.ts
│       │   ├── dev.ts           watch mode
│       │   └── merge-pkg.ts     merge preservando chaves não-gerenciadas
│       └── package.json
│
└── examples/
    └── hello/                   extensão real usada como fixture E2E
```

---

## 4. O modelo de propriedade

Esta é a decisão central do design. Existem duas fontes possíveis de verdade
(a AST em build time, o registry em runtime). Para evitar que divirjam, cada uma
é dona de uma metade disjunta:

| | Dono | Por quê |
|---|---|---|
| **Identidade** — ids, títulos, `when`, keybindings, schema de config | Compilador (AST) | Precisa existir no `package.json` antes de qualquer código rodar |
| **Comportamento** — as funções handler | Runtime (registry) | Codegen de corpo de função gera sourcemap ruim e debug pior |

A ponte entre os dois é uma **chave estável**:

```
key = `${NomeDaClasse}.${nomeDoMembro}`
```

O compilador emite a lista de chaves esperadas. O runtime preenche o registry.
O `activate()` gerado faz o join e **lança erro** se faltar chave. Dessincronização
vira exceção na ativação, em vez de comando fantasma.

### Por que decorators são metadados, não comportamento

O `@Command({ title: "..." })` quase não faz nada em runtime — ele só registra
o handler no registry. O objeto de opções é **ignorado em runtime** e existe
apenas para ser lido da AST.

Consequência direta e obrigatória: **argumentos de decorator devem ser literais**.

```ts
@Command({ title: "Say hello" })   // ✅ legível na AST
@Command(myOptions)                 // ❌ erro de compilação do vscx
```

Este é o mesmo modelo do Stencil, pela mesma razão.

---

## 5. Superfície pública (a DX)

O arquivo que o usuário escreve:

```ts
import * as vscode from "vscode";
import { Extension, Command, Config, Watch, Activate } from "@vscx/core";

@Extension({ prefix: "hello" })
export class HelloExtension {
  @Config({ description: "Texto exibido na saudação" })
  accessor greeting: string = "Olá";

  @Config({ description: "Número de tentativas", minimum: 1, maximum: 10 })
  accessor retries: number = 3;

  @Command({ title: "Say hello", category: "Hello", keybinding: "ctrl+alt+h" })
  sayHello() {
    vscode.window.showInformationMessage(`${this.greeting}!`);
  }

  @Command({ title: "Reset", when: "editorFocus", menu: "editor/context" })
  reset() {
    this.greeting = "Olá";
  }

  @Watch("greeting")
  onGreetingChanged(next: string, prev: string) {
    console.log(`greeting: ${prev} → ${next}`);
  }

  @Activate()
  onActivate(ctx: vscode.ExtensionContext) {
    // opcional; roda depois do wiring
  }
}
```

Nenhuma linha de `package.json` é escrita à mão.

### Derivação de identidade

| Campo | Regra |
|---|---|
| `prefix` | de `@Extension({ prefix })`; default = campo `name` do `package.json` |
| id de comando | `${prefix}.${nomeDoMetodo}` |
| id de config | `${prefix}.${nomeDaPropriedade}` |
| chave de registry | `${NomeDaClasse}.${nomeDoMembro}` |

### Opções aceitas

```ts
interface ExtensionOptions { prefix?: string }

interface CommandOptions {
  title: string;
  category?: string;
  icon?: string;
  when?: string;
  keybinding?: string | { key: string; mac?: string; when?: string };
  menu?: string | string[];       // ex: "editor/context", "commandPalette"
  group?: string;
  enablement?: string;
}

interface ConfigOptions {
  description?: string;
  scope?: "application" | "machine" | "window" | "resource";
  enum?: string[];
  minimum?: number;
  maximum?: number;
  deprecationMessage?: string;
}
```

O **tipo** e o **default** de uma config NÃO vão no decorator. São inferidos da
declaração da propriedade (seção 8.3). Evita duplicar informação que o TS já tem.

---

## 6. Por que `accessor` em `@Config`

Decision record — não mude sem entender.

`@Config` precisa que ler `this.greeting` retorne o valor **atual** do workspace,
não um valor congelado na construção. Isso exige substituir a propriedade por
um par get/set.

No spec **stage 3** de decorators (padrão no TS 5.x), um decorator de campo
**não pode** transformar um campo em accessor — só pode retornar um initializer.
O único decorator que pode devolver `{ get, set }` é o de **auto-accessor**, que
exige a palavra-chave `accessor`.

Portanto:

```ts
@Config({ description: "..." })
accessor greeting: string = "Olá";
```

Requisitos de tsconfig que isso impõe:

```jsonc
{
  "target": "ES2022",
  "experimentalDecorators": false,   // stage 3, NÃO legacy
  "useDefineForClassFields": true
}
```

> Alternativa rejeitada: decorators legacy (`experimentalDecorators: true`).
> Funcionaria com campo simples, mas é o spec antigo, está em caminho de
> depreciação, e `emitDecoratorMetadata` exigiria `reflect-metadata` no bundle.
> Como toda a informação de tipo já vem da AST, não há nada a ganhar.

Implementação do decorator:

```ts
export function Config(_opts: ConfigOptions = {}) {
  return function <T>(
    _target: ClassAccessorDecoratorTarget<any, T>,
    ctx: ClassAccessorDecoratorContext<any, T>
  ): ClassAccessorDecoratorResult<any, T> {
    const name = String(ctx.name);
    return {
      get() {
        return readWorkspaceConfig<T>(this.constructor.name, name);
      },
      set(value: T) {
        void writeWorkspaceConfig(this.constructor.name, name, value);
      },
      init(initial: T) {
        registry.configDefaults.set(`${this.constructor.name}.${name}`, initial);
        return initial;
      },
    };
  };
}
```

O `init` captura o valor default em runtime, mas o **compilador também o lê da AST**
— o runtime aqui é conveniência, o manifesto usa a versão da AST.

---

## 7. O IR

Não vá de AST direto para `package.json`. Passe por um IR normalizado e serializável.
Ganhos: emitters viram funções puras testáveis; `loc` dá diagnóstico com posição;
o IR serializado é a chave do cache incremental (hash igual → não reemite).

```ts
// packages/compiler/src/ir.ts

export const IR_VERSION = 1;

export interface SourceLoc {
  file: string;
  line: number;
  character: number;
}

export interface IRCommand {
  key: string;            // "HelloExtension.sayHello"
  id: string;             // "hello.sayHello"
  title: string;
  category?: string;
  icon?: string;
  when?: string;
  enablement?: string;
  keybinding?: { key: string; mac?: string; when?: string };
  menus: { menu: string; group?: string; when?: string }[];
  loc: SourceLoc;
}

export interface IRConfig {
  key: string;            // "HelloExtension.greeting"
  id: string;             // "hello.greeting"
  jsonType: "string" | "number" | "boolean" | "array" | "object";
  tsType: string;         // texto do tipo, para o config.d.ts
  default: unknown;
  description?: string;
  scope?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  loc: SourceLoc;
}

export interface IRWatch {
  key: string;            // "HelloExtension.onGreetingChanged"
  targetConfigId: string; // "hello.greeting"
  loc: SourceLoc;
}

export interface IRTreeView {
  key: string;
  id: string;
  name: string;
  container: "explorer" | "scm" | "debug" | string;
  rootsKey: string;
  childrenKey?: string;
  itemKey: string;
  loc: SourceLoc;
}

export interface IRWebview {
  key: string;
  id: string;
  title: string;
  uiEntry: string;                       // caminho relativo do HTML
  messageHandlers: { type: string; key: string }[];
  loc: SourceLoc;
}

export interface IR {
  version: number;
  prefix: string;
  extensionClass: string;
  sourceFile: string;
  activateKey?: string;
  deactivateKey?: string;
  commands: IRCommand[];
  configs: IRConfig[];
  watches: IRWatch[];
  treeViews: IRTreeView[];
  webviews: IRWebview[];
}
```

---

## 8. O coletor

### 8.1 API do TS 5.x — atenção

`node.decorators` **foi removido** no TypeScript 5. Use os helpers:

```ts
import ts from "typescript";

export function getDecorator(
  node: ts.Node,
  checker: ts.TypeChecker,
  name: string
): ts.Decorator | undefined {
  if (!ts.canHaveDecorators(node)) return undefined;
  const decs = ts.getDecorators(node) ?? [];
  return decs.find((d) => resolveDecoratorName(d, checker) === name);
}
```

### 8.2 Compare pelo símbolo, não pelo texto

Comparar `d.expression.expression.text === "Command"` dá falso positivo se o
usuário tiver um `@Command` de outra biblioteca. Resolva o símbolo e verifique
que a declaração vem de `@vscx/core`:

```ts
function resolveDecoratorName(d: ts.Decorator, checker: ts.TypeChecker): string | undefined {
  const expr = ts.isCallExpression(d.expression) ? d.expression.expression : d.expression;
  const sym = checker.getSymbolAtLocation(expr);
  const decl = sym?.declarations?.[0] ?? checker.getAliasedSymbol(sym!)?.declarations?.[0];
  const file = decl?.getSourceFile().fileName ?? "";
  if (!file.includes("@vscx/core") && !file.includes("packages/core")) return undefined;
  return sym?.name;
}
```

### 8.3 Inferência de schema a partir do tipo

Leia o `TypeNode` da propriedade, não um campo do decorator.

| Tipo TS | `jsonType` | Extra |
|---|---|---|
| `string` | `"string"` | |
| `number` | `"number"` | |
| `boolean` | `"boolean"` | |
| `string[]` | `"array"` | `items: { type: "string" }` |
| `"a" \| "b"` | `"string"` | `enum: ["a", "b"]` |
| object literal type | `"object"` | |
| qualquer outro | — | **erro**: tipo não suportado |

### 8.4 Avaliador estático

Impõe a restrição de literais e é a maior fonte de diagnóstico útil.

```ts
export function evalStatic(node: ts.Expression): unknown {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    return -(evalStatic(node.operand) as number);
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(evalStatic);
  if (ts.isObjectLiteralExpression(node)) {
    const out: Record<string, unknown> = {};
    for (const p of node.properties) {
      if (!ts.isPropertyAssignment(p)) {
        throw new StaticEvalError(p, "spread e shorthand não são suportados aqui");
      }
      out[p.name.getText()] = evalStatic(p.initializer);
    }
    return out;
  }
  throw new StaticEvalError(node, "o valor precisa ser um literal");
}
```

`StaticEvalError` carrega o `ts.Node` para virar diagnóstico com posição.

### 8.5 Ordem de percurso

1. Cria `ts.Program` a partir do `tsconfig.json` do projeto do usuário.
2. Para cada `SourceFile` não-declaração, para cada `ClassDeclaration`:
   - procura `@Extension`; se ausente, pula a classe;
   - **erro** se houver mais de uma classe `@Extension` no projeto.
3. Dentro da classe:
   - `MethodDeclaration` → procura `@Command`, `@Watch`, `@Activate`, `@Deactivate`, `@OnMessage`, `@TreeRoot`, `@TreeChildren`, `@TreeItem`;
   - `PropertyDeclaration` com modificador `accessor` → procura `@Config`;
   - **erro** se `@Config` estiver em propriedade sem `accessor`.
4. Emite o IR ordenado deterministicamente (ordena arrays por `id`) — determinismo
   é obrigatório para `vscx check` funcionar.

---

## 9. Validação

Regras semânticas que rodam sobre o IR, cada uma produzindo `ts.Diagnostic` com `loc`:

| Código | Regra |
|---|---|
| `VSCX1001` | argumento de decorator não é literal estático |
| `VSCX1002` | id de comando duplicado |
| `VSCX1003` | id de config duplicado |
| `VSCX1004` | `@Watch("x")` referencia config inexistente |
| `VSCX1005` | keybinding duplicado dentro da extensão |
| `VSCX1006` | `@Config` em propriedade sem `accessor` |
| `VSCX1007` | tipo de config não suportado |
| `VSCX1008` | membro decorado em classe sem `@Extension` |
| `VSCX1009` | mais de uma classe `@Extension` no projeto |
| `VSCX1010` | `@Command` sem `title` |

Formatação: use o formatador do próprio TS, que já desenha o caret apontando
para o token errado.

```ts
console.error(ts.formatDiagnosticsWithColorAndContext(diags, formatHost));
```

---

## 10. Emitters

### R4 vale aqui: funções puras, sem IO.

### 10.1 Manifesto

`emitManifest(ir: IR): Partial<Contributes>` retorna **apenas** as chaves gerenciadas:

```ts
const OWNED_CONTRIBUTES = ["commands", "configuration", "menus", "keybindings", "views"] as const;
```

O merge (seção 11) preserva tudo que não estiver nessa lista.

Sobre `activationEvents`: no VSCode 1.74+ os `onCommand:` são **gerados
automaticamente** a partir de `contributes.commands`. Não emita esses eventos.
Fixe `"engines": { "vscode": "^1.75.0" }` no template e documente.

### 10.2 Wire

Use **template strings**, não `ts.factory`. O factory API é feito para transformação
in-place; para emitir arquivo novo ele é várias vezes mais verboso e ilegível.
Guarde o factory para quando houver um transformer de verdade.

```ts
export function emitWire(ir: IR): string {
  const cmds = ir.commands.map((c) => ({ key: c.key, id: c.id }));
  return `// GERADO POR vscx — NÃO EDITE
import * as vscode from "vscode";
import { registry, bindConfigWatchers } from "@vscx/core";
import { ${ir.extensionClass} } from "${relativeImport(ir.sourceFile)}";

const COMMANDS = ${JSON.stringify(cmds, null, 2)} as const;
const WATCHES = ${JSON.stringify(ir.watches, null, 2)} as const;

let instance: ${ir.extensionClass} | undefined;

export function activate(ctx: vscode.ExtensionContext) {
  instance = new ${ir.extensionClass}();
  for (const c of COMMANDS) {
    const fn = registry.commands.get(c.key);
    if (!fn) throw new Error(\`vscx: handler ausente para \${c.key}. Rode 'vscx build'.\`);
    ctx.subscriptions.push(vscode.commands.registerCommand(c.id, fn));
  }
  ctx.subscriptions.push(bindConfigWatchers(WATCHES));
${ir.activateKey ? `  registry.lifecycle.get(${JSON.stringify(ir.activateKey)})?.(ctx);` : ""}
}

export function deactivate() {
${ir.deactivateKey ? `  registry.lifecycle.get(${JSON.stringify(ir.deactivateKey)})?.();` : ""}
  instance = undefined;
}
`;
}
```

O `throw` do handler ausente é a materialização de R6.

### 10.3 Tipos

`emitTypes(ir)` gera uma interface a partir das configs e um helper tipado:

```ts
// GERADO POR vscx — NÃO EDITE
export interface VscxConfig {
  "hello.greeting": string;
  "hello.retries": number;
}

export declare function getConfig<K extends keyof VscxConfig>(key: K): VscxConfig[K];
```

---

## 11. Merge do `package.json`

**Nunca sobrescreva o arquivo inteiro.**

Algoritmo:

1. Lê o `package.json` do usuário preservando ordem de chaves.
2. Garante `contributes` existente.
3. Para cada chave em `OWNED_CONTRIBUTES`: substitui integralmente pelo valor emitido.
   Se o emitido for vazio, **remove** a chave.
4. Toda outra chave dentro de `contributes` fica intacta.
5. Escreve com `JSON.stringify(obj, null, 2) + "\n"`.

Isso permite ao usuário escrever à mão o que o framework ainda não suporta
(`viewsContainers`, `languages`, `grammars`, `snippets`) sem perder no próximo build.

### `vscx check`

Regenera tudo em memória e compara com o disco. Sai com código 1 se divergir.
Vai no CI. É o que garante que ninguém commita manifesto desatualizado.
Como o IR é ordenado deterministicamente (seção 8.5), a comparação é estável.

---

## 12. Fases de implementação

### Fase 1 — Núcleo

Escopo: `@Extension`, `@Command`, `@Config`, coletor, IR, `emitManifest`, `emitWire`,
merge do `package.json`, `vscx build`.

Fora de escopo: `@Watch`, TreeView, Webview, diagnósticos bonitos, watch mode.

**Critério de aceite:**
Em `examples/hello`, rodar `vscx build`, apertar `F5`, e:

1. `Hello: Say hello` aparece na command palette;
2. executá-lo mostra a mensagem;
3. `hello.greeting` aparece em Settings com a descrição correta;
4. o `package.json` não foi editado à mão;
5. remover o `@Command` e rodar `vscx build` remove a entrada do manifesto.

### Fase 2 — Robustez

- `diagnostics.ts` com todos os códigos da seção 9 e formatação via TS.
- `vscx check`.
- `@Watch` + `bindConfigWatchers` sobre `onDidChangeConfiguration`.
- `vscx dev` — watch mode.
- Cache incremental por hash do IR.
- Snapshot tests (seção 14).

**Critério de aceite:** id de comando duplicado produz erro com caret apontando
para a linha certa; `vscx check` falha em manifesto stale; alterar `hello.greeting`
em Settings dispara o `@Watch`.

### Fase 3 — UI

Seção 15. Só comece depois que a Fase 2 estiver verde.

---

## 13. Armadilhas conhecidas

**`node.decorators` não existe no TS 5.** Use `ts.canHaveDecorators` + `ts.getDecorators`.

**Minificação quebra `this.constructor.name`.** A chave de registry depende do nome
da classe. Configure `keepNames: true` no esbuild da extensão e documente isso no
template gerado por `vscx init`. Se preferir robustez, use `ctx.metadata`
(`Symbol.metadata`, stage 3) em vez do nome — mas exige polyfill em runtimes antigos.

**`accessor` exige `target: ES2022`.** Com target menor o TS emite erro obscuro.

**Não confunda os dois specs de decorator.** Com `experimentalDecorators: true`
a assinatura é `(target, key, descriptor)` e o código da seção 6 não compila.
Fixe `false`.

**Ordem determinística é requisito, não polimento.** Sem ela o `vscx check` vira
falso positivo intermitente.

**O import do wire para o arquivo do usuário é relativo.** Calcule a partir de
`src/.generated/` para o `sourceFile` do IR. Erre aqui e o build da extensão quebra
com "cannot find module".

**Emitters não podem ler disco.** Se um emitter precisar de algo do `package.json`
(como o `prefix` default), esse valor entra no IR na fase de coleta.

---

## 14. Testes

Ordem de valor decrescente:

**1. Snapshot de IR.** Pasta `fixtures/` com arquivos `.ts` de entrada e snapshot
do IR de saída. Como o IR é JSON puro, o diff é legível e regressão do coletor
aparece na hora. É a camada de maior retorno — construa primeiro.

**2. Snapshot de emitter.** `IR fixo → string esperada`. Trivial porque emitters
são puros (R4).

**3. Teste de merge.** `package.json` com chaves não-gerenciadas → verifica que
sobreviveram.

**4. Teste de fronteira.** Percorre imports e falha se R1 ou R2 forem violadas.

**5. E2E no Extension Host.** `@vscode/test-electron` sobre `examples/hello`.
Caro e lento; só um caminho feliz.

---

## 15. Fase 3 — Definição de UI

Aqui a DX diverge em dois mundos com custos bem diferentes.

### 15.1 TreeView — declarativo, barato

```ts
interface TaskNode { id: string; label: string; children?: TaskNode[] }

@TreeView({ id: "tasks", name: "Tasks", container: "explorer" })
export class TasksView {
  @TreeRoot()
  roots(): TaskNode[] {
    return loadTasks();
  }

  @TreeChildren()
  children(node: TaskNode): TaskNode[] {
    return node.children ?? [];
  }

  @TreeItem()
  render(node: TaskNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label);
    item.collapsibleState = node.children?.length
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;
    return item;
  }

  @Command({ title: "Refresh tasks", icon: "$(refresh)", menu: "view/title" })
  refresh() {
    registry.trees.get("TasksView")!.fire();
  }
}
```

O compilador emite em `contributes.views`; o wire instancia um `TreeDataProvider`
adaptador que delega para as três chaves e expõe o `EventEmitter` de refresh
via `registry.trees`.

Custo baixo, retorno alto. Faça primeiro.

### 15.2 Webview — onde mora o boilerplate real

O que dói hoje, toda vez, do zero: CSP com nonce, `asWebviewUri` para assets
locais, `retainContextWhenHidden`, e message passing sem nenhum tipo.

```ts
type HostToUi = { type: "state"; value: Settings };
type UiToHost =
  | { type: "save"; value: Settings }
  | { type: "reset" };

@Webview({ id: "settings", title: "Settings", ui: "./ui/settings.html" })
export class SettingsPanel {
  @OnMessage("save")
  onSave(value: Settings) {
    persist(value);
    this.post({ type: "state", value });
  }

  @OnMessage("reset")
  onReset() {
    this.post({ type: "state", value: DEFAULTS });
  }

  post!: (msg: HostToUi) => void;   // injetado pelo wire
}
```

O que `core/webview-host.ts` deve gerar:

1. **Shell HTML** — lê o `ui` do disco, injeta nonce, reescreve `src`/`href`
   locais via `webview.asWebviewUri`.
2. **CSP** — `default-src 'none'; script-src 'nonce-{n}'; style-src {cspSource} 'unsafe-inline'; img-src {cspSource} https: data:;`
3. **Roteador de mensagens** — `onDidReceiveMessage` faz dispatch por `msg.type`
   para as chaves de `@OnMessage`; tipo desconhecido vira warning, nunca silêncio (R6).
4. **`post` injetado** — atribuído na instanciação pelo wire.
5. **Runtime do lado UI** — módulo minúsculo exportando `postToHost` e `onHostMessage`,
   com os mesmos tipos compartilhados via `import type`.

Isso resolve a maior parte da dor **sem** camada de componentes. Um JSX próprio
dentro do webview é outro projeto — não misture aqui.

### 15.3 Ordem sugerida da Fase 3

1. `@TreeView` completo.
2. Shell de webview + CSP + `asWebviewUri` (sem tipagem de mensagem ainda).
3. `@OnMessage` + roteador + tipos compartilhados.
4. `@StatusBar`, se ainda houver apetite.

---

## 16. tsconfig de referência

Para o projeto do usuário (`vscx init` gera este arquivo):

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "strict": true,
    "experimentalDecorators": false,
    "useDefineForClassFields": true,
    "sourceMap": true,
    "outDir": "out",
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

Build da extensão com esbuild:

```
esbuild src/.generated/wire.ts --bundle --platform=node --format=cjs \
  --external:vscode --keep-names --sourcemap --outfile=out/extension.js
```

`--keep-names` é obrigatório (seção 13).

> **Errata da implementação:** além de `--keep-names`, o comando acima precisa
> de `--target=es2022`. Sem target o esbuild assume `esnext`, considera
> decorators "suportados" e os deixa **crus** no bundle — e nenhum runtime Node
> os executa hoje. Descoberto por smoke test na Fase 1.
>
> **Errata 2 (include do tsconfig):** `"include": ["src"]` NÃO inclui
> `src/.generated/` — os globs do tsc excluem diretórios que começam com ponto,
> mesmo quando o diretório é nomeado sem wildcard. O include correto é
> `["src", "src/.generated/**/*"]` (o segmento-ponto explícito no padrão
> funciona). Sem isso, o `config.d.ts` gerado (e sua augmentation de tipos)
> fica fora do programa e o typecheck do usuário não vê o wire. Descoberto
> pelo teste negativo de tipos na melhoria do getConfig tipado.
>
> **Errata 3 (§10.3):** o `config.d.ts` do spec declarava um `getConfig` órfão,
> sem ligação com runtime algum. A implementação emite, em vez disso, uma
> module augmentation de `@sigil/core` (interface `SigilConfigRegistry`), que
> tipa por chave o `getConfig` REAL do core — autocomplete e checagem de typo
> sem nenhum import novo.
>
> **Errata 4 (§13/§16):** `--keep-names` deixou de ser obrigatório. A
> implementação adotou a alternativa que a própria §13 sugeria: registro por
> bucket em `ctx.metadata` (`Symbol.metadata`, com polyfill via `Symbol.for`),
> adotado pelo wire sob o nome DECLARADO da classe. `this.constructor.name`
> não é mais usado em lugar nenhum do runtime; há teste que ativa o bundle
> minificado para garantir.
