import * as vscode from "vscode";
import { registry } from "../registry";

export interface TreeViewOptions {
  id: string;
  name: string;
  container?: "explorer" | "scm" | "debug" | (string & {});
}

/**
 * Marca uma classe como TreeView (§15.1). Como todo decorator do sigil, as
 * opções são metadados para a AST — em runtime a classe só precisa existir
 * para os decorators de membro registrarem os handlers na construção.
 */
export function TreeView(_opts: TreeViewOptions) {
  return function <T extends new (...args: any[]) => object>(
    _target: T,
    _ctx: ClassDecoratorContext<T>
  ): void {};
}

function treeHandlerDecorator() {
  return function <This, Value extends (this: This, ...args: any[]) => any>(
    value: Value,
    ctx: ClassMethodDecoratorContext<This, Value>
  ): void {
    ctx.addInitializer(function (this: This) {
      const key = `${(this as object).constructor.name}.${String(ctx.name)}`;
      registry.treeHandlers.set(key, (value as (...args: unknown[]) => unknown).bind(this));
    });
  };
}

/** Método que retorna os nós raiz da árvore. Obrigatório. */
export function TreeRoot() {
  return treeHandlerDecorator();
}

/** Método que retorna os filhos de um nó. Opcional (árvore rasa sem ele). */
export function TreeChildren() {
  return treeHandlerDecorator();
}

/** Método que converte um nó em vscode.TreeItem. Obrigatório. */
export function TreeItem() {
  return treeHandlerDecorator();
}

export interface TreeViewBinding {
  readonly key: string;
  readonly id: string;
  readonly rootsKey: string;
  readonly childrenKey?: string;
  readonly itemKey: string;
}

/**
 * Chamado pelo activate() gerado, depois de instanciar a classe @TreeView.
 * Monta o TreeDataProvider adaptador que delega para os handlers do registry
 * e expõe o refresh via registry.trees (é o que `registry.trees.get(...)!.fire()`
 * usa). Handler ausente lança na ativação (R6).
 */
export function bindTreeView(binding: TreeViewBinding): vscode.Disposable {
  const roots = registry.treeHandlers.get(binding.rootsKey);
  const item = registry.treeHandlers.get(binding.itemKey);
  const children = binding.childrenKey ? registry.treeHandlers.get(binding.childrenKey) : undefined;
  if (!roots || !item || (binding.childrenKey && !children)) {
    throw new Error(`sigil: handlers de tree ausentes para ${binding.key}. Rode 'sigil build'.`);
  }

  const emitter = new vscode.EventEmitter<void>();
  const provider: vscode.TreeDataProvider<unknown> = {
    onDidChangeTreeData: emitter.event,
    getTreeItem: (el) => item(el) as vscode.TreeItem | Thenable<vscode.TreeItem>,
    getChildren: (el) =>
      (el === undefined ? roots() : children ? children(el) : []) as
        | unknown[]
        | Thenable<unknown[]>,
  };

  registry.trees.set(binding.key, { fire: () => emitter.fire() });
  const registration = vscode.window.registerTreeDataProvider(binding.id, provider);
  return {
    dispose() {
      registry.trees.delete(binding.key);
      emitter.dispose();
      registration.dispose();
    },
  };
}
