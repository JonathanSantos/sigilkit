import * as vscode from "vscode";
import { dual } from "./dual";
import { registry } from "../registry";
import { registerBoundMember } from "../metadata";
import { guard } from "../guard";

/** Container customizado declarado inline; o sigil emite contributes.viewsContainers. */
export interface ViewContainerSpec {
  id: string;
  title: string;
  /** caminho do ícone relativo à raiz da extensão (ex.: "media/icon.svg") */
  icon: string;
  location?: "activitybar" | "panel";
}

export interface TreeViewOptions {
  /** when da view (contributes.views[].when) — validado no build. */
  when?: string;
  id: string;
  name: string;
  container?: "explorer" | "scm" | "debug" | (string & {}) | ViewContainerSpec;
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

/** Método que retorna os nós raiz da árvore. Obrigatório. */
export const TreeRoot = dual(() => registerBoundMember("treeHandlers"));

/** Método que retorna os filhos de um nó. Opcional (árvore rasa sem ele). */
export const TreeChildren = dual(() => registerBoundMember("treeHandlers"));

/** Método que converte um nó em vscode.TreeItem. Obrigatório. */
export const TreeItem = dual(() => registerBoundMember("treeHandlers"));

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
  // R6 na ativação: as chaves precisam existir agora…
  if (
    !registry.treeHandlers.has(binding.rootsKey) ||
    !registry.treeHandlers.has(binding.itemKey) ||
    (binding.childrenKey && !registry.treeHandlers.has(binding.childrenKey))
  ) {
    throw new Error(`sigil: handlers de tree ausentes para ${binding.key}. Rode 'sigil build'.`);
  }

  // …mas o dispatch resolve do registry A CADA chamada: o hot swap troca os
  // handlers por baixo sem re-registrar a view. guard: erro loga e degrada
  // (item de aviso / lista vazia) em vez de quebrar a view em silêncio.
  const safeCall = (what: string, key: string, args: unknown[]): unknown =>
    guard(what, () => {
      const fn = registry.treeHandlers.get(key);
      if (!fn) throw new Error(`sigil: handler ausente para ${key}. Rode 'sigil build'.`);
      return fn(...args);
    })();

  const emitter = new vscode.EventEmitter<void>();
  const provider: vscode.TreeDataProvider<unknown> = {
    onDidChangeTreeData: emitter.event,
    getTreeItem: (el) =>
      (safeCall(`@TreeItem de ${binding.key}`, binding.itemKey, [el]) ??
        new vscode.TreeItem("⚠ erro — veja os logs")) as vscode.TreeItem | Thenable<vscode.TreeItem>,
    getChildren: (el) =>
      ((el === undefined
        ? safeCall(`@TreeRoot de ${binding.key}`, binding.rootsKey, [])
        : binding.childrenKey
          ? safeCall(`@TreeChildren de ${binding.key}`, binding.childrenKey, [el])
          : []) ?? []) as unknown[] | Thenable<unknown[]>,
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
