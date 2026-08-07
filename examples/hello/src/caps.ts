import { CustomEditor, OnMessage, type SigilEditorContext } from "@sigilkit/core";

// Editor custom sobre o shell de webview: a UI recebe o documento por
// mensagens __sigilDocument e edita via applyEdit (undo-friendly).
@CustomEditor({ id: "caps", displayName: "Editor CAPS", filenamePattern: "*.caps", ui: "./ui/caps.html" })
export class CapsEditor {
  @OnMessage("gritar")
  gritar(_v: unknown, editor: SigilEditorContext) {
    void editor.applyEdit(editor.getText().toUpperCase());
  }
}
