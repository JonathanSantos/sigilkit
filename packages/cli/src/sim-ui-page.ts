/**
 * A página do workbench fake do `sigil sim --ui`. Uma página só, sem
 * framework, tema escuro com as variáveis CSS do VSCode (que também são
 * injetadas nos iframes de webview, para a UI do usuário parecer correta).
 */
export const SIM_UI_PAGE = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>sigil sim</title>
<style>
  :root {
    --bg: #1e1e1e; --bg2: #252526; --bg3: #333333; --fg: #cccccc; --dim: #8a8a8a;
    --accent: #0e639c; --accent2: #1177bb; --border: #3c3c3c; --status: #16825d;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, system-ui, sans-serif; font-size: 13px;
         background: var(--bg); color: var(--fg); height: 100vh; display: flex; flex-direction: column; }
  #titlebar { background: var(--bg3); padding: 6px 12px; display: flex; gap: 8px; align-items: center;
              border-bottom: 1px solid var(--border); }
  #titlebar b { color: #fff; }
  #conn { margin-left: auto; font-size: 11px; color: var(--dim); }
  #main { flex: 1; display: grid; grid-template-columns: 260px 1fr 320px; min-height: 0; }
  .col { border-right: 1px solid var(--border); overflow-y: auto; min-height: 0; }
  .section { padding: 8px 10px; }
  .section h3 { margin: 4px 0 8px; font-size: 11px; text-transform: uppercase; color: var(--dim);
                letter-spacing: .06em; }
  /* palette */
  .cmd { display: block; width: 100%; text-align: left; background: var(--bg2); color: var(--fg);
         border: 1px solid var(--border); border-radius: 3px; padding: 6px 8px; margin: 3px 0;
         cursor: pointer; font: inherit; }
  .cmd:hover { background: var(--accent); color: #fff; }
  .cmd small { color: var(--dim); display: block; font-size: 10px; }
  .cmd:hover small { color: #cde; }
  /* trees */
  .tree { margin-bottom: 10px; }
  .tnode { padding: 2px 0 2px 8px; cursor: default; white-space: nowrap; }
  .tnode .twist { display: inline-block; width: 14px; cursor: pointer; color: var(--dim); }
  .tnode .desc { color: var(--dim); margin-left: 6px; font-size: 11px; }
  .tkids { margin-left: 14px; border-left: 1px solid var(--border); }
  /* config */
  .cfg { margin: 8px 0; }
  .cfg label { display: block; font-weight: 600; margin-bottom: 2px; }
  .cfg .desc { color: var(--dim); font-size: 11px; margin-bottom: 3px; }
  .cfg input[type=text], .cfg input[type=number], .cfg select {
    width: 100%; background: var(--bg3); color: var(--fg); border: 1px solid var(--border);
    border-radius: 2px; padding: 4px 6px; font: inherit; }
  /* webviews */
  .wv { border: 1px solid var(--border); border-radius: 4px; margin: 8px 0; overflow: hidden; }
  .wv .wvtitle { background: var(--bg3); padding: 4px 8px; font-size: 11px; color: var(--dim); }
  .wv iframe { width: 100%; height: 340px; border: 0; background: var(--bg); }
  #sidebar .wv iframe { height: 260px; }
  /* logs */
  #logs { font-family: ui-monospace, monospace; font-size: 11px; white-space: pre-wrap;
          margin: 0; padding: 8px 10px; }
  #logs .warn { color: #d7ba7d; } #logs .error { color: #f48771; } #logs .debug, #logs .trace { color: var(--dim); }
  /* status bar */
  #statusbar { background: var(--status); color: #fff; padding: 3px 12px; font-size: 12px;
               display: flex; gap: 16px; }
  /* toasts */
  #toasts { position: fixed; right: 14px; bottom: 40px; display: flex; flex-direction: column; gap: 8px; }
  .toast { background: var(--bg3); border: 1px solid var(--border); border-left: 3px solid var(--accent2);
           padding: 8px 12px; border-radius: 3px; max-width: 340px; box-shadow: 0 4px 12px #0008; }
  .toast.warn { border-left-color: #d7ba7d; } .toast.error { border-left-color: #f48771; }
  /* modal */
  #overlay { position: fixed; inset: 0; background: #0008; display: flex; align-items: flex-start;
             justify-content: center; padding-top: 12vh; }
  #modal { background: var(--bg2); border: 1px solid var(--border); border-radius: 4px; padding: 14px;
           width: 420px; box-shadow: 0 8px 30px #000a; }
  #modal input { width: 100%; background: var(--bg3); color: var(--fg); border: 1px solid var(--accent2);
                 padding: 6px 8px; font: inherit; }
  #modal .qpitem { padding: 6px 8px; cursor: pointer; border-radius: 3px; }
  #modal .qpitem:hover { background: var(--accent); color: #fff; }
  .empty { color: var(--dim); font-style: italic; }
  .notsim { color: var(--dim); text-align: center; padding: 30px 10px; border: 1px dashed var(--border);
            border-radius: 4px; margin: 10px; }
</style>
</head>
<body>
  <div id="titlebar">⚡ <b>sigil sim</b> <span id="proj"></span><span id="conn">conectando…</span></div>
  <div id="main">
    <div class="col" id="sidebar">
      <div class="section"><h3>Views</h3><div id="trees"></div><div id="sideviews"></div></div>
    </div>
    <div class="col" id="center">
      <div class="notsim">editor não simulado — este é o harness do sigil, não um VSCode</div>
      <div class="section"><h3>Webviews (painéis)</h3><div id="panels"><div class="empty">nenhum painel aberto — execute um comando que abra</div></div></div>
    </div>
    <div class="col" id="right">
      <div class="section"><h3>Command Palette</h3><div id="cmds"></div></div>
      <div class="section"><h3>Configurações</h3><div id="cfgs"></div></div>
      <div class="section"><h3>Output</h3><pre id="logs"></pre></div>
    </div>
  </div>
  <div id="statusbar"></div>
  <div id="toasts"></div>
<script>
(function () {
  var state = null;
  var seen = { info: 0, warn: 0, error: 0 };
  var firstRender = true;
  var iframes = {};   // key -> { wrap, iframe, html, postedCount }
  var collapsed = {}; // "viewId//path" -> true

  var es = new EventSource("/events");
  es.onopen = function () { document.getElementById("conn").textContent = "● conectado"; };
  es.onerror = function () { document.getElementById("conn").textContent = "○ reconectando…"; };
  es.onmessage = function (e) { state = JSON.parse(e.data); render(); };

  function api(path, body) {
    return fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  var IFRAME_BASE = "<style>:root{--vscode-font-family:-apple-system,system-ui,sans-serif;" +
    "--vscode-foreground:#ccc;--vscode-input-background:#3c3c3c;--vscode-input-foreground:#eee;" +
    "--vscode-input-border:#555;--vscode-panel-border:#444}" +
    "body{background:#1e1e1e;color:#ccc}</style>";

  function prepareHtml(html, key) {
    var out = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/i, "");
    out = out.replace(/sigil-webview:\\/\\//g, "/webview-resource?path=");
    var shim = "<script>window.acquireVsCodeApi=function(){return{postMessage:function(m){" +
      "parent.postMessage({__sigilUi:true,key:" + JSON.stringify(key) + ",message:m},'*')}," +
      "getState:function(){},setState:function(){}}};<\\/script>" + IFRAME_BASE;
    if (/<head[^>]*>/i.test(out)) return out.replace(/<head([^>]*)>/i, "<head$1>" + shim);
    return shim + out;
  }

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (d && d.__sigilUi) api("/api/webview-message", { key: d.key, message: d.message });
  });

  function renderTreeNodes(container, viewId, nodes, pathPrefix) {
    nodes.forEach(function (n) {
      var key = viewId + "//" + pathPrefix + n.label;
      var row = el("div", "tnode");
      if (n.collapsible) {
        var twist = el("span", "twist", collapsed[key] ? "▸" : "▾");
        twist.onclick = function () { collapsed[key] = !collapsed[key]; render(); };
        row.appendChild(twist);
      } else {
        row.appendChild(el("span", "twist", "•"));
      }
      row.appendChild(document.createTextNode(n.label));
      if (n.description) row.appendChild(el("span", "desc", n.description));
      container.appendChild(row);
      if (n.collapsible && !collapsed[key] && n.children.length) {
        var kids = el("div", "tkids");
        renderTreeNodes(kids, viewId, n.children, pathPrefix + n.label + "/");
        container.appendChild(kids);
      }
    });
  }

  function renderWebviews(listEl, items) {
    items.forEach(function (wv) {
      var ref = iframes[wv.key];
      if (!ref) {
        var wrap = el("div", "wv");
        wrap.appendChild(el("div", "wvtitle", (wv.kind === "view" ? "sidebar · " : "painel · ") + wv.title));
        var iframe = document.createElement("iframe");
        iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-modals");
        wrap.appendChild(iframe);
        ref = iframes[wv.key] = { wrap: wrap, iframe: iframe, html: null, postedCount: 0 };
      }
      if (!ref.wrap.parentElement) listEl.appendChild(ref.wrap);
      if (ref.html !== wv.html) {
        ref.html = wv.html;
        ref.postedCount = 0;
        ref.iframe.srcdoc = prepareHtml(wv.html, wv.key);
      }
      var posted = wv.posted || [];
      if (ref.postedCount < posted.length) {
        var pendingMsgs = posted.slice(ref.postedCount);
        ref.postedCount = posted.length;
        setTimeout(function () {
          pendingMsgs.forEach(function (m) {
            try { ref.iframe.contentWindow.postMessage(m, "*"); } catch (err) {}
          });
        }, 60);
      }
    });
  }

  function toast(kind, text) {
    var t = el("div", "toast " + kind, text);
    document.getElementById("toasts").appendChild(t);
    setTimeout(function () { t.remove(); }, 4500);
  }

  function render() {
    if (!state) return;
    document.getElementById("proj").textContent = "— " + state.project.displayName;

    // palette
    var cmds = document.getElementById("cmds");
    cmds.innerHTML = "";
    state.commands.forEach(function (c) {
      var b = el("button", "cmd", c.title || c.id);
      b.appendChild(el("small", null, c.id));
      b.onclick = function () { api("/api/command", { id: c.id }); };
      cmds.appendChild(b);
    });

    // configs
    var cfgs = document.getElementById("cfgs");
    cfgs.innerHTML = "";
    state.config.forEach(function (c) {
      var box = el("div", "cfg");
      var label = el("label", null, c.id);
      box.appendChild(label);
      if (c.description) box.appendChild(el("div", "desc", c.description));
      var input;
      if (c.enum) {
        input = document.createElement("select");
        c.enum.forEach(function (opt) {
          var o = el("option", null, String(opt));
          o.value = String(opt);
          input.appendChild(o);
        });
        input.value = String(c.value);
        input.onchange = function () { api("/api/config", { id: c.id, value: input.value }); };
      } else if (c.type === "boolean") {
        input = document.createElement("input");
        input.type = "checkbox";
        input.checked = !!c.value;
        input.onchange = function () { api("/api/config", { id: c.id, value: input.checked }); };
      } else if (c.type === "number") {
        input = document.createElement("input");
        input.type = "number";
        if (c.minimum !== undefined) input.min = c.minimum;
        if (c.maximum !== undefined) input.max = c.maximum;
        input.value = c.value;
        input.onchange = function () { api("/api/config", { id: c.id, value: Number(input.value) }); };
      } else {
        input = document.createElement("input");
        input.type = "text";
        input.value = c.value === undefined ? "" : String(c.value);
        input.onchange = function () { api("/api/config", { id: c.id, value: input.value }); };
      }
      box.appendChild(input);
      cfgs.appendChild(box);
    });

    // trees
    var trees = document.getElementById("trees");
    trees.innerHTML = "";
    state.trees.forEach(function (t) {
      var box = el("div", "tree");
      box.appendChild(el("h3", null, t.name.toUpperCase() + " (" + t.viewId + ")"));
      if (t.nodes.length === 0) box.appendChild(el("div", "empty", "vazia"));
      renderTreeNodes(box, t.viewId, t.nodes, "");
      trees.appendChild(box);
    });

    // webviews
    var side = [], center = [];
    state.webviews.forEach(function (wv) { (wv.kind === "view" ? side : center).push(wv); });
    var sideEl = document.getElementById("sideviews");
    var panelsEl = document.getElementById("panels");
    if (center.length && panelsEl.querySelector(".empty")) panelsEl.innerHTML = "";
    renderWebviews(sideEl, side);
    renderWebviews(panelsEl, center);

    // status bar
    var sb = document.getElementById("statusbar");
    sb.innerHTML = "";
    if (state.statusBar.length === 0) sb.appendChild(el("span", "empty", "sem itens de status bar"));
    state.statusBar.forEach(function (s) {
      var span = el("span", null, s.text);
      if (s.tooltip) span.title = s.tooltip;
      sb.appendChild(span);
    });

    // logs
    var logs = document.getElementById("logs");
    logs.innerHTML = "";
    state.logs.slice(-40).forEach(function (l) {
      var line = el("div", l.level, "[" + l.level + "] " + l.message);
      logs.appendChild(line);
    });
    logs.scrollTop = logs.scrollHeight;

    // toasts para notificações NOVAS (na primeira render só sincroniza contadores)
    ["info", "warn", "error"].forEach(function (kind) {
      var list = state.notifications[kind];
      if (!firstRender) list.slice(seen[kind]).forEach(function (m) { toast(kind, m); });
      seen[kind] = list.length;
    });
    firstRender = false;

    // input interativo
    var existing = document.getElementById("overlay");
    if (existing) existing.remove();
    if (state.pendingInput) {
      var pi = state.pendingInput;
      var overlay = el("div"); overlay.id = "overlay";
      var modal = el("div"); modal.id = "modal";
      modal.appendChild(el("div", "desc", pi.prompt));
      if (pi.kind === "quickPick" && pi.items) {
        pi.items.forEach(function (item) {
          var opt = el("div", "qpitem", typeof item === "string" ? item : (item.label || JSON.stringify(item)));
          opt.onclick = function () { api("/api/input-response", { id: pi.id, value: item }); };
          modal.appendChild(opt);
        });
      } else {
        var input = document.createElement("input");
        input.placeholder = "Enter confirma · Esc cancela";
        input.onkeydown = function (ev) {
          if (ev.key === "Enter") api("/api/input-response", { id: pi.id, value: input.value });
          if (ev.key === "Escape") api("/api/input-response", { id: pi.id, value: null });
        };
        modal.appendChild(input);
        setTimeout(function () { input.focus(); }, 30);
      }
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
    }
  }
})();
</script>
</body>
</html>
`;
