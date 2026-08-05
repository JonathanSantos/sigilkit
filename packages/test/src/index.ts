import Module from "node:module";
import fs from "node:fs";
import path from "node:path";
import {
  DisposableLike,
  TreeDataProviderLike,
  TreeItemMock,
  VscodeMockState,
  WebviewPanelMock,
  createState,
  createVscodeMock,
  uriFile,
} from "./vscode-mock";

export { EventEmitterMock, TreeItemMock, WebviewPanelMock } from "./vscode-mock";
export type { DisposableLike, TreeDataProviderLike, UriMock, VscodeMockState } from "./vscode-mock";

export interface ActivateOptions {
  /** Raiz do projeto da extensão (com package.json apontando `main` para o bundle). */
  projectDir: string;
  /** Valores iniciais de config além dos defaults do manifesto (id completo → valor). */
  configuration?: Record<string, unknown>;
}

interface ExtensionModule {
  activate(ctx: unknown): unknown;
  deactivate?(): unknown;
}

/**
 * Ativa o bundle REAL da extensão dentro do simulador: intercepta
 * `require("vscode")` durante o load do bundle e chama o `activate()` gerado
 * com um ExtensionContext fake. Cada chamada é isolada (o cache de require do
 * bundle é limpo, então o registry recomeça do zero).
 *
 * Os defaults de config são semeados de `contributes.configuration` do
 * package.json — o mesmo papel que o VSCode cumpre ao ler o manifesto.
 */
export async function activateExtension(opts: ActivateOptions): Promise<SigilTestHost> {
  const projectDir = path.resolve(opts.projectDir);
  const pkgPath = path.join(projectDir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`sigil-test: package.json não encontrado em ${projectDir}`);
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    main?: string;
    contributes?: { configuration?: { properties?: Record<string, { default?: unknown }> } };
  };
  const bundlePath = path.resolve(projectDir, pkg.main ?? "./out/extension.js");
  if (!fs.existsSync(bundlePath)) {
    throw new Error(
      `sigil-test: bundle não encontrado em ${bundlePath} — rode o build da extensão antes (ex.: npm run build)`
    );
  }

  const state = createState();
  const properties = pkg.contributes?.configuration?.properties ?? {};
  for (const [id, schema] of Object.entries(properties)) {
    if (schema && "default" in schema) state.defaults.set(id, schema.default);
  }
  if (opts.configuration) {
    for (const [id, value] of Object.entries(opts.configuration)) state.values.set(id, value);
  }

  const vscodeMock = createVscodeMock(state);
  const moduleInternals = Module as unknown as {
    _load: (request: string, ...rest: unknown[]) => unknown;
  };
  const originalLoad = moduleInternals._load;
  moduleInternals._load = function (request: string, ...rest: unknown[]) {
    if (request === "vscode") return vscodeMock;
    return originalLoad.call(this, request, ...rest);
  };

  try {
    delete require.cache[require.resolve(bundlePath)];
    const ext = require(bundlePath) as ExtensionModule;
    const ctx = {
      subscriptions: [] as DisposableLike[],
      extensionUri: uriFile(projectDir),
      extensionPath: projectDir,
    };
    await ext.activate(ctx);
    return new SigilTestHost(state, vscodeMock, ext, ctx);
  } finally {
    moduleInternals._load = originalLoad;
  }
}

/** Sonda de leitura de uma TreeView registrada. */
export class TreeProbe {
  /** quantas vezes o onDidChangeTreeData disparou desde a criação da sonda */
  refreshCount = 0;

  constructor(private readonly provider: TreeDataProviderLike) {
    provider.onDidChangeTreeData?.(() => {
      this.refreshCount++;
    });
  }

  async roots(): Promise<unknown[]> {
    return ((await this.provider.getChildren(undefined)) as unknown[]) ?? [];
  }

  async children(node: unknown): Promise<unknown[]> {
    return ((await this.provider.getChildren(node)) as unknown[]) ?? [];
  }

  async item(node: unknown): Promise<TreeItemMock> {
    return (await this.provider.getTreeItem(node)) as TreeItemMock;
  }
}

export class SigilTestHost {
  constructor(
    private readonly state: VscodeMockState,
    /** escape hatch: o namespace vscode simulado, para asserções avançadas */
    readonly vscode: Record<string, unknown>,
    private readonly ext: ExtensionModule,
    private readonly ctx: { subscriptions: DisposableLike[] }
  ) {}

  /** ids de comando registrados, ordenados */
  get commands(): string[] {
    return [...this.state.commands.keys()].sort();
  }

  executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T> {
    const commands = this.vscode.commands as {
      executeCommand: (id: string, ...args: unknown[]) => Promise<T>;
    };
    return commands.executeCommand(id, ...args);
  }

  readonly configuration = {
    get: <T = unknown>(id: string): T => {
      return (
        this.state.values.has(id) ? this.state.values.get(id) : this.state.defaults.get(id)
      ) as T;
    },
    /** Simula o usuário editando Settings: grava e dispara onDidChangeConfiguration. */
    set: (id: string, value: unknown): void => {
      if (value === undefined) this.state.values.delete(id);
      else this.state.values.set(id, value);
      this.state.fireConfigChange(id);
    },
  };

  get infoMessages(): string[] {
    return [...this.state.infoMessages];
  }
  get warnMessages(): string[] {
    return [...this.state.warnMessages];
  }
  get errorMessages(): string[] {
    return [...this.state.errorMessages];
  }

  /** Sonda para a view registrada com o id dado (ex.: "hello.tasks"). */
  tree(viewId: string): TreeProbe {
    const provider = this.state.treeProviders.get(viewId);
    if (!provider) {
      throw new Error(
        `sigil-test: nenhuma TreeView registrada como '${viewId}' (registradas: ${[...this.state.treeProviders.keys()].sort().join(", ") || "nenhuma"})`
      );
    }
    return new TreeProbe(provider);
  }

  /** Todos os painéis webview já criados (incluindo descartados). */
  get webviewPanels(): WebviewPanelMock[] {
    return [...this.state.panels];
  }

  /** O painel vivo com o viewType dado (ex.: "hello.settings"). */
  panel(viewType: string): WebviewPanelMock {
    const found = this.state.panels.find((p) => p.viewType === viewType && !p.disposed);
    if (!found) {
      throw new Error(
        `sigil-test: nenhum painel vivo com viewType '${viewType}' — execute o comando que o abre primeiro`
      );
    }
    return found;
  }

  /** Descarta subscriptions (na ordem inversa) e chama o deactivate() da extensão. */
  async dispose(): Promise<void> {
    for (const d of [...this.ctx.subscriptions].reverse()) d.dispose?.();
    await this.ext.deactivate?.();
  }
}
