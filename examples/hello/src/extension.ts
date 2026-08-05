import * as vscode from "vscode";
import { Extension, Command, Config, Watch, Activate, StatusBar, registry } from "@sigil/core";

@Extension({ prefix: "hello" })
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

  @Activate()
  onActivate(ctx: vscode.ExtensionContext) {
    // opcional; roda depois do wiring
  }
}
