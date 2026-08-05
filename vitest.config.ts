import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "examples/*/test/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
