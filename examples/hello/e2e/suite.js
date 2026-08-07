// Roda DENTRO do extension host real. Sem mocha: exports.run retorna uma
// Promise — resolve = sucesso, reject = falha.
const assert = require("node:assert");
const vscode = require("vscode");

exports.run = async function run() {
  const ext = vscode.extensions.getExtension("sigil-example.hello");
  assert.ok(ext, "extensão sigil-example.hello encontrada no host");
  await ext.activate();

  // manifesto e wire em sincronia: todos os comandos derivados existem
  const commands = await vscode.commands.getCommands(true);
  for (const id of ["hello.sayHello", "hello.reset", "hello.openSettings", "hello.refreshTasks"]) {
    assert.ok(commands.includes(id), `comando ${id} registrado`);
  }

  // config declarada no manifesto com default lido da AST
  assert.strictEqual(vscode.workspace.getConfiguration("hello").get("greeting"), "Olá");

  // executar os comandos não lança (join registry ↔ wire íntegro)
  await vscode.commands.executeCommand("hello.sayHello");
  await vscode.commands.executeCommand("hello.refreshTasks");
  await vscode.commands.executeCommand("hello.openSettings");

  // ── fornada de IA no host REAL — o que o simulador não pune ─────────────
  // manifesto aceito pelo host, com o schema derivado do tipo
  const tools = ext.packageJSON.contributes.languageModelTools;
  const saud = tools.find((t) => t.name === "hello_saudacao");
  assert.ok(saud, "tool hello_saudacao no contributes");
  assert.strictEqual(saud.inputSchema.properties.nome.description, "quem deve ser saudado");
  assert.deepStrictEqual(saud.inputSchema.properties.entusiasmo.enum, ["baixo", "alto"]);
  assert.deepStrictEqual(saud.inputSchema.required, ["nome"]);

  // registro real: o host VALIDA o nome do registerTool contra o contributes
  assert.ok(
    vscode.lm.tools.some((t) => t.name === "hello_saudacao"),
    "tool registrada em vscode.lm.tools"
  );

  // invocação como o agent mode faz: RPC real, token real, resultado precisa
  // ser um LanguageModelToolResult de verdade (o wrapToolResult do core)
  const cts = new vscode.CancellationTokenSource();
  const resultado = await vscode.lm.invokeTool(
    "hello_saudacao",
    { input: { nome: "Mundo", entusiasmo: "alto" }, toolInvocationToken: undefined },
    cts.token
  );
  const texto = resultado.content
    .filter((p) => p instanceof vscode.LanguageModelTextPart)
    .map((p) => p.value)
    .join("");
  assert.strictEqual(texto, "Olá, Mundo!!!", "tool executou com input tipado e voltou pelo RPC");

  // o contrato de classes que o llm.agent monta (par Assistant/User por callId)
  // existe no host com estas assinaturas — se o VSCode mudar, este E2E acusa
  const chamada = new vscode.LanguageModelToolCallPart("c1", "hello_saudacao", {});
  vscode.LanguageModelChatMessage.Assistant([chamada]);
  vscode.LanguageModelChatMessage.User([
    new vscode.LanguageModelToolResultPart("c1", [new vscode.LanguageModelTextPart("ok")]),
  ]);

  // MCP: o registro no activate passou pela validação id × contributes do host
  assert.ok(
    ext.packageJSON.contributes.mcpServerDefinitionProviders.some((m) => m.id === "hello.servidores"),
    "provedor MCP declarado e aceito"
  );

  // ── chat no host real: participante + slash command declarados e registrados
  const chatPart = ext.packageJSON.contributes.chatParticipants.find((c) => c.id === "hello.hello");
  assert.ok(chatPart, "participante hello.hello no contributes");
  assert.deepStrictEqual(
    chatPart.commands.map((c) => c.name),
    ["greet"],
    "slash command /greet declarado"
  );
  // a API de chat existe e o bind registrou sem lançar (a ativação passou);
  // não há API pública para DISPARAR uma chat request — cobertura de
  // comportamento fica no simulador (host.chatRequest)
  assert.ok(typeof vscode.chat?.createChatParticipant === "function", "API de chat presente no host");

  // ── custom editor no host real: openWith resolve o provider registrado
  const os = require("node:os");
  const fsMod = require("node:fs");
  const caps = require("node:path").join(os.tmpdir(), `sigil-e2e-${Date.now()}.caps`);
  fsMod.writeFileSync(caps, "grite comigo");
  const capsUri = vscode.Uri.file(caps);
  await vscode.commands.executeCommand("vscode.openWith", capsUri, "hello.caps");
  const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs);
  const capsTab = tabs.find(
    (t) => t.input instanceof vscode.TabInputCustom && t.input.viewType === "hello.caps"
  );
  assert.ok(capsTab, "aba do custom editor hello.caps aberta com o documento");
  fsMod.rmSync(caps, { force: true });

  console.log("E2E: caminho feliz OK no extension host real (comandos, config, tools de IA, MCP, chat e custom editor)");
};
