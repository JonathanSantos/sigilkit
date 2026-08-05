import { Extension, Config } from "@sigilkit/core";

@Extension({ prefix: "fx" })
export class Fx {
  // erro de propósito: @Config exige a palavra-chave `accessor` (§6)
  // @ts-expect-error
  @Config({ description: "x" })
  greeting: string = "hi";
}
