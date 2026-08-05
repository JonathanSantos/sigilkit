import { Extension, TreeItem, TreeView } from "@sigilkit/core";

@Extension({ prefix: "fx" })
export class Fx {}

@TreeView({ id: "t", name: "T" })
export class Incomplete {
  @TreeItem()
  render(node: unknown) {
    return node;
  }
}
