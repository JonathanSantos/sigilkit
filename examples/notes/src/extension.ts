import { Extension, Command, Config, OnMessage, Webview, registry, getConfig } from "@sigil/core";

export interface Note {
  id: number;
  text: string;
}

type HostToUi = { type: "state"; value: Note[] } | { type: "error"; value: string };

@Extension()
export class NotesExtension {
  @Config({ description: "Máximo de notas guardadas", minimum: 1, maximum: 50 })
  accessor maxNotes: number = 10;

  @Command({ title: "Open Notes", category: "Notes" })
  open() {
    registry.webviews.get("NotesPanel")!.open();
  }
}

// O estado vive na instância (criada uma vez na ativação), não no painel:
// fechar e reabrir o webview não perde as notas.
@Webview({ id: "panel", title: "Notes", ui: "./ui/notes.html" })
export class NotesPanel {
  private notes: Note[] = [];
  private nextId = 1;

  @OnMessage("add")
  onAdd(text: string) {
    // tipado pelo config.d.ts gerado — a anotação é prova estática da augmentation
    const max: number = getConfig("notes.maxNotes");
    if (this.notes.length >= max) {
      this.post({ type: "error", value: `limite de ${max} notas atingido` });
      return;
    }
    this.notes.push({ id: this.nextId++, text });
    this.post({ type: "state", value: this.notes });
  }

  @OnMessage("remove")
  onRemove(id: number) {
    this.notes = this.notes.filter((n) => n.id !== id);
    this.post({ type: "state", value: this.notes });
  }

  post!: (msg: HostToUi) => void; // injetado pelo wire
}
