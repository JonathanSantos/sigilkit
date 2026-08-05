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

  type __Sigil_SettingsPanel = InstanceType<typeof import("../src/panels/settings")["SettingsPanel"]>;

  /** Mensagens aceitas pelos @OnMessage de SettingsPanel. */
  type SettingsPanelMessage =
    | __SigilMsg<"reset", __SigilValueOf<__Sigil_SettingsPanel["onReset"]>>
    | __SigilMsg<"save", __SigilValueOf<__Sigil_SettingsPanel["onSave"]>>;

  /** Mensagens que o host envia para esta UI (tipo do 'post' de SettingsPanel). */
  type SettingsPanelHostMessage = __SigilHostOf<__Sigil_SettingsPanel>;

  function acquireVsCodeApi(): {
    postMessage(message: SettingsPanelMessage): void;
    getState(): unknown;
    setState(state: unknown): void;
  };
}

declare module "@sigilkit/core/ui" {
  interface SigilUiMessages {
    "reset": __SigilValueOf<__Sigil_SettingsPanel["onReset"]>;
    "save": __SigilValueOf<__Sigil_SettingsPanel["onSave"]>;
  }
  interface SigilUiFromHost {
    message: SettingsPanelHostMessage;
  }
}
