import * as vscode from "vscode";
import { dual } from "./dual";
import { registry } from "../registry";
import { registerBoundMember } from "../metadata";
import { guard } from "../guard";
import { log } from "../log";

/**
 * Testing API declarativa: @TestController na classe, @TestDiscover devolve a
 * árvore de testes como nós simples e @TestRun executa um teste por vez.
 * Runtime-only — a Testing API não tem contributes; o sigil emite
 * `onStartupFinished` para o Test Explorer enxergar o controller.
 */

export interface TestControllerOptions {
  /** nome exibido no Test Explorer */
  label: string;
  /** sufixo do id do controller (default: nome da classe) → `<prefix>.<id>` */
  id?: string;
}

export function TestController(_opts: TestControllerOptions) {
  return function <T extends new (...args: any[]) => object>(
    _target: T,
    _ctx: ClassDecoratorContext<T>
  ): void {};
}

/** Um teste (ou grupo, quando tem children) descoberto pelo @TestDiscover. */
export interface TestNode {
  id: string;
  label: string;
  children?: TestNode[];
  /** uri do arquivo do teste (habilita o gutter/ir-para-o-teste) */
  uri?: unknown;
}

/**
 * Resultado de um teste no @TestRun: `undefined`/`true` = passou;
 * `false` = falhou; `{ passed, message? }` = controle fino. Exceção = falha
 * com a mensagem do erro.
 */
export type TestOutcome = void | boolean | { passed: boolean; message?: string };

/** discover() → TestNode[] — chamado na ativação e no botão de refresh. */
export const TestDiscover = dual(() => registerBoundMember("testHandlers"));

/** run(node, token) → TestOutcome — chamado por FOLHA incluída na execução. */
export const TestRun = dual(() => registerBoundMember("testHandlers"));

export interface TestControllerBinding {
  readonly key: string;
  readonly id: string;
  readonly label: string;
  readonly discoverKey: string;
  readonly runKey?: string;
}

interface TestItemLike {
  id: string;
  label: string;
  uri?: unknown;
  children: { replace(items: TestItemLike[]): void; size: number; forEach(cb: (item: TestItemLike) => void): void };
}

interface TestControllerLike {
  items: TestItemLike["children"];
  createTestItem(id: string, label: string, uri?: unknown): TestItemLike;
  createRunProfile(label: string, kind: unknown, handler: (request: TestRunRequestLike, token: unknown) => unknown, isDefault?: boolean): unknown;
  createTestRun(request: TestRunRequestLike): TestRunLike;
  refreshHandler?: () => unknown;
  dispose(): void;
}

interface TestRunRequestLike {
  include?: readonly TestItemLike[];
}

interface TestRunLike {
  started(item: TestItemLike): void;
  passed(item: TestItemLike, duration?: number): void;
  failed(item: TestItemLike, message: unknown, duration?: number): void;
  end(): void;
}

export function bindTestController(binding: TestControllerBinding): vscode.Disposable {
  const testsApi = (vscode as unknown as {
    tests?: { createTestController(id: string, label: string): TestControllerLike };
  }).tests;
  if (!testsApi?.createTestController) {
    log.error("sigil: @TestController exige a Testing API (VSCode >= 1.59) — controller não registrado");
    return { dispose() {} };
  }
  if (!registry.testHandlers.has(binding.discoverKey)) {
    throw new Error(`sigil: handler ausente para ${binding.discoverKey}. Rode 'sigil build'.`);
  }
  if (binding.runKey && !registry.testHandlers.has(binding.runKey)) {
    throw new Error(`sigil: handler ausente para ${binding.runKey}. Rode 'sigil build'.`);
  }

  const controller = testsApi.createTestController(binding.id, binding.label);

  const toItem = (node: TestNode): TestItemLike => {
    const item = controller.createTestItem(node.id, node.label, node.uri);
    if (node.children && node.children.length > 0) {
      item.children.replace(node.children.map(toItem));
    }
    return item;
  };

  // resolve do registry a cada chamada (hot-swap safe)
  const discover = guard(`@TestDiscover de ${binding.key}`, async () => {
    const fn = registry.testHandlers.get(binding.discoverKey);
    if (!fn) throw new Error(`sigil: handler ausente para ${binding.discoverKey}. Rode 'sigil build'.`);
    const nodes = ((await fn()) ?? []) as TestNode[];
    controller.items.replace(nodes.map(toItem));
  });

  controller.refreshHandler = discover;
  void discover();

  if (binding.runKey) {
    const runKey = binding.runKey;
    const leavesOf = (item: TestItemLike): TestItemLike[] => {
      if (item.children.size === 0) return [item];
      const out: TestItemLike[] = [];
      item.children.forEach((child) => out.push(...leavesOf(child)));
      return out;
    };
    const kind = (vscode as unknown as { TestRunProfileKind?: { Run: unknown } }).TestRunProfileKind?.Run ?? 1;
    controller.createRunProfile(
      "Run",
      kind,
      async (request, token) => {
        const run = controller.createTestRun(request);
        const roots: TestItemLike[] = [];
        if (request.include) roots.push(...request.include);
        else controller.items.forEach((item) => roots.push(item));
        for (const leaf of roots.flatMap(leavesOf)) {
          run.started(leaf);
          const started = Date.now();
          try {
            const fn = registry.testHandlers.get(runKey);
            if (!fn) throw new Error(`sigil: handler ausente para ${runKey}. Rode 'sigil build'.`);
            const outcome = (await fn({ id: leaf.id, label: leaf.label }, token)) as TestOutcome;
            const failed = outcome === false || (typeof outcome === "object" && outcome !== null && !outcome.passed);
            if (failed) {
              const message = typeof outcome === "object" && outcome !== null ? outcome.message : undefined;
              run.failed(leaf, makeTestMessage(message ?? "teste falhou"), Date.now() - started);
            } else {
              run.passed(leaf, Date.now() - started);
            }
          } catch (err) {
            run.failed(leaf, makeTestMessage(err instanceof Error ? err.message : String(err)), Date.now() - started);
          }
        }
        run.end();
      },
      true
    );
  }

  return { dispose: () => controller.dispose() };
}

function makeTestMessage(text: string): unknown {
  const TM = (vscode as unknown as { TestMessage?: new (t: string) => unknown }).TestMessage;
  return TM ? new TM(text) : { message: text };
}
