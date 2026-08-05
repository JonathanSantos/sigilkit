import * as vscode from "vscode";
import { registry } from "../registry";
import { bucketOf } from "../metadata";

/**
 * O trio de persistência do sigil, tudo no mesmo modelo accessor do @Config:
 *
 * - @State("global" | "workspace") → Memento (ctx.globalState/workspaceState)
 * - @Secret() → SecretStorage (com cache síncrono pré-carregado pelo wire)
 * - @ContextKey() → setContext, para usar em cláusulas `when` — e o compilador
 *   VALIDA os `when` que referenciam as keys declaradas (SIGIL1018)
 */

export function State(scope: "global" | "workspace" = "global") {
  return function <T>(
    _target: ClassAccessorDecoratorTarget<any, T>,
    ctx: ClassAccessorDecoratorContext<any, T>
  ): ClassAccessorDecoratorResult<any, T> {
    const name = String(ctx.name);
    const metadata = ctx.metadata;
    const memento = (): vscode.Memento | undefined =>
      scope === "workspace" ? registry.context?.workspaceState : registry.context?.globalState;
    return {
      get() {
        const stored = memento()?.get<T>(name);
        if (stored !== undefined) return stored;
        return bucketOf(metadata).configDefaults.get(name) as T;
      },
      set(value: T) {
        void memento()?.update(name, value);
      },
      init(initial: T) {
        bucketOf(metadata).configDefaults.set(name, initial);
        return initial;
      },
    };
  };
}

export function Secret() {
  return function (
    _target: ClassAccessorDecoratorTarget<any, string | undefined>,
    ctx: ClassAccessorDecoratorContext<any, string | undefined>
  ): ClassAccessorDecoratorResult<any, string | undefined> {
    const name = String(ctx.name);
    return {
      get() {
        return registry.secretsCache.get(name);
      },
      set(value: string | undefined) {
        if (value === undefined) {
          registry.secretsCache.delete(name);
          void registry.context?.secrets.delete(name);
        } else {
          registry.secretsCache.set(name, value);
          void registry.context?.secrets.store(name, value);
        }
      },
      init(initial: string | undefined) {
        return initial;
      },
    };
  };
}

/** Pré-carrega os @Secret no cache síncrono e acompanha mudanças externas. */
export async function bindSecrets(names: readonly string[]): Promise<vscode.Disposable> {
  const secrets = registry.context?.secrets;
  if (!secrets) return { dispose() {} };
  for (const name of names) {
    const value = await secrets.get(name);
    if (value !== undefined) registry.secretsCache.set(name, value);
  }
  return secrets.onDidChange((e) => {
    if (!names.includes(e.key)) return;
    void secrets.get(e.key).then((value) => {
      if (value === undefined) registry.secretsCache.delete(e.key);
      else registry.secretsCache.set(e.key, value);
    });
  });
}

export function ContextKey() {
  return function <T>(
    _target: ClassAccessorDecoratorTarget<any, T>,
    ctx: ClassAccessorDecoratorContext<any, T>
  ): ClassAccessorDecoratorResult<any, T> {
    const name = String(ctx.name);
    const metadata = ctx.metadata;
    return {
      get() {
        const id = `${registry.prefix}.${name}`;
        if (registry.contextValues.has(id)) return registry.contextValues.get(id) as T;
        return bucketOf(metadata).configDefaults.get(name) as T;
      },
      set(value: T) {
        const id = `${registry.prefix}.${name}`;
        registry.contextValues.set(id, value);
        void vscode.commands.executeCommand("setContext", id, value);
      },
      init(initial: T) {
        bucketOf(metadata).configDefaults.set(name, initial);
        return initial;
      },
    };
  };
}

export interface ContextKeyBinding {
  readonly id: string; // "hello.pronto"
  readonly default: unknown;
}

/** Publica os valores iniciais das @ContextKey na ativação. */
export function bindContextKeys(bindings: readonly ContextKeyBinding[]): void {
  for (const b of bindings) {
    registry.contextValues.set(b.id, b.default);
    void vscode.commands.executeCommand("setContext", b.id, b.default);
  }
}
