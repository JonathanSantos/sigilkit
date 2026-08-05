import { Extension, Config } from "@sigil/core";

@Extension({ prefix: "fx" })
export class Fx {
  @Config()
  accessor when: Date = "x" as unknown as Date;
}
