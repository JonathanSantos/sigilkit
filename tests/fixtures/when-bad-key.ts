import { Extension, Command, ContextKey } from "@sigil/core";

@Extension({ prefix: "fx" })
export class Fx {
  @ContextKey()
  accessor pronto = false;

  @Command({ title: "A", enablement: "fx.prontto" })
  a() {}
}
