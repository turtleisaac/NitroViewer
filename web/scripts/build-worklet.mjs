#!/usr/bin/env node
// Pre-bundles the AudioWorklet module into public/sseq-worklet.js as a single, self-contained ES
// module (stepper.ts/load.ts/protocol.ts/tables.ts inlined, imports resolved, TypeScript stripped).
//
// Why this exists: AudioWorkletProcessor is loaded via `ctx.audioWorklet.addModule(url)`, not a
// static `import`, so nothing in the app's module graph reaches sseq-worklet.ts — Vite never sees
// it as code to bundle. Vite's `new URL(x, import.meta.url)` handling (which host.ts's runtime
// reference to this file uses) only transpiles/bundles a referenced file when the SAME module also
// contains a literal, textually-adjacent `new Worker(new URL(...))`/`new SharedWorker(new URL(...))`
// expression (there's no AudioWorklet-specific recognition) — and even then, the rewrite only
// produces a Worker, not a URL we can hand to addModule(). Without that, the file is treated as an
// opaque static asset: for something this small it gets base64-inlined as a `data:` URL with a
// guessed (wrong — video/mp2t, since ".ts" is also the MPEG-TS extension) MIME type, which browsers
// refuse to load a worklet module from (opaque/null origin) — exactly the "Cross-origin script load
// denied" error this fixes. Building it as a real, addressable file sidesteps all of that.
//
// Mirrors ../scripts/build-jars.sh, which generates web/public/jars/*.jar the same way: a build
// artifact regenerated here, not committed (see .gitignore).
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [resolve(root, "src/sound/engine/sseq-worklet.ts")],
  bundle: true,
  format: "esm",
  target: "es2020",
  minify: true,
  outfile: resolve(root, "public/sseq-worklet.js"),
});

console.log("Built public/sseq-worklet.js");
