import { Extension, Command, Config } from "@sigilkit/core";

@Extension({ prefix: "fx" })
export class Fx {
  @Config({ description: "%fx.desc%" })
  accessor nivel: number = 1;

  @Command({ title: "%fx.title%" })
  a() {}
}
