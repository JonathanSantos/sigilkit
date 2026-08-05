import { Extension, StatusBar } from "@sigil/core";

@Extension({ prefix: "fx" })
export class Fx {
  @StatusBar({ command: "fx.missing" })
  accessor status: string = "hi";
}
