import { Extension, Command } from "@sigilkit/core";

@Extension({ prefix: "fx" })
export class Fx {}

export class Other {
  @Command({ title: "X" })
  run() {}
}
