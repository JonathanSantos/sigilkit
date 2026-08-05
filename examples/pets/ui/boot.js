// O ÚNICO código novo do lado UI: ~30 linhas de adaptação.
// O app do vscode-pets (ui-src/, intacto) fala {command,...}; o roteador do
// sigil fala {type, value}. Este boot: (1) adapta a direção UI→host,
// (2) deriva a base de mídia da URI do próprio bundle, (3) faz o handshake
// ready→init para o host mandar as configs — que no upstream eram
// interpoladas no HTML (o shell do sigil serve HTML estático).
(function () {
  var real = acquireVsCodeApi();
  var adaptado = {
    postMessage: function (m) { real.postMessage({ type: m.command, value: m }); },
    getState: function () { return real.getState(); },
    setState: function (s) { return real.setState(s); },
  };

  var bundle = document.querySelector("script[data-pets-bundle]");
  var basePetUri = new URL("../../media", bundle.src).toString();

  var iniciado = false;
  window.addEventListener("message", function (ev) {
    var msg = ev.data;
    if (!msg || msg.command !== "init" || iniciado) return;
    iniciado = true;
    // eslint-disable-next-line no-undef
    petApp.petPanelApp(
      basePetUri, msg.theme, msg.themeKind, msg.color, msg.size, msg.type,
      msg.throwBallWithMouse, msg.disableEffects, adaptado
    );
    // o app arma um listener de 'load' que gateia a animação — no upstream o
    // boot era inline (antes do load); aqui o init chega DEPOIS do load, então
    // re-disparamos o evento para destravar o tick loop
    window.dispatchEvent(new Event("load"));
  });

  adaptado.postMessage({ command: "ready" });
})();
