import { Extension, TreeView, TreeRoot, TreeItem } from "@sigil/core";

@Extension({ prefix: "fx" })
export class Fx {}

@TreeView({ id: "t" })
export class Tree {
  @TreeRoot()
  roots(): string[] {
    return [];
  }

  @TreeItem()
  render(node: string) {
    return node;
  }
}
