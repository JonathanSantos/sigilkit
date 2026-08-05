import * as vscode from "vscode";
import { registry } from "./registry";
import { renderWebviewHtml } from "./webview-html";
import { makeNonce } from "./webview-host";
import { setConfigById } from "./config-access";
import { guard } from "./guard";

/**
 * A "aplicação de opções" pronta do sigil: uma aba webview com formulário
 * derivado do schema das @Config — two-way (editar no form grava no
 * workspace; editar em Settings reflete no form). Habilitada com
 * `@Extension({ settings: true })`; o comando `<prefix>.configure` é emitido
 * no manifesto e registrado pelo wire.
 */

export interface SettingsField {
  id: string; // "hello.greeting"
  label: string; // "greeting"
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  default?: unknown;
}

export interface SettingsAppBinding {
  readonly viewType: string; // "hello.sigilSettings"
  readonly title: string;
  readonly prefix: string;
  readonly fields: readonly SettingsField[];
}

function settingsHtml(binding: SettingsAppBinding): string {
  const fieldsJson = JSON.stringify(binding.fields).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${binding.title}</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 1rem 2rem; max-width: 640px; }
    h1 { font-size: 1.3em; border-bottom: 1px solid var(--vscode-panel-border, #8883); padding-bottom: .4rem; }
    .row { margin: 1rem 0; }
    label { display: block; font-weight: 600; margin-bottom: .2rem; }
    .desc { margin: 0 0 .3rem; opacity: .75; font-size: .9em; }
    input[type=text], input[type=number], select {
      width: 100%; box-sizing: border-box; padding: .3rem .5rem;
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px;
    }
  </style>
</head>
<body>
  <h1>${binding.title}</h1>
  <div id="form"></div>
  <script>
    const vscodeApi = acquireVsCodeApi();
    const FIELDS = ${fieldsJson};
    const container = document.getElementById("form");
    const inputs = {};
    for (const f of FIELDS) {
      const row = document.createElement("div");
      row.className = "row";
      const label = document.createElement("label");
      label.textContent = f.label;
      row.appendChild(label);
      if (f.description) {
        const desc = document.createElement("p");
        desc.className = "desc";
        desc.textContent = f.description;
        row.appendChild(desc);
      }
      let input;
      if (f.enum) {
        input = document.createElement("select");
        for (const option of f.enum) {
          const o = document.createElement("option");
          o.value = String(option);
          o.textContent = String(option);
          input.appendChild(o);
        }
      } else if (f.type === "boolean") {
        input = document.createElement("input");
        input.type = "checkbox";
      } else if (f.type === "number") {
        input = document.createElement("input");
        input.type = "number";
        if (f.minimum !== undefined) input.min = String(f.minimum);
        if (f.maximum !== undefined) input.max = String(f.maximum);
      } else {
        input = document.createElement("input");
        input.type = "text";
      }
      input.addEventListener("change", () => {
        const value = f.type === "boolean" ? input.checked
          : f.type === "number" ? Number(input.value)
          : input.value;
        vscodeApi.postMessage({ type: "set", value: { id: f.id, value } });
      });
      inputs[f.id] = input;
      row.appendChild(input);
      container.appendChild(row);
    }
    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (!msg || msg.type !== "state") return;
      for (const f of FIELDS) {
        const input = inputs[f.id];
        const value = msg.value[f.id];
        if (f.type === "boolean") input.checked = !!value;
        else input.value = value === undefined ? "" : String(value);
      }
    });
    vscodeApi.postMessage({ type: "ready" });
  </script>
</body>
</html>
`;
}

export interface SettingsAppHandle extends vscode.Disposable {
  open(): Promise<void>;
}

export function bindSettingsApp(
  binding: SettingsAppBinding,
  _ctx: vscode.ExtensionContext
): SettingsAppHandle {
  let panel: vscode.WebviewPanel | undefined;

  const currentValues = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    const cfg = vscode.workspace.getConfiguration(binding.prefix);
    for (const f of binding.fields) {
      out[f.id] = cfg.get(f.id.slice(binding.prefix.length + 1)) ?? f.default;
    }
    return out;
  };
  const pushState = (): void => {
    void panel?.webview.postMessage({ type: "state", value: currentValues() });
  };

  const configSub = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(binding.prefix)) pushState();
  });

  const open = async (): Promise<void> => {
    if (panel) {
      panel.reveal();
      return;
    }
    panel = vscode.window.createWebviewPanel(binding.viewType, binding.title, vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    panel.onDidDispose(() => {
      panel = undefined;
    });
    panel.webview.onDidReceiveMessage(
      guard(`settings de ${binding.prefix}`, (msg: { type?: string; value?: { id?: string; value?: unknown } } | undefined) => {
        if (msg?.type === "ready") {
          pushState();
          return;
        }
        if (msg?.type === "set" && msg.value && typeof msg.value.id === "string") {
          void setConfigById(msg.value.id, msg.value.value);
          return;
        }
        console.warn(`sigil: mensagem desconhecida no settings app: ${String(msg?.type)}`);
      })
    );
    panel.webview.html = renderWebviewHtml(settingsHtml(binding), {
      nonce: makeNonce(),
      cspSource: panel.webview.cspSource,
      resolveResource: (rel) => rel,
    });
  };

  registry.webviews.set("__sigilSettings", { open, post: (m) => void panel?.webview.postMessage(m) });
  return {
    open,
    dispose() {
      registry.webviews.delete("__sigilSettings");
      configSub.dispose();
      panel?.dispose();
    },
  };
}
