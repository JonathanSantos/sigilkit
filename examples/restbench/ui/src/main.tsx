import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { callHost, onHostMessage, postToHost } from "@sigilkit/core/ui";

// Os tipos abaixo são GERADOS pelo sigil em ui/sigil-env.d.ts, derivados dos
// handlers do host: RestBenchPanelResponse["send"] É o RequestResult de
// src/extension.ts — mudou lá, refletiu aqui, sem nenhum import.
type Resultado = RestBenchPanelResponse["send"];
type Historico = RestBenchPanelResponse["history"];
type Metodo = Historico[number]["spec"]["method"];

const METODOS: Metodo[] = ["GET", "POST", "PUT", "DELETE"];

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
      setResp({ ok: false, status: 0, ms: 0, body: "", error: String(e) });
    } finally {
      setOcupado(false);
    }
  }

  async function guardarToken() {
    setTemToken(await callHost("setToken", token));
    setToken("");
  }

  return (
    <>
      <h1>REST Bench</h1>

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

      {resp && (
        <div className="resposta">
          <span className={resp.ok ? "status-ok" : "status-erro"}>
            {resp.status || "erro"}
          </span>{" "}
          · {resp.ms}ms{resp.error ? ` · ${resp.error}` : ""}
          {resp.body && <pre>{resp.body}</pre>}
        </div>
      )}

      <h2>Autorização</h2>
      <div className="linha">
        <input type="text" value={token} onChange={(e) => setToken(e.target.value)} placeholder={temToken ? "token guardado ✓ (vazio remove)" : "Bearer token (vai para o SecretStorage)"} />
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
            <span className="dica">{item.result.ms}ms</span>
          </li>
        ))}
      </ul>
      {hist.length > 0 && (
        <button className="secundario" onClick={() => postToHost({ type: "clear" })}>
          Limpar histórico
        </button>
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
