// GERADO POR sigil — NÃO EDITE (derivado dos @OnMessage/@OnRequest; regenerado no build)
// Tipa o protocolo desta UI: postMessage só aceita os tipos declarados no
// host, e o shape de 'value' vem do parâmetro do handler correspondente.

type __SigilMsg<T extends string, V> = undefined extends V
  ? { type: T; value?: V; __sigilRpcId?: never }
  : { type: T; value: V; __sigilRpcId?: never };
type __SigilReq<T extends string, V> = undefined extends V
  ? { type: T; value?: V; __sigilRpcId: number }
  : { type: T; value: V; __sigilRpcId: number };

type __Sigil_SettingsPanel = InstanceType<typeof import("../src/panels/settings")["SettingsPanel"]>;

/** Mensagens aceitas pelos @OnMessage de SettingsPanel. */
type SettingsPanelMessage =
  | __SigilMsg<"reset", Parameters<__Sigil_SettingsPanel["onReset"]>[0]>
  | __SigilMsg<"save", Parameters<__Sigil_SettingsPanel["onSave"]>[0]>;

declare function acquireVsCodeApi(): {
  postMessage(message: SettingsPanelMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};
