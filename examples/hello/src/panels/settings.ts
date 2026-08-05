import { OnMessage, Webview } from "@sigilkit/core";

export interface Settings {
  greeting: string;
}

type HostToUi = { type: "state"; value: Settings };

const DEFAULTS: Settings = { greeting: "Olá" };

@Webview({ id: "settings", title: "Hello Settings", ui: "./ui/settings.html" })
export class SettingsPanel {
  private current: Settings = DEFAULTS;

  @OnMessage("save")
  onSave(value: Settings) {
    this.current = value;
    this.post({ type: "state", value: this.current });
  }

  @OnMessage("reset")
  onReset() {
    this.current = DEFAULTS;
    this.post({ type: "state", value: this.current });
  }

  post!: (msg: HostToUi) => void; // injetado pelo wire
}
