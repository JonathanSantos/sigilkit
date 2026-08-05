import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { SigilTestHost } from "@sigilkit/test";
import { SIM_UI_PAGE } from "./sim-ui-page";

/**
 * A camada visual do `sigil sim`: um workbench fake servido localmente que
 * renderiza o ESTADO do simulador (palette, trees, configs, status bar,
 * notificações, logs) e webviews DE VERDADE em iframes com shim de
 * acquireVsCodeApi. Push de estado por SSE; interações por POST.
 *
 * Guarda-corpo de escopo: renderiza somente o que o simulador modela — é um
 * harness visual, não um clone do VSCode. O editor não é simulado.
 */

interface PendingInput {
  id: number;
  kind: "inputBox" | "quickPick";
  opts: unknown;
  items?: unknown;
  resolve: (value: unknown) => void;
}

export interface SimUiOptions {
  projectDir: string;
  port: number;
  getHost: () => SigilTestHost | undefined;
}

export interface SimUiHandle {
  /** chama depois de cada reload do sim: re-liga o input interativo e faz push */
  notifyChange(): void;
  url: string;
  close(): void;
}

interface ManifestInfo {
  displayName: string;
  commandTitles: Map<string, string>;
  configProps: Record<string, Record<string, unknown>>;
  /** viewId → { name, webview } */
  views: Map<string, { name: string; webview: boolean }>;
}

function readManifest(projectDir: string): ManifestInfo {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8")) as {
    name?: string;
    displayName?: string;
    contributes?: {
      commands?: { command: string; title?: string }[];
      configuration?: { properties?: Record<string, Record<string, unknown>> };
      views?: Record<string, { id: string; name: string; type?: string }[]>;
    };
  };
  const commandTitles = new Map<string, string>();
  for (const c of pkg.contributes?.commands ?? []) {
    if (c.title) commandTitles.set(c.command, c.title);
  }
  const views = new Map<string, { name: string; webview: boolean }>();
  for (const entries of Object.values(pkg.contributes?.views ?? {})) {
    for (const v of entries) views.set(v.id, { name: v.name, webview: v.type === "webview" });
  }
  return {
    displayName: pkg.displayName ?? pkg.name ?? "extensão",
    commandTitles,
    configProps: pkg.contributes?.configuration?.properties ?? {},
    views,
  };
}

interface TreeNodeSnapshot {
  label: string;
  description?: string;
  collapsible: boolean;
  children: TreeNodeSnapshot[];
}

async function serializeTree(
  host: SigilTestHost,
  viewId: string,
  name: string
): Promise<{ viewId: string; name: string; nodes: TreeNodeSnapshot[] }> {
  const probe = host.tree(viewId);
  const walk = async (elements: unknown[], depth: number): Promise<TreeNodeSnapshot[]> => {
    if (depth > 4) return [];
    const out: TreeNodeSnapshot[] = [];
    for (const el of elements) {
      const item = await probe.item(el);
      const collapsible = ((item.collapsibleState as number | undefined) ?? 0) > 0;
      out.push({
        label: String(item.label ?? ""),
        description: item.description ? String(item.description) : undefined,
        collapsible,
        children: collapsible ? await walk(await probe.children(el), depth + 1) : [],
      });
    }
    return out;
  };
  return { viewId, name, nodes: await walk(await probe.roots(), 0) };
}

/** Snapshot serializável de tudo que o workbench renderiza. Exportado para teste. */
export async function buildSnapshot(
  host: SigilTestHost,
  projectDir: string,
  pendingInput: PendingInput | null
): Promise<Record<string, unknown>> {
  const manifest = readManifest(projectDir);

  const trees: { viewId: string; name: string; nodes: TreeNodeSnapshot[] }[] = [];
  for (const [viewId, info] of manifest.views) {
    if (info.webview) continue;
    try {
      trees.push(await serializeTree(host, viewId, info.name));
    } catch {
      /* view no manifesto mas provider não registrado — ignora */
    }
  }

  const webviews: Record<string, unknown>[] = [];
  for (const panel of host.webviewPanels) {
    if (panel.disposed) continue;
    webviews.push({ key: panel.viewType, title: panel.title, kind: "panel", html: panel.html, posted: panel.posted });
  }
  for (const viewId of host.webviewViewIds) {
    try {
      const view = await host.webviewView(viewId);
      webviews.push({
        key: viewId,
        title: manifest.views.get(viewId)?.name ?? viewId,
        kind: "view",
        html: view.html,
        posted: view.posted,
      });
    } catch {
      /* provider indisponível */
    }
  }

  const pi = pendingInput
    ? {
        id: pendingInput.id,
        kind: pendingInput.kind,
        prompt:
          ((pendingInput.opts as { prompt?: string; placeHolder?: string } | undefined)?.prompt ??
            (pendingInput.opts as { placeHolder?: string } | undefined)?.placeHolder) ||
          "Entrada",
        items: pendingInput.items,
      }
    : null;

  return {
    project: { displayName: manifest.displayName, dir: projectDir },
    commands: host.commands.map((id) => ({ id, title: manifest.commandTitles.get(id) })),
    statusBar: host.statusBarItems
      .filter((s) => s.shown)
      .map((s) => ({ text: s.text, tooltip: s.tooltip, alignment: s.alignment, priority: s.priority })),
    notifications: { info: host.infoMessages, warn: host.warnMessages, error: host.errorMessages },
    logs: host.logs.slice(-200),
    config: Object.entries(manifest.configProps).map(([id, schema]) => ({
      id,
      type: schema.type,
      description: schema.description,
      enum: schema.enum,
      minimum: schema.minimum,
      maximum: schema.maximum,
      default: schema.default,
      value: host.configuration.get(id),
    })),
    trees,
    webviews,
    pendingInput: pi,
  };
}

function contentTypeOf(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".css") return "text/css";
  if (ext === ".js") return "text/javascript";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".html") return "text/html";
  return "application/octet-stream";
}

export function startSimUi(options: SimUiOptions): SimUiHandle {
  let pending: PendingInput | null = null;
  let inputSeq = 0;
  const clients = new Set<http.ServerResponse>();

  const pushState = async (): Promise<void> => {
    const host = options.getHost();
    if (!host || clients.size === 0) return;
    try {
      const snapshot = await buildSnapshot(host, options.projectDir, pending);
      const payload = `data: ${JSON.stringify(snapshot)}\n\n`;
      for (const client of clients) client.write(payload);
    } catch {
      /* host no meio de um reload — o próximo push resolve */
    }
  };

  const wireHost = (): void => {
    options.getHost()?.onInputRequest(
      (kind, opts, items) =>
        new Promise((resolve) => {
          pending = { id: ++inputSeq, kind, opts, items, resolve };
          void pushState();
        })
    );
  };

  const readBody = (req: http.IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((resolve) => {
      let body = "";
      req.on("data", (chunk) => (body += String(chunk)));
      req.on("end", () => {
        try {
          resolve(JSON.parse(body || "{}") as Record<string, unknown>);
        } catch {
          resolve({});
        }
      });
    });

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(SIM_UI_PAGE);
        return;
      }
      if (req.method === "GET" && url.pathname === "/events") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        clients.add(res);
        req.on("close", () => clients.delete(res));
        await pushState();
        return;
      }
      if (req.method === "GET" && url.pathname === "/webview-resource") {
        const requested = path.resolve(url.searchParams.get("path") ?? "");
        if (!requested.startsWith(path.resolve(options.projectDir))) {
          res.writeHead(403).end();
          return;
        }
        try {
          res.writeHead(200, { "content-type": contentTypeOf(requested) }).end(fs.readFileSync(requested));
        } catch {
          res.writeHead(404).end();
        }
        return;
      }

      if (req.method === "POST") {
        const host = options.getHost();
        const body = await readBody(req);
        const reply = (payload: Record<string, unknown>): void => {
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(payload));
        };
        if (!host) {
          reply({ ok: false, error: "extensão ainda não carregada" });
          return;
        }

        switch (url.pathname) {
          case "/api/command": {
            const id = String(body.id ?? "");
            if (!host.commands.includes(id)) {
              reply({ ok: false, error: `comando desconhecido: ${id}` });
              return;
            }
            // sem await: comandos podem esperar input interativo (modal na UI)
            void host
              .executeCommand(id, ...(body.arg !== undefined ? [body.arg] : []))
              .catch(() => {})
              .finally(() => setTimeout(() => void pushState(), 20));
            reply({ ok: true });
            return;
          }
          case "/api/config": {
            host.configuration.set(String(body.id ?? ""), body.value);
            await pushState();
            reply({ ok: true });
            return;
          }
          case "/api/webview-message": {
            const key = String(body.key ?? "");
            try {
              const target =
                host.webviewPanels.find((p) => p.viewType === key && !p.disposed) ??
                (await host.webviewView(key));
              target.receive(body.message);
              setTimeout(() => void pushState(), 20);
              reply({ ok: true });
            } catch (e) {
              reply({ ok: false, error: (e as Error).message });
            }
            return;
          }
          case "/api/input-response": {
            if (pending && pending.id === Number(body.id)) {
              const current = pending;
              pending = null;
              current.resolve(body.value ?? undefined);
              setTimeout(() => void pushState(), 20);
            }
            reply({ ok: true });
            return;
          }
          default:
            res.writeHead(404).end();
            return;
        }
      }

      res.writeHead(404).end();
    })().catch(() => {
      try {
        res.writeHead(500).end();
      } catch {
        /* resposta já enviada */
      }
    });
  });

  server.listen(options.port, "127.0.0.1");
  server.on("error", (e) => {
    console.error(`sim --ui: servidor falhou — ${(e as Error).message}`);
  });

  // estado muda também por caminhos assíncronos (RPC, timers da extensão):
  // um push periódico barato mantém a página em dia
  const poller = setInterval(() => void pushState(), 1000);

  return {
    notifyChange() {
      wireHost();
      void pushState();
    },
    url: `http://127.0.0.1:${options.port}`,
    close() {
      clearInterval(poller);
      server.close();
    },
  };
}
