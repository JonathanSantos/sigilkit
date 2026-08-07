import * as vscode from "vscode";

/**
 * Fluxos de input sem o boilerplate do MultiStepInput: passos sequenciais,
 * ESC volta um passo (no primeiro, cancela tudo → undefined). Cada passo
 * recebe o resultado parcial dos anteriores.
 *
 * F3 do dogfood externo: todo passo também é THENABLE — `await prompt.pick(
 * itens)` funciona avulso, sem `steps` e sem `.run({})`.
 */

export interface PromptStep<T = unknown> extends PromiseLike<T | undefined> {
  run(partial: Record<string, unknown>): Thenable<T | undefined>;
}

/** passo executável em `steps` E aguardável direto (`await prompt.pick(...)`). */
function step<T>(run: (partial: Record<string, unknown>) => Thenable<T | undefined>): PromptStep<T> {
  return {
    run,
    then: (onOk, onErr) => Promise.resolve(run({})).then(onOk, onErr),
  };
}

export interface TextStepOptions {
  prompt?: string;
  placeHolder?: string;
  value?: string;
  password?: boolean;
  validate?(value: string): string | undefined;
}

function text(opts: TextStepOptions = {}): PromptStep<string> {
  return step(() =>
    vscode.window.showInputBox({
      prompt: opts.prompt,
      placeHolder: opts.placeHolder,
      value: opts.value,
      password: opts.password,
      validateInput: opts.validate,
    })
  );
}

export interface PickStepOptions {
  placeHolder?: string;
}

/** item rico de QuickPick: o retorno é `value` (ou o label, sem value). */
export interface RichPickItem<V = unknown> {
  label: string;
  description?: string;
  detail?: string;
  value?: V;
}

type PickItems<T> = readonly (T | RichPickItem)[] | ((partial: Record<string, unknown>) => readonly (T | RichPickItem)[]);

function pick<T extends string>(
  items: readonly T[] | ((partial: Record<string, unknown>) => readonly T[]),
  opts?: PickStepOptions
): PromptStep<T>;
function pick<V>(
  items: readonly RichPickItem<V>[] | ((partial: Record<string, unknown>) => readonly RichPickItem<V>[]),
  opts?: PickStepOptions
): PromptStep<V>;
function pick(items: PickItems<string>, opts: PickStepOptions = {}): PromptStep<unknown> {
  return step(async (partial) => {
    const list = typeof items === "function" ? items(partial) : items;
    const hasRich = list.some((i) => typeof i !== "string");
    if (!hasRich) {
      return vscode.window.showQuickPick([...(list as readonly string[])], { placeHolder: opts.placeHolder });
    }
    const richItems = list.map((i) => (typeof i === "string" ? { label: i } : i)) as vscode.QuickPickItem[];
    const escolha = await vscode.window.showQuickPick(richItems, { placeHolder: opts.placeHolder });
    if (escolha === undefined) return undefined;
    // host real devolve o ITEM; o simulador devolve o valor enfileirado (label)
    const label = typeof escolha === "string" ? escolha : escolha.label;
    const item = list.find((i) => (typeof i === "string" ? i : i.label) === label);
    if (item === undefined) return undefined;
    return typeof item === "string" ? item : ((item as RichPickItem).value ?? item.label);
  });
}

function confirm(message: string): PromptStep<boolean> {
  return step(async () => {
    const choice = await vscode.window.showQuickPick(["Sim", "Não"], { placeHolder: message });
    if (choice === undefined) return undefined;
    return choice === "Sim";
  });
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
