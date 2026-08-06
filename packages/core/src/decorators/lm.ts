import * as vscode from "vscode";
import { registry } from "../registry";
import { registerBoundMember } from "../metadata";
import { guard } from "../guard";
import { log } from "../log";

/**
 * A fornada de IA: tools do agent mode e servidores MCP — as superfícies que
 * o Copilot invoca. API acessada DINAMICAMENTE (resolução tardia, princípio
 * do CONTRIBUTING): host sem suporte → erro alto no bind, nunca crash no load
 * e nunca exigência de @types/vscode novo.
 */

export interface LmToolOptions {
  /** O texto que o MODELO lê para decidir usar a tool — capriche. */
  description: string;
  /** Sufixo do nome público (default: nome do método) → `<prefix>_<name>`. */
  name?: string;
  /** Nome exibido ao usuário (confirmações, listas). */
  displayName?: string;
  /** Habilita `#nome` no prompt do usuário (canBeReferencedInPrompt). */
  referenceName?: string;
  /** Mensagem exibida enquanto a tool roda ("Buscando issues…"). */
  invocationMessage?: string;
  tags?: string[];
}

/**
 * Tool do agent mode (contributes.languageModelTools + lm.registerTool).
 * O inputSchema é DERIVADO do tipo do primeiro parâmetro do método — o
 * schema JSON que todo mundo duplica à mão sai do seu tipo TS.
 * Retorne string (vira texto para o modelo) ou um LanguageModelToolResult.
 */
export function LmTool(_opts: LmToolOptions) {
  return registerBoundMember("lmTools");
}

export interface McpServersOptions {
  /** Nome do provedor exibido ao usuário. */
  label: string;
  /** Sufixo do id do contributes (default: nome do método). */
  id?: string;
}

/**
 * Provedor de servidores MCP (contributes.mcpServerDefinitionProviders +
 * lm.registerMcpServerDefinitionProvider, VSCode >= 1.101). Retorne
 * definições simples; o bind converte para as classes do host:
 *   { label, command, args?, env?, cwd? }  → stdio
 *   { label, uri, headers? }               → http
 */
export function McpServers(_opts: McpServersOptions) {
  return registerBoundMember("mcpServers");
}

// ── binds ────────────────────────────────────────────────────────────────────

export interface LmToolBinding {
  readonly key: string;
  readonly name: string;
  readonly invocationMessage?: string;
}

interface LmToolsApiLike {
  registerTool(name: string, tool: Record<string, unknown>): vscode.Disposable;
}

export function bindLmTools(bindings: readonly LmToolBinding[]): vscode.Disposable {
  const lm = (vscode as unknown as { lm?: LmToolsApiLike }).lm;
  if (!lm?.registerTool) {
    log.error("sigil: @LmTool exige a Language Model Tools API (VSCode >= 1.95) — tools não registradas");
    return { dispose() {} };
  }
  const disposables: vscode.Disposable[] = [];
  for (const b of bindings) {
    if (!registry.lmToolHandlers.has(b.key)) {
      throw new Error(`sigil: handler ausente para ${b.key}. Rode 'sigil build'.`);
    }
    disposables.push(
      lm.registerTool(b.name, {
        invoke: async (options: { input?: unknown }, token: unknown) => {
          // resolve do registry a cada invocação (hot-swap safe)
          const fn = registry.lmToolHandlers.get(b.key);
          if (!fn) throw new Error(`sigil: handler ausente para ${b.key}. Rode 'sigil build'.`);
          const result = await fn(options?.input, token);
          return wrapToolResult(result);
        },
        ...(b.invocationMessage
          ? { prepareInvocation: () => ({ invocationMessage: b.invocationMessage }) }
          : {}),
      })
    );
  }
  return {
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

/** string → LanguageModelToolResult([TextPart]); resultado pronto passa direto. */
function wrapToolResult(result: unknown): unknown {
  if (result && typeof result === "object" && "content" in (result as object)) return result;
  const api = vscode as unknown as {
    LanguageModelToolResult?: new (parts: unknown[]) => unknown;
    LanguageModelTextPart?: new (text: string) => unknown;
  };
  const text = typeof result === "string" ? result : JSON.stringify(result ?? null);
  if (api.LanguageModelToolResult && api.LanguageModelTextPart) {
    return new api.LanguageModelToolResult([new api.LanguageModelTextPart(text)]);
  }
  return { content: [{ value: text }] };
}

export interface McpProviderBinding {
  readonly key: string;
  readonly id: string;
}

interface McpApiLike {
  registerMcpServerDefinitionProvider(id: string, provider: Record<string, unknown>): vscode.Disposable;
}

export function bindMcpServers(bindings: readonly McpProviderBinding[]): vscode.Disposable {
  const lm = (vscode as unknown as { lm?: McpApiLike }).lm;
  if (!lm?.registerMcpServerDefinitionProvider) {
    log.error("sigil: @McpServers exige a MCP API (VSCode >= 1.101) — provedores não registrados");
    return { dispose() {} };
  }
  const disposables: vscode.Disposable[] = [];
  for (const b of bindings) {
    if (!registry.mcpServerHandlers.has(b.key)) {
      throw new Error(`sigil: handler ausente para ${b.key}. Rode 'sigil build'.`);
    }
    disposables.push(
      lm.registerMcpServerDefinitionProvider(b.id, {
        provideMcpServerDefinitions: guard(`@McpServers ${b.key}`, async () => {
          const fn = registry.mcpServerHandlers.get(b.key);
          const defs = (await fn?.()) as Record<string, unknown>[] | undefined;
          return (defs ?? []).map(toMcpDefinition);
        }),
      })
    );
  }
  return {
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

function toMcpDefinition(def: Record<string, unknown>): unknown {
  const api = vscode as unknown as {
    McpStdioServerDefinition?: new (label: string, command: string, args?: string[], env?: Record<string, string | number | null>) => unknown;
    McpHttpServerDefinition?: new (label: string, uri: unknown, headers?: Record<string, string>) => unknown;
  };
  if (typeof def.uri === "string" && api.McpHttpServerDefinition) {
    return new api.McpHttpServerDefinition(String(def.label), vscode.Uri.parse(def.uri), def.headers as Record<string, string> | undefined);
  }
  if (api.McpStdioServerDefinition) {
    return new api.McpStdioServerDefinition(
      String(def.label),
      String(def.command),
      (def.args as string[] | undefined) ?? [],
      def.env as Record<string, string | number | null> | undefined
    );
  }
  return def; // host sem as classes: entrega cru (mocks de teste caem aqui)
}
