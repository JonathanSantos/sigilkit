import { Extension, Config } from "@sigilkit/core";

@Extension({ prefix: "fx" })
export class Fx {
  @Config({ description: "modo de execução" })
  accessor mode: "fast" | "slow" = "fast";

  @Config()
  accessor tags: string[] = ["a", "b"];

  @Config()
  accessor enabled = true;

  @Config({ description: "antiga", deprecationMessage: "use mode" })
  accessor legacy: string = "x";
}
