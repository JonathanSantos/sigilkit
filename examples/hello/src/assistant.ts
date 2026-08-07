import { ChatParticipant, ChatRequest, ChatCommand, registry } from "@sigilkit/core";
import { HelloExtension } from "./extension";

// Participante de chat (@hello no Copilot Chat) com um slash command — a API
// de chat é acessada dinamicamente pelo bind; em host antigo falha alto.
@ChatParticipant({ id: "hello", name: "hello", description: "o assistente do hello" })
export class HelloAssistant {
  @ChatRequest()
  async responder(_req: unknown, _ctx: unknown, stream: { markdown(t: string): void }) {
    stream.markdown("olá do chat!");
  }

  @ChatCommand("greet", { description: "Manda a saudação configurada" })
  async greet(_req: unknown, _ctx: unknown, stream: { markdown(t: string): void }) {
    stream.markdown(registry.instance(HelloExtension).greeting);
  }
}
