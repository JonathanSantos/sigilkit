import { Extension, LmTool } from "@sigilkit/core";

@Extension({ prefix: "fx" })
export class Fx {
  @LmTool({ description: "input não derivável" })
  ferramenta(input: Map<string, number>): string {
    return String(input.size);
  }
}
