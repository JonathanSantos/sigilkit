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

// Tree rasa (sem @TreeChildren) sobre estado mutável. Os comandos de menu
// "view/*" ganham `when: view == todos.list` automático — não aparecem em
// views de outras extensões.
@TreeView({ id: "list", name: "Todos", container: "explorer" })
export class TodoList {
  @TreeRoot()
  roots(): Todo[] {
    return getConfig<boolean>("todos.showCompleted")
      ? store.todos
      : store.todos.filter((t) => !t.done);
  }

  @TreeItem()
  render(todo: Todo): vscode.TreeItem {
    const item = new vscode.TreeItem(todo.done ? `✓ ${todo.label}` : todo.label);
    item.id = String(todo.id);
    item.contextValue = "todo";
    return item;
  }

  @Command({ title: "Add Todo", icon: "$(add)", menu: "view/title" })
  async addTodo() {
    const label = await vscode.window.showInputBox({ prompt: "Novo todo" });
    if (!label) return;
    store.add(label);
    refresh();
  }

  // o VSCode passa o ELEMENTO da tree (nosso Todo) como argumento
  @Command({ title: "Toggle Done", menu: "view/item/context" })
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
