import { defineConfig } from "vitest/config";
import path from "node:path";

// Aliases do modo inline do @sigilkit/test (tests/inline-host.test.ts): o wire TS
// é importado direto (sem bundle), então "vscode" resolve para o mock
// compartilhado e "@sigilkit/core" para o SRC (o dist faria require("vscode")
// fora do grafo do vite). O target es2022 rebaixa os decorators stage 3.
export default defineConfig({
  esbuild: { target: "es2022" },
  resolve: {
    alias: {
      vscode: path.resolve(process.cwd(), "packages/test/src/vscode-singleton.ts"),
      "@sigilkit/core": path.resolve(process.cwd(), "packages/core/src/index.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "examples/*/test/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
