import { defineConfig } from "vitest/config";

// The shipped game-db check only. The default Vitest config leaves that file out.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/gamedb/validity.test.ts"],
  },
});
