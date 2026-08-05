import fs from "node:fs";
import path from "node:path";
import { SigilTestHost } from "./index";
import { resetState, uriFile } from "./vscode-mock";
import { __mock, __sigilTestState } from "./vscode-singleton";

/**
 * Modo INLINE (item 12): ativa o wire TS diretamente, sem bundle no meio —
 * o vitest transforma o TS e o alias "vscode" → @sigil/test/vscode-singleton
 * entrega o mock. Pré-requisitos no vitest.config:
 *
 *   esbuild: { target: "es2022" },       // decorators stage 3 rebaixados
 *   resolve.alias: {
 *     vscode: ".../packages/test/src/vscode-singleton.ts",
 *     "@sigil/core": ".../packages/core/src/index.ts",  // o dist faria require("vscode") fora do alias
 *   }
 *
 * Cada activateInline zera o estado compartilhado — um host por vez.
 */
export interface InlineActivateOptions {
  /** raiz do projeto — semeia os defaults de config do manifesto */
  projectDir: string;
  configuration?: Record<string, unknown>;
}

interface ExtensionModule {
  activate(ctx: unknown): unknown;
  deactivate?(): unknown;
}

export async function activateInline(
  ext: ExtensionModule,
  opts: InlineActivateOptions
): Promise<SigilTestHost> {
  resetState(__sigilTestState);

  const projectDir = path.resolve(opts.projectDir);
  const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8")) as {
    contributes?: { configuration?: { properties?: Record<string, { default?: unknown }> } };
  };
  const properties = pkg.contributes?.configuration?.properties ?? {};
  for (const [id, schema] of Object.entries(properties)) {
    if (schema && "default" in schema) __sigilTestState.defaults.set(id, schema.default);
  }
  if (opts.configuration) {
    for (const [id, value] of Object.entries(opts.configuration)) {
      __sigilTestState.values.set(id, value);
    }
  }

  const ctx = {
    subscriptions: [],
    extensionUri: uriFile(projectDir),
    extensionPath: projectDir,
  };
  await ext.activate(ctx);
  return new SigilTestHost(__sigilTestState, __mock, ext, ctx);
}
