/**
 * AGENTS.md gerado pelo `sigil init`: o manual do framework no formato que
 * agentes de IA leem primeiro. A tese: na era dos agentes, o valor do sigil
 * é dar um loop de verificação por máquina (erros altos com posição +
 * simulador headless) — este arquivo ensina o agente a usá-lo.
 */

export function agentsMd(name: string, react: boolean): string {
  return `# AGENTS.md — como trabalhar neste projeto (sigil)

Este projeto usa o **sigil** (\`@sigilkit/*\`): um framework declarativo para
extensões do VSCode onde o TypeScript é a fonte única de verdade — o
\`package.json\` (bloco \`contributes\`), o \`activate()\` e os tipos de config
são GERADOS a partir dos decorators em \`src/\`.

## Regras de ouro

1. **NUNCA edite \`src/.generated/**\`** nem o bloco \`contributes\`/chaves
   gerenciadas do \`package.json\` — são regenerados pelo build e sua edição
   será sobrescrita. Toda mudança acontece nos decorators em \`src/\`.
2. **Depois de mudar qualquer decorator, rode \`npm run build\`** — regenera
   manifesto, wire e tipos. \`npx sigil check .\` falha se o manifesto
   commitado estiver stale (use como verificação barata).
3. **Erros do sigil são acionáveis**: diagnósticos \`SIGIL1000–1022\` vêm com
   arquivo/linha e dizem o remédio. Erros de runtime idem ("handler ausente
   para X. Rode 'sigil build'"). Leia a mensagem — ela é a instrução.
4. **Verifique com o simulador, não com F5.** Você não consegue clicar na
   UI do VSCode; o \`@sigilkit/test\` ativa o bundle real headless e expõe
   sondas para TUDO (comandos, configs, trees, webviews, chat, tools de IA,
   testes). O loop editar→buildar→testar roda inteiro no terminal.

## Comandos

| Comando | O que faz |
|---|---|
| \`npm run build\` | UI (se houver) + \`sigil build\` (AST → manifesto/wire/tipos) + bundle esbuild |
| \`npx sigil check .\` | falha se o manifesto está dessincronizado do código |
| \`npx sigil dev .\` | watch incremental (~3ms por rebuild) |
| \`npm run sim\` | simulador com hot reload + REPL (\`run <cmd>\`, \`set <config>\`, \`tree\`, \`logs\`) |
| \`npm run sandbox\` | VSCode REAL isolado com hot swap sem F5 |
| \`npm test\` | seus testes (vitest + @sigilkit/test) |

## Decorators (referência rápida)

Classe \`@Extension({ prefix, settings? })\` — a extensão. Membros:
- \`@Command({ title, id?, keybinding?, menu?, when?, enablement?, progress? })\` método → comando
- \`@Config({ description?, minimum?, maximum? })\` **accessor** → configuração (tipo/default/enum saem da declaração TS; união de literais vira enum)
- \`@Watch("chave")\` método → reage a mudança de config
- \`@Activate\` / \`@Deactivate\` métodos → lifecycle
- \`@StatusBar({ alignment?, command? })\` **accessor** → item vivo (atribuir atualiza o texto)
- \`@State("global"|"workspace")\` **accessor** → persistência; **REATRIBUA** (\`this.x = [...]\`) — mutação interna (\`push\`) NÃO persiste
- \`@Secret()\` **accessor** → SecretStorage · \`@ContextKey()\` **accessor** → setContext + habilita validação de \`when\`
- \`@On("ns.evento")\` / \`@OnFile(glob, kind)\` / \`@UriHandler()\` / \`@Every(ms)\` métodos
- \`@LmTool({ description, referenceName? })\` método → tool do Copilot; o **inputSchema é derivado do tipo do 1º parâmetro** (JSDoc→description, união→enum, opcional→não-required)
- \`@McpServers({ label })\` método → retorne \`{label, command, args}\` (stdio) ou \`{label, uri}\` (http)

Outras classes (uma responsabilidade por classe):
- \`@TreeView({ name, container?, when? })\` + \`@TreeRoot\`/\`@TreeChildren\`/\`@TreeItem\` (+ \`@Command\` com menu \`view/title\`)
- \`@Webview({ id, title, ui, location? })\` + \`@OnMessage("tipo")\`/\`@OnRequest("tipo")\` — \`location\`: \`"panel"\` (default), \`"sidebar"\` ou \`"dual"\` (painel E sidebar); \`ui:\` é relativo à RAIZ do projeto; declare \`post!: (msg: ...) => void\` para enviar host→UI
- \`@Language({ id })\` + \`@Hover\`/\`@Completion\`/\`@CodeLens\`/\`@Diagnostics\`/\`@InlineCompletion\`/\`@CodeAction\`/\`@Definition\`/\`@References\`/\`@Rename\`/\`@Formatting\`/\`@Symbols\`/\`@InlayHints\` — \`@Formatting\` pode retornar o documento formatado como **string**
- \`@ChatParticipant({ id, name })\` + \`@ChatRequest\`/\`@ChatCommand("nome")\`/\`@ChatFollowups\`
- \`@CustomEditor({ id, filenamePattern, ui })\` — handlers recebem \`SigilEditorContext\` como 2º argumento (\`editor.getText()\`, \`editor.applyEdit(novoTexto)\`)
- \`@TestController({ label })\` + \`@TestDiscover\` (retorne nós \`{id, label, children?}\`) + \`@TestRun\` (retorne \`true\`/\`false\`/\`{passed, message?}\` por folha)

Plataforma (\`import { ... } from "@sigilkit/core"\`): \`log.info/warn/error\`,
\`http.get/post/send\` (fetch com timeout/HttpError), \`prompt.text/pick/confirm/steps\`,
\`editor.openText(texto, { language, beside })\`, \`llm.ask/stream/agent\`,
\`registry.instance(Classe)\` (ponte tipada entre classes),
\`registry.panel(ClasseWebview)\` (\`post\`/\`open()\`/\`isOpen\` sem strings),
\`getConfig("${name}.chave")\` (tipado por chave — chave errada retorna \`unknown\`).

## O servidor MCP (se o seu ambiente suporta, prefira-o)

Este projeto registra o servidor MCP do sigil automaticamente (\`.mcp.json\`
para o Claude Code, \`.vscode/mcp.json\` para o Copilot). Quatro tools:

- \`sigil_check\` — diagnósticos estruturados (code/file/line) sem escrever nada
- \`sigil_build\` — regenera manifesto/wire/tipos
- \`sigil_probe\` — executa a extensão na sessão VIVA do simulador; **se você
  editou código, ele rebuilda e reativa sozinho** — edite e sonde, sem pensar
  em build. kinds: \`command\`/\`config\`/\`tree\`/\`panelRequest\`/\`invokeTool\`/
  \`chatRequest\`/\`runTests\`/\`logs\`
- \`sigil_docs\` — busca na referência oficial da API (use antes de chutar
  uma assinatura)

Sem MCP, o mesmo loop existe via terminal (abaixo).

## O loop de verificação (use SEMPRE)

\`\`\`ts
import { activateExtension } from "@sigilkit/test";

const host = await activateExtension({ projectDir: "." }); // ativa o bundle REAL
await host.executeCommand("${name}.minhaAcao");
host.infoMessages;                                  // notificações exibidas
host.logText();                                     // logs como texto
host.configuration.set("${name}.chave", "valor");   // dispara @Watch
await host.tree("${name}.minhaView").roots();       // nós da tree
const panel = host.panel("${name}.painel");         // webview: panel.request(tipo, valor) faz RPC
await host.invokeTool("${name}_minhaTool", { ... }); // @LmTool sem Copilot
await host.chatRequest("${name}.guru", "oi", { command: "fix" });
await host.runTests("${name}.meusTestes");          // @TestController
await host.dispose();
\`\`\`

Mais sondas: \`commands\`, \`statusBarItems\`, \`contextKey(id)\`, \`secrets\`,
\`openTextDocument(texto, lang)\` + \`provideHover/CodeActions/Definition/
References/RenameEdits/FormattingEdits/DocumentSymbols/InlayHints/
InlineCompletions\`, \`diagnosticsFor(doc)\`, \`lmTools\`, \`mcpServers(id)\`,
\`queueLlmResponse(...)\` (roteiriza \`llm.*\`; aceita \`{text, toolCalls}\`),
\`testItems(id)\`. API não simulada **lança erro descritivo** — nunca retorna
\`undefined\` silencioso.

## Erros comuns → remédio

- \`SIGIL1018\` (\`when\`/\`enablement\` com token desconhecido): o token com o
  prefixo \`${name}.\` precisa ser uma \`@ContextKey\`, view ou comando declarado.
- \`SIGIL1021\` (@LmTool): o input precisa ser objeto de primitivos/uniões de
  literais/arrays/objetos — \`Map\`/\`Date\`/função não viram schema.
- \`SIGIL1022\`: \`@OnOpen\`/\`@OnDispose\`/\`@Every\` na classe errada (vivem em
  \`@Webview\`/\`@CustomEditor\`; \`@Every\` também na \`@Extension\`).
- "handler ausente para X. Rode 'sigil build'": o wire está velho — builde.
- Decorator exige \`accessor\`: \`@Config\`/\`@State\`/\`@Secret\`/\`@ContextKey\`/
  \`@StatusBar\` são \`accessor nome = default\`, não \`property\`.
- tsconfig: \`"include"\` PRECISA de \`"src/.generated/**/*"\` (globs do tsc não
  atravessam diretórios com ponto). esbuild PRECISA de \`--target=es2022\`.
${react ? `
## A UI React (protocolo tipado)

- \`ui/sigil-env.d.ts\` é GERADO pelo build: tipa \`postToHost\`/\`callHost\`/
  \`onHostMessage\` (de \`@sigilkit/core/ui\`) pelas chaves dos \`@OnMessage\`/
  \`@OnRequest\` da classe \`MainPanel\` — typo em chave é erro de
  typecheck da UI (\`tsc -p ui\`). Nunca edite esse arquivo.
- Hooks prontos em \`ui/src/hooks/useHost.ts\` (\`useHostRequest\`/\`useHostMessage\`).
- O bundle da UI é seu (\`npm run build:ui\`); \`npm run sim\` sobe host + UI com
  hot reload dos dois lados.
` : ""}
## Documentação

**A API inteira numa página** (feita para o seu contexto):
https://raw.githubusercontent.com/JonathanSantos/sigilkit/main/docs/reference.md
Índice para máquinas:
https://raw.githubusercontent.com/JonathanSantos/sigilkit/main/llms.txt
Repo: https://github.com/JonathanSantos/sigilkit (README, docs/spec.md,
docs/tutorial.md).
`;
}

/** CLAUDE.md fino: importa o AGENTS.md (sintaxe @ de imports do Claude Code). */
export function claudeMdPointer(): string {
  return `Este projeto usa o framework sigil. O manual para agentes está em:

@AGENTS.md
`;
}
