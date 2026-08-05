import { Extension, Config } from "@sigilkit/core";

@Extension({ prefix: "fx" })
export class Fx {
  @Config()
  accessor when: Date = "x" as unknown as Date;
}
