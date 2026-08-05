import fs from "node:fs";
import path from "node:path";

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
 * Template do §16 do spec, com as correções aprendidas nas Fases 1–3:
 * decorators stage 3 (experimentalDecorators: false), e o esbuild com
 * `--keep-names` (chave de registry = nome da classe) E `--target=es2022`
 * (sem target o esbuild deixa a sintaxe de decorator crua no bundle).
 */
export type InitTemplate = "basic" | "react-webview";

function templateFiles(name: string, template: InitTemplate): TemplateFile[] {
  const className = `${pascalCase(name)}Extension`;
  const react = template === "react-webview";

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
      typecheck: react ? "tsc --noEmit && tsc -p ui --noEmit" : "tsc --noEmit",
      // o vsce roda vscode:prepublish sozinho; --no-dependencies porque o
      // esbuild já embute @sigilkit/core no bundle
      package: "vsce package --no-dependencies",
      "vscode:prepublish": "npm run build",
    },
    dependencies: {
      "@sigilkit/core": "^0.3.0",
      ...(react ? { react: "^19.0.0", "react-dom": "^19.0.0" } : {}),
    },
    devDependencies: {
      "@sigilkit/cli": "^0.3.0",
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
    ? `import { Extension, Command, Config, Webview, OnMessage, OnRequest, registry } from "@sigilkit/core";

// O manifesto é derivado destas classes: rode \`sigil build\` (ou \`npm run build\`)
// e o package.json ganha o bloco contributes. O sigil-env.d.ts gerado em ui/
// tipa o protocolo do painel dos dois lados.
@Extension()
export class ${className} {
  @Config({ description: "Saudação usada pelo painel" })
  accessor greeting: string = "Olá";

  @Command({ title: "Open Panel" })
  openPanel() {
    return registry.webviews.get("MainPanel")!.open();
  }
}

type HostToUi = { type: "pong"; value: number };

@Webview({ id: "panel", title: "${name}", ui: "./ui/index.html" })
export class MainPanel {
  private pings = 0;

  // callHost("saudar", nome) na UI — o retorno resolve a Promise, tipado
  @OnRequest("saudar")
  saudar(nome: string): string {
    return \`\${registry.instance(${className}).greeting}, \${nome}!\`;
  }

  @OnMessage("ping")
  ping() {
    this.post({ type: "pong", value: ++this.pings });
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
</head>
<body>
  <div id="root"></div>
  <script src="dist/main.js"></script>
</body>
</html>
`;

  const uiMain = `import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { callHost, onHostMessage, postToHost } from "@sigilkit/core/ui";

// Tipos vêm do sigil-env.d.ts gerado: callHost/postToHost/onHostMessage já
// saem tipados pelos @OnMessage/@OnRequest do host — typo é erro de build.
function App() {
  const [frase, setFrase] = useState("…");
  const [pongs, setPongs] = useState(0);

  useEffect(() => {
    void callHost("saudar", "mundo").then(setFrase);
    return onHostMessage((msg) => {
      if (msg.type === "pong") setPongs(msg.value);
    });
  }, []);

  return (
    <main>
      <h1>{frase}</h1>
      <button onClick={() => postToHost({ type: "ping" })}>ping ({pongs} pongs)</button>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
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
    ...(react
      ? [
          { rel: "ui/index.html", content: uiHtml },
          { rel: "ui/src/main.tsx", content: uiMain },
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
