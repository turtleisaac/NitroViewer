import { defineConfig } from "vitest/config";

// Fast, DOM-free unit tests (pure logic like sprite/palette pairing).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
