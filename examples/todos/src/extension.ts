import * as vscode from "vscode";
import {
  Extension,
  Command,
  Config,
  Watch,
  TreeView,
  TreeRoot,
  TreeItem,
  registry,
  getConfig,
} from "@sigil/core";

export interface Todo {
  id: number;
  label: string;
  done: boolean;
}

const store = {
  todos: [] as Todo[],
  nextId: 1,
  add(label: string): void {
    this.todos.push({ id: this.nextId++, label, done: false });
  },
  toggle(id: number): void {
    const todo = this.todos.find((t) => t.id === id);
    if (todo) todo.done = !todo.done;
  },
  clearDone(): void {
    this.todos = this.todos.filter((t) => !t.done);
  },
};

function refresh(): void {
  registry.trees.get("TodoList")!.fire();
}

@Extension()
export class TodosExtension {
  @Config({ description: "Exibir também os todos concluídos" })
  accessor showCompleted: boolean = true;

  @Watch("showCompleted")
  onShowCompletedChanged() {
    refresh();
  }
}

// título via const: o avaliador estático segue `const` com initializer literal
const ADD_TODO_TITLE = "Add Todo";

// Tree rasa (sem @TreeChildren) sobre estado mutável, num container CUSTOMIZADO
// declarado inline — o sigil emite contributes.viewsContainers. Os comandos de
// menu "view/*" ganham `when: view == todos.list` automático.
@TreeView({
  id: "list",
  name: "Todos",
  container: { id: "todos-suite", title: "Todos", icon: "media/icon.svg" },
})
export class TodoList {
  @TreeRoot()
  roots(): Todo[] {
    // tipado pelo config.d.ts gerado (augmentation): a anotação `: boolean`
    // é uma prova estática — se a augmentation quebrar, isto vira unknown
    // e o typecheck falha
    const showCompleted: boolean = getConfig("todos.showCompleted");
    return showCompleted ? store.todos : store.todos.filter((t) => !t.done);
  }

  @TreeItem()
  render(todo: Todo): vscode.TreeItem {
    const item = new vscode.TreeItem(todo.done ? `✓ ${todo.label}` : todo.label);
    item.id = String(todo.id);
    item.contextValue = "todo";
    return item;
  }

  @Command({ title: ADD_TODO_TITLE, icon: "$(add)", menu: "view/title" })
  async addTodo() {
    const label = await vscode.window.showInputBox({ prompt: "Novo todo" });
    if (!label) return;
    store.add(label);
    refresh();
  }

  // o VSCode passa o ELEMENTO da tree (nosso Todo) como argumento;
  // forma por-entrada de menu: group "inline" mostra a ação no próprio item
  @Command({ title: "Toggle Done", icon: "$(check)", menu: [{ id: "view/item/context", group: "inline" }] })
  toggleDone(todo: Todo) {
    store.toggle(todo.id);
    refresh();
  }

  @Command({ title: "Clear Completed", category: "Todos" })
  clearCompleted() {
    store.clearDone();
    refresh();
  }
}
