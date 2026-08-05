import { CONDITIONAL_CONTRIBUTES, OWNED_CONTRIBUTES, type Contributes } from "@sigil/compiler";

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
export function mergePackageJson(pkgText: string, emitted: Contributes, activationEvents: string[] = []): string {
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
  // condicionais: substituídas quando emitidas, preservadas quando ausentes
  for (const key of CONDITIONAL_CONTRIBUTES) {
    const value = emitted[key];
    if (!isEmpty(value)) contributes[key] = value;
  }

  // activationEvents: o sigil é dono só do subconjunto onLanguage:* — o resto
  // (onStartupFinished etc.) é do usuário e fica intacto
  const existing = Array.isArray(pkg.activationEvents) ? (pkg.activationEvents as string[]) : [];
  const userEvents = existing.filter((e) => !e.startsWith("onLanguage:"));
  const merged = [...new Set([...userEvents, ...activationEvents])].sort();
  if (merged.length > 0) pkg.activationEvents = merged;
  else delete pkg.activationEvents;

  return JSON.stringify(pkg, null, 2) + "\n";
}
