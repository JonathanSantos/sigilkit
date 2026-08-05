import { OWNED_CONTRIBUTES, type Contributes } from "@sigil/compiler";

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

/**
 * §11 — nunca sobrescreve o arquivo inteiro. Substitui integralmente cada
 * chave gerenciada (removendo as vazias) e preserva todo o resto, inclusive
 * a ordem das chaves (JSON.parse preserva ordem de inserção de chaves string).
 * Função pura: texto → texto; o IO fica no build.
 */
export function mergePackageJson(pkgText: string, emitted: Contributes): string {
  const pkg = JSON.parse(pkgText) as Record<string, unknown>;
  if (typeof pkg.contributes !== "object" || pkg.contributes === null) {
    pkg.contributes = {};
  }
  const contributes = pkg.contributes as Record<string, unknown>;
  for (const key of OWNED_CONTRIBUTES) {
    const value = emitted[key];
    if (isEmpty(value)) delete contributes[key];
    else contributes[key] = value;
  }
  return JSON.stringify(pkg, null, 2) + "\n";
}
