<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo/sigil-logo-dark.svg">
    <img src="assets/logo/sigil-logo-light.svg" alt="sigil" width="300">
  </picture>
</p>

<p align="center">
  <strong>A declarative framework for VSCode extensions.</strong><br>
  TypeScript is the single source of truth; <code>package.json</code> is derived from it.<br>
  <em>The only build that catches a typo in a <code>when</code> expression.</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/org/sigilkit"><img src="https://img.shields.io/npm/v/%40sigilkit%2Fcore?label=npm%20%40sigilkit&color=cb3837" alt="npm @sigilkit"></a>
  <a href="https://github.com/JonathanSantos/sigilkit/actions/workflows/ci.yml"><img src="https://github.com/JonathanSantos/sigilkit/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-8b5cf6" alt="MIT License"></a>
</p>

<p align="center">
  English | <a href="README.md">Português (principal)</a>
</p>

---

```ts
import * as vscode from "vscode";
import { Extension, Command, Config, Watch } from "@sigilkit/core";

@Extension({ prefix: "hello" })
export class HelloExtension {
  @Config({ description: "Text shown in the greeting" })
  accessor greeting: string = "Hello";

  @Command({ title: "Say hello", category: "Hello", keybinding: "ctrl+alt+h" })
  sayHello() {
    vscode.window.showInformationMessage(`${this.greeting}!`);
  }

  @Watch("greeting")
  onGreetingChanged(next: string, prev: string) {}
}
```

Not a single line of `contributes` is written by hand. `sigil build` generates:

- the `contributes` block in `package.json` (merged — unmanaged keys are preserved);
- `src/.generated/wire.ts` — the real `activate()`, which joins the keys emitted
  by the compiler with the handlers registered at runtime, and **throws**
  if a handler is missing;
- `src/.generated/config.d.ts` — per-key types: `getConfig("hello.retries")`
  → `number`, with autocomplete; a key outside the registry returns `unknown`.

Renaming a command and forgetting the manifest is no longer a ghost command —
it becomes a **build error with a file position**. A typo in a `when`
expression, which would fail silently forever, becomes a build error
(`SIGIL1018`) with a caret on the line.

## In 30 seconds

Hot reload in the `sigil sim --ui` workbench: a command runs, the handler gets
edited, and the new behavior is already live — **no F5, no VSCode window**:

<p align="center">
  <img src="assets/demo-hot-reload.gif" alt="hot reload in sigil sim --ui: command executed, handler edited, new behavior without F5" width="900">
</p>

## Why sigil

- **One source of truth** — identity (ids, titles, schemas) comes from the AST
  at build time; behavior (handlers) comes from the registry at runtime; the
  join by stable key is verified on both ends.
- **Loud errors, never silence** — a missing handler throws on activation; an
  exception in a command becomes a log with stack plus an "Open logs"
  notification; unsimulated API in tests throws a descriptive error.
- **A dev loop of seconds, not F5** — four gears: incremental watch, a
  simulator with a REPL, a visual workbench in the browser, and real VSCode
  with hot swap.
- **Testable by default** — `@sigilkit/test` activates the extension's real
  bundle without an extension host; the examples and the tutorial itself run
  in CI.
- **Web-ready and minification-safe** — a runtime with no `node:*` (works on
  vscode.dev) and a join via `Symbol.metadata` (no `--keep-names`).

## How it compares

The closest neighbor is [reactive-vscode](https://github.com/KermanX/reactive-vscode),
which tackles the **runtime**: Vue-style reactivity on top of the events and
disposables API. sigil tackles **identity**: manifest, `activationEvents`,
config types and `when` expressions derived from code and verified at build
time. The two theses are complementary — the deciding question is which pain
is yours: runtime ergonomics, or keeping `package.json`, schemas and `when`
in sync by hand. And the part no other tool (not even VSCode itself) offers
is structural: **validating `when`/`enablement` at build time requires seeing
the declared context keys AND the expressions at the same time** — only a tool
that derives the manifest from code has both sides.

## Getting started

The packages are on npm under the [`@sigilkit`](https://www.npmjs.com/org/sigilkit) scope:

```bash
npm create sigil my-extension
cd my-extension && npm install && npm run build
# open in VSCode and press F5 — or: npx sigil sim --ui .
```

(`--template=react-webview` scaffolds a React panel with the typed protocol
ready to go. Without `npm create`: `npm i -D @sigilkit/cli && npx sigil init`.)

**Follow the [tutorial: your first extension in 5 minutes](docs/tutorial.md)**
(in Portuguese) — command, config, status bar, watch, a settings tab and a
`.vsix`, without opening VSCode. The test `tests/tutorial.test.ts` guarantees
it never rots.

In this monorepo:

```bash
npm install && npm run build     # compiles the four packages
npm test                         # unit + simulator + CLI E2E
```

## The decorators

| Decorator | On | What it declares |
|---|---|---|
| `@Extension({ prefix?, settings? })` | class | the extension; `settings: true` generates the settings tab (`<prefix>.configure`) |
| `@Command({ title, id?, keybinding?, menus?, enablement?, progress? })` | method | command + keybindings + menus; `id` pins the public id independent of the method name; `progress` wraps in `withProgress` (token is the last argument) |
| `@Config({ description?, ... })` | accessor | configuration — type, default and enum come from the TS declaration |
| `@Watch("key")` | method | reaction to a config change |
| `@Activate` / `@Deactivate` | method | lifecycle |
| `@StatusBar({ alignment?, command? })` | accessor | status bar item; assigning to the accessor updates the text |
| `@On("ns.event", { debounce? })` | method | API event with auto-dispose |
| `@OnFile(glob, kind, { debounce? })` | method | declarative `FileSystemWatcher` |
| `@UriHandler()` | method | `vscode://…` deep links (+ automatic `activationEvent`) |
| `@State("global" \| "workspace")` | accessor | typed `Memento` persistence — **reassign** (`this.x = [...]`); internal mutation (`push`) does not persist |
| `@Secret()` | accessor | `SecretStorage` with a synchronous cache |
| `@ContextKey()` | accessor | `setContext` on assignment — and enables `when` validation |
| `@TreeView({ name, container?, when? })` + `@TreeRoot`/`@TreeChildren`/`@TreeItem` | class | sidebar view with an adapted `TreeDataProvider`; `when` validated |
| `@Webview({ title, ui, location?, when? })` + `@OnMessage`/`@OnRequest` | class | panel or sidebar with an HTML shell (CSP + nonce) and typed RPC; `when` (sidebar) validated |
| `@OnOpen` / `@OnDispose` | method | panel/view lifecycle — open/close |
| `@Every(ms)` | method | a timer with the right lifecycle: on the `@Extension` it lives from activation to deactivation; on a `@Webview`, only while the panel is open |
| `@Language({ id })` + `@Hover`/`@Completion`/`@CodeLens`/`@Diagnostics` | class | language providers (+ automatic `onLanguage:*`) |
| `@ChatParticipant({ id, name })` + `@ChatRequest`/`@ChatFollowups` | class | chat participant (`@name` in Copilot Chat) |
| `@ChatCommand("fix", { description? })` | method | the participant's slash command — declared in the manifest and routed by `request.command` |
| `@LmTool({ description, referenceName? })` | method | **agent mode tool** — `inputSchema` DERIVED from the parameter's type; Copilot invokes it |
| `@McpServers({ label })` | method | MCP server definition provider (return `{label, command, args}` or `{label, uri}`) |
| `@InlineCompletion` | method | ghost text (`InlineCompletionItemProvider`) — return strings |
| `@CustomEditor({ id, filenamePattern, ui })` | class | custom editor on top of the webview shell, with undo-friendly `applyEdit` |

Manifest strings accept localization `%keys%`: keep your `package.nls.json`
and the build **validates** every key used — a missing one is `SIGIL1020`
with a caret on the line.

## The agent mode era: `@LmTool`

The integration point of the Copilot era is the tool that agent mode invokes —
and `contributes.languageModelTools` demands a **hand-written JSON Schema**
duplicating a TS type, tied by string to `registerTool`. In sigil:

```ts
interface SearchInput {
  /** the text to search for */
  query: string;
  state?: "open" | "closed";
  max?: number;
}

@LmTool({ description: "Search the project's issues", referenceName: "issues" })
searchIssues(input: SearchInput): string { ... }
```

The `inputSchema` **comes from the type** (JSDoc becomes `description`, a
union of literals becomes `enum`, optional becomes not-required, aliases
resolve through the checker), registration and the join belong to the wire,
and `host.invokeTool("…")` tests the tool in the simulator without any
Copilot. Slash commands (`@ChatCommand`), ghost text (`@InlineCompletion`),
MCP providers (`@McpServers`) and `llm.agent()` — the tool-calling loop
without boilerplate — complete the batch. All on stable API, accessed
dynamically: no new `@types/vscode` required, with a loud error on old hosts.

## Language, chat and editor surfaces

```ts
@Language({ id: "markdown" })
export class MarkdownAssist {
  @Hover()                                   hover(doc, pos) { return new vscode.Hover("…"); }
  @Completion({ triggerCharacters: ["("] })  complete(doc, pos) { /* … */ }
  @Diagnostics({ on: "change" })             validate(doc) { return [/* Diagnostic[] */]; }
}
```

sigil emits the `activationEvents: onLanguage:<id>` (managing only the
`onLanguage:*` subset — the rest of the array is yours), registers the
providers with dynamic dispatch (hot-swappable) and handles the
`DiagnosticCollection` lifecycle: revalidates on change/save/open and clears
on close.

```ts
@ChatParticipant({ id: "guru", name: "guru" })
export class Guru {
  @ChatRequest()
  async respond(request, ctx, stream, token) { stream.markdown("…"); }
}
```

It lands in `contributes.chatParticipants`; the chat API is accessed
dynamically — it doesn't require a new `@types/vscode` from those who don't
use chat, and on old hosts the bind fails loudly with a clear message.

```ts
@CustomEditor({ id: "caps", displayName: "CAPS", filenamePattern: "*.caps", ui: "./ui/editor.html" })
export class CapsEditor {
  @OnMessage("shout")
  shout(_v: unknown, editor: SigilEditorContext) {
    void editor.applyEdit(editor.getText().toUpperCase());  // undo works (WorkspaceEdit)
  }
}
```

Handlers receive the document context as the second argument; the UI receives
the content on load and on every change (`onDocument` in `@sigilkit/core/ui`).

## `when` validated at build time

The feature only sigil can have: the compiler sees the declared `@ContextKey`s
**and** the `when`/`enablement` expressions. A token with your prefix that
isn't a declared context key, view or command → `SIGIL1018` with a caret on
the line. Invalid syntax (`&&&`, unbalanced parentheses) → `SIGIL1019`.

```ts
@ContextKey() accessor ready = false;

@Command({ title: "Sync", enablement: "hello.ready" })   // ✓ validated
sync() { /* … */ }
```

## The webview protocol, typed

The same principle applied to the ecosystem's third stringly-typed contract:
`sigil build` generates a `sigil-env.d.ts` in the folder pointed to by `ui:`,
and that folder's `acquireVsCodeApi()` starts accepting **only** the types
declared by the class's `@OnMessage`/`@OnRequest` — with the `value` shape
derived from the handler's parameter (`Parameters<>`): change the type on the
host and the UI sees it instantly, no rebuild.

```js
// ui/notes.js — plain JS with // @ts-check is enough
vscode.postMessage({ type: "add", value: "text" });    // ✓ autocomplete everywhere
vscode.postMessage({ type: "addd", value: "x" });      // error: Did you mean '"add"'?
vscode.postMessage({ type: "remove", value: "seven" });// error: onRemove expects number
```

The `@sigilkit/core/ui` helpers come typed by the same file:
`callHost("send", …)` infers the handler's return type, `postToHost`
validates the message, `onHostMessage` receives the host→UI union derived
from the type of `post` — a typo in any key is a build error. It's types
only — works with any bundler (or none): a React/Vite app includes the file
in **its own** tsconfig and gets the same contract
(`sigil init --template=react-webview` scaffolds it all). Recommended
convention: one folder (with a `lib: DOM` + `checkJs` tsconfig) per webview —
[examples/notes](examples/notes) is the showcase.

## Runtime platform

Beyond the decorators, `@sigilkit/core` ships the base every extension
rewrites:

- **Logs** — `log.info/warn/error/debug/trace` over `LogOutputChannel` (level
  controlled by the user); works before activation (buffered).
- **Errors never vanish** — every command/watch/webview/tree goes through
  `guard()`: an error becomes a log with stack plus a notification with an
  "Open logs" button; trees degrade to a warning item.
- **HTTP** — `http.get/post/…` over the global fetch: automatic JSON, timeout,
  `HttpError` with status/body, `http.fetchImpl` swappable in tests; and
  `http.send()` when you want the raw response (`{ status, headers, text,
  json() }`) without throwing on non-2xx.
- **Bridge between classes** — `registry.instance(MyExtension)` returns the
  live, typed instance of any managed class (from the panel to the extension,
  for instance); an unmanaged class throws immediately. And
  `registry.panel(MyPanel)` talks to another class's webview **without
  strings**: `post` typed by the class's `post!` (sends if open, `false` if
  closed), `open()` and `isOpen`.
- **Resources** — `resources.readText/readJson/readBytes` for packaged files
  (via `workspace.fs`, works on vscode.dev).
- **The editor as a renderer** — `editor.openText(content, { language,
  beside })` opens a virtual document in a real editor: the vscode-native way
  to show a payload, with the user's own theme highlighting and folding.
- **Host↔UI RPC** — `@OnMessage` (fire-and-forget) and `@OnRequest` answering
  `callHost(type, value)` with automatic correlation.
- **Wizards and LLM** — `prompt.text/pick/confirm/steps` (ESC goes back one
  step) and `llm.ask/stream` over the Language Model API.
- **A ready-made settings tab** — `@Extension({ settings: true })` generates
  the `<prefix>.configure` command with a form derived from the `@Config`
  schema.

## Incremental adoption — graft mode

Have an existing extension? **Rewrite nothing.** Three steps:

1. `"sigil": { "graft": true }` in your `package.json` — the merge starts
   preserving your entire manual `contributes`, entry by entry;
2. write the first sigil class (a single new command is enough);
3. in YOUR `activate()`, one line: `await sigilActivate(ctx)` (imported from
   `./.generated/wire`).

`sigil build` adds the derived manifest to yours without touching what's
manual, and the two worlds coexist at runtime. From there, migration is one
command at a time, at your pace — each migrated one gains validated `when`,
typed config and simulator testability. (Documented trade-off: in graft mode,
a managed entry you REMOVE from code leaves the manifest by hand — without
full replacement there's no way to tell "manual" from "ex-managed".)

## Development modes

| Command | What it does | When to use |
|---|---|---|
| `sigil build` | AST → IR → manifest + wire + types (cached by IR hash) | build and CI |
| `sigil check` | fails if the committed manifest is stale | CI guardian |
| `sigil dev` | incremental watch (`ts.createWatchProgram`, ~3ms rebuilds) | terminal next to the editor |
| `sigil sim` | hot reload in the `@sigilkit/test` simulator + REPL | testing behavior without UI |
| `sigil sim --ui` | visual workbench in the browser, live state over SSE | seeing palette, trees, configs and real webviews |
| `sigil sandbox` | **real, isolated** VSCode with hot swap and no F5 | full fidelity |

**`sigil sim`** re-activates the extension in the simulator on every save,
preserving configs, and the REPL exercises it live: `run hello.sayHello`,
`set hello.greeting "Hi"` (fires `@Watch`), `tree hello.tasks`, `msg`,
`input`, `logs`.

**`sigil sim --ui`** opens `http://127.0.0.1:4400`: a clickable command
palette, trees with expansion, a config editor, status bar, toasts, Output —
and **webviews rendered for real** in iframes with an `acquireVsCodeApi`
shim; `showInputBox`/`showQuickPick` become modals on the page. It's a visual
harness of what the simulator models, not a VSCode clone — for full fidelity,
use the sandbox.

<p align="center">
  <img src="assets/sim-ui.png" alt="the sigil sim --ui workbench with tree view, rendered webview, command palette, settings and status bar" width="900">
</p>

**UI hot reload in both modes**: with `"sigil": { "uiDev": "npm run dev:ui" }`
in the package.json (the React template ships like this), `sim` and `sandbox`
start your UI's watch alongside and **reload the open panel** when the bundle
changes — editing a `.tsx` reflects in the panel with no F5, no reopening, in
a single command (`npm run sim`).

**`sigil sandbox`** downloads an isolated VSCode (its own user-data and
extensions, zero pollution of yours) and connects a companion over a socket.
The window opens with the project folder and a notification confirms the
extension loaded, with a button that opens the palette pre-filtered to its
commands — it runs in **development mode** (like F5), so it doesn't show in
the Extensions tab, and that's expected. The watch decides by the **IR
hash**: a method body changed → **🔥 hot swap** (~3ms, no window reload — the
companion reloads the bundle and calls `__sigilHydrate()`); the manifest
changed → automatic window reload. Instance state resets on swap (like Fast
Refresh); configs and open panels survive. Requires `node_modules` in the
project (the bundle keeps `@sigilkit/core` external so the registry is a
singleton across swaps).

## Testing without VSCode — `@sigilkit/test`

A simulator of the subset of the `vscode` API that sigil touches. It
activates the **real bundle** by intercepting `require("vscode")`, seeds the
manifest defaults and exposes probes:

```ts
import { activateExtension } from "@sigilkit/test";

const host = await activateExtension({ projectDir: "examples/hello" });
await host.executeCommand("hello.sayHello");
host.infoMessages;                              // ["Hello!"]
host.configuration.set("hello.greeting", "Hi"); // simulates Settings → fires @Watch
await host.tree("hello.tasks").roots();         // the view's nodes
host.panel("hello.settings").receive({ type: "save", value: { /* … */ } });
await host.dispose();
```

Fidelity where it matters (`affectsConfiguration` semantics, duplicate
registration throws, singleton panel) and honesty at the edges: unsimulated
API throws a descriptive error instead of a silent `undefined`. What the
simulator doesn't cover, E2E covers on the real host: `npm run test:e2e` runs
`examples/hello` via `@vscode/test-electron`.

## Packaging (`.vsix`)

```bash
npm run package      # inside the extension's project
```

Runs `vsce package --no-dependencies` (the bundle already inlines
`@sigilkit/core`). The `.vscodeignore` generated by `sigil init` excludes
source/tests and lets in `out/`, `ui/` and `media/`. The `.vsix` installs via
"Install from VSIX…" or `code --install-extension`; publishing to the
Marketplace is `vsce publish`.

## Project requirements

`sigil init` generates everything this way; for existing projects:

- `target: ES2022`, `experimentalDecorators: false`,
  `useDefineForClassFields: true` — **stage 3** decorators; `@Config`,
  `@StatusBar`, `@State`, `@Secret` and `@ContextKey` require `accessor`;
- `"include": ["src", "src/.generated/**/*"]` in the tsconfig (tsc globs
  don't traverse directories with a dot);
- an esbuild bundle with `--target=es2022` (without it, decorator syntax
  stays raw in the bundle); `--keep-names` is **not** needed — the join uses
  `Symbol.metadata`, with a test that activates the minified bundle to prove
  it;
- `engines.vscode >= 1.75`; chat requires host ≥ 1.90 **at runtime** (not in
  `@types`).

## The monorepo

| Package | Role | Inviolable rule |
|---|---|---|
| [`@sigilkit/core`](packages/core) | runtime — goes into the extension's bundle | never imports `typescript` (R1) nor `node:*` (web-ready) |
| [`@sigilkit/compiler`](packages/compiler) | build time — AST → IR → emitters | never imports `vscode` (R2); never executes user code (R3) |
| [`@sigilkit/cli`](packages/cli) | orchestration and IO | emitters are pure; all IO lives here (R4) |
| [`@sigilkit/test`](packages/test) | simulator for tests | never imports `vscode` nor `typescript` |

The rules are **tested**: `tests/boundaries.test.ts` extracts imports via AST
and fails the build if any is violated. The full design — ownership model
(§4), IR, `SIGIL1000`–`SIGIL1019` diagnostics, pitfalls — is in
[docs/spec.md](docs/spec.md) (in Portuguese), with the errata discovered
during implementation at the end.

## Examples

Each one validates a DX profile, and all have tests with `@sigilkit/test` —
the same pattern a real extension would use:

| Example | Profile | What it exercises |
|---|---|---|
| [examples/counter](examples/counter) | minimal — 1 class, 1 file | default prefix, union → enum, min/max, keybinding with `mac` |
| [examples/todos](examples/todos) | interactive TreeView | own container in the activity bar, state + refresh via `@Watch`, `view/item/context` menu, auto-scoped `when` |
| [examples/notes](examples/notes) | sidebar webview | assets via `asWebviewUri`, typed RPC with `@OnRequest`, state that survives close/reopen |
| [examples/hello](examples/hello) | kitchen sink | everything together — including `@Language` and `@LmTool` — + E2E on the real extension host |
| [examples/restbench](examples/restbench) | **React UI** — a full REST client | typed protocol consumed by React, `@OnRequest` RPC, the `http` platform with stubbed fetch in tests, `@State`/`@Secret`/`@ContextKey` + `enablement`, zero `import vscode` |
| [examples/pets](examples/pets) | **rewrite case** — the [vscode-pets](https://github.com/tonybaloney/vscode-pets) host | 1,347 host lines become ~260; 293 lines of `contributes` become 0; the pets UI stays byte-identical (35 lines of glue) |

## Tests

```bash
npm test             # unit + simulator + CLI E2E (includes the examples)
npm run test:e2e     # real extension host (downloads VSCode the first time)
```

Layers: fixtures with one case per diagnostic (asserting code **and** caret
line), IR/emitter snapshots, `package.json` merge, R1–R4 boundary tests, CLI
E2E (`init`/`build`/`check` on isolated copies), the simulator over the real
bundle (including **minified**), the pinned tutorial, and the happy path on
the extension host via `@vscode/test-electron`. CI runs everything, with
`sigil check` as the stale-manifest guardian.

## Status

The spec's three phases (core, robustness, UI) are complete, plus the
post-spec roadmap: language/chat/editor surfaces, DX over the events and
state API, the runtime platform, the four development modes and packaging.
The [decorators table](#the-decorators) reflects what's implemented and
tested — today sigil declaratively covers the vast majority of marketplace
extension types.

## Roadmap

The public queue is in [ROADMAP.md](ROADMAP.md) — sigil evolves by
dogfooding, and issues with real friction are the fuel.

## Stability

Pre-1.0: the public API may change between minor versions (`0.x` → `0.y`),
always with a note in the [CHANGELOG](CHANGELOG.md) and in the
[releases](https://github.com/JonathanSantos/sigilkit/releases). The packages
version in **lockstep** — always use the same version of all of them. From
`1.0.0` on, strict semver.

## License

[MIT](LICENSE)
