import { Extension, Command } from "@sigilkit/core";

@Extension({ prefix: "fx" })
export class Fx {
  @Command({ title: "A", keybinding: "ctrl+k" })
  first() {}

  @Command({ title: "B", keybinding: "ctrl+k" })
  second() {}
}
