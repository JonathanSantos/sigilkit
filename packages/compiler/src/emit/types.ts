import { IR } from "../ir";

/** IR → src/.generated/config.d.ts: interface das configs + helper tipado. */
export function emitTypes(ir: IR): string {
  const lines = ir.configs.map((c) => `  ${JSON.stringify(c.id)}: ${c.tsType};`);
  return `// GERADO POR sigil — NÃO EDITE
export interface SigilConfig {
${lines.join("\n")}
}

export declare function getConfig<K extends keyof SigilConfig>(key: K): SigilConfig[K];
`;
}
