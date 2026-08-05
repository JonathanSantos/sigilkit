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

  console.log("E2E: caminho feliz OK no extension host real");
};
