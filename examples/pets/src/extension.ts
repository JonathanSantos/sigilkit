import * as vscode from "vscode";
import {
  Activate,
  Command,
  Config,
  Every,
  Extension,
  OnDispose,
  OnMessage,
  OnOpen,
  State,
  Watch,
  Webview,
  editor,
  log,
  prompt,
  registry,
} from "@sigilkit/core";

// ─── Case de rewrite: o HOST do vscode-pets em sigil ─────────────────────────
// O app dos bichinhos (ui-src/, de tonybaloney/vscode-pets, MIT) fica INTACTO.
// Este arquivo substitui as ~1350 linhas de src/extension/extension.ts do
// upstream: comandos, configs, estado e o painel — com o manifesto derivado.

// Subconjunto de bichos incluído no exemplo (mídia completa no upstream).
const CORES_POR_TIPO = {
  dog: ["black", "brown", "white", "red", "akita"],
  fox: ["red", "white"],
  crab: ["red"],
} as const;

export type PetType = keyof typeof CORES_POR_TIPO;
export type PetColor = (typeof CORES_POR_TIPO)[PetType][number];

export interface PetSpec {
  type: PetType;
  color: PetColor;
  name: string;
}

// O protocolo do app deles usa `command:` (não o `type:` do sigil) — o post
// envia o shape DELES verbatim; o ui/boot.js adapta a direção UI→host.
type HostToUi =
  | { command: "init"; theme: string; themeKind: number; color: string; size: string; type: string; throwBallWithMouse: boolean; disableEffects: boolean }
  | { command: "spawn-pet"; type: string; color: string; name: string }
  | { command: "set-size"; size: string }
  | { command: "delete-pet"; name: string; type: string; color: string }
  | { command: "list-pets" }
  | { command: "roll-call" }
  | { command: "throw-ball" }
  | { command: "throw-with-mouse"; enabled: boolean }
  | { command: "disable-effects"; disabled: boolean }
  | { command: "reset-pet" }
  | { command: "tick" };

const NOMES = ["Bolinha", "Rex", "Pixel", "Mel", "Fagulha", "Byte", "Nina", "Zig"];
const nomeAleatorio = () => NOMES[Math.floor(Math.random() * NOMES.length)]!;

@Extension({ prefix: "vscode-pets" })
export class PetsExtension {
  @Config({ description: "Tipo do bicho novo (subconjunto incluído no exemplo)" })
  accessor petType: PetType = "dog";

  @Config({ description: "Cor do bicho novo" })
  accessor petColor: PetColor = "brown";

  @Config({ description: "Tamanho dos bichos" })
  accessor petSize: "nano" | "small" | "medium" | "large" = "nano";

  @Config({ description: "Lançar a bolinha com o mouse (botão direito)" })
  accessor throwBallWithMouse: boolean = true;

  @Config({ description: "Desligar efeitos visuais" })
  accessor disableEffects: boolean = false;

  /** Os bichos adotados — sobrevivem a fechar o VSCode (Memento global). */
  @State("global")
  accessor petsSalvos: PetSpec[] = [];

  @Activate
  ativar() {
    log.info(`pets salvos: ${this.petsSalvos.length}`);
  }

  // ids explícitos = os MESMOS ids públicos do upstream (keybindings e
  // walkthroughs de usuários continuariam funcionando num drop-in)
  @Command({ id: "start", title: "Start pet coding session", category: "Pets" })
  abrir() {
    return registry.panel(PetsPanel).open();
  }

  @Command({ id: "spawn-pet", title: "Spawn additional pet", category: "Pets" })
  async adotar() {
    // wizard com passo DEPENDENTE (as cores vêm do tipo escolhido) e ESC
    // voltando um passo — o MultiStepInput de 200 linhas do upstream, de graça
    const escolha = await prompt.steps({
      type: prompt.pick(Object.keys(CORES_POR_TIPO) as PetType[], { placeHolder: "Qual bicho?" }),
      color: prompt.pick((parcial) => CORES_POR_TIPO[parcial.type as PetType], { placeHolder: "Qual cor?" }),
      name: prompt.text({ prompt: "Nome do bicho", value: nomeAleatorio() }),
    });
    if (!escolha) return;

    const spec: PetSpec = { type: escolha.type, color: escolha.color as PetColor, name: escolha.name };
    this.petsSalvos = [...this.petsSalvos, spec];
    const panel = registry.panel(PetsPanel);
    if (panel.isOpen) {
      panel.post({ command: "spawn-pet", ...spec });
      panel.post({ command: "set-size", size: this.petSize });
    } else {
      await panel.open(); // abre e repovoa do estado (inclui o novo)
    }
  }

  @Command({ id: "delete-pet", title: "Remove pet", category: "Pets" })
  remover() {
    // o inventário vivo está no app: pede a lista; a resposta cai no
    // @OnMessage("list-pets") do painel com aguardandoRemocao ligado
    const panel = registry.instance(PetsPanel);
    panel.aguardandoRemocao = true;
    panel.post({ command: "list-pets" });
  }

  @Command({ id: "remove-all-pets", title: "Remove all pets", category: "Pets" })
  removerTodos() {
    this.petsSalvos = [];
    registry.panel(PetsPanel).post({ command: "reset-pet" });
  }

  @Command({ id: "roll-call", title: "Roll-call", category: "Pets" })
  chamada() {
    registry.panel(PetsPanel).post({ command: "roll-call" });
  }

  @Command({ id: "throw-ball", title: "Throw ball", category: "Pets" })
  bolinha() {
    registry.panel(PetsPanel).post({ command: "throw-ball" });
  }

  @Command({ id: "throw-with-mouse", title: "Toggle: throw ball with mouse", category: "Pets" })
  alternarMouse() {
    // atribuir ao accessor ESCREVE a config — e o @Watch abaixo notifica a UI
    this.throwBallWithMouse = !this.throwBallWithMouse;
  }

  @Command({ id: "export-pet-list", title: "Export pet list", category: "Pets" })
  exportar() {
    // upstream: ~30 linhas de documento untitled + edit. Aqui: o editor como
    // renderer, com highlight e folding do tema do usuário.
    return editor.openText(JSON.stringify(this.petsSalvos, null, 2), {
      language: "json",
      beside: true,
    });
  }

  @Watch("throwBallWithMouse")
  aoMudarMouse(ativo: boolean) {
    registry.panel(PetsPanel).post({ command: "throw-with-mouse", enabled: ativo });
  }

  @Watch("disableEffects")
  aoMudarEfeitos(desligado: boolean) {
    registry.panel(PetsPanel).post({ command: "disable-effects", disabled: desligado });
  }

  @Watch("petSize")
  aoMudarTamanho(tamanho: string) {
    registry.panel(PetsPanel).post({ command: "set-size", size: tamanho });
  }
}

@Webview({ id: "panel", title: "Pet Panel", ui: "./ui/index.html" })
export class PetsPanel {
  /** ligado pelo comando delete-pet: a próxima lista vira um QuickPick */
  aguardandoRemocao = false;

  /** A animação do app é dirigida por ticks do HOST (como no upstream, 100ms).
   *  @Every em classe @Webview roda ENQUANTO o painel está aberto — liga no
   *  open, desliga no dispose. O setInterval manual (que vazava) morreu. */
  @Every(100)
  tick() {
    this.post({ command: "tick" });
  }

  @OnOpen
  aoAbrir() {
    log.info("painel dos bichos aberto");
  }

  @OnDispose
  aoFechar() {
    log.info("painel dos bichos fechado");
  }

  /** O boot.js avisa que o app carregou → mandamos init + repovoamos. */
  @OnMessage("ready")
  pronto() {
    const ext = registry.instance(PetsExtension);
    this.post({
      command: "init",
      theme: "none", // temas precisam dos backgrounds (9 MB) — fora do exemplo
      themeKind: vscode.window.activeColorTheme?.kind ?? 2,
      color: ext.petColor,
      size: ext.petSize,
      type: ext.petType,
      throwBallWithMouse: ext.throwBallWithMouse,
      disableEffects: ext.disableEffects,
    });
    if (ext.petsSalvos.length === 0) {
      // primeira abertura: adota o bicho padrão da config (como o upstream)
      ext.petsSalvos = [{ type: ext.petType, color: ext.petColor, name: nomeAleatorio() }];
    }
    for (const pet of ext.petsSalvos) {
      this.post({ command: "spawn-pet", ...pet });
    }
    this.post({ command: "set-size", size: ext.petSize });
  }

  /** Resposta do app: "type,name,color" por linha. */
  @OnMessage("list-pets")
  async lista(value: { text: string }) {
    if (!this.aguardandoRemocao) return;
    this.aguardandoRemocao = false;
    const pets = value.text
      .split("\n")
      .filter(Boolean)
      .map((linha) => {
        const [type, name, color] = linha.split(",");
        return { type: type!, name: name!, color: color! };
      });
    if (pets.length === 0) return;
    const rotulos = pets.map((p) => `${p.name} (${p.color} ${p.type})`);
    const escolha = await prompt.steps({
      pet: prompt.pick(rotulos, { placeHolder: "Remover qual bicho?" }),
    });
    if (!escolha) return;
    const pet = pets[rotulos.indexOf(escolha.pet)]!;
    this.post({ command: "delete-pet", ...pet });
    const ext = registry.instance(PetsExtension);
    ext.petsSalvos = ext.petsSalvos.filter(
      (p) => !(p.name === pet.name && p.type === pet.type && p.color === pet.color)
    );
  }

  @OnMessage("info")
  info(value: { text: string }) {
    void vscode.window.showInformationMessage(value.text);
  }

  @OnMessage("error")
  erro(value: { text: string }) {
    void vscode.window.showErrorMessage(value.text);
  }

  post!: (msg: HostToUi) => void; // injetado pelo wire
}
