import { Extension, Command } from "@sigil/core";

@Extension({ prefix: "fx" })
export class Fx {}

export class Other {
  @Command({ title: "X" })
  run() {}
}
