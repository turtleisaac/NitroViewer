# NitroViewer — Agent Handoff

A modern, in-browser Nintendo DS ROM viewer/editor — a replacement for Tinke, powered by **Nds4j**
(Java) running in the browser via **CheerpJ** (WASM JVM). Live at **https://nitroviewer.com**.

> **The ROM never leaves the tab.** Everything (parse, decode, render) runs client-side. nitroviewer.com
> is a static site on GitHub Pages.

This doc covers: current state, how to work in the repo, the hard-won quirks, and — the main event —
**the next flagship: file importing + ROM saving** (the write/edit half of Tinke we haven't built yet).

---

## 1. Current state (what's done)

**Read/view side is complete and deployed:**
- **2D:** NCGR (sprites) · NCLR (palettes) · NSCR (tilemaps) · NCER (cells) · NANR (cell animation, plays)
  — with palette-pairing UX, 4bpp sub-palette selection, LZ decompression, PNG export.
- **NARC** browse (format-typed entries) + **raw file export**.
- **3D / effects (full Nitro stack):** NSBMD models + NSBTX textures (three.js, orbit/zoom/pan, unlit),
  NSBCA skeletal animation (glTF), NSBMA/NSBVA/NSBTP tracks (three.js-driven per-frame), SPA particles
  (server-rendered frame player), glTF export, model/texture/animation pickers, smart NSBCA auto-pairing.
- **Infra:** responsive layout, GitHub Actions CI/CD to Pages, 13 JUnit facade tests + 10 vitest tests.

**Not done:** the entire **write/edit/save** path (this doc's focus), plus formats Nds4j can't parse yet
(NFTR fonts, NMCR/NMAR multi-cell) and SPA-track niceties. See §5.

---

## 2. Architecture in 60 seconds

```
web/ (React + Vite + TS)                nitroviewer-core/ (Java, Maven)
  components/  UI, viewers                CheerpjFacade implements NitroViewerService
  transport/   NitroViewerClient  ──────▶   - thin adapter over Nds4j
    cheerpj.ts   CheerpjTransport            - int handles → open ROMs/NARCs
  state/       zustand store + pairing       - returns JSON / base64 / glTF strings
```

- **Facade contract** (`NitroViewerService.java`): methods take/return only `int`, `boolean`, `byte[]`,
  `String` (JSON/base64). **Never a live Nds4j object, never a `long`, never throws across the boundary**
  (errors come back as `{"error":...}`; `openRom` returns `{"ok":false,...}`).
- **Transport** (`cheerpj.ts`) is the ONLY place that knows about CheerpJ. Swap it for an `HttpTransport`
  and nothing else changes. It **serialises every call through a queue** (see quirks).
- A **resource** is a `(container, id)` pair: `container < 0` = a ROM file with that id; `container >= 0` =
  index `id` inside the open NARC with that narc-handle. Bytes are LZ-decompressed transparently.
- The facade holds ROMs (`Map<Integer,NintendoDsRom>`) and NARCs (`Map<Integer,Narc>`) by handle,
  **in memory, mutable** — which is exactly what makes editing possible (§6).

---

## 3. Working in the repo

```bash
make jars          # build Nds4j (from ../Nds4j) + facade jar, stage into web/public/jars + spike/jars
cd web && npm install
npm run dev        # Vite dev server @ 5173  (CheerpJ needs Range + no COOP/COEP — Vite is fine)
npm run build      # tsc --noEmit && vite build  → web/dist
npm test           # vitest (pairing logic) — runs in CI
```
- **Facade JUnit tests** need a retail ROM: `cd nitroviewer-core && mvn test -Drom.dir=/…/PokEditor-Stack
  -Djava.awt.headless=true`. ROMs (`HeartGold.nds`, `Platinum.nds`, …) live in the workspace root and are
  **never committed** (`.gitignore`). Tests `Assumptions`-skip when a ROM is absent, so CI (no ROM) skips
  them; CI still compiles the test sources.
- **Deploy:** push to `main` → `.github/workflows/deploy.yml` checks out `turtleisaac/Nds4j@feature/3d-formats`
  beside the repo, builds both jars + the SPA (running `npm test`), publishes `web/dist` to Pages.
- **Preview a prod build at domain-root** (CheerpJ needs `/app`=origin root): `python3 scripts/serve-static.py
  web/dist 8080`.

### Verifying UI changes (the loop I used all session)
`playwright-core` + **system Chrome** (no browser download): `chromium.launch({ executablePath:
'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })`. The store is exposed as
`window.__store` (dev affordance in `state/store.ts`) so a driver can `getState().select(ref,name)` etc.
For **WebGL/three.js** headless, add args `['--use-gl=angle','--use-angle=swiftshader',
'--enable-unsafe-swiftshader']`. Screenshots via `page.screenshot()` / `element.screenshot()`; compare two
frames' buffers to detect animation. Keep throwaway driver scripts in a scratch dir outside the repo.

---

## 4. Hard-won quirks (READ THIS before touching the transport or 3D)

### CheerpJ (all learned the hard way)
- **Pass binary as `Int8Array`, never `Uint8Array`.** Java `byte` is signed; a Uint8Array fails overload
  resolution the moment it holds a value > 127 (every ROM does) with `Method X cannot be resolved`.
- **Serial call queue is mandatory.** CheerpJ Library Mode allows only ONE Java call in flight; a concurrent
  second throws `"Java code still running, check for a missing 'await'"`. `Promise.all` over facade calls, or
  two component effects at once, will trip it. `CheerpjTransport.enqueue` chains every call. Keep it.
- **`cheerpjInit()` runs exactly once per page** — React StrictMode/remounts double-call it →
  `WebAssembly.Memory maximum 0`. Guarded with a singleton promise in `init()`.
- **Never throw across the boundary; never return `long`; use `int` handles.** Java exceptions marshal as
  "Cannot convert object to primitive value". Return `{"error":...}` JSON instead.
- **Big binary OUT:** returning a huge `byte[]` from CheerpJ → JS comes back as a typed array. `openRom` sends
  128 MB in fine; the reverse (ROM save-out, §6) is the main *unverified* path — try `Int8Array` return first.
- Loader: `https://cjrtnc.leaningtech.com/4.3/loader.js`. `/app` maps to the **origin root**.
- **Static host must answer HTTP Range/206** or CheerpJ refuses ("HTTP server does not support the 'Range'
  header"). Python's stock handler doesn't — `scripts/serve-static.py`/`serve-spike.py` add it. **Do NOT set
  COOP/COEP** — `require-corp` blocks CheerpJ's own `c.html` iframe.
- Base64/PNG data crosses fine as strings. To read huge JSON string fields in Java tests, use `indexOf`,
  **not a backtracking regex** (`"key":"((?:[^"\\]|\\.)*)"` StackOverflows on multi-KB base64).

### three.js
- **A perpetual `requestAnimationFrame` loop STARVES CheerpJ** (cooperative main-thread execution) and *hangs*
  long Java calls like the glTF export — the facade call never returns. **Render on demand** (OrbitControls
  `change` + resize + load); run a RAF loop **only while actively playing and not exporting** (`ModelViewer`).
- **DS models are unlit** — the texture/vertex colours are the final image. glTF exports PBR; `makeUnlit`
  swaps each material to `MeshBasicMaterial` (crisp, authentic) **and preserves `material.name`** so the
  NSBMA/NSBTP tracks can target materials by name.
- **Non-glTF tracks (NSBMA/NSBVA/NSBTP)** are driven in three.js from per-frame facade data, mapped by DS
  **material name** (colour, texture-pattern) and **node index** (visibility, via `getModelRig`). A track and
  model are authored together in a NARC; a mismatched pairing just no-ops.

### GitHub Pages / DNS
- Pages **does** serve `.jar` with Range/206 (binary, un-gzipped) — verified. CheerpJ boots from Pages.
- **Custom domain must be set in the repo's Settings → Pages** (the REST API refuses: "certificate does not
  exist yet"). The account-level "Verified domains" TXT is separate and optional.
- Build uses **Vite `base: './'`** + a **path-aware CheerpJ classpath** derived from `location.pathname`
  (`/app<dir>/jars/…`), so one build works at both the apex root and the `…github.io/NitroViewer/` subpath.

### Nds4j
- **CI builds Nds4j from `turtleisaac/Nds4j@feature/3d-formats`.** Any Nds4j method the facade calls must be
  **pushed to that branch first**, and **verify it compiles before pushing** (a duplicate `getBitDepth()` broke
  the branch once — recovered with a forward-fix; force-push is blocked by the permission classifier). The
  facade currently depends on `Nds4j:1.0.0` (a local build of that branch shadows Central).
- **`NitroLz.isCompressed()` is a heuristic** and false-positives on some uncompressed files (Platinum's
  `area_build.narc` sub-files), where `decompress` then throws AIOOB. Always go through
  `CheerpjFacade.maybeDecompress()` (falls back to raw on failure).

### Test fixtures (retail ROMs, workspace root)
- **manene** (Mime Jr., a known-good animated model): **Platinum NARC file 142, model index 51, animation 53.**
- **NSBMA/NSBVA/NSBTP** live in Platinum: e.g. romFile 139 has a model + NSBVA 81 + NSBTP 14; romFile 179
  model 0 + NSBMA 3 tints visibly. **SPA** is in Platinum `particledata` NARCs.
- 2D everything is easy to find in HeartGold `a/…` NARCs.

---

## 5. Read-side backlog (small)

- Smarter model↔NSBCA/track pairing (currently nearest-at-or-after by index; sometimes wrong).
- NANR: auto-select a multi-frame clip (default clip 0 is often single-frame → looks static).
- Model lighting/material polish; a ground grid; "capture PNG" of the 3D view.
- Formats Nds4j can't parse yet: **NFTR** (fonts), **NMCR/NMAR** (multi-cell) — need Nds4j support first.
- SPA: emitter isolation, adjustable frame count/size, background toggle.

---

## 6. 🚩 FLAGSHIP: File importing + ROM saving (the write half)

This is the big remaining half of Tinke: **replace/import files and assets, then save the modified `.nds`.**
The architecture already supports it — the facade holds a **mutable in-memory `NintendoDsRom`** per handle.
The model is: **edits accumulate in that ROM; "Save ROM" serialises and downloads the `.nds`.**

### 6.1 Nds4j write APIs (confirmed, real signatures)
- `NintendoDsRom.setFile(int index, byte[] data)` / `setFileByName(String path, byte[])` — replace a ROM file.
- `NintendoDsRom.save(boolean updateDeviceCapacity)` → `byte[]` — the whole ROM (use `false`, per Nds4j's own
  examples, unless you changed cartridge size). `saveToFile(...)` also exists (not usable in-browser).
- `Narc.setFile(int index, byte[])` / `setFileByName` / `setFiles(ArrayList<byte[]>)`, and
  `Narc.save()` → `byte[]` — repack a NARC after editing a sub-file.
- **Asset re-encode (headless-safe, use these):**
  - PNG → NCGR: **`new IndexedImage(int[][] pixels, Palette).save()`** — build the index grid in Java by
    matching each imported pixel to the palette (see risk below re: JPanel), then `save()` → NCGR bytes.
  - Palette import: `new Palette(Color[]).save()` → NCLR bytes.
  - NSBMD from scratch: `ObjImporter.parse(objText)` + `ModelBuilder`, or
    `ImdImporter.toNsbmd(imdXml, name)` / `toNsbmdWithTextures(...)` → NSBMD bytes (byte-exact vs g3dcvtr).
  - Round-trip a decoded model after edits: `ModelSet.reencodeModels()` → byte-exact NSBMD bytes.
  - In-place NSB* edits: `G3dFile.writeBlockU8/U16` (e.g. NSBMA colour keyframes, `TextureSet.setPaletteColor`).

### 6.2 Facade methods to add (new `NitroViewerService` entries)
Keep the contract (JSON/base64/`byte[]` in, JSON out; never throw):
- `String importRaw(int romHandle, int container, int id, byte[] bytes)` — for a ROM file: `rom.setFile(id,
  bytes)`. For a NARC entry: `narc.setFile(id, bytes)` then **repack**: `rom.setFile(narcRomFileId,
  narc.save())`. Return `{"ok":true}` / `{"error":...}`. **Track dirty state.**
- `String importPng(int romHandle, ncgrRef, nclrRef, tilesWidth, byte[] pngBytes)` — decode PNG → `int[][]`
  indices against the paired palette → `new IndexedImage(pixels, palette).save()` → `setFile` + repack.
- (later) `importGltf/importObj`, `importPalette`, per-track editors.
- `byte[] saveRom(int romHandle)` — `return rom.save(false);`. **This is the one CheerpJ path to prove out**
  (128 MB byte[] → JS). Try returning the raw `byte[]` (JS gets an `Int8Array`); the transport wraps it in a
  `Blob` for download. If marshalling 128 MB is too slow/heavy, fallbacks: chunk it, or write to CheerpJ's
  writable `/files/` VFS and stream it out. **Measure first.**

**Crucial bookkeeping:** `openNarc` must remember which ROM file each narc-handle came from (add
`Map<Integer,Integer> narcRomFile`) so `importRaw`/`importPng` can repack the edited NARC back into the ROM.
Right now the facade doesn't store that link.

### 6.3 Frontend
- A hidden `<input type=file>` "Import…" action on the selected resource → `arrayBuffer()` → `Int8Array` →
  `importRaw`/`importPng`. (Reuse the `Int8Array` marshalling rule.)
- Header **"Save ROM"** button → `saveRom` → `new Blob([bytes])` → download `<romName>.nds` (util already has
  `download`).
- A **dirty indicator** + `beforeunload` warning when there are unsaved edits (track in the zustand store).
- After an import, invalidate/re-decode the affected viewer (the `decodeCache` and any open NARC listing).

### 6.4 Phasing (recommend)
1. **MVP:** `importRaw` (any file) + `saveRom` + Save button + dirty flag. Format-agnostic, unlocks the whole
   workflow. Prove the 128 MB save-download round-trips and the saved ROM re-opens in NitroViewer (and ideally
   boots in an emulator — `Diamond.nds`/`HeartGold.nds` are in the workspace for spot checks).
2. **Asset import:** PNG → NCGR/NSCR/NCER, palette import, then glTF/OBJ → NSBMD.
3. **Polish:** undo/redo (snapshot the edited file's prior bytes), per-format import UIs, batch import from an
   unpacked folder (`NintendoDsRom.unpack`/`fromUnpacked`, `Narc.unpack`/`fromUnpacked`).

### 6.5 Risks / unknowns to retire early
- **128 MB `byte[]` return** across CheerpJ (save path) — perf/memory unverified. Peak memory ≈ ROM (in
  facade) + save copy + Int8Array + Blob (~0.5 GB). Measure in a real browser; it likely works but confirm.
- **JPanel/headless:** `IndexedImage`'s quantiser paths (`indexSelf(JPanel)`, `replacePalette(...,JPanel)`,
  `IndexedImage(Image,JPanel)`) take a Swing `JPanel` and may throw `HeadlessException` under CheerpJ. **Avoid
  them.** Do PNG→indices matching yourself and use `new IndexedImage(int[][] pixels, Palette)` (no JPanel).
- **Compression on write:** for MVP, write files **uncompressed** (don't re-LZ). Nds4j's ROM save recomputes
  FAT offsets so size changes are fine, but a few games *require* certain files compressed — flag per-format
  later; `framework.NitroLz` / `BLZCoder` can re-compress if needed.
- **ROM integrity:** editing arm9/overlays or moving files can brick a ROM. Scope MVP to **data files / NARC
  sub-files**; leave code binaries alone.
- **Round-trip fidelity:** Nds4j's NSB*/NARC writers are byte-exact on retail data (that's a project
  invariant — see `../Nds4j` `HANDOFF-3D.md` and the round-trip memory), so re-encoded assets should be clean;
  still, verify an edited ROM opens and the edited asset reads back.

### 6.6 Verification approach
- JUnit (ROM-gated): edit a NARC sub-file → `saveRom` → re-open the bytes as a fresh `NintendoDsRom` → assert
  the edited file reads back; assert an untouched file is unchanged.
- E2E (playwright + `window.__store`): import a PNG over a sprite, Save ROM, re-open the downloaded `.nds`,
  confirm the sprite changed. Emulator smoke-test the saved ROM boots.

---

## 7. Key files
- `nitroviewer-core/src/main/java/com/nitroviewer/core/`
  - `NitroViewerService.java` — the contract. `CheerpjFacade.java` — the implementation (add write methods here).
- `web/src/`
  - `transport/{types,cheerpj,index}.ts` — client interface + CheerpJ transport (add write methods here).
  - `state/store.ts` — zustand store (add dirty state here); `state/pairing.ts` — pure pairing (+ tests).
  - `components/` — `InspectorPane` (format→viewer router), `SpriteViewer`, `PaletteViewer`, `TextureViewer`,
    `ModelViewer` (3D + tracks), `ParticleViewer`, `NarcBrowser`, `TreePane`.
- `.github/workflows/deploy.yml` · `scripts/{build-jars,serve-static,serve-spike}.{sh,py}` · `Makefile`
- Memory: `~/.claude/projects/…/memory/nitroviewer-cheerpj-spike.md` has the condensed quirks.
