import { createHash } from "node:crypto";
import { IR } from "./ir";

/**
 * Hash canônico do IR — a chave do cache incremental (§7): hash igual → não
 * reemite. Estável porque o IR é construído com ordem determinística (§8.5)
 * e chaves inseridas em ordem fixa.
 */
export function hashIR(ir: IR): string {
  return createHash("sha256").update(JSON.stringify(ir)).digest("hex");
}
