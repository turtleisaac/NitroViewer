import { defineConfig, mergeConfig } from "vitest/config";

import base from "./vitest.config";

// Vitest LCOV for crapper, written under the repo target/ tree.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      coverage: {
        provider: "v8",
        reporter: ["lcov"],
        reportsDirectory: "../target/coverage/typescript",
        include: ["src/**/*.{ts,tsx}", "electron/pokeHub.cjs"],
        exclude: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/**/*.d.ts"],
      },
    },
  }),
);
