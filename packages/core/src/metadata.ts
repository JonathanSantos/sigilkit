import { registry } from "./registry";
import type { StatusBarItemLike } from "./registry";

// Polyfill do Symbol.metadata (stage 3, ainda não em todo runtime). Symbol.for
// para que múltiplas cópias do runtime concordem com a chave. Roda no load de
// @sigil/core — que todo arquivo decorado importa antes de definir classes.
(Symbol as { metadata?: symbol }).metadata ??= Symbol.for("Symbol.metadata");

/**
 * Registrações de UMA classe, guardadas no objeto ctx.metadata dela — a
 * identidade da classe SEM depender de nomes de função em runtime (§13:
 * minificação quebrava `this.constructor.name`; ctx.metadata não quebra).
 */
export interface Bucket {
  commands: Map<string, (...args: unknown[]) => unknown>;
  lifecycle: Map<string, (...args: unknown[]) => unknown>;
  watches: Map<string, (next: unknown, prev: unknown) => unknown>;
  treeHandlers: Map<string, (...args: unknown[]) => unknown>;
  webviewHandlers: Map<string, (...args: unknown[]) => unknown>;
  languageHandlers: Map<string, (...args: unknown[]) => unknown>;
  chatHandlers: Map<string, (...args: unknown[]) => unknown>;
  events: Map<string, (...args: unknown[]) => unknown>;
  configDefaults: Map<string, unknown>;
  statusBarText: Map<string, string>;
  statusBarItems: Map<string, StatusBarItemLike>;
}

const buckets = new WeakMap<object, Bucket>();

export function bucketOf(metadata: object | undefined): Bucket {
  if (!metadata) {
    throw new Error(
      "sigil: decorator sem ctx.metadata — o runtime não expôs Symbol.metadata. Garanta que @sigil/core é importado antes das classes decoradas."
    );
  }
  let bucket = buckets.get(metadata);
  if (!bucket) {
    bucket = {
      commands: new Map(),
      lifecycle: new Map(),
      watches: new Map(),
      treeHandlers: new Map(),
      webviewHandlers: new Map(),
      languageHandlers: new Map(),
      chatHandlers: new Map(),
      events: new Map(),
      configDefaults: new Map(),
      statusBarText: new Map(),
      statusBarItems: new Map(),
    };
    buckets.set(metadata, bucket);
  }
  return bucket;
}

type BoundMemberKind =
  | "commands"
  | "lifecycle"
  | "watches"
  | "treeHandlers"
  | "webviewHandlers"
  | "languageHandlers"
  | "chatHandlers"
  | "events";

/** Fábrica dos decorators de método: registra o método (bound) no bucket da classe. */
export function registerBoundMember(kind: BoundMemberKind) {
  return function <This, Value extends (this: This, ...args: any[]) => any>(
    value: Value,
    ctx: ClassMethodDecoratorContext<This, Value>
  ): void {
    const name = String(ctx.name);
    const metadata = ctx.metadata;
    ctx.addInitializer(function (this: This) {
      const map = bucketOf(metadata)[kind] as Map<string, (...args: unknown[]) => unknown>;
      map.set(name, (value as (...args: unknown[]) => unknown).bind(this));
    });
  };
}

/**
 * O join do modelo de propriedade (§4) sem `this.constructor.name`: o wire —
 * que conhece o nome DECLARADO da classe, o mesmo que o compilador usou nas
 * chaves do IR — adota as registrações do bucket sob esse nome. Chamado pelo
 * activate() gerado, logo após `new Classe()`. Dessincronização lança (R6).
 */
export function adoptRegistrations(
  className: string,
  cls: abstract new (...args: never[]) => unknown
): void {
  const metadataSymbol = (Symbol as { metadata?: symbol }).metadata!;
  const metadata = (cls as unknown as Record<symbol, object | undefined>)[metadataSymbol];
  if (!metadata) {
    // sem Symbol.metadata a classe não passou por decorator nenhum — bundle quebrado
    throw new Error(
      `sigil: nenhuma registração encontrada para ${className} — a classe tem decorators do sigil? Rode 'sigil build'.`
    );
  }
  // classe só com o marcador (@Extension sem membros, por exemplo) é válida:
  // bucket vazio. Handler realmente ausente explode no join, por chave (R6).
  const bucket = bucketOf(metadata);
  // hot swap: itens de status bar VIVOS migram do bucket anterior para o novo
  // (o item foi criado uma vez pelo bind; a classe nova precisa alcançá-lo)
  const previous = registry.buckets.get(className);
  if (previous && previous !== bucket) {
    for (const [member, item] of previous.statusBarItems) {
      if (!bucket.statusBarItems.has(member)) bucket.statusBarItems.set(member, item);
      const text = bucket.statusBarText.get(member);
      if (text !== undefined) item.text = text;
    }
  }
  registry.buckets.set(className, bucket);
  for (const [member, fn] of bucket.commands) registry.commands.set(`${className}.${member}`, fn);
  for (const [member, fn] of bucket.lifecycle) registry.lifecycle.set(`${className}.${member}`, fn);
  for (const [member, fn] of bucket.watches) registry.watches.set(`${className}.${member}`, fn);
  for (const [member, fn] of bucket.treeHandlers) {
    registry.treeHandlers.set(`${className}.${member}`, fn);
  }
  for (const [member, fn] of bucket.webviewHandlers) {
    registry.webviewHandlers.set(`${className}.${member}`, fn);
  }
  for (const [member, fn] of bucket.languageHandlers) {
    registry.languageHandlers.set(`${className}.${member}`, fn);
  }
  for (const [member, fn] of bucket.chatHandlers) {
    registry.chatHandlers.set(`${className}.${member}`, fn);
  }
  for (const [member, fn] of bucket.events) {
    registry.events.set(`${className}.${member}`, fn);
  }
  for (const [member, v] of bucket.configDefaults) {
    registry.configDefaults.set(`${className}.${member}`, v);
  }
}
