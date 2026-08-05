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

  type __Sigil_RestBenchPanel = InstanceType<typeof import("../src/extension")["RestBenchPanel"]>;

  /** Mensagens aceitas pelos @OnMessage de RestBenchPanel. */
  type RestBenchPanelMessage =
    | __SigilMsg<"clear", __SigilValueOf<__Sigil_RestBenchPanel["limpar"]>>
    | __SigilMsg<"openInEditor", __SigilValueOf<__Sigil_RestBenchPanel["abrirNoEditor"]>>;

  /** Requests (@OnRequest): envie com __sigilRpcId e receba { type: "__sigilRpcResult", id, ok, value }. */
  type RestBenchPanelRequest =
    | __SigilReq<"history", __SigilValueOf<__Sigil_RestBenchPanel["historico"]>>
    | __SigilReq<"send", __SigilValueOf<__Sigil_RestBenchPanel["enviar"]>>
    | __SigilReq<"setToken", __SigilValueOf<__Sigil_RestBenchPanel["guardarToken"]>>;

  /** Resultado de cada request de RestBenchPanel. */
  type RestBenchPanelResponse = {
    "history": Awaited<ReturnType<__Sigil_RestBenchPanel["historico"]>>;
    "send": Awaited<ReturnType<__Sigil_RestBenchPanel["enviar"]>>;
    "setToken": Awaited<ReturnType<__Sigil_RestBenchPanel["guardarToken"]>>;
  };

  /** Mensagens que o host envia para esta UI (tipo do 'post' de RestBenchPanel). */
  type RestBenchPanelHostMessage = __SigilHostOf<__Sigil_RestBenchPanel>;

  function acquireVsCodeApi(): {
    postMessage(message: RestBenchPanelMessage | RestBenchPanelRequest): void;
    getState(): unknown;
    setState(state: unknown): void;
  };
}

declare module "@sigilkit/core/ui" {
  interface SigilUiMessages {
    "clear": __SigilValueOf<__Sigil_RestBenchPanel["limpar"]>;
    "openInEditor": __SigilValueOf<__Sigil_RestBenchPanel["abrirNoEditor"]>;
  }
  interface SigilUiRequests {
    "history": { value: __SigilValueOf<__Sigil_RestBenchPanel["historico"]>; result: Awaited<ReturnType<__Sigil_RestBenchPanel["historico"]>> };
    "send": { value: __SigilValueOf<__Sigil_RestBenchPanel["enviar"]>; result: Awaited<ReturnType<__Sigil_RestBenchPanel["enviar"]>> };
    "setToken": { value: __SigilValueOf<__Sigil_RestBenchPanel["guardarToken"]>; result: Awaited<ReturnType<__Sigil_RestBenchPanel["guardarToken"]>> };
  }
  interface SigilUiFromHost {
    message: RestBenchPanelHostMessage;
  }
}
