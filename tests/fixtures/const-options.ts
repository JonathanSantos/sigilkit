import { Extension, Command, Config } from "@sigilkit/core";

const TITLE = "From Const";
const OPTS = { title: "Object Const", category: "Fx" } as const;
const DEFAULT_GREETING = "hi";

@Extension({ prefix: "fx" })
export class Fx {
  @Config({ description: "d" })
  accessor greeting: string = DEFAULT_GREETING;

  @Command({ title: TITLE })
  a() {}

  @Command(OPTS)
  b() {}
}
