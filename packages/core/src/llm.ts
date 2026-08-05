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

export const llm = {
  /** Streaming: onChunk por pedaço; resolve com o texto completo. */
  async stream(promptText: string, onChunk: (chunk: string) => void, opts: LlmOptions = {}): Promise<string> {
    const model = await selectModel(opts);
    const started = Date.now();
    const content = opts.system ? `${opts.system}\n\n${promptText}` : promptText;
    const response = await model.sendRequest([userMessage(content)], {}, { isCancellationRequested: false });
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
};
