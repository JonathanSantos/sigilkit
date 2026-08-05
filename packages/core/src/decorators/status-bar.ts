import * as vscode from "vscode";
import { registry } from "../registry";
import { bucketOf } from "../metadata";

export interface StatusBarOptions {
  alignment?: "left" | "right";
  priority?: number;
  /** id de comando executado ao clicar no item */
  command?: string;
  tooltip?: string;
  name?: string;
}

/**
 * §15.3 item 4. Um accessor cujo VALOR é o texto do item: atribuir a ele
 * atualiza a status bar. Alignment/priority/command são metadados lidos da
 * AST; o texto default vem do initializer. Tudo via bucket (ctx.metadata) —
 * nenhuma dependência de nome de classe em runtime.
 */
export function StatusBar(_opts: StatusBarOptions = {}) {
  return function <T>(
    _target: ClassAccessorDecoratorTarget<any, T>,
    ctx: ClassAccessorDecoratorContext<any, T>
  ): ClassAccessorDecoratorResult<any, T> {
    const name = String(ctx.name);
    const metadata = ctx.metadata;
    return {
      get() {
        return (bucketOf(metadata).statusBarText.get(name) ?? "") as T;
      },
      set(value: T) {
        const bucket = bucketOf(metadata);
        const text = String(value);
        bucket.statusBarText.set(name, text);
        const item = bucket.statusBarItems.get(name);
        if (item) item.text = text;
      },
      init(initial: T) {
        bucketOf(metadata).statusBarText.set(name, String(initial));
        return initial;
      },
    };
  };
}

export interface StatusBarBinding {
  readonly key: string;
  readonly alignment?: "left" | "right";
  readonly priority?: number;
  readonly command?: string;
  readonly tooltip?: string;
  readonly name?: string;
}

/**
 * Chamado pelo activate() gerado, DEPOIS de adoptRegistrations — o bucket da
 * classe já está em registry.buckets sob o nome declarado.
 */
export function bindStatusBar(binding: StatusBarBinding): vscode.Disposable {
  const dot = binding.key.indexOf(".");
  const className = binding.key.slice(0, dot);
  const member = binding.key.slice(dot + 1);
  const bucket = registry.buckets.get(className);
  if (!bucket) {
    throw new Error(`sigil: classe ${className} não adotada — rode 'sigil build'.`);
  }

  const item = vscode.window.createStatusBarItem(
    binding.alignment === "right" ? vscode.StatusBarAlignment.Right : vscode.StatusBarAlignment.Left,
    binding.priority
  );
  item.text = bucket.statusBarText.get(member) ?? "";
  if (binding.tooltip !== undefined) item.tooltip = binding.tooltip;
  if (binding.command !== undefined) item.command = binding.command;
  if (binding.name !== undefined) item.name = binding.name;
  item.show();
  bucket.statusBarItems.set(member, item);
  return {
    dispose() {
      bucket.statusBarItems.delete(member);
      item.dispose();
    },
  };
}
