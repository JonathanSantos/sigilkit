import { CONDITIONAL_CONTRIBUTES, OWNED_CONTRIBUTES, type Contributes } from "@sigilkit/compiler";

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

export interface MergeOptions {
  /**
   * Modo ENXERTO (adoção incremental): em vez de substituir integralmente as
   * chaves gerenciadas, faz merge POR IDENTIDADE — entradas manuais (de uma
   * extensão pré-existente) sobrevivem lado a lado com as derivadas. Trade
   * documentado: entrada gerenciada removida do código precisa ser removida
   * do manifesto à mão (sem substituição integral não há como distinguir
   * "manual" de "ex-gerenciada"). Opt-in via `"sigil": { "graft": true }`.
   */
  graft?: boolean;
}

/** identidade de cada entrada nas chaves de array do contributes */
const idOf = (entry: unknown): string | undefined => {
  const e = entry as Record<string, unknown>;
  return (e?.command ?? e?.id) as string | undefined;
};

/** enxerto: mantém entradas existentes cuja identidade não é gerenciada e soma as emitidas */
function graftArray(existing: unknown, emitted: unknown[]): unknown[] {
  const managed = new Set(emitted.map(idOf).filter((v): v is string => v !== undefined));
  const foreign = (Array.isArray(existing) ? existing : []).filter((e) => {
    const id = idOf(e);
    return id === undefined || !managed.has(id);
  });
  return [...foreign, ...emitted];
}

/**
 * §11 — nunca sobrescreve o arquivo inteiro. Substitui integralmente cada
 * chave gerenciada (removendo as vazias) e preserva todo o resto, inclusive
 * a ordem das chaves (JSON.parse preserva ordem de inserção de chaves string).
 * Função pura: texto → texto; o IO fica no build.
 */
export function mergePackageJson(
  pkgText: string,
  emitted: Contributes,
  activationEvents: string[] = [],
  opts: MergeOptions = {}
): string {
  const pkg = JSON.parse(pkgText) as Record<string, unknown>;
  if (typeof pkg.contributes !== "object" || pkg.contributes === null) {
    pkg.contributes = {};
  }
  const contributes = pkg.contributes as Record<string, unknown>;
  for (const key of OWNED_CONTRIBUTES) {
    const value = emitted[key];
    if (opts.graft) {
      graftKey(contributes, key, value);
      continue;
    }
    if (isEmpty(value)) delete contributes[key];
    else contributes[key] = value;
  }
  // condicionais: substituídas quando emitidas, preservadas quando ausentes
  for (const key of CONDITIONAL_CONTRIBUTES) {
    const value = emitted[key];
    if (!isEmpty(value)) {
      if (opts.graft) graftKey(contributes, key, value);
      else contributes[key] = value;
    }
  }

  // limpeza: chaves gerenciadas que ficaram vazias no enxerto saem
  if (opts.graft) {
    for (const key of Object.keys(contributes)) {
      if (isEmpty(contributes[key])) delete contributes[key];
    }
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

/** enxerto de UMA chave do contributes, respeitando o formato dela */
function graftKey(contributes: Record<string, unknown>, key: string, value: unknown): void {
  const existing = contributes[key];
  if (isEmpty(value)) return; // nada emitido → manifesto manual fica intacto

  if (Array.isArray(value)) {
    contributes[key] = graftArray(existing, value);
    return;
  }

  if (key === "configuration") {
    // emitido: { title, properties }. Manual pode ser objeto OU array de seções.
    const emitted = value as { title?: string; properties?: Record<string, unknown> };
    if (Array.isArray(existing)) {
      const idx = existing.findIndex((s) => (s as { title?: string }).title === emitted.title);
      if (idx >= 0) existing[idx] = emitted;
      else existing.push(emitted);
      contributes[key] = existing;
      return;
    }
    const current = (existing ?? {}) as { title?: string; properties?: Record<string, unknown> };
    contributes[key] = {
      title: emitted.title ?? current.title,
      properties: { ...(current.properties ?? {}), ...(emitted.properties ?? {}) },
    };
    return;
  }

  if (typeof value === "object" && value !== null) {
    // objetos de arrays por sub-chave (menus por menu-id, views/viewsContainers
    // por container): enxerta cada sub-array e preserva sub-chaves manuais
    const emitted = value as Record<string, unknown>;
    const current = (typeof existing === "object" && existing !== null ? existing : {}) as Record<string, unknown>;
    const result: Record<string, unknown> = { ...current };
    for (const sub of Object.keys(emitted)) {
      const sv = emitted[sub];
      result[sub] = Array.isArray(sv) ? graftArray(current[sub], sv) : sv;
    }
    contributes[key] = result;
    return;
  }

  contributes[key] = value;
}
