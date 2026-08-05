import { IR } from "../ir";

/**
 * IR → src/.generated/config.d.ts.
 *
 * Além da interface com as configs, o arquivo AUMENTA o módulo "@sigil/core":
 * SigilConfigRegistry ganha as chaves desta extensão e o `getConfig` real do
 * core passa a ser tipado por chave — `getConfig("hello.retries")` → number,
 * com autocomplete e sem nenhum import novo. (Melhoria sobre o §10.3 do spec,
 * cujo `declare function` não ligava a runtime nenhum.)
 */
export function emitTypes(ir: IR): string {
  const lines = ir.configs.map((c) => `  ${JSON.stringify(c.id)}: ${c.tsType};`);
  return `// GERADO POR sigil — NÃO EDITE
import "@sigil/core";

export interface SigilConfig {
${lines.join("\n")}
}

declare module "@sigil/core" {
  interface SigilConfigRegistry extends SigilConfig {}
}
`;
}
