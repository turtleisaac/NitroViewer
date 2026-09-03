# NitroViewer — Agent Handoff

A modern, in-browser Nintendo DS ROM viewer/editor — a replacement for Tinke, powered by **Nds4j**
(Java) running in the browser via **CheerpJ** (WASM JVM). Live at **https://nitroviewer.com**.

> **The ROM never leaves the tab.** Everything (parse, decode, render) runs client-side. nitroviewer.com
> is a static site on GitHub Pages.

This doc covers: current state, how to work in the repo, the hard-won quirks, and the remaining open
items. The write/edit half (§6) now has a **working MVP** — replace any file, import a PNG over a sprite,
and Save ROM. What's left (asset encoders, the per-game manifest, polish) is snapshotted in **§9**.

---

## 1. Current state (what's done)

**Read/view side is complete and deployed:**
- **2D:** NCGR (sprites) · NCLR (palettes) · NSCR (tilemaps) · NCER (cells) · NANR (cell animation, plays,
  auto-selects the first multi-frame clip so it looks alive on open) — with palette-pairing UX, 4bpp
  sub-palette selection, LZ decompression, PNG export.
- **NARC** browse (format-typed entries), incl. **NARC-in-NARC** (nested archives browse; edits repack up
  the whole nesting chain to the ROM) + **raw file export**.
- **Icon/title banner** (the DS home-menu game icon): a **"◆ Game icon & titles"** entry pinned above the
  filesystem opens a viewer for the 32×32 icon (Export PNG / **Replace icon…** — 32×32, ≤15 opaque colors,
  index 0 = transparent) and the per-language titles (editable, up to 3 lines each). Undoable + Save ROM like
  any edit. It's not a FAT file: it rides a **`BANNER_CONTAINER` (-2) sentinel** through the same
  (container,id) resolveRaw/writeResource plumbing, so extract/replace/undo/save reuse works unchanged; the
  Nds4j `IconBanner` class does the icon 4bpp/BGR555 + UTF-16 title + CRC work.
- **3D / effects (full Nitro stack):** NSBMD models + NSBTX textures (three.js, orbit/zoom/pan, unlit),
  NSBCA animation (glTF node-TRS), NSBMA/NSBVA/NSBTP tracks (three.js-driven per-frame), SPA particles
  (server-rendered frame player), glTF export, **Capture PNG of the 3D view**, model/texture/animation
  pickers. Animation is driven by a **`setInterval` timer** (rAF gets throttled on iOS Safari) with a
  capped `devicePixelRatio` + WebGL context-loss recovery, so it plays on iPhone. **Model↔NSBCA
  auto-pairing is a nearest-index heuristic and is often wrong** (see §9).
- **Write/edit/save — the full write half is DONE (§6):** replace/import files and assets, then Save ROM.
  Every viewer that renders a 2D/3D asset can import over it; all edits are **undoable** (↶/↷); the ROM stays
  dirty until **Save ROM** downloads the `.nds`; and edits **preserve LZ compression** — a file the ROM stored
  compressed is re-compressed on write (decompressed for view/export/link, re-compressed for storage;
  `matchCompression` at every NARC-nesting level). The import surface:
  - **Import… / Export** (header): raw **replace** / **extract** of *any* file — extract is decompressed with
    its real name + format extension. The **NARC browser** adds per-entry ↓ extract / ↑ replace and
    **Export/Import folder (zip)** for a whole NARC; **tree folders** have a ↓ *extract-subtree-to-zip*.
  - **PNG → NCGR** (Import PNG…): match-to-palette or rebuild-palette, with the unmatched-pixel count.
  - **PNG → NCLR** (PaletteViewer): Export/Import a swatch-strip PNG.
  - **PNG → NSCR** (background): decompose a painted background into NCGR tileset + NSCR tilemap (H/V-flip
    tile dedup, per-cell sub-palette), matching **or** rebuilding the NCLR.
  - **PNG → NCER / NANR** (composed cell / animation frame): decompose the assembled sprite back into the
    NCGR through its OAMs, matching **or** rebuilding the NCLR (per-OAM sub-palettes, slot 0 = transparent).
  - **OBJ → NSBMD** (Import OBJ ↑): re-encode a mesh — the `.obj` alone (untextured) or with a texture image
    (embedded TEX0). glTF export, Capture PNG, raw export all remain.
  - **WAV → SDAT/SWAR/SWAV**: import a PCM WAV over a wave (encoded as the slot's existing PCM8/PCM16/ADPCM).
- **Sound:** SDAT browser (sequences / waves / streams / banks), SSEQ note-track canvas + play, SWAV/STRM
  preview + play, MIDI / SoundFont export. Two playback paths: the default is a Java-side render to WAV
  (one full playthrough up to the loop point); a **realtime AudioWorklet engine** (a from-scratch JS port
  of the Java `SequencePlayer`, bit-exact — see `web/src/sound/engine/`) is used for mute/solo (so they're
  actually audible, not just a note-roll highlight) and, for sequences flagged **demanding** (long/dense
  enough that rendering the whole thing to WAV risks an iOS Safari OOM crash — real incidents, not
  theoretical), for **Play and seeking too**, skipping the WAV render entirely. Export WAV still always
  renders (inherent to exporting audio) and warns first for a demanding sequence. See §9 for the details
  and the open follow-ups.
- **Game DB (§8) — built:** `state/grouping.ts` + `gamedb/gamedb.json`, manifest-first with `pairing.ts`
  fallback: a **"◆ Game DB" badge**, render hints, and declared groupings, sourced from PokEditor-Core's
  sprite-NARC layouts. Drives model↔NSBCA pairing **by clip name** and the **D/P battle-sprite scan
  direction** fix (they decode as garbled static otherwise).
- **Scanned (bitmap) NCGR handling:** a scanned NCGR viewed through an NCER (DPPt trainer sprites,
  `trbgra.narc`) renders the NCGR **bitmap directly** (it can't be tile-composed); cell import is refused there.
- **Navigation / UX:** full-path **breadcrumbs** (folder segments expand + scroll the tree; the NARC segment
  jumps back to its file list); a **filesystem search** box (→ flat, clickable results by path); a **hex
  viewer** (decompressed) for any file with no dedicated viewer; the NARC grid remembers its scroll position;
  a loading spinner covers the ROM-parse gap. Disambiguates HGSS's numeric `a/X/Y/Z`.
- **SEO / landing:** full `<title>` + meta description/keywords/canonical, Open Graph + Twitter cards
  (incl. `og:image:alt`/`og:locale`), JSON-LD `WebApplication` (with `featureList`/`screenshot`/`author`/
  `sameAs`), `favicon.svg` + `favicon-32.png` + `apple-touch-icon.png`, `site.webmanifest`, `robots.txt`,
  `sitemap.xml`, `preconnect` to the CheerpJ CDN. The **OG image is a real capture of the 3D viewer
  rendering the manene model**. **Crawlable static landing content** lives in `#root` (hero + features +
  formats + FAQ) so non-JS crawlers get real text; React replaces it on mount. Positioning is a **Tinke
  replacement** (copy avoids "free"/"in your browser").
- **Infra:** responsive layout, GitHub Actions CI/CD to Pages, **44 JUnit facade tests + ~11 Nds4j
  image/write-back tests + 88 vitest tests** (pairing + game-DB grouping). CheerpJ's JRE is **Java 8** — see
  §4 (any Nds4j code the facade calls must avoid Java 9+ APIs; nitroviewer-core is guarded with
  `maven.compiler.release=8`).

**Not done (larger — need parsers/RE):** glTF *import* (OBJ import is done); bitmap-OBJ NCER composition
(so scanned sprites compose per-cell). See §9 for the full snapshot.

> **Sprite viewing tip:** the **Width (px)** control (NCGR) sets the sprite width in pixels (step 8; 0 = auto)
> — auto can look like a garbled linear strip.

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
make build         # jars + vendor CheerpJ + SPA + Electron desktop bundle → release/
                   # (unsigned; CheerpJ is vendored so the app is fully offline)
```
The Electron shell (`web/electron/`) is a Range-capable `127.0.0.1` static server plus a
window — CheerpJ cannot load from `file://`. `scripts/vendor-cheerpj.sh` mirrors CheerpJ 4.3
(Java 8) into `web/vendor/cheerpj/` (gitignored); the shell rewrites the CDN loader tag to
`/cheerpj/loader.js` and 204s omitted optional runtime files. The SPA/transport is unchanged
for the website. `npm run electron` after `npm run build` + vendor runs the unpackaged shell.
- **Facade JUnit tests** need a retail ROM: `cd nitroviewer-core && mvn test -Drom.dir=/…/PokEditor-Stack
  -Djava.awt.headless=true`. ROMs (`HeartGold.nds`, `Platinum.nds`, …) live in the workspace root and are
  **never committed** (`.gitignore`). Tests `Assumptions`-skip when a ROM is absent, so CI (no ROM) skips
  them; CI still compiles the test sources.
- **Deploy:** push to `main` → `.github/workflows/deploy.yml` checks out `turtleisaac/Nds4j@main`
  beside the repo, builds both jars + the SPA (running `npm test`), publishes `web/dist` to Pages.
- **Desktop release:** publishing a GitHub Release (or `workflow_dispatch`) runs
  `.github/workflows/release-desktop.yml` — macOS (arm64+x64 dmg/zip), Windows (x64+arm64 nsis/zip),
  and Linux (x64 AppImage/deb/tar.gz), CheerpJ vendored, plus `SHA256SUMS`. Version comes from the
  tag (`v0.1.0` → `0.1.0`). macOS is signed/notarized when `CSC_LINK` + `APPLE_*` secrets are set.
  Packaged apps prompt (Download / Later) if GitHub Releases has a newer tag; they do not auto-download.
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
- **CheerpJ's JRE is Java 8** (`java.version` = `1.8.0_492`). A **Java 9+ API *call*** compiles fine under
  `source/target 8` but throws a bare **`NoSuchMethodError` (null message, empty stack)** in the browser —
  it worked in JUnit (JDK 20) and only died in CheerpJ. This bit the model-write path: Nds4j's
  `ModelBuilder` used `List.of()` (Java 9), so `importObj` failed in-browser while passing every JUnit.
  Fixed by making `ModelBuilder` Java-8-clean (`List.of`→`Arrays.asList`, byte-exact preserved) and
  guarding **nitroviewer-core with `maven.compiler.release=8`** (not just source/target) so any Java 9+ API
  is a *build* error here, not a browser-only surprise. **Latent elsewhere:** `SkeletalAnimationSet.encode`
  uses `ByteArrayOutputStream.writeBytes` (Java 11) — the next write path to wire will hit the same wall.
- Prefer a **single trailing `byte[]` and no `String`/mixed object params** for facade methods: a method
  with `(…,String,byte[],String)` failed CheerpJ overload resolution (`NoSuchMethodError`); reshaping
  `importObj` to `(int,int,int,byte[])` (OBJ text as UTF-8 bytes) fixed it. `int,int,int,byte[]` (like
  `importPalette`/`importObj`) is the proven shape.
- Jar URLs are **cache-busted** (`?v=…`): dev uses a per-load timestamp, prod a fixed `JAR_VERSION`
  (bump when a jar changes) so a redeployed jar isn't shadowed by the browser cache.

### three.js
- **A perpetual `requestAnimationFrame` loop STARVES CheerpJ** (cooperative main-thread execution) and *hangs*
  long Java calls like the glTF export — the facade call never returns. **Render on demand** (OrbitControls
  `change` + resize + load); run a RAF loop **only while actively playing and not exporting** (`ModelViewer`).
- **DS models are unlit** — the texture/vertex colors are the final image. glTF exports PBR; `makeUnlit`
  swaps each material to `MeshBasicMaterial` (crisp, authentic) **and preserves `material.name`** so the
  NSBMA/NSBTP tracks can target materials by name.
- **Non-glTF tracks (NSBMA/NSBVA/NSBTP)** are driven in three.js from per-frame facade data, mapped by DS
  **material name** (color, texture-pattern) and **node index** (visibility, via `getModelRig`). A track and
  model are authored together in a NARC; a mismatched pairing just no-ops.

### GitHub Pages / DNS
- Pages **does** serve `.jar` with Range/206 (binary, un-gzipped) — verified. CheerpJ boots from Pages.
- **Custom domain must be set in the repo's Settings → Pages** (the REST API refuses: "certificate does not
  exist yet"). The account-level "Verified domains" TXT is separate and optional.
- Build uses **Vite `base: './'`** + a **path-aware CheerpJ classpath** derived from `location.pathname`
  (`/app<dir>/jars/…`), so one build works at both the apex root and the `…github.io/NitroViewer/` subpath.

### Nds4j
- **CI builds Nds4j from `turtleisaac/Nds4j@main`** (the `feature/3d-formats` work is now merged). Any Nds4j
  method the facade calls must be **pushed to main first**, and **verify it compiles before pushing** (a
  duplicate `getBitDepth()` broke the branch once — recovered with a forward-fix).
- **✅ FIXED (2026-09-02): the Nds4j dependency version must track Nds4j's own `pom.xml`, not be
  hardcoded.** `nitroviewer-core/pom.xml` had `Nds4j` pinned to a literal `1.0.0`, but Nds4j's own `pom.xml`
  has declared `1.1.0-SNAPSHOT` since Aug 27. `build-jars.sh`'s `mvn install` on a fresh Nds4j checkout
  installs under whatever version *that* `pom.xml` says (`1.1.0-SNAPSHOT`), so the pinned `1.0.0` resolved to
  the **old published Maven Central release** instead — missing every 3D-format class, and every 3D-touching
  Nds4j method added since. This silently broke every CI deploy for hours (compiled locally because a stale
  `1.0.0` jar happened to already sit in `~/.m2` from an earlier local build; a truly fresh checkout —
  exactly what CI does — always hit it). Fixed: `nitroviewer-core/pom.xml`'s dependency version is now
  `${nds4j.version}` (default `1.0.0` for a bare `mvn test`), and `build-jars.sh` reads Nds4j's real version
  via `mvn help:evaluate -Dexpression=project.version -DforceStdout` and passes it through
  (`-Dnds4j.version=...`) so the two can never drift again. **If a `make jars`/CI build ever fails with
  "cannot find symbol" for a class that clearly exists in Nds4j's source, suspect this class of bug first** —
  reproduce locally with `rm -rf ~/.m2/repository/io/github/turtleisaac/Nds4j/<pinned-version> && mvn clean
  test` to force resolution against the *actual* published artifact instead of a lucky local cache.
- **`NitroLz.isCompressed()` is a heuristic** and false-positives on some uncompressed files (Platinum's
  `area_build.narc` sub-files), where `decompress` then throws AIOOB. Always go through
  `CheerpjFacade.maybeDecompress()` (falls back to raw on failure).
- **✅ FIXED: the distinct "`LZ77`"-tagged compression wrapper.** Found live-driving Animal Crossing: Wild
  World's `carpet/floor_*.nsbtx` (loose top-level ROM files): the raw bytes are the 4-byte ASCII tag
  `"LZ77"` followed by a *standard* LZ10/LZ11 header (`[type][u24 decompressedSize]`) and then the normal
  compressed stream. `NitroLz.isCompressed()`/`decompress()` now detect and transparently skip the tag
  (Nds4j `feature/3d-formats`, commit `bb0ef1c`); `compressLz77Tagged()`/`compressLz11Lz77Tagged()` re-emit
  it for write-back. In Animal Crossing alone this unlocked 6348 previously-invisible top-level files, 3974
  of them valid Nitro assets (2503 `BTX0` alone). **Requires a `make jars` rebuild** to pick up the new
  Nds4j jar in the SPA.
- **✅ ALIGNED (2026-09-02): Nds4j edit-path fixes + new BMG/NFTR editing API.** A round of Nds4j work on
  `feature/3d-formats` (commit `7ad2f1b`) that the SPA now runs after a `make jars` rebuild — **re-verified
  green**: the `nitroviewer-core` facade JUnit suite (41 tests, incl. `setPaletteColors` / `setNcgrPixels` /
  `importPng → saveRom → reopen`) plus the headless banner E2E (boot → title/icon edit → Save ROM → reopen).
  All Nds4j changes are additive (no removed/renamed public API), so nothing on the NitroViewer side needed
  code changes.
  - **Free wins from the rebuild (paths the facade already exercises):** `NitroLz.encode` is now O(n) (was
    O(n²)) — the `matchCompression`/`reCompress` path (editing a large LZ-stored NCGR/NCLR/map) no longer
    crawls or hangs; `SequenceNotes` guards multi-byte reads so a truncated SSEQ degrades instead of
    throwing (piano-roll robustness); `Model` MTX-restore is bounds-safe on malformed SBC.
  - **Latent (read-only in the facade today):** `TextureSet.setPaletteColor` and the
    `MaterialColorAnimationSet` colour setters were fixed (BGR555 `>>3`; bit-15 / animated-alpha-width
    preservation) — only matters once a texture-palette or MCA-colour *editor* is added.
  - **NEW Nds4j editing API now available to surface (see §5/§9):** NFTR fonts (`NitroFont`:
    `getGlyphImage`/`renderGlyphSheet`/`renderString` to view, `setGlyphPixels`/`setWidths`/FontInfo metric
    setters to edit) and BMG text (`BinaryMessage`: decode + `Message.setText`/`setInfo`/`setParts`,
    `Escape.setType`/`setData`, `setEncoding`/`setBigEndian`). NMCR/NMAR multi-cell are parseable/editable now
    too. Both editing surfaces are backed in Nds4j by an edit-path round-trip survey + functional tests.

### Test fixtures (retail ROMs, workspace root)
- **manene** (Mime Jr., a known-good animated model): **Platinum NARC file 142, model index 51, animation 53.**
- **NSBMA/NSBVA/NSBTP** live in Platinum: e.g. romFile 139 has a model + NSBVA 81 + NSBTP 14; romFile 179
  model 0 + NSBMA 3 tints visibly. **SPA** is in Platinum `particledata` NARCs.
- 2D everything is easy to find in HeartGold `a/…` NARCs.

---

## 5. Read-side backlog (small)

- ~~Smarter model↔NSBCA pairing~~ **DONE** — by clip name (`getAnimationSetInfo` + `pickAnimByName`): a model
  scopes to the NSBCAs whose clips share its base name ("manene" ↔ "manene_aruku"), never a neighbour's; the
  picker labels each NSBCA by clip name. The game DB (§8) can still pin exact sets.
- ~~NANR: auto-select a multi-frame clip~~ **DONE** (`SpriteViewer` jumps to the first `frames > 1` clip).
- ~~"capture PNG" of the 3D view~~ **DONE**. ~~ground grid~~ **DONE** (`ModelViewer` Grid toggle + Reset view).
  Still open: model lighting/material polish (DS models are unlit — mostly N/A).
- ~~NFTR fonts, BMG text, NMCR/NMAR multi-cell surfacing~~ **DONE (2026-09-02).** `formatOf` recognizes all
  four magics; facade decode/render/edit/save methods added (`decodeBmg`/`setBmgMessage`,
  `decodeFontMeta`/`renderFontGlyphSheet`/`renderFontString`/`decodeFontGlyphPixels`/`setFontGlyphPixels`,
  `decodeNmcrMeta`/`decodeNmcr`/`decodeNmarMeta`/`decodeNmar`); three new web panels (`BmgViewer` — message
  table + text editor, escape-code-aware; `FontViewer` — glyph sheet + string preview + click-to-paint pixel
  editor; `MultiCellViewer` — NMCR/NMAR composed through a cascading NCER→NCGR/NCLR (and NMCR, for NMAR)
  auto-pair chain, mirroring `SpriteViewer`'s NCER/NANR heuristic one level deeper). Verified against real
  fixtures both at the facade layer and live in-browser (playwright): BMG/NFTR in Phantom Hourglass,
  NMCR/NMAR in White2's `a/0/0/4` NARC. New `CheerpjFacadeTextFontMultiCellTest` (JUnit) opens those specific
  ROMs by exact name (`TestRoms.requireNamed`, not the shared `-Drom.name` default) since these formats are
  rare enough that the default HeartGold fixture carries none of them.
- SPA: emitter isolation, adjustable frame count/size, background toggle.

---

## 6. 🚩 FLAGSHIP: File importing + ROM saving (the write half)

This is the big remaining half of Tinke: **replace/import files and assets, then save the modified `.nds`.**
The architecture already supports it — the facade holds a **mutable in-memory `NintendoDsRom`** per handle.
The model is: **edits accumulate in that ROM; "Save ROM" serialises and downloads the `.nds`.**

> **STATUS: COMPLETE & verified (2026-08-29).** All three phases are done and proven end-to-end (JUnit +
> headless-browser E2E). The write half now covers **every 2D/3D format**, undoable, saved via `saveRom`:
>
> | Import | Facade method | Nds4j primitive | modes |
> |---|---|---|---|
> | raw file replace | `importRaw` | `setFile` (repacks up the NARC chain) | — |
> | extract (decompressed) | `exportFile` | `maybeDecompress` | — |
> | whole NARC ⇄ folder | `exportNarcZip` / `importNarcZip` | `Narc.setFiles` + `java.util.zip` | — |
> | folder subtree extract | `exportFolderZip` | FNT walk + `java.util.zip` | — |
> | PNG → NCGR | `importPng` | `IndexedImage.applyImageMatched`/`applyImageQuantized` | match / rebuild |
> | PNG → NCLR | `importPalette` | `new Palette(Color[])` | — |
> | PNG → NSCR | `importScreenPng` | `Screen.applyImage`/`applyImageRebuildingPalette` | match / rebuild |
> | PNG → NCER / NANR | `importCellPng` / `importNanrPng` | `CellBank.applyImage`/`applyImageRebuildingPalette` | match / rebuild |
> | OBJ → NSBMD | `importObj` / `importObjTextured` | `ObjImporter` + `ModelBuilder.build{Un,}Textured` | ±texture |
>
> - **Compression is preserved on write** (`matchCompression` in `writeResource`): a slot that held LZ bytes
>   is re-compressed with the same LZ10/LZ11 type (guards `isCompressed` false-positives; keeps undo byte-exact).
> - **Undo/redo:** per-edit prior-byte snapshots (`store.undoStack`/`redoStack`); dirty clears when empty.
> - The **128 MB `byte[]` save path across CheerpJ works**: `saveRom` returns raw `byte[]` (JS gets an
>   `Int8Array` → Blob), and on failure an **empty array** — call `lastError()` (both awaited in one
>   transport `enqueue`, still serial). `openNarcAt` records `narcParent[narcHandle]` so edits repack up.
> - **CheerpJ marshalling rule (learned the hard way):** facade methods take `int/boolean/String` + a
>   **single trailing `byte[]`**; a `byte[]` in a middle position or a `(…,String,byte[],String)` shape fails
>   overload resolution (`NoSuchMethodError`). OBJ+texture is framed into one `byte[]` (`[u32 objLen][obj][img]`).

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
  - In-place NSB* edits: `G3dFile.writeBlockU8/U16` (e.g. NSBMA color keyframes, `TextureSet.setPaletteColor`).

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
  - `NitroViewerService.java` — the contract. `CheerpjFacade.java` — the implementation. Write/extract methods:
    `importRaw`, `exportFile`, `importPng`, `importPalette`, `importScreenPng`, `importCellPng`,
    `importNanrPng`, `importObj`/`importObjTextured`, `exportNarcZip`/`importNarcZip`, `exportFolderZip`,
    `saveRom`/`lastError`; `matchCompression` (LZ-preserving `writeResource`); `getAnimationSetInfo`.
  - `CheerpjFacadeTest.java` (ROM-gated, `-Drom.dir=…`) covers the write round-trips.
- `web/src/`
  - `transport/{types,cheerpj,index}.ts` — client interface + CheerpJ transport.
  - `state/store.ts` — zustand store (dirty/undo/redo, all `import*` actions); `state/pairing.ts` (+ by-name
    anim pairing); **`state/grouping.ts` + `gamedb/gamedb.json`** — the game DB (§8); `*.test.ts` for both.
  - `components/` — `InspectorPane` (format→viewer router + header Import/Export), `SpriteViewer`
    (NCGR/NSCR/NCER/NANR view **+ import**), `PaletteViewer`, `TextureViewer`, `ModelViewer` (3D + tracks +
    OBJ import + grid), `ParticleViewer`, `NarcBrowser` (per-entry + folder-zip), `TreePane` (search + folder
    extract), `InfoViewer` (hex), `SoundViewer` (SDAT browser + note-roll + WAV/live playback — see §9).
  - `sound/engine/` — the realtime AudioWorklet SSEQ engine: `stepper.ts` (bytecode VM + mixer, bit-exact
    port of Java `SequencePlayer`), `load.ts` (engine-data decode), `host.ts` (main-thread `createEngine`),
    `sseq-worklet.ts` (the `AudioWorkletProcessor`), `protocol.ts` (message types), `liveEngineSlot.ts`
    (single-live-engine bookkeeping, unit-tested — see §9). `sound/noteTrack.ts` — the note-roll canvas
    drawing (pure, tested separately from the component).
- `.github/workflows/{deploy,release-desktop}.yml` · `scripts/{build-jars,vendor-cheerpj,serve-static,serve-spike}.{sh,py}` · `Makefile`
- `web/electron/{main,serve}.cjs` — Electron shell; `scripts/vendor-cheerpj.sh` — CheerpJ 4.3 Java 8 runtime; `make build` → `release/` via electron-builder
- Memory: `~/.claude/projects/…/memory/nitroviewer-cheerpj-spike.md` (condensed quirks, kept current) and
  `nitroviewer-game-db.md` (the authoritative sprite-NARC layouts from PokEditor-Core).

---

## 8. Future: per-game asset manifest ("game DB")

**Problem.** Today the app *guesses* how related files pair up — `state/pairing.ts` (`pickSibling`,
`pickNearestAfter`) picks NCGR/NCLR/NCER siblings by index proximity, and per-entry render facts are
inferred at view time (tile width, 4bpp sub-palette, and — as the `trbgra.narc` case showed — whether an
NCGR is scanned). That's fragile: the correct **tile width** is often un-guessable (an NCGR is a linear
strip until you pick the right width), a NANR's real **NCER/NCGR/NCLR** may not be its index-neighbours,
and 3D **model↔texture↔animation** sets pair by a nearest-index heuristic that's "sometimes wrong" (§5).

**Concept.** Ship a declarative **game DB**: JSON, keyed by 4-char game code, that *declares* how the
sibling files in a NARC group into renderable units, plus per-unit/per-entry render hints. Resolution is
**manifest-first, heuristic-fallback** — a known game/NARC returns exact answers; anything unlisted falls
back to today's `pairing.ts` rules, so coverage can grow incrementally without regressing unknown ROMs.
The whole point: **clicking a NANR resolves to exactly the NCGR + NCLR + NCER (and the tile width) to
load — no guessing.**

### Where it lives / how it plugs in
- Frontend data: `web/src/gamedb/*.json` (one file per game, or a bundled `gamedb.json`), loaded at boot
  and cached. It's pure data behind the transport, so an HTTP backend could serve it later unchanged.
- A resolver — `web/src/state/grouping.ts` — exposes `resolveUnit(gameCode, narcPath, ref): AssetUnit | null`.
  The store consults it in `select()` / the viewers' auto-pair effects **before** `pairing.ts`. When it
  returns `null`, the existing heuristic runs (unchanged).
- Keying: `romInfo.gameCode` (already in the store). Support region-agnostic entries via a trailing `*`
  wildcard (`"CPU*"` = Platinum all regions); exact code wins over wildcard. NARCs are addressed by **FNT
  path** when named (DPPt: `/poketool/trgra/trbgra.narc`) or by numbered FNT path (HGSS: `a/0/0/4`).

### Schema sketch (v1)
```jsonc
{
  "version": 1,
  "games": {
    "CPU*": {                                    // Pokémon Platinum, any region
      "title": "Pokémon Platinum",
      "narcs": {
        "/poketool/trgra/trbgra.narc": {
          "role": "sprite-set",
          // The NARC holds equal-length runs of each format, in this order; unit i = the i-th entry of
          // each run (nclr[i], ncgr[i], ncer[i], nanr[i]). Counts inferred from the detected runs, or set `count`.
          "grouping": { "strategy": "lockstep", "order": ["NCLR", "NCGR", "NCER", "NANR"] },
          "render":   { "tileWidth": 20, "transparent": true },   // per-unit defaults
          "entries":  { "19": { "scanned": true, "role": "bitmap-sprite" } }  // per-index overrides
        }
      },
      "models": {
        "/poketool/pokegra/…": {
          // 3D set: which NSBMD pairs with which NSBTX/NSBCA and driven tracks
          "grouping": { "strategy": "model-set",
                        "model": "NSBMD", "texture": "embedded|NSBTX",
                        "anim": "NSBCA", "tracks": ["NSBMA", "NSBVA", "NSBTP"] }
        }
      }
    }
  }
}
```

### Grouping strategies (extensible)
- **`lockstep`** — equal-length runs of each format in a stated `order`; unit i aligns the i-th of each.
  (The common Pokémon layout: a block of NCLR, then NCGR, then NCER, then NANR.)
- **`interleaved`** — entries repeat a fixed pattern per unit, e.g. `["NCLR","NCGR","NCER","NANR"]`.
- **`explicit`** — an array of units with exact indices: `[{ "nclr":1, "ncgr":19, "ncer":32, "nanr":43 }]`.
- **`model-set`** — 3D: pair NSBMD with its NSBTX/NSBCA/tracks (declared, replacing `pickNearestAfter`).

### Data split across NARCs (cross-NARC units)
A unit's parts are often in **different NARCs** — e.g. models in `build_model.narc` and their textures in
`build_model_tex.narc`, aligned by index; or Pokémon where the NSBMD and its NSBTX live in parallel
archives. The `(container, id)` facade calls **already** accept a different open NARC per role (each ref is
independent — `exportModelGltf` takes separate `nsbmd`/`nsbtx`/`nsbca` refs, `decodeNcgr` separate
`ncgr`/`nclr` refs), so nothing in the transport or Java changes. The manifest expresses it, and the
resolver opens the sibling NARC on demand. Model each role as `{ narc, format, index }` (omit `narc` to
mean "this NARC") under a top-level `sets` list:

```jsonc
"sets": [
  {
    "role": "model-set",
    "align": "index",                 // unit i = index i in each member (see alignments below)
    "members": {
      "model":   { "narc": "/data/build_model.narc",     "format": "NSBMD" },
      "texture": { "narc": "/data/build_model_tex.narc", "format": "NSBTX" },
      "anim":    { "narc": "/data/build_model_anim.narc","format": "NSBCA" }
    },
    "render": { "unlit": true }
  }
]
```
Click NSBMD `#i` in `build_model.narc` → resolver finds the set whose `model.narc` matches, and returns
`{ model: (build_model,i), texture: (build_model_tex,i), anim: (build_model_anim,i) }` — refs spanning
three containers. Intra-NARC groupings are just the degenerate case where every member omits `narc`.

**Member alignments** (how a member's index is derived from the clicked unit's index `i`):
- **`index`** — parallel archives, member index = `i` (the common case).
- **`offset`** — member index = `i + k` (per-member constant), for archives that lead/lag.
- **`explicit`** — a per-unit index table when there's no arithmetic relation.
- **`by-name`** — match by the internal asset name (NSBMD material texture-names ↔ the NSBTX's texture
  names; NSBMD model name ↔ NSBCA name). Robust when archives aren't index-aligned; a good heuristic
  fallback even without a manifest.

**Resolver/store implications** (the one new piece of plumbing):
- Manifest references NARCs by **FNT path**, so the resolver first maps path → `romFileId` (walk the tree)
  → `store.ensureNarc(romFileId)` to get/open each member NARC's handle. A cross-NARC unit therefore may
  **open a second (or third) NARC lazily** the first time it's resolved; cache the handles (the store
  already memoises `fileToNarc`).
- `resolveUnit` returns refs whose `container` fields are **different narc handles** — the viewers already
  pass per-role refs straight through, so `ModelViewer`/`SpriteViewer` need only stop assuming siblings
  share the selection's container (today `siblingsOfFormat` scans one container; it gains a manifest path
  that pulls candidates from the member NARCs instead).

### Render hints (stop guessing these too)
Per-unit or per-entry: **`tileWidth`** (the big one — kills the "linear strip" problem), `bitDepth`,
`paletteIndex` (4bpp sub-palette), `transparent`, and **`scanned`** (so the bitmap-NCGR path in
`decodeNcer`/`decodeNanr` is chosen from data, not sniffed). These flow into the existing decode calls.

### Resolution, for "click NANR/NSBMD at (narc, id)"
1. `gameCode` → best game key (exact, else `*`-wildcard).
2. Selected NARC's FNT path → look for a matching `narcs[path]` (intra-NARC) **or** a `sets` entry whose
   member `narc` matches (cross-NARC).
3. Apply the `grouping`/`align` strategy to find the unit containing this file → refs for every role
   (possibly across containers) + render hints, e.g. `{ nclr, ncgr, ncer, tileWidth }` or
   `{ model, texture, anim }`. For cross-NARC members, `ensureNarc` the member archives to get their handles.
4. Any miss (unknown game / NARC / entry) → fall back to `pairing.ts` + view-time inference.

### Authoring & growth
- Seed it from the cases already learned (trbgra scanned + tile widths; HG player-sprite widths) and grow
  per game. The store already records **manual `pairingOverrides`** (and, after the tile-width fix, the
  user's chosen tile width) — a small "export overrides → manifest stub" dev action could turn hands-on
  corrections into DB entries, so the app *learns* the right groupings once and never re-guesses.
- Community-editable: adding a game is just adding a JSON file; no code change. Consider a lightweight
  schema (`$schema` + CI validation) so contributed entries stay well-formed.

---

## 9. Open items (snapshot)

A single up-to-date list of what's left. Details live in the referenced sections. **Much of the 2026-08-29
batch below is now done** (marked ✅); the residual work is called out under each.

**Write/edit (§6) — the write half is COMPLETE.** ✅ PNG→NCGR/NCLR, ✅ NSCR background (`importScreenPng`,
match/rebuild), ✅ NCER/NANR composed cell + animation frame (`importCellPng`/`importNanrPng`, match/rebuild —
per-OAM sub-palettes, slot 0 transparent), ✅ OBJ→NSBMD **±texture** (`importObj`/`importObjTextured`), ✅
palette import, ✅ raw extract/replace of any file (`exportFile`), ✅ whole-NARC + folder ZIP
(`exportNarcZip`/`importNarcZip`/`exportFolderZip`), ✅ **LZ compression preserved on write**
(`matchCompression`), ✅ undo/redo, ✅ Save ROM. All verified JUnit + headless-browser E2E (see §6 table).
**Remaining:**
- **glTF → NSBMD** import — the app *exports* glTF; import needs a glTF **mesh reader** (accessors → the same
  `ModelBuilder` path). Batch import from an unpacked folder. A whole-ROM zip via a `byte[]`-out path (the
  folder extract uses base64-in-JSON — fine for subtrees, heavy for a full 100 MB+ ROM).

**✅ Per-game asset manifest / "game DB" (§8) — built.** `state/grouping.ts` (`resolveGame`/`resolveNarcInfo`/
`resolveRenderHints`/`resolveSpriteUnit`+`groupUnit`) + `gamedb/gamedb.json`, keyed by game code with `*`
wildcards. **Manifest-first, `pairing.ts` heuristic-fallback.** Wired into SpriteViewer: a **"◆ Game DB"
badge**, render hints (transparent/scanned/tileWidth/paletteIndex) seed the view, and declared groupings
resolve the sibling unit. Seeded with Platinum trainer/pokemon sprite NARCs (`grouping.test.ts` covers the
strategies). **Residual:** grow coverage (only render-hint entries seeded; irregular NARCs still use the
heuristic), cross-NARC `sets` resolution (schema + resolver stubs exist; not yet consumed by ModelViewer),
and the "export overrides → manifest stub" dev action.

**✅ Model↔NSBCA pairing — by-name.** New facade `getAnimationSetInfo` exposes NSBCA clip names; ModelViewer
fetches them and `pickAnimByName` picks the lowest-index NSBCA whose clips share the model's base name
("manene" ↔ "manene_aruku"), never a neighbour's ("kami_pur"), falling back to nearest-index. The picker now
**labels each NSBCA by its clip name**. *(Nds4j exports NSBMD as rigid **node** animation, never glTF skins —
no vertex-skinned models, so don't chase GPU/CPU skinning.)*

**Read-side polish (§5).** ✅ **Ground grid** + Reset-view in ModelViewer (Grid toggle; grid sized to the
model). Remaining: SPA emitter isolation / adjustable frame count/size / background toggle; NANR default-clip
edge cases. (DS models are unlit by design — no lighting to add.)

**✅ Sound (SDAT).** SDAT / SSEQ / SWAR / SWAV / STRM listeners over Nds4j's sequenced-audio stack:
browse sequences / wave archives / streams / banks; play a sequence or a wave / stream; a canvas **note
track** (piano-roll) for SSEQ with live note glow + gutter highlighting while a track is sounding;
**Import WAV** over a wave in an SDAT (or a standalone SWAR/SWAV); export MIDI / SoundFont.

**✅ Realtime AudioWorklet engine (constant-memory playback).** `web/src/sound/engine/` (`stepper.ts`,
`load.ts`, `host.ts`, `sseq-worklet.ts`, `protocol.ts`) is a from-scratch JS port of the Java
`SequencePlayer` bytecode VM, running on an `AudioWorkletProcessor` — bit-exact against the Java reference
render (`stepper.fixtures.test.ts`, 5 real Platinum sequences incl. two dense/long ones, 100% sample match).
Two playback paths in `SoundViewer.tsx`:
- **Default:** Play renders the whole sequence to WAV Java-side (one playthrough to the loop point) and
  plays that — simple, but the render + resulting `AudioBuffer` scale with song length.
- **Live engine:** used for mute/solo always (so they're actually audible, not just a note-roll
  highlight), and for **Play and seeking too** when `isDemandingSequence()` flags the sequence — routes
  straight to the live engine, skipping the WAV render entirely.
- **Why "demanding" exists:** rendering a long/dense sequence to WAV crashed real iOS Safari sessions
  (`SEQ_PL_BA_GIRA` and `SEQ_D_MOUNT1` in Platinum, both real user reports) — the base64 blob through the
  CheerpJ bridge plus the resulting `AudioBuffer` is fine on desktop but too much for iOS's tighter per-tab
  memory ceiling. `isDemandingSequence()` (in `SoundViewer.tsx`) checks note count **or** an estimated
  render duration (tick/tempo/loop-aware, no render needed — `estimateTiming()`) against thresholds
  calibrated off real measured renders of both crash cases plus two known-safe controls; note count alone
  wasn't a reliable enough signal (`SEQ_D_MOUNT1` crashed with fewer notes than one safe control). Export
  WAV can't route around this the same way — exporting audio requires actually rendering it — so it warns
  (`window.confirm`) before rendering a demanding sequence instead.
- **`LiveEngineSlot`** (`sound/engine/liveEngineSlot.ts`, unit-tested) owns the single live `EngineHandle`
  and guarantees its `onPosition` subscription is torn down whenever it stops being current. This exists
  because `AudioWorkletNode` has no `stop()` — `disconnect()` doesn't guarantee the node's position
  postMessages stop right away — and an earlier version of this code forgot to unsubscribe on
  switch/stop, which let a "zombie" engine's stale elapsed time keep clobbering `liveSeconds` for
  whatever sequence was actually on screen (reproduced as the note-roll playhead teleporting to unrelated
  positions, worse the more sequences you'd switched through). Fixed + regression-tested; **there's still
  no component-test harness for `SoundViewer.tsx` itself** (`vitest.config.ts` is deliberately DOM-free/
  pure-logic-only), so this class is how that invariant stays testable — keep extracting logic this way
  rather than adding jsdom/RTL for one component.
- **Known gap:** the demanding-sequence duration estimate is tempo-constant; a sequence with mid-song
  tempo-change events will be under-estimated (ticks/tempo only reflect the *initial* tempo) — the
  note-count check is the backstop for that case, not a fully independent signal.

**Larger gaps.** ~~**NFTR** fonts, **BMG** text, and **NMCR/NMAR** multi-cell~~ **DONE (2026-09-02)** — see §5.
**glTF import** — needs a glTF accessor/mesh reader (still a real RE task). **Bitmap-OBJ NCER composition** — so
scanned sprites (DPPt trbgra) compose per-cell instead of the raw-bitmap fallback (a Nds4j RE task).
*(Note: the NCER/NANR **write-back** that used to be listed here is DONE — §6; only the scanned-bitmap
compose is still blocked.)*

**Game DB residual.** Grow coverage per game (only render-hint/grouping entries seeded so far); cross-NARC
`sets` resolution (schema + resolver stubs exist, not yet consumed by ModelViewer); an "export overrides →
manifest stub" dev action. The **D/P battle-sprite scan direction** fix already ships via the game DB.

**UX niceties.** ✅ **Width (px)** control; ✅ filesystem search; ✅ hex viewer; ✅ cross-file live invalidation
(`editVersion` re-decodes every viewer after any import). Remaining: the NANR import edits the frame's *cell*
(cell-sized image), not the transformed frame canvas — functional but slightly indirect.

**Tech debt — mobile/iOS header crowding.** The write-half controls added to the top bar (Undo/Redo,
Save ROM, dirty badge, status) have made the header cramped on narrow screens and worsened the already-shaky
iOS layout. Needs a responsive pass: collapse Undo/Redo to icon-only (or an overflow/"⋯" menu) below a
breakpoint, and re-check the topbar wrap/scroll on iOS Safari. (See the iOS 3D notes in the CheerpJ memory.)

**SEO / discoverability.** On-page is **done**, now incl. ✅ **`FAQPage` JSON-LD** (mirrors the visible FAQ)
+ ✅ **`softwareVersion`**/`isAccessibleForFree`. What's left is **off-platform** (needs the owner):
- Verify the site in **Google Search Console + Bing Webmaster** and submit `sitemap.xml` (paste a
  verification token and I'll add the meta tag; the submission itself is yours).
- **Backlinks:** link nitroviewer.com from the Nds4j README and DS/Pokémon romhacking communities; set the
  GitHub repo **description + topics**. A **Lighthouse** pass for Core Web Vitals.
