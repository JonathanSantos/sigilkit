import { Extension, Command, ContextKey } from "@sigilkit/core";

@Extension({ prefix: "fx" })
export class Fx {
  @ContextKey()
  accessor pronto = false;

  @Command({ title: "A", enablement: "fx.pronto &&& editorFocus" })
  a() {}
}
