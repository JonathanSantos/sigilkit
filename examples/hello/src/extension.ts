import * as vscode from "vscode";
import { Extension, Command, Config, Watch, Activate, registry } from "@sigil/core";

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

  @Command({ title: "Open settings", category: "Hello" })
  openSettings() {
    registry.webviews.get("SettingsPanel")!.open();
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
