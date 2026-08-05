// GERADO POR sigil — NÃO EDITE (derivado dos @OnMessage/@OnRequest; regenerado no build)
// Tipa o protocolo desta UI: postMessage só aceita os tipos declarados no
// host, e o shape de 'value' vem do parâmetro do handler correspondente.

type __SigilMsg<T extends string, V> = undefined extends V
  ? { type: T; value?: V; __sigilRpcId?: never }
  : { type: T; value: V; __sigilRpcId?: never };
type __SigilReq<T extends string, V> = undefined extends V
  ? { type: T; value?: V; __sigilRpcId: number }
  : { type: T; value: V; __sigilRpcId: number };

type __Sigil_NotesPanel = InstanceType<typeof import("../src/extension")["NotesPanel"]>;

/** Mensagens aceitas pelos @OnMessage de NotesPanel. */
type NotesPanelMessage =
  | __SigilMsg<"add", Parameters<__Sigil_NotesPanel["onAdd"]>[0]>
  | __SigilMsg<"remove", Parameters<__Sigil_NotesPanel["onRemove"]>[0]>;

/** Requests (@OnRequest): envie com __sigilRpcId e receba { type: "__sigilRpcResult", id, ok, value }. */
type NotesPanelRequest =
  | __SigilReq<"count", Parameters<__Sigil_NotesPanel["onCount"]>[0]>;

/** Resultado de cada request de NotesPanel. */
type NotesPanelResponse = {
  "count": Awaited<ReturnType<__Sigil_NotesPanel["onCount"]>>;
};

declare function acquireVsCodeApi(): {
  postMessage(message: NotesPanelMessage | NotesPanelRequest): void;
  getState(): unknown;
  setState(state: unknown): void;
};
