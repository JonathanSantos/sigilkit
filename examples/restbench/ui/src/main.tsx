import { type ReactNode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { callHost, onHostMessage, postToHost } from "@sigilkit/core/ui";

// Os tipos abaixo são GERADOS pelo sigil em ui/sigil-env.d.ts, derivados dos
// handlers do host: RestBenchPanelResponse["send"] É o RequestResult de
// src/extension.ts — mudou lá, refletiu aqui, sem nenhum import.
type Resultado = RestBenchPanelResponse["send"];
type Historico = RestBenchPanelResponse["history"];
type Metodo = Historico[number]["spec"]["method"];

const METODOS: Metodo[] = ["GET", "POST", "PUT", "DELETE"];

// Highlight de JSON em ~30 linhas, com as CORES DO TEMA do VSCode (css vars).
// Para renderização completa (folding, busca), o botão "Abrir no editor"
// manda o corpo para um editor real via @OnMessage("openInEditor").
const TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;

function highlightJson(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(TOKEN)) {
    const i = m.index!;
    if (i > last) out.push(text.slice(last, i));
    if (m[1] !== undefined) {
      out.push(<span key={k++} className={m[2] ? "tk-key" : "tk-str"}>{m[1]}</span>);
      if (m[2]) out.push(m[2]);
    } else if (m[3] !== undefined) {
      out.push(<span key={k++} className="tk-num">{m[3]}</span>);
    } else {
      out.push(<span key={k++} className="tk-kw">{m[4]}</span>);
    }
    last = i + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} kB`);

function App() {
  const [method, setMethod] = useState<Metodo>("GET");
  const [url, setUrl] = useState("https://api.github.com/repos/JonathanSantos/sigilkit");
  const [body, setBody] = useState("");
  const [token, setToken] = useState("");
  const [temToken, setTemToken] = useState(false);
  const [resp, setResp] = useState<Resultado | null>(null);
  const [hist, setHist] = useState<Historico>([]);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    // tudo inferido pela augmentation do sigil-env.d.ts: o retorno de
    // "history" é HistoryItem[], e msg é a união host→UI (sem casts)
    void callHost("history").then(setHist);
    return onHostMessage((msg) => {
      if (msg.type === "history") setHist(msg.value);
    });
  }, []);

  async function enviar() {
    setOcupado(true);
    try {
      setResp(await callHost("send", { method, url, body: body || undefined }));
    } catch (e) {
      setResp({ ok: false, status: 0, ms: 0, body: "", headers: {}, size: 0, language: "plaintext", error: String(e) });
    } finally {
      setOcupado(false);
    }
  }

  async function guardarToken() {
    setTemToken(await callHost("setToken", token));
    setToken("");
  }

  // Layout de app: a coluna principal é 100% do height do painel e o
  // visualizador de resposta ocupa TODO o espaço restante (flex: 1), com
  // scroll próprio — como um cliente REST de verdade.
  return (
    <div className="app">
      <section className="principal">
        <div className="linha">
          <select value={method} onChange={(e) => setMethod(e.target.value as Metodo)}>
            {METODOS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… ou /caminho (usa restbench.baseUrl)" />
          <button onClick={() => void enviar()} disabled={ocupado || url.trim() === ""}>
            {ocupado ? "Enviando…" : "Enviar"}
          </button>
        </div>

        {method !== "GET" && (
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder='corpo JSON, ex: { "nome": "sigil" }' />
        )}

        {resp ? (
          <div className="resposta">
            <div className="linha">
              <span className={resp.ok ? "status-ok" : "status-erro"}>{resp.status || "erro"}</span>
              <span className="dica">{resp.ms}ms · {fmtBytes(resp.size)}{resp.error ? ` · ${resp.error}` : ""}</span>
              <span className="espaco" />
              {resp.body && (
                <>
                  <button className="secundario" onClick={() => void navigator.clipboard.writeText(resp.body)}>
                    Copiar
                  </button>
                  <button
                    className="secundario"
                    title="abre num editor real do VSCode — highlight, folding e busca"
                    onClick={() => postToHost({ type: "openInEditor", value: { body: resp.body, language: resp.language } })}
                  >
                    Abrir no editor
                  </button>
                </>
              )}
            </div>
            {resp.body && (
              <pre className="corpo">{resp.language === "json" ? highlightJson(resp.body) : resp.body}</pre>
            )}
            {Object.keys(resp.headers).length > 0 && (
              <details>
                <summary>headers ({Object.keys(resp.headers).length})</summary>
                <pre>{Object.entries(resp.headers).map(([nome, valor]) => `${nome}: ${valor}`).join("\n")}</pre>
              </details>
            )}
          </div>
        ) : (
          <div className="resposta vazia">
            <p className="dica">envie uma requisição — a resposta aparece aqui, com highlight do seu tema</p>
          </div>
        )}
      </section>

      <aside className="lateral">
        <h2>Autorização</h2>
        <div className="linha">
          <input type="text" value={token} onChange={(e) => setToken(e.target.value)} placeholder={temToken ? "token guardado ✓" : "Bearer token"} title="vai para o SecretStorage; vazio remove" />
          <button className="secundario" onClick={() => void guardarToken()}>Guardar</button>
        </div>

        <h2>Histórico</h2>
        {hist.length === 0 && <p className="dica">as requisições ficam aqui — e sobrevivem a fechar o VSCode (@State)</p>}
        <ul className="historico">
          {hist.map((item, i) => (
            <li
              key={i}
              title="clique para repetir"
              onClick={() => {
                setMethod(item.spec.method);
                setUrl(item.spec.url);
                setBody(item.spec.body ?? "");
              }}
            >
              <span className="metodo">{item.spec.method}</span>
              <span className="url">{item.spec.url}</span>
              <span className={item.result.ok ? "status-ok" : "status-erro"}>{item.result.status || "erro"}</span>
            </li>
          ))}
        </ul>
        {hist.length > 0 && (
          <button className="secundario" onClick={() => postToHost({ type: "clear" })}>
            Limpar histórico
          </button>
        )}
      </aside>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
