import { describe, expect, it } from "vitest";
import { createState, createVscodeMock } from "@sigilkit/test";

// Item 12: documentos e editores fake — o suficiente para testar extensões
// que leem/editam o activeTextEditor, sem extension host.

function makeVscode() {
  const state = createState();
  return { state, vscode: createVscodeMock(state) as any };
}

describe("editores e documentos fake", () => {
  it("openTextDocument + showTextDocument definem o activeTextEditor", async () => {
    const { vscode } = makeVscode();
    const doc = await vscode.workspace.openTextDocument({ content: "hello\nworld", language: "markdown" });
    const editor = await vscode.window.showTextDocument(doc);
    expect(vscode.window.activeTextEditor).toBe(editor);
    expect(doc.languageId).toBe("markdown");
    expect(doc.lineCount).toBe(2);
    expect(vscode.workspace.textDocuments).toHaveLength(1);
  });

  it("edit aplica insert/replace/delete com offsets estáveis", async () => {
    const { vscode } = makeVscode();
    const doc = await vscode.workspace.openTextDocument({ content: "hello\nworld" });
    const editor = await vscode.window.showTextDocument(doc);
    await editor.edit((b: any) => {
      b.insert(new vscode.Position(0, 5), "!");
      b.replace(new vscode.Range(new vscode.Position(1, 0), new vscode.Position(1, 5)), "sigil");
    });
    expect(doc.getText()).toBe("hello!\nsigil");
  });

  it("positionAt/offsetAt são inversos", async () => {
    const { vscode } = makeVscode();
    const doc = await vscode.workspace.openTextDocument({ content: "ab\ncde\nf" });
    const offset = doc.offsetAt(new vscode.Position(1, 2)); // "e"
    expect(offset).toBe(5);
    const pos = doc.positionAt(5);
    expect(pos.line).toBe(1);
    expect(pos.character).toBe(2);
    expect(doc.lineAt(1).text).toBe("cde");
  });

  it("showQuickPick registra os itens mostrados (asserção de chamada)", async () => {
    const { state, vscode } = makeVscode();
    state.quickPickQueue.push("b");
    const picked = await vscode.window.showQuickPick(["a", "b"], { placeHolder: "escolha" });
    expect(picked).toBe("b");
    expect(state.quickPickCalls).toEqual([{ items: ["a", "b"], options: { placeHolder: "escolha" } }]);
  });
});
