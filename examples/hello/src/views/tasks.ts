import * as vscode from "vscode";
import { Command, TreeChildren, TreeItem, TreeRoot, TreeView, registry } from "@sigilkit/core";

interface TaskNode {
  id: string;
  label: string;
  children?: TaskNode[];
}

const TASKS: TaskNode[] = [
  {
    id: "build",
    label: "Build",
    children: [
      { id: "compile", label: "Compilar" },
      { id: "bundle", label: "Bundle" },
    ],
  },
  { id: "test", label: "Testes" },
];

@TreeView({ id: "tasks", name: "Tasks", container: "explorer" })
export class TasksView {
  @TreeRoot()
  roots(): TaskNode[] {
    return TASKS;
  }

  @TreeChildren()
  children(node: TaskNode): TaskNode[] {
    return node.children ?? [];
  }

  @TreeItem()
  render(node: TaskNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label);
    item.id = node.id;
    item.collapsibleState = node.children?.length
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;
    return item;
  }

  @Command({ title: "Refresh tasks", icon: "$(refresh)", menu: "view/title" })
  refreshTasks() {
    registry.trees.get("TasksView")!.fire();
  }
}
