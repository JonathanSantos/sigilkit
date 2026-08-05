import { Extension, Command } from "@sigil/core";

const opts = { title: "X" };

@Extension({ prefix: "fx" })
export class Fx {
  @Command(opts)
  run() {}
}
