import * as vscode from "vscode";
import { dual } from "./dual";
import { registry } from "../registry";
import { registerBoundMember } from "../metadata";
import { guard } from "../guard";
import { log } from "../log";

export interface ChatParticipantOptions {
  /** sufixo do id (vira `<prefix>.<id>` no manifesto) */
  id: string;
  /** o @nome que o usuário menciona no chat */
  name: string;
  fullName?: string;
  description?: string;
  isSticky?: boolean;
}

/**
 * Participante de chat (Copilot Chat, VSCode >= 1.90). O manifesto ganha a
 * entrada em contributes.chatParticipants (ativação é automática); o handler
 * de request vem de @ChatRequest.
 *
 * A API de chat é acessada dinamicamente: em hosts antigos o bind falha alto
 * com mensagem clara (R6) em vez de quebrar o load do bundle.
 */
export function ChatParticipant(_opts: ChatParticipantOptions) {
  return function <T extends new (...args: any[]) => object>(
    _target: T,
    _ctx: ClassDecoratorContext<T>
  ): void {};
}

/** handler(request, context, stream, token) — o coração do participante. */
export const ChatRequest = dual(() => registerBoundMember("chatHandlers"));

/** provideFollowups(result, context, token) — sugestões pós-resposta. Opcional. */
export const ChatFollowups = dual(() => registerBoundMember("chatHandlers"));

export interface ChatParticipantBinding {
  readonly key: string;
  readonly id: string;
  readonly requestKey: string;
  readonly followupsKey?: string;
}

// Tipagem mínima local: evita exigir @types/vscode >= 1.90 de quem não usa chat.
interface ChatApiLike {
  createChatParticipant(
    id: string,
    handler: (...args: unknown[]) => unknown
  ): {
    followupProvider?: { provideFollowups: (...args: unknown[]) => unknown };
    dispose(): void;
  };
}

export function bindChatParticipant(binding: ChatParticipantBinding, ctx: vscode.ExtensionContext): vscode.Disposable {
  if (!registry.chatHandlers.has(binding.requestKey)) {
    throw new Error(`sigil: handler ausente para ${binding.requestKey}. Rode 'sigil build'.`);
  }
  const chat = (vscode as unknown as { chat?: ChatApiLike }).chat;
  if (!chat) {
    // R6: host sem a API de chat → erro descritivo na ativação, nunca silêncio
    log.error(`sigil: '${binding.id}' exige a API de chat (VSCode >= 1.90) — participante não registrado`);
    return { dispose() {} };
  }

  const participant = chat.createChatParticipant(binding.id, (...args: unknown[]) => {
    const fn = registry.chatHandlers.get(binding.requestKey);
    if (!fn) throw new Error(`sigil: handler ausente para ${binding.requestKey}. Rode 'sigil build'.`);
    return guard(`@ChatRequest de ${binding.key}`, fn)(...args);
  });
  if (binding.followupsKey) {
    const followupsKey = binding.followupsKey;
    participant.followupProvider = {
      provideFollowups: (...args: unknown[]) => {
        const fn = registry.chatHandlers.get(followupsKey);
        return fn ? guard(`@ChatFollowups de ${binding.key}`, fn)(...args) : [];
      },
    };
  }
  void ctx;
  return participant;
}
