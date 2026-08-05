// GERADO POR sigil — NÃO EDITE (derivado dos @OnMessage/@OnRequest; regenerado no build)
// Tipa o protocolo desta UI: postMessage só aceita os tipos declarados no
// host, e o shape de 'value' vem do parâmetro do handler correspondente.

type __SigilMsg<T extends string, V> = undefined extends V
  ? { type: T; value?: V; __sigilRpcId?: never }
  : { type: T; value: V; __sigilRpcId?: never };
type __SigilReq<T extends string, V> = undefined extends V
  ? { type: T; value?: V; __sigilRpcId: number }
  : { type: T; value: V; __sigilRpcId: number };

type __Sigil_RestBenchPanel = InstanceType<typeof import("../src/extension")["RestBenchPanel"]>;

/** Mensagens aceitas pelos @OnMessage de RestBenchPanel. */
type RestBenchPanelMessage =
  | __SigilMsg<"clear", Parameters<__Sigil_RestBenchPanel["limpar"]>[0]>;

/** Requests (@OnRequest): envie com __sigilRpcId e receba { type: "__sigilRpcResult", id, ok, value }. */
type RestBenchPanelRequest =
  | __SigilReq<"history", Parameters<__Sigil_RestBenchPanel["historico"]>[0]>
  | __SigilReq<"send", Parameters<__Sigil_RestBenchPanel["enviar"]>[0]>
  | __SigilReq<"setToken", Parameters<__Sigil_RestBenchPanel["guardarToken"]>[0]>;

/** Resultado de cada request de RestBenchPanel. */
type RestBenchPanelResponse = {
  "history": Awaited<ReturnType<__Sigil_RestBenchPanel["historico"]>>;
  "send": Awaited<ReturnType<__Sigil_RestBenchPanel["enviar"]>>;
  "setToken": Awaited<ReturnType<__Sigil_RestBenchPanel["guardarToken"]>>;
};

declare function acquireVsCodeApi(): {
  postMessage(message: RestBenchPanelMessage | RestBenchPanelRequest): void;
  getState(): unknown;
  setState(state: unknown): void;
};
