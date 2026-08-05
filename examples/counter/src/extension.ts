import * as vscode from "vscode";
import { Extension, Command, Config, Watch, setConfig } from "@sigil/core";

// O menor sigil possível: sem prefix explícito (deriva do `name` do
// package.json → "counter"), uma classe, um arquivo.
@Extension()
export class CounterExtension {
  private count = 0;

  @Config({ description: "Quanto somar a cada incremento", minimum: 1, maximum: 100 })
  accessor step: number = 1;

  @Config({ description: "Verbosidade das notificações" })
  accessor mode: "silent" | "verbose" = "verbose";

  @Command({
    title: "Increment",
    category: "Counter",
    keybinding: { key: "ctrl+alt+i", mac: "cmd+alt+i" },
  })
  increment() {
    this.count += this.step;
    if (this.mode === "verbose") {
      vscode.window.showInformationMessage(`Counter: ${this.count}`);
    }
  }

  @Command({ title: "Reset", category: "Counter" })
  reset() {
    this.count = 0;
    // setConfig tipado pela augmentation: "counter.step" só aceita number
    void setConfig("counter.step", 1);
    vscode.window.showInformationMessage("Counter: 0");
  }

  @Watch("step")
  onStepChanged(next: number, prev: number) {
    console.log(`step: ${prev} → ${next}`);
  }
}
