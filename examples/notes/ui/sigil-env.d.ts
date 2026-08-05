// GERADO POR sigil — NÃO EDITE (derivado dos @OnMessage/@OnRequest; regenerado no build)
// Tipa o protocolo desta UI nos dois lados: acquireVsCodeApi global e os
// helpers postToHost/callHost/onHostMessage de "@sigilkit/core/ui".

export {};

declare global {
  type __SigilMsg<T extends string, V> = undefined extends V
    ? { type: T; value?: V; __sigilRpcId?: never }
    : { type: T; value: V; __sigilRpcId?: never };
  type __SigilReq<T extends string, V> = undefined extends V
    ? { type: T; value?: V; __sigilRpcId: number }
    : { type: T; value: V; __sigilRpcId: number };
  // extração LAZY: handler sem parâmetro vira undefined (indexar [0] numa
  // tupla vazia seria erro TS2493 e degradaria tudo para any sob skipLibCheck)
  type __SigilValueOf<F> = F extends (...args: infer A) => unknown
    ? A extends [] ? undefined : A[0]
    : never;
  // idem para o post: checagem estrutural, sem indexar chave que pode não existir
  type __SigilHostOf<I> = I extends { post: (msg: infer M) => unknown } ? M : never;

  type __Sigil_NotesPanel = InstanceType<typeof import("../src/extension")["NotesPanel"]>;

  /** Mensagens aceitas pelos @OnMessage de NotesPanel. */
  type NotesPanelMessage =
    | __SigilMsg<"add", __SigilValueOf<__Sigil_NotesPanel["onAdd"]>>
    | __SigilMsg<"remove", __SigilValueOf<__Sigil_NotesPanel["onRemove"]>>;

  /** Requests (@OnRequest): envie com __sigilRpcId e receba { type: "__sigilRpcResult", id, ok, value }. */
  type NotesPanelRequest =
    | __SigilReq<"count", __SigilValueOf<__Sigil_NotesPanel["onCount"]>>;

  /** Resultado de cada request de NotesPanel. */
  type NotesPanelResponse = {
    "count": Awaited<ReturnType<__Sigil_NotesPanel["onCount"]>>;
  };

  /** Mensagens que o host envia para esta UI (tipo do 'post' de NotesPanel). */
  type NotesPanelHostMessage = __SigilHostOf<__Sigil_NotesPanel>;

  function acquireVsCodeApi(): {
    postMessage(message: NotesPanelMessage | NotesPanelRequest): void;
    getState(): unknown;
    setState(state: unknown): void;
  };
}

declare module "@sigilkit/core/ui" {
  interface SigilUiMessages {
    "add": __SigilValueOf<__Sigil_NotesPanel["onAdd"]>;
    "remove": __SigilValueOf<__Sigil_NotesPanel["onRemove"]>;
  }
  interface SigilUiRequests {
    "count": { value: __SigilValueOf<__Sigil_NotesPanel["onCount"]>; result: Awaited<ReturnType<__Sigil_NotesPanel["onCount"]>> };
  }
  interface SigilUiFromHost {
    message: NotesPanelHostMessage;
  }
}
