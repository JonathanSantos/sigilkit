import { Extension, Command } from "@sigilkit/core";

@Extension({ prefix: "fx" })
export class Fx {
  // erro de propósito: @Command sem title (SIGIL1010)
  // @ts-expect-error
  @Command({})
  run() {}
}
