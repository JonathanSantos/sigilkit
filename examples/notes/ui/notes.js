// @ts-check
// Protocolo tipado sem build de UI nenhum: o sigil-env.d.ts gerado pelo
// `sigil build` tipa o acquireVsCodeApi desta pasta — um `type` fora do
// declarado (ou um `value` com o shape errado) é erro de typecheck aqui.
const vscode = acquireVsCodeApi();

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

$("add").addEventListener("click", () => {
  const input = /** @type {HTMLInputElement} */ ($("text"));
  if (!input.value) return;
  vscode.postMessage({ type: "add", value: input.value });
  input.value = "";
});

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "error") {
    alert(msg.value);
    return;
  }
  if (msg.type === "state") {
    const list = $("list");
    list.innerHTML = "";
    for (const note of msg.value) {
      const li = document.createElement("li");
      li.textContent = note.text;
      li.addEventListener("click", () => vscode.postMessage({ type: "remove", value: note.id }));
      list.appendChild(li);
    }
  }
});
