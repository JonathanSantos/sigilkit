import fs from "node:fs";
import path from "node:path";
import { agentsMd, claudeMdPointer } from "./agents-md";

function sanitizeName(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "my-extension";
}

function pascalCase(name: string): string {
  return name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join("");
}

interface TemplateFile {
  rel: string;
  content: string;
}

/**
 * Templates do sigil init. Regras aprendidas nas fases: decorators stage 3
 * (experimentalDecorators: false) e esbuild com `--target=es2022` (sem
 * target a sintaxe de decorator fica crua no bundle). `--keep-names` NÃO é
 * necessário — o join usa Symbol.metadata.
 */
export type InitTemplate = "basic" | "react-webview";

/**
 * A versão dos @sigilkit/* no template é a DO PRÓPRIO CLI, lida em runtime —
 * a lição da F1 do primeiro dogfood externo: a string hardcoded ficou em
 * ^0.6.0 por três releases e todo `npm create sigil` instalava 0.6.2 em
 * silêncio. Interpolar a própria versão elimina a classe do bug.
 */
function sigilDepRange(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version ? `^${pkg.version}` : "latest";
  } catch {
    return "latest";
  }
}

function templateFiles(name: string, template: InitTemplate): TemplateFile[] {
  const className = `${pascalCase(name)}Extension`;
  const react = template === "react-webview";
  const sigilRange = sigilDepRange();

  const pkg = {
    name,
    displayName: name,
    description: "",
    version: "0.0.1",
    publisher: "your-publisher",
    private: true,
    engines: { vscode: "^1.75.0" },
    categories: ["Other"],
    main: "./out/extension.js",
    // uiDev: o sim/sandbox sobem o watch da UI junto — hot reload de host E
    // de UI num comando só (npm run sim / npm run sandbox)
    ...(react ? { sigil: { uiDev: "npm run dev:ui" } } : {}),
    scripts: {
      build: react ? "npm run build:ui && sigil build && npm run bundle" : "sigil build && npm run bundle",
      ...(react
        ? {
            "build:ui":
              "esbuild ui/src/main.tsx --bundle --format=iife --target=es2022 --jsx=automatic --outfile=ui/dist/main.js",
          }
        : {}),
      bundle:
        "esbuild src/.generated/wire.ts --bundle --platform=node --format=cjs --target=es2022 --external:vscode --sourcemap --outfile=out/extension.js",
      check: "sigil check",
      dev: "sigil dev",
      sim: "sigil sim --ui .",
      sandbox: "sigil sandbox .",
      ...(react
        ? {
            "dev:ui":
              "esbuild ui/src/main.tsx --bundle --format=iife --target=es2022 --jsx=automatic --outfile=ui/dist/main.js --watch=forever",
          }
        : {}),
      typecheck: react ? "tsc --noEmit && tsc -p ui --noEmit" : "tsc --noEmit",
      // o vsce roda vscode:prepublish sozinho; --no-dependencies porque o
      // esbuild já embute @sigilkit/core no bundle
      package: "vsce package --no-dependencies",
      "vscode:prepublish": "npm run build",
    },
    dependencies: {
      "@sigilkit/core": sigilRange,
      ...(react ? { react: "^19.0.0", "react-dom": "^19.0.0" } : {}),
    },
    devDependencies: {
      "@sigilkit/cli": sigilRange,
      ...(react ? { "@types/react": "^19.0.0", "@types/react-dom": "^19.0.0" } : {}),
      "@types/vscode": "^1.75.0",
      "@vscode/vsce": "^3.2.1",
      esbuild: "^0.24.2",
      typescript: "^5.7.3",
    },
  };

  const tsconfig = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "strict": true,
    "experimentalDecorators": false,
    "useDefineForClassFields": true,
    "sourceMap": true,
    "outDir": "out",
    "skipLibCheck": true
  },
  "include": ["src", "src/.generated/**/*"]
}
`;

  const extension = react
    ? `import { Extension, Command, Config, OnMessage, OnRequest, State, Webview, registry } from "@sigilkit/core";

// O manifesto é derivado destas classes: rode \`sigil build\` (ou \`npm run build\`)
// e o package.json ganha o bloco contributes. O sigil-env.d.ts gerado em ui/
// tipa o protocolo do painel dos dois lados — typo vira erro de build na UI.

export interface Tarefa {
  id: number;
  texto: string;
  feita: boolean;
}

type HostToUi = { type: "tarefas"; value: Tarefa[] };

@Extension()
export class ${className} {
  @Config({ description: "Máximo de tarefas na lista", minimum: 1, maximum: 500 })
  accessor maxTarefas: number = 50;

  /** Persistidas por workspace — sobrevivem a fechar o VSCode. */
  @State("workspace")
  accessor tarefas: Tarefa[] = [];

  @Command({ title: "Open Panel" })
  openPanel() {
    return registry.panel(MainPanel).open();
  }
}

@Webview({ id: "panel", title: "${name}", ui: "./ui/index.html" })
export class MainPanel {
  /** A UI pede o estado inicial ao montar (useHostRequest("tarefas")). */
  @OnRequest("tarefas")
  listar(): Tarefa[] {
    return registry.instance(${className}).tarefas;
  }

  @OnMessage("adicionar")
  adicionar(texto: string) {
    const ext = registry.instance(${className});
    if (texto.trim() === "" || ext.tarefas.length >= ext.maxTarefas) return;
    ext.tarefas = [...ext.tarefas, { id: Date.now(), texto: texto.trim(), feita: false }];
    this.post({ type: "tarefas", value: ext.tarefas });
  }

  @OnMessage("alternar")
  alternar(id: number) {
    const ext = registry.instance(${className});
    ext.tarefas = ext.tarefas.map((t) => (t.id === id ? { ...t, feita: !t.feita } : t));
    this.post({ type: "tarefas", value: ext.tarefas });
  }

  @OnMessage("remover")
  remover(id: number) {
    const ext = registry.instance(${className});
    ext.tarefas = ext.tarefas.filter((t) => t.id !== id);
    this.post({ type: "tarefas", value: ext.tarefas });
  }

  post!: (msg: HostToUi) => void; // injetado pelo wire
}
`
    : `import * as vscode from "vscode";
import { Extension, Command, Config } from "@sigilkit/core";

// O manifesto é derivado desta classe: rode \`sigil build\` (ou \`npm run build\`)
// e o package.json ganha o bloco contributes. Nada de dupla declaração.
@Extension()
export class ${className} {
  @Config({ description: "Saudação exibida pelo comando hello" })
  accessor greeting: string = "Olá";

  @Command({ title: "Hello" })
  hello() {
    vscode.window.showInformationMessage(\`\${this.greeting}, ${name}!\`);
  }
}
`;

  const uiHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${name}</title>
  <link href="dist/main.css" rel="stylesheet">
</head>
<body>
  <div id="root"></div>
  <script src="dist/main.js"></script>
</body>
</html>
`;

  const uiMain = `import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);
`;

  const uiApp = `import { useEffect, useState } from "react";
import { postToHost } from "@sigilkit/core/ui";
import { useHostRequest, useHostMessage } from "./hooks/useHost";
import { TaskInput } from "./components/TaskInput";
import { TaskList } from "./components/TaskList";

// Tudo tipado pelo sigil-env.d.ts gerado: "tarefas"/"adicionar"/"alternar"/
// "remover" autocompletam, e um typo em qualquer chave é erro de build.
export function App() {
  const [tarefas, setTarefas] = useState<NonNullable<ReturnType<typeof useHostRequest<"tarefas">>["data"]>>([]);

  // estado inicial via request; atualizações via push do host
  const inicial = useHostRequest("tarefas");
  useEffect(() => {
    if (inicial.data) setTarefas(inicial.data);
  }, [inicial.data]);
  useHostMessage((msg) => {
    if (msg.type === "tarefas") setTarefas(msg.value);
  });

  const pendentes = tarefas.filter((t) => !t.feita).length;

  return (
    <main>
      <header>
        <h1>Tarefas</h1>
        <span className="dica">
          {tarefas.length === 0 ? "persistidas por workspace (@State)" : \`\${pendentes} pendente(s)\`}
        </span>
      </header>
      <TaskInput onAdd={(texto) => postToHost({ type: "adicionar", value: texto })} />
      <TaskList
        tarefas={tarefas}
        onToggle={(id) => postToHost({ type: "alternar", value: id })}
        onRemove={(id) => postToHost({ type: "remover", value: id })}
      />
    </main>
  );
}
`;

  const uiHooks = `import { useEffect, useRef, useState } from "react";
import { callHost, onHostMessage, type SigilUiFromHost, type SigilUiRequests } from "@sigilkit/core/ui";

type ResultOf<K extends keyof SigilUiRequests> = SigilUiRequests[K] extends { result: infer R }
  ? R
  : never;
/** a união host→UI derivada do post da classe (via sigil-env.d.ts) */
type HostMsg = SigilUiFromHost extends { message: infer M } ? M : unknown;

/**
 * Request ao host no mount, com estado de loading/erro — a versão React do
 * callHost. As chaves e o tipo do retorno vêm do sigil-env.d.ts gerado.
 */
export function useHostRequest<K extends keyof SigilUiRequests & string>(type: K) {
  const [state, setState] = useState<{ data?: ResultOf<K>; error?: string; loading: boolean }>({
    loading: true,
  });
  useEffect(() => {
    let vivo = true;
    (callHost as (t: K) => Promise<ResultOf<K>>)(type).then(
      (data) => vivo && setState({ data, loading: false }),
      (e: unknown) => vivo && setState({ error: String(e), loading: false })
    );
    return () => {
      vivo = false;
    };
  }, [type]);
  return state;
}

/** Assina mensagens do host com unsubscribe automático (e handler sempre fresco). */
export function useHostMessage(handler: (msg: HostMsg) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => onHostMessage<HostMsg>((msg) => ref.current(msg)), []);
}
`;

  const uiTaskInput = `import { useState } from "react";

export function TaskInput({ onAdd }: { onAdd(texto: string): void }) {
  const [texto, setTexto] = useState("");
  const enviar = () => {
    if (texto.trim() === "") return;
    onAdd(texto);
    setTexto("");
  };
  return (
    <div className="linha">
      <input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && enviar()}
        placeholder="Nova tarefa…"
      />
      <button onClick={enviar} disabled={texto.trim() === ""}>
        Adicionar
      </button>
    </div>
  );
}
`;

  const uiTaskList = `import type { Tarefa } from "../../../src/extension";

interface Props {
  tarefas: Tarefa[];
  onToggle(id: number): void;
  onRemove(id: number): void;
}

export function TaskList({ tarefas, onToggle, onRemove }: Props) {
  if (tarefas.length === 0) {
    return <p className="dica">nada por aqui — adicione a primeira acima</p>;
  }
  return (
    <ul className="lista">
      {tarefas.map((t) => (
        <li key={t.id} className={t.feita ? "feita" : ""}>
          <label>
            <input type="checkbox" checked={t.feita} onChange={() => onToggle(t.id)} />
            <span>{t.texto}</span>
          </label>
          <button className="remover" title="remover" onClick={() => onRemove(t.id)}>
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}
`;

  const uiStyles = `/* As variáveis --vscode-* vêm do tema do usuário — a UI acompanha
   qualquer tema, claro ou escuro, sem código. */
:root { color-scheme: light dark; }
body {
  margin: 0;
  padding: 16px;
  font-family: var(--vscode-font-family, system-ui, sans-serif);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-editor-foreground, #ddd);
  background: var(--vscode-editor-background, #1e1e1e);
}
header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; }
h1 { font-size: 16px; margin: 0; }
.dica { opacity: 0.55; font-size: 12px; }
.linha { display: flex; gap: 8px; margin-bottom: 12px; }
input[type="text"], input:not([type]) {
  flex: 1;
  background: var(--vscode-input-background, #2a2a33);
  color: var(--vscode-input-foreground, #eee);
  border: 1px solid var(--vscode-input-border, #444);
  border-radius: 4px;
  padding: 6px 8px;
}
button {
  background: var(--vscode-button-background, #0e639c);
  color: var(--vscode-button-foreground, #fff);
  border: none; border-radius: 4px; padding: 6px 14px; cursor: pointer;
}
button:disabled { opacity: 0.5; cursor: default; }
.lista { list-style: none; padding: 0; margin: 0; }
.lista li {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; border-radius: 4px;
}
.lista li:hover { background: var(--vscode-list-hoverBackground, #2f2f3a); }
.lista label { display: flex; align-items: center; gap: 8px; flex: 1; cursor: pointer; }
.lista li.feita span { text-decoration: line-through; opacity: 0.55; }
.remover {
  background: transparent;
  color: var(--vscode-descriptionForeground, #999);
  padding: 2px 8px; font-size: 14px;
}
.remover:hover { color: var(--vscode-errorForeground, #f87171); }
`;

  const uiTsconfig = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "noEmit": true,
    "strict": true,
    "useDefineForClassFields": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*", "sigil-env.d.ts", "../src/.generated/config.d.ts"]
}
`;

  const launch = `{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run ${name}",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=\${workspaceFolder}"],
      "preLaunchTask": "npm: build"
    }
  ]
}
`;

  const readme = `# ${name}

Extensão do VSCode construída com [sigil](https://github.com/) — o manifesto é
derivado do TypeScript, nunca escrito à mão.

\`\`\`bash
npm install
npm run build   # sigil build (manifesto + wire) + esbuild (bundle)
\`\`\`

Abra a pasta no VSCode e aperte F5 — ou \`npx sigil sim --ui .\` para um
workbench no browser, \`npx sigil sandbox .\` para um VSCode isolado com hot
swap. Outros comandos: \`npm run dev\` (watch), \`npm run check\` (CI — falha se
o manifesto estiver desatualizado).

Regras herdadas do sigil: o tsconfig usa decorators stage 3 (não mude
\`experimentalDecorators\`), e o bundle exige \`--target=es2022\` (sem isso a
sintaxe de decorator fica crua e o extension host não executa).
`;

  const vscodeignore = `.vscode/**
.vscode-test/**
src/**
test/**
node_modules/**
out/**/*.map
tsconfig.json
.gitignore
.mcp.json
AGENTS.md
CLAUDE.md
**/*.ts
`;

  return [
    { rel: "package.json", content: JSON.stringify(pkg, null, 2) + "\n" },
    { rel: "tsconfig.json", content: tsconfig },
    { rel: "src/extension.ts", content: extension },
    { rel: ".vscode/launch.json", content: launch },
    { rel: ".vscodeignore", content: react ? `${vscodeignore}ui/src/**\nui/tsconfig.json\n` : vscodeignore },
    { rel: ".gitignore", content: `node_modules/\nout/\n.generated/\n*.vsix\n${react ? "ui/dist/\n" : ""}` },
    { rel: "README.md", content: readme },
    // o manual do sigil no formato que agentes de IA leem primeiro; o
    // CLAUDE.md importa via @ (sintaxe de imports do Claude Code)
    { rel: "AGENTS.md", content: agentsMd(name, react) },
    { rel: "CLAUDE.md", content: claudeMdPointer() },
    // servidor MCP do sigil auto-descoberto: Claude Code lê .mcp.json,
    // o Copilot agent mode lê .vscode/mcp.json — zero configuração
    {
      rel: ".mcp.json",
      content: JSON.stringify({ mcpServers: { sigil: { command: "npx", args: ["sigil", "mcp"] } } }, null, 2) + "\n",
    },
    {
      rel: ".vscode/mcp.json",
      content:
        JSON.stringify({ servers: { sigil: { type: "stdio", command: "npx", args: ["sigil", "mcp"] } } }, null, 2) +
        "\n",
    },
    ...(react
      ? [
          { rel: "ui/index.html", content: uiHtml },
          { rel: "ui/src/main.tsx", content: uiMain },
          { rel: "ui/src/App.tsx", content: uiApp },
          { rel: "ui/src/hooks/useHost.ts", content: uiHooks },
          { rel: "ui/src/components/TaskInput.tsx", content: uiTaskInput },
          { rel: "ui/src/components/TaskList.tsx", content: uiTaskList },
          { rel: "ui/src/styles.css", content: uiStyles },
          { rel: "ui/tsconfig.json", content: uiTsconfig },
        ]
      : []),
  ];
}

export function runInit(projectDir: string, template: InitTemplate = "basic"): number {
  fs.mkdirSync(projectDir, { recursive: true });
  const name = sanitizeName(path.basename(projectDir));
  const files = templateFiles(name, template);

  // R6: confere TUDO antes de escrever QUALQUER coisa — nada de projeto meio-escrito
  const existing = files.filter((f) => fs.existsSync(path.join(projectDir, f.rel)));
  if (existing.length > 0) {
    console.error(
      `sigil init: arquivos já existem em ${projectDir}:\n` +
        existing.map((f) => `  - ${f.rel}`).join("\n") +
        `\nNada foi escrito. Use um diretório vazio.`
    );
    return 1;
  }

  for (const f of files) {
    const abs = path.join(projectDir, f.rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content);
    console.log(`  + ${f.rel}`);
  }

  console.log(`
sigil init: projeto '${name}' criado. Próximos passos:
  cd ${projectDir}
  npm install
  npm run build
  abra no VSCode e aperte F5`);
  return 0;
}
