import { configDefaults, defineConfig } from "vitest/config";

// Fast, DOM-free unit tests (pure logic like sprite/palette pairing).
// The shipped game-db check has its own config so this suite does not run it too.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: [...configDefaults.exclude, "src/gamedb/validity.test.ts"],
  },
});
