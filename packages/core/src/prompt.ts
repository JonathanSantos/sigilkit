import * as vscode from "vscode";

/**
 * Fluxos de input sem o boilerplate do MultiStepInput: passos sequenciais,
 * ESC volta um passo (no primeiro, cancela tudo → undefined). Cada passo
 * recebe o resultado parcial dos anteriores.
 */

export interface PromptStep<T = unknown> {
  run(partial: Record<string, unknown>): Thenable<T | undefined>;
}

export interface TextStepOptions {
  prompt?: string;
  placeHolder?: string;
  value?: string;
  password?: boolean;
  validate?(value: string): string | undefined;
}

function text(opts: TextStepOptions = {}): PromptStep<string> {
  return {
    run: () =>
      vscode.window.showInputBox({
        prompt: opts.prompt,
        placeHolder: opts.placeHolder,
        value: opts.value,
        password: opts.password,
        validateInput: opts.validate,
      }),
  };
}

export interface PickStepOptions {
  placeHolder?: string;
}

function pick<T extends string>(
  items: readonly T[] | ((partial: Record<string, unknown>) => readonly T[]),
  opts: PickStepOptions = {}
): PromptStep<T> {
  return {
    run: (partial) => {
      const list = typeof items === "function" ? items(partial) : items;
      return vscode.window.showQuickPick([...list], { placeHolder: opts.placeHolder }) as Thenable<T | undefined>;
    },
  };
}

function confirm(message: string): PromptStep<boolean> {
  return {
    run: async () => {
      const choice = await vscode.window.showQuickPick(["Sim", "Não"], { placeHolder: message });
      if (choice === undefined) return undefined;
      return choice === "Sim";
    },
  };
}

async function steps<T extends Record<string, PromptStep>>(
  specs: T
): Promise<{ [K in keyof T]: T[K] extends PromptStep<infer V> ? V : never } | undefined> {
  const keys = Object.keys(specs) as (keyof T)[];
  const result: Record<string, unknown> = {};
  let index = 0;
  while (index < keys.length) {
    const key = keys[index]!;
    const value = await specs[key]!.run(result);
    if (value === undefined) {
      if (index === 0) return undefined; // ESC no primeiro passo cancela o fluxo
      index--; // ESC volta um passo
      continue;
    }
    result[String(key)] = value;
    index++;
  }
  return result as { [K in keyof T]: T[K] extends PromptStep<infer V> ? V : never };
}

export const prompt = { text, pick, confirm, steps };
