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
function templateFiles(name: string): TemplateFile[] {
  const className = `${pascalCase(name)}Extension`;

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
      build: "sigil build && npm run bundle",
      bundle:
        "esbuild src/.generated/wire.ts --bundle --platform=node --format=cjs --target=es2022 --external:vscode --sourcemap --outfile=out/extension.js",
      check: "sigil check",
      dev: "sigil dev",
      typecheck: "tsc --noEmit",
      "vscode:prepublish": "npm run build",
    },
    dependencies: { "@sigil/core": "^0.1.0" },
    devDependencies: {
      "@sigil/cli": "^0.1.0",
      "@types/vscode": "^1.75.0",
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

  const extension = `import * as vscode from "vscode";
import { Extension, Command, Config } from "@sigil/core";

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

Abra a pasta no VSCode e aperte F5. Outros comandos: \`npm run dev\` (watch),
\`npm run check\` (CI — falha se o manifesto estiver desatualizado).

Regras herdadas do sigil: o tsconfig usa decorators stage 3 (não mude
\`experimentalDecorators\`), e o bundle exige \`--keep-names --target=es2022\`.
`;

  return [
    { rel: "package.json", content: JSON.stringify(pkg, null, 2) + "\n" },
    { rel: "tsconfig.json", content: tsconfig },
    { rel: "src/extension.ts", content: extension },
    { rel: ".vscode/launch.json", content: launch },
    { rel: ".gitignore", content: "node_modules/\nout/\n.generated/\n*.vsix\n" },
    { rel: "README.md", content: readme },
  ];
}

export function runInit(projectDir: string): number {
  fs.mkdirSync(projectDir, { recursive: true });
  const name = sanitizeName(path.basename(projectDir));
  const files = templateFiles(name);

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
