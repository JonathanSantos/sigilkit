import { Extension, Command } from "@sigilkit/core";

let opts = { title: "X" };

@Extension({ prefix: "fx" })
export class Fx {
  @Command(opts)
  run() {}
}
