import { Extension, Command } from "@sigil/core";

@Extension({ prefix: "fx" })
export class Fx {
  @Command({ title: "A" })
  run() {}

  @Command({ title: "B" })
  static run() {}
}
