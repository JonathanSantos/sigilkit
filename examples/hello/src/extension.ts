import * as vscode from "vscode";
import {
  Extension,
  Command,
  Config,
  Watch,
  Activate,
  StatusBar,
  Language,
  Hover,
  Diagnostics,
  log,
  registry,
} from "@sigilkit/core";

// settings: true → comando hello.configure abre a aba de configurações
// pronta do sigil, com formulário derivado do schema das @Config
@Extension({ prefix: "hello", settings: true })
export class HelloExtension {
  @Config({ description: "Texto exibido na saudação" })
  accessor greeting: string = "Olá";

  @Config({ description: "Número de tentativas", minimum: 1, maximum: 10 })
  accessor retries: number = 3;

  // atribuir ao accessor atualiza o item da status bar
  @StatusBar({ alignment: "left", priority: 100, command: "hello.sayHello", tooltip: "Diga olá" })
  accessor status: string = "$(megaphone) Olá";

  @Command({ title: "Say hello", category: "Hello", keybinding: "ctrl+alt+h" })
  sayHello() {
    log.info(`saudação exibida: ${this.greeting}`);
    vscode.window.showInformationMessage(`${this.greeting}!`);
    this.status = `$(megaphone) ${this.greeting}!`;
  }

  @Command({ title: "Reset", when: "editorFocus", menu: "editor/context" })
  reset() {
    this.greeting = "Olá";
  }

  @Command({ title: "Open settings", category: "Hello" })
  openSettings() {
    return registry.webviews.get("SettingsPanel")!.open();
  }

  @Watch("greeting")
  onGreetingChanged(next: string, prev: string) {
    console.log(`greeting: ${prev} → ${next}`);
  }

  @Activate
  onActivate(ctx: vscode.ExtensionContext) {
    // opcional; roda depois do wiring
  }
}

// Providers de linguagem: o sigil emite "activationEvents": ["onLanguage:markdown"]
// e registra os providers com dispatch dinâmico (hot-swappable).
@Language({ id: "markdown" })
export class MarkdownAssist {
  @Hover()
  hover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover {
    return new vscode.Hover(`Linha ${pos.line + 1} de ${doc.lineCount} — ${doc.getText().length} caracteres`);
  }

  @Diagnostics({ on: "change" })
  pendencias(doc: vscode.TextDocument): vscode.Diagnostic[] {
    const found: vscode.Diagnostic[] = [];
    const lines = doc.getText().split("\n");
    for (let i = 0; i < lines.length; i++) {
      const col = lines[i]!.indexOf("TODO");
      if (col >= 0) {
        found.push(
          new vscode.Diagnostic(
            new vscode.Range(new vscode.Position(i, col), new vscode.Position(i, col + 4)),
            "pendência anotada",
            vscode.DiagnosticSeverity.Warning
          )
        );
      }
    }
    return found;
  }
}
