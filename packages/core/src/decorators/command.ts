import { registerBoundMember } from "../metadata";

export interface CommandMenuEntry {
  id: string;
  group?: string;
  when?: string;
}

export interface CommandOptions {
  title: string;
  category?: string;
  icon?: string;
  when?: string;
  keybinding?: string | { key: string; mac?: string; linux?: string; win?: string; when?: string };
  /** ex: "editor/context" | ["view/title", { id: "view/item/context", group: "inline" }] */
  menu?: string | (string | CommandMenuEntry)[];
  /** group default para entradas de menu que não definem o seu */
  group?: string;
  enablement?: string;
}

/**
 * As opções são ignoradas em runtime (§4) — existem para a AST. Aqui só se
 * registra o handler (bound) no bucket da classe via ctx.metadata; o
 * activate() gerado adota as registrações sob o nome declarado da classe.
 */
export function Command(_opts: CommandOptions) {
  return registerBoundMember("commands");
}
