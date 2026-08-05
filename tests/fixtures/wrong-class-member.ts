import { Extension, TreeView, TreeRoot, TreeItem, Config } from "@sigilkit/core";

@Extension({ prefix: "fx" })
export class Fx {}

@TreeView({ id: "t", name: "T" })
export class Tree {
  @TreeRoot()
  roots(): string[] {
    return [];
  }

  @TreeItem()
  render(node: string) {
    return node;
  }

  @Config({ description: "x" })
  accessor value: string = "a";
}
