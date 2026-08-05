import { Extension, Command, Config, OnMessage, OnRequest, Webview, registry, getConfig } from "@sigil/core";

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
    return registry.webviews.get("NotesPanel")!.open();
  }
}

// Webview de SIDEBAR: entra em contributes.views (type "webview") e o open()
// foca a view. O estado vive na instância, não na view: fechar e reabrir a
// sidebar não perde as notas.
@Webview({ id: "panel", title: "Notes", ui: "./ui/notes.html", location: "sidebar", container: "explorer" })
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

  // @OnRequest: o retorno volta para o callHost("count") do lado UI
  @OnRequest("count")
  onCount(): number {
    return this.notes.length;
  }

  post!: (msg: HostToUi) => void; // injetado pelo wire
}
