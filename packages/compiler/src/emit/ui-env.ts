import * as path from "node:path";
import { IR } from "../ir";

/**
 * IR → um `sigil-env.d.ts` por diretório de UI (dirname do `ui:` de cada
 * @Webview/@CustomEditor). O arquivo tipa o protocolo UI→host daquela pasta:
 * `acquireVsCodeApi().postMessage(...)` só aceita os tipos declarados em
 * @OnMessage/@OnRequest, e o shape do `value` é DERIVADO do parâmetro do
 * handler via `Parameters<import(...)>` — mudar o tipo no host flui para a UI
 * sem reemitir nada (só adicionar/remover mensagem reemite, e isso é mudança
 * de IR).
 *
 * O arquivo é script global (sem import/export de topo) de propósito: as
 * declarações ficam ambient para os .js/.ts da pasta. A convenção recomendada
 * é uma pasta (e um tsconfig) por webview — com duas UIs na mesma pasta, os
 * protocolos se unem.
 */
export function emitUiEnv(ir: IR): { dir: string; content: string }[] {
  type UiClass = {
    key: string;
    sourceFile: string;
    messageHandlers: { type: string; key: string }[];
    requestHandlers: { type: string; key: string }[];
  };

  const byDir = new Map<string, UiClass[]>();
  const add = (uiEntry: string, cls: UiClass): void => {
    const dir = path.posix.dirname(uiEntry);
    const list = byDir.get(dir) ?? [];
    list.push(cls);
    byDir.set(dir, list);
  };
  for (const wv of ir.webviews) add(wv.uiEntry, wv);
  for (const ed of ir.customEditors) add(ed.uiEntry, ed);

  const files: { dir: string; content: string }[] = [];
  for (const [dir, classes] of [...byDir.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    classes.sort((a, b) => (a.key < b.key ? -1 : 1));

    const blocks: string[] = [];
    const postTypes: string[] = [];
    for (const cls of classes) {
      const inst = `__Sigil_${cls.key}`;
      const spec = importSpecifier(dir, cls.sourceFile);
      const lines: string[] = [
        `type ${inst} = InstanceType<typeof import(${JSON.stringify(spec)})[${JSON.stringify(cls.key)}]>;`,
      ];

      if (cls.messageHandlers.length > 0) {
        const members = cls.messageHandlers.map(
          (h) => `  | __SigilMsg<${JSON.stringify(h.type)}, Parameters<${inst}[${JSON.stringify(memberOf(h.key))}]>[0]>`
        );
        lines.push(``, `/** Mensagens aceitas pelos @OnMessage de ${cls.key}. */`);
        lines.push(`type ${cls.key}Message =`, ...members);
        lines[lines.length - 1] += ";";
        postTypes.push(`${cls.key}Message`);
      }
      if (cls.requestHandlers.length > 0) {
        const members = cls.requestHandlers.map(
          (h) => `  | __SigilReq<${JSON.stringify(h.type)}, Parameters<${inst}[${JSON.stringify(memberOf(h.key))}]>[0]>`
        );
        lines.push(``, `/** Requests (@OnRequest): envie com __sigilRpcId e receba { type: "__sigilRpcResult", id, ok, value }. */`);
        lines.push(`type ${cls.key}Request =`, ...members);
        lines[lines.length - 1] += ";";
        const results = cls.requestHandlers.map(
          (h) => `  ${JSON.stringify(h.type)}: Awaited<ReturnType<${inst}[${JSON.stringify(memberOf(h.key))}]>>;`
        );
        lines.push(``, `/** Resultado de cada request de ${cls.key}. */`);
        lines.push(`type ${cls.key}Response = {`, ...results, `};`);
        postTypes.push(`${cls.key}Request`);
      }
      blocks.push(lines.join("\n"));
    }

    const accepted = postTypes.length > 0 ? postTypes.join(" | ") : "never";
    const content = `// GERADO POR sigil — NÃO EDITE (derivado dos @OnMessage/@OnRequest; regenerado no build)
// Tipa o protocolo desta UI: postMessage só aceita os tipos declarados no
// host, e o shape de 'value' vem do parâmetro do handler correspondente.

type __SigilMsg<T extends string, V> = undefined extends V
  ? { type: T; value?: V; __sigilRpcId?: never }
  : { type: T; value: V; __sigilRpcId?: never };
type __SigilReq<T extends string, V> = undefined extends V
  ? { type: T; value?: V; __sigilRpcId: number }
  : { type: T; value: V; __sigilRpcId: number };

${blocks.join("\n\n")}

declare function acquireVsCodeApi(): {
  postMessage(message: ${accepted}): void;
  getState(): unknown;
  setState(state: unknown): void;
};
`;
    files.push({ dir, content });
  }
  return files;
}

/** "src/panels/notes.ts" visto de "ui" → "../src/panels/notes". */
function importSpecifier(uiDir: string, sourceFile: string): string {
  const noExt = sourceFile.replace(/\.(ts|tsx|mts|cts)$/, "");
  const rel = path.posix.relative(uiDir === "." ? "" : uiDir, noExt);
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/** "NotesPanel.onAdd" → "onAdd" (a chave do IR é sempre Classe.membro). */
function memberOf(key: string): string {
  return key.slice(key.indexOf(".") + 1);
}
