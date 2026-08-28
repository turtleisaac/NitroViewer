# NitroViewer

A sleek, modern web app for browsing and viewing Nintendo DS ROMs — a direct replacement for the
legacy desktop tool [Tinke](https://github.com/pleonex/tinke). Destined for **nitroviewer.com**.

NitroViewer is powered by [**Nds4j**](https://github.com/turtleisaac/Nds4j), a pure-Java library for
Nintendo DS file formats (ROM/NARC, the 2D graphics formats, and the full Nitro 3D stack).

## Architecture

The defining constraint: Tinke is **local and private** — DS ROMs are large (64–128 MB) copyrighted
files that never leave your machine — yet we want a web app you just *visit*. NitroViewer resolves
this by running the Nds4j JAR **in your browser** via [CheerpJ](https://cheerpj.com) (a WebAssembly
JVM). The ROM never leaves the tab, nitroviewer.com is a static site, and we run the real Nds4j —
inheriting every format it supports.

Everything routes through a **transport-agnostic facade** (`nitroviewer-core`) whose methods only
exchange JSON / `byte[]` / base64 strings — never live Java objects. So the same contract can run
in-browser (CheerpJ) *or* behind an HTTP backend, and the frontend never has to care which.

```
nitroviewer-core/   Java (Maven) facade over Nds4j — the transport contract
spike/              Phase-0 CheerpJ de-risk (throwaway; proves the chain works)
web/                v1 React + Vite + TypeScript SPA (built after the spike gate passes)
scripts/            build-jars.sh, serve-spike.py
```

## Status: Phase 0 — CheerpJ spike (de-risk)

Before committing the UI to CheerpJ, we prove the whole chain in a blank page and measure it:
load the JVM in the browser → open a real ROM → walk the FNT tree → decode one sprite.

### Run the spike

Requires JDK 8+ and Maven (to build the jars) and Python 3 (to serve). A retail DS ROM stays local.

```bash
make spike          # builds the jars and serves at http://localhost:8000
```

Open <http://localhost:8000>, pick a `.nds` ROM, and watch the metrics panel. The **gate** (see
`../.claude/plans/…`): a 64 MB ROM parses in a few seconds, the sprite renders correctly, memory
stays sane, and CheerpJ's license fits a free static site. Pass → build v1 on CheerpJ. Any hard
miss → keep the facade, swap in an HTTP transport (the frontend is unaffected).

## v1 scope (after the gate)

ROM tree browser · 2D graphics viewer (NCGR/NCLR/NSCR/NCER/NANR) · NARC browse + extract/export.
The 3D viewer (Nds4j's glTF export → three.js) is designed-for but deferred past v1.

## License

GPLv3 (see [LICENSE](LICENSE)), matching Nds4j.
