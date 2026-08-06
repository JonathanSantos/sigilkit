import * as vscode from "vscode";
import { log } from "./log";

/**
 * Helper fino sobre vscode.lm (Language Model API, VSCode >= 1.90): seleção
 * de modelo, streaming e coleta — acessado dinamicamente para não exigir
 * @types/vscode novo de quem não usa. Host sem a API → erro descritivo (R6).
 */

export interface LlmOptions {
  /** família preferida (ex.: "gpt-4o", "claude-3.5-sonnet"); sem match usa o primeiro disponível */
  family?: string;
  /** prepend de instruções de sistema ao prompt */
  system?: string;
  /** CancellationToken a propagar (ex.: o token do handler de @ChatRequest) */
  token?: unknown;
}

interface LmModelLike {
  family: string;
  sendRequest(
    messages: unknown[],
    options: Record<string, unknown>,
    token: unknown
  ): Thenable<{ text: AsyncIterable<string> }>;
}

interface LmApiLike {
  selectChatModels(selector?: Record<string, unknown>): Thenable<LmModelLike[]>;
}

async function selectModel(opts: LlmOptions): Promise<LmModelLike> {
  const lm = (vscode as unknown as { lm?: LmApiLike }).lm;
  if (!lm) {
    throw new Error("sigil: llm exige a Language Model API (VSCode >= 1.90 com Copilot ou provedor de modelo)");
  }
  let models = opts.family ? await lm.selectChatModels({ family: opts.family }) : [];
  if (models.length === 0) models = await lm.selectChatModels();
  if (models.length === 0) {
    throw new Error("sigil: nenhum modelo de linguagem disponível no host");
  }
  return models[0]!;
}

function userMessage(content: string): unknown {
  const MessageClass = (vscode as unknown as { LanguageModelChatMessage?: { User(c: string): unknown } })
    .LanguageModelChatMessage;
  return MessageClass ? MessageClass.User(content) : { role: "user", content };
}

/**
 * O host real embrulha o token num CancellationTokenSource(parent), que chama
 * parent.onCancellationRequested — um objeto cru sem esse método crasha.
 */
function requestToken(opts: LlmOptions): unknown {
  if (opts.token) return opts.token;
  const Cts = (vscode as unknown as { CancellationTokenSource?: new () => { token: unknown } })
    .CancellationTokenSource;
  if (Cts) return new Cts().token;
  return { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
}

export const llm = {
  /** Streaming: onChunk por pedaço; resolve com o texto completo. */
  async stream(promptText: string, onChunk: (chunk: string) => void, opts: LlmOptions = {}): Promise<string> {
    const model = await selectModel(opts);
    const started = Date.now();
    const content = opts.system ? `${opts.system}\n\n${promptText}` : promptText;
    const response = await model.sendRequest([userMessage(content)], {}, requestToken(opts));
    let full = "";
    for await (const chunk of response.text) {
      full += chunk;
      onChunk(chunk);
    }
    log.debug(`llm ${model.family}: ${full.length} chars (${Date.now() - started}ms)`);
    return full;
  },

  /** Pergunta e espera a resposta completa. */
  ask(promptText: string, opts: LlmOptions = {}): Promise<string> {
    return llm.stream(promptText, () => {}, opts);
  },

  /**
   * O loop agêntico sem boilerplate: manda o prompt COM as tools do host
   * (lm.tools — as suas @LmTool inclusive), executa cada tool call via
   * lm.invokeTool e devolve o resultado ao modelo, até a resposta final.
   * Duck-typed sobre as parts da LM API — não exige @types novo.
   */
  async agent(
    promptText: string,
    opts: LlmOptions & { maxRounds?: number; tools?: string[]; toolInvocationToken?: unknown } = {}
  ): Promise<string> {
    const lmApi = (vscode as unknown as {
      lm?: {
        tools?: { name: string; description: string; inputSchema?: unknown }[];
        invokeTool?(name: string, options: Record<string, unknown>, token?: unknown): Thenable<{ content?: { value?: string }[] }>;
      };
    }).lm;
    if (!lmApi?.invokeTool) {
      throw new Error("sigil: llm.agent exige a Language Model Tools API (VSCode >= 1.95)");
    }
    const api = vscode as unknown as {
      LanguageModelChatMessage?: { User(c: unknown): unknown; Assistant(c: unknown): unknown };
      LanguageModelTextPart?: new (text: string) => unknown;
      LanguageModelToolCallPart?: new (callId: string, name: string, input: object) => unknown;
      LanguageModelToolResultPart?: new (callId: string, content: unknown[]) => unknown;
    };
    const disponiveis = (lmApi.tools ?? []).filter(
      (t) => !opts.tools || opts.tools.includes(t.name)
    );
    const model = await selectModel(opts);
    const content = opts.system ? `${opts.system}\n\n${promptText}` : promptText;
    const messages: unknown[] = [userMessage(content)];
    const token = requestToken(opts);
    let texto = "";

    for (let round = 0; round < (opts.maxRounds ?? 5); round++) {
      const response = (await model.sendRequest(
        messages,
        { tools: disponiveis },
        token
      )) as { text: AsyncIterable<string>; stream?: AsyncIterable<unknown> };

      const toolCalls: { callId: string; name: string; input: unknown }[] = [];
      let rodada = "";
      if (response.stream) {
        for await (const part of response.stream) {
          const p = part as { value?: unknown; callId?: string; name?: string; input?: unknown };
          if (typeof p.value === "string") rodada += p.value;
          else if (p.callId && p.name) toolCalls.push({ callId: p.callId, name: p.name, input: p.input });
        }
      } else {
        for await (const chunk of response.text) rodada += chunk;
      }
      texto += rodada;
      if (toolCalls.length === 0) return texto;

      const invocar = (call: { callId: string; name: string; input: unknown }) => {
        log.debug(`llm.agent: tool ${call.name}`);
        return lmApi.invokeTool!(call.name, { input: call.input, toolInvocationToken: opts.toolInvocationToken });
      };

      if (api.LanguageModelChatMessage?.Assistant && api.LanguageModelToolCallPart && api.LanguageModelToolResultPart) {
        // o protocolo real: Assistant([texto? + tool calls]) e User([tool results])
        // pareados por callId — sem o par, o modelo re-chama a mesma tool em loop
        const assistantParts: unknown[] = [];
        if (rodada && api.LanguageModelTextPart) assistantParts.push(new api.LanguageModelTextPart(rodada));
        for (const call of toolCalls) {
          assistantParts.push(new api.LanguageModelToolCallPart(call.callId, call.name, (call.input as object) ?? {}));
        }
        messages.push(api.LanguageModelChatMessage.Assistant(assistantParts));
        const resultParts: unknown[] = [];
        for (const call of toolCalls) {
          const r = await invocar(call);
          resultParts.push(new api.LanguageModelToolResultPart(call.callId, (r.content ?? []) as unknown[]));
        }
        messages.push(api.LanguageModelChatMessage.User(resultParts));
      } else {
        // host sem as classes de parts: resultados como texto
        const resultados: string[] = [];
        for (const call of toolCalls) {
          const r = await invocar(call);
          resultados.push(`[${call.name}] ${(r.content ?? []).map((c) => c.value ?? "").join("")}`);
        }
        messages.push(userMessage(`Resultados das ferramentas:\n${resultados.join("\n")}`));
      }
    }
    return texto;
  },
};
