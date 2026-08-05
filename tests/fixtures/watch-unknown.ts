import { Extension, Config, Watch } from "@sigil/core";

@Extension({ prefix: "fx" })
export class Fx {
  @Config({ description: "x" })
  accessor greeting: string = "hi";

  @Watch("missing")
  onChange(next: string, prev: string) {}
}
