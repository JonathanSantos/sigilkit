import * as vscode from "vscode";

/**
 * Renderização "vscode-native" de conteúdo: em vez de reinventar viewer em
 * webview, abre um documento VIRTUAL (untitled, sem tocar o disco) num editor
 * real — syntax highlight, folding, busca e o tema do usuário, de graça.
 */
export const editor = {
  /** Abre `content` num editor. `language` é o id do VSCode ("json", "html", …). */
  async openText(
    content: string,
    opts: { language?: string; beside?: boolean } = {}
  ): Promise<void> {
    const doc = await vscode.workspace.openTextDocument({
      content,
      language: opts.language ?? "plaintext",
    });
    await vscode.window.showTextDocument(doc, {
      preview: true,
      viewColumn: opts.beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
    });
  },
};
