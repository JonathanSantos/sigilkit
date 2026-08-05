export function toPosix(p: string): string {
  return p.split("\\").join("/");
}

/** Remove chaves com valor undefined (raso) — mantém o IR limpo e determinístico. */
export function compact<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}
