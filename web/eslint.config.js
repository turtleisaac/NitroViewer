import eslint from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// Lint standard for the web app: ESLint recommended, typescript-eslint's
// type-checked recommended set, and the React / react-hooks recommended sets.
// Layout (indent, quotes, braces) is not enforced by a formatter.
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "public/**",
      "vendor/**",
      "release/**",
      "electron/**",
      "scripts/**",
      ".stryker-tmp/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      react.configs.flat.recommended,
      react.configs.flat["jsx-runtime"],
    ],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.eslint.json"],
        tsconfigRootDir: rootDir,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    settings: {
      react: { version: "18.3" },
    },
    rules: {
      ...reactHooks.configs["recommended-latest"].rules,
      // Warnings would not fail CI. The gate treats every recommended hook
      // finding as an error.
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/incompatible-library": "error",
      "react-hooks/unsupported-syntax": "error",
      // `directory` is the non-standard folder-picker attribute (alongside
      // webkitdirectory). It is declared on input props in vite-env.d.ts.
      "react/no-unknown-property": ["error", { ignore: ["directory"] }],
    },
  },
  {
    files: ["e2e/**/*.mjs"],
    ...eslint.configs.recommended,
    languageOptions: {
      ...eslint.configs.recommended.languageOptions,
      sourceType: "module",
      ecmaVersion: 2022,
      globals: { Buffer: "readonly" },
    },
  },
);
