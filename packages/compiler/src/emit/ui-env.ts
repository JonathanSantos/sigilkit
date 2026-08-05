import * as path from "node:path";
import { IR } from "../ir";

/**
 * IR → um `sigil-env.d.ts` por diretório de UI (dirname do `ui:` de cada
 * @Webview/@CustomEditor). O arquivo tipa o protocolo da pasta nos dois
 * mundos:
 *
 * - `declare global`: `acquireVsCodeApi().postMessage(...)` aceita só os
 *   tipos declarados em @OnMessage/@OnRequest, com o shape do `value`
 *   DERIVADO do parâmetro do handler via `Parameters<import(...)>` — mudar o
 *   tipo no host flui para a UI sem reemitir (só add/remove de mensagem
 *   reemite, e isso é mudança de IR);
 * - `declare module "@sigilkit/core/ui"`: augmentation dos registros
 *   SigilUiMessages/SigilUiRequests/SigilUiFromHost — postToHost e callHost
 *   ficam tipados por chave (typo = erro de build), e onHostMessage recebe a
 *   união host→UI derivada do tipo do `post` da classe.
 *
 * O arquivo é módulo (`export {}`) porque augmentation exige; os globais vêm
 * do bloco `declare global`. Convenção: uma pasta (e um tsconfig) por
 * webview — com duas UIs na mesma pasta, os protocolos se unem.
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

    const globalBlocks: string[] = [];
    const postTypes: string[] = [];
    const msgEntries: string[] = [];
    const reqEntries: string[] = [];
    const hostTypes: string[] = [];

    for (const cls of classes) {
      const inst = `__Sigil_${cls.key}`;
      const spec = importSpecifier(dir, cls.sourceFile);
      const lines: string[] = [
        `  type ${inst} = InstanceType<typeof import(${JSON.stringify(spec)})[${JSON.stringify(cls.key)}]>;`,
      ];
      const param = (h: { key: string }) =>
        `__SigilValueOf<${inst}[${JSON.stringify(memberOf(h.key))}]>`;

      if (cls.messageHandlers.length > 0) {
        lines.push(``, `  /** Mensagens aceitas pelos @OnMessage de ${cls.key}. */`);
        lines.push(
          `  type ${cls.key}Message =`,
          ...cls.messageHandlers.map((h) => `    | __SigilMsg<${JSON.stringify(h.type)}, ${param(h)}>`)
        );
        lines[lines.length - 1] += ";";
        postTypes.push(`${cls.key}Message`);
        msgEntries.push(
          ...cls.messageHandlers.map((h) => `    ${JSON.stringify(h.type)}: ${param(h)};`)
        );
      }
      if (cls.requestHandlers.length > 0) {
        const ret = (h: { key: string }) =>
          `Awaited<ReturnType<${inst}[${JSON.stringify(memberOf(h.key))}]>>`;
        lines.push(``, `  /** Requests (@OnRequest): envie com __sigilRpcId e receba { type: "__sigilRpcResult", id, ok, value }. */`);
        lines.push(
          `  type ${cls.key}Request =`,
          ...cls.requestHandlers.map((h) => `    | __SigilReq<${JSON.stringify(h.type)}, ${param(h)}>`)
        );
        lines[lines.length - 1] += ";";
        lines.push(``, `  /** Resultado de cada request de ${cls.key}. */`);
        lines.push(
          `  type ${cls.key}Response = {`,
          ...cls.requestHandlers.map((h) => `    ${JSON.stringify(h.type)}: ${ret(h)};`),
          `  };`
        );
        postTypes.push(`${cls.key}Request`);
        reqEntries.push(
          ...cls.requestHandlers.map(
            (h) => `    ${JSON.stringify(h.type)}: { value: ${param(h)}; result: ${ret(h)} };`
          )
        );
      }
      // host→UI: derivado do tipo do membro `post` da classe (se existir)
      lines.push(
        ``,
        `  /** Mensagens que o host envia para esta UI (tipo do 'post' de ${cls.key}). */`,
        `  type ${cls.key}HostMessage = __SigilHostOf<${inst}>;`
      );
      hostTypes.push(`${cls.key}HostMessage`);
      globalBlocks.push(lines.join("\n"));
    }

    const accepted = postTypes.length > 0 ? postTypes.join(" | ") : "never";
    const augment = [
      `declare module "@sigilkit/core/ui" {`,
      ...(msgEntries.length > 0 ? [`  interface SigilUiMessages {`, ...msgEntries, `  }`] : []),
      ...(reqEntries.length > 0 ? [`  interface SigilUiRequests {`, ...reqEntries, `  }`] : []),
      `  interface SigilUiFromHost {`,
      `    message: ${hostTypes.join(" | ")};`,
      `  }`,
      `}`,
    ].join("\n");

    const content = `// GERADO POR sigil — NÃO EDITE (derivado dos @OnMessage/@OnRequest; regenerado no build)
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

${globalBlocks.join("\n\n")}

  function acquireVsCodeApi(): {
    postMessage(message: ${accepted}): void;
    getState(): unknown;
    setState(state: unknown): void;
  };
}

${augment}
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
