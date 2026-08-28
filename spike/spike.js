/*
 * NitroViewer CheerpJ spike glue. Throwaway Phase-0 code — proves Nds4j runs in a WASM JVM and
 * measures it. The real v1 frontend hides all of this behind a transport interface.
 */

const CLASSPATH = "/app/jars/nitroviewer-core.jar:/app/jars/Nds4j.jar";
const FACADE_CLASS = "com.nitroviewer.core.SpikeFacade";

const $ = (id) => document.getElementById(id);
const status = (msg) => { $("status").textContent = msg; };

const metrics = [];
function metric(label, value, verdict) {
  metrics.push({ label, value, verdict });
  const rows = metrics.map((m) => {
    const cls = m.verdict ? ` class="${m.verdict}"` : "";
    return `<tr><td>${m.label}</td><td${cls}>${m.value}</td></tr>`;
  });
  $("metrics").innerHTML = rows.join("");
}

const ms = (n) => `${n.toFixed(0)} ms`;
// Thresholds from the plan's Phase-0 gate table.
const verdictFor = (key, n) => {
  const t = { init: [5000, 12000], open: [3000, 8000], tree: [500, 1500], decode: [300, 1000] }[key];
  if (!t) return "";
  return n <= t[0] ? "ok" : n <= t[1] ? "warn" : "bad";
};

let facade = null;

async function boot() {
  const t0 = performance.now();
  status("Initialising CheerpJ runtime…");
  await cheerpjInit();
  status("Loading Nds4j + facade jars…");
  const cj = await cheerpjRunLibrary(CLASSPATH);
  facade = await cj.com.nitroviewer.core.SpikeFacade;
  const initMs = performance.now() - t0;
  metric("CheerpJ init + load", ms(initMs), verdictFor("init", initMs));
  status("Ready. Pick a .nds ROM — it stays in this tab.");
  const input = $("rom");
  input.disabled = false;
  input.addEventListener("change", onRomPicked);
}

async function onRomPicked(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    metrics.length = 0;
    $("metrics").innerHTML = "";
    metric("ROM file", `${file.name} (${(file.size / 1048576).toFixed(1)} MB)`);

    status(`Reading ${file.name}…`);
    let t = performance.now();
    // Java byte is SIGNED: CheerpJ maps Int8Array -> byte[]. A Uint8Array fails overload
    // resolution the moment it holds a value > 127 (which every ROM does).
    const bytes = new Int8Array(await file.arrayBuffer());
    metric("read file → bytes", ms(performance.now() - t));

    // Every Java call returns a Promise.
    status("Parsing ROM (NintendoDsRom)…");
    t = performance.now();
    const openRes = JSON.parse(await facade.openRom(bytes));
    const openMs = performance.now() - t;
    metric("openRom (parse)", ms(openMs), verdictFor("open", openMs));
    metric(
      "byte[] received",
      `${(openRes.len / 1048576).toFixed(1)} MB`,
      openRes.len === file.size ? "ok" : "bad"
    );
    if (!openRes.ok) throw new Error("openRom failed: " + openRes.error);
    const handle = openRes.handle;

    const info = JSON.parse(await facade.getRomInfo(handle));
    metric("title / gameCode", `${info.title || "—"} / ${info.gameCode || "—"}`);
    metric("files in ROM", String(info.numFiles));

    status("Walking FNT tree…");
    t = performance.now();
    const treeJson = await facade.listTree(handle);
    const treeMs = performance.now() - t;
    metric("listTree", ms(treeMs), verdictFor("tree", treeMs));
    renderTree(JSON.parse(treeJson));

    status("Scanning ROM for a sprite…");
    t = performance.now();
    const sprite = JSON.parse(await facade.decodeFirstSprite(handle));
    metric("scan+decode (whole ROM)", ms(performance.now() - t));
    renderSprite(sprite);

    // Honest per-sprite cost: re-decode the exact pair we just found, no whole-ROM scan.
    if (!sprite.error) {
      t = performance.now();
      await facade.decodeSprite(handle, sprite.romFileId, sprite.ncgrIndex, sprite.nclrIndex);
      const decodeMs = performance.now() - t;
      metric("decode one sprite", ms(decodeMs), verdictFor("decode", decodeMs));
    }

    if (performance.memory) {
      const mb = (performance.memory.usedJSHeapSize / 1048576).toFixed(0);
      metric("JS heap in use", `${mb} MB`);
    }
    status("Done. See metrics + decoded sprite.");
  } catch (err) {
    console.error(err);
    status("ERROR: " + (err && err.message ? err.message : err));
    metric("result", "FAILED", "bad");
  }
}

function renderTree(root) {
  let folders = 0, files = 0;
  const html = (node) => {
    let s = `<details open><summary>${esc(node.name)}/</summary>`;
    for (const f of node.folders) { folders++; s += html(f); }
    for (const file of node.files) {
      files++;
      s += `<div class="file">${esc(file.name)} <span class="id">#${file.id}</span></div>`;
    }
    return s + "</details>";
  };
  const body = html(root);
  $("tree").innerHTML = `<div style="color:#7f8695;margin-bottom:8px">${folders} folders · ${files} files</div>${body}`;
  // Collapse everything but the root so a big ROM tree stays navigable.
  $("tree").querySelectorAll("details details").forEach((d) => d.removeAttribute("open"));
}

function renderSprite(s) {
  const canvas = $("sprite");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (s.error) {
    $("spriteMeta").innerHTML = `<span class="bad">${esc(s.error)}</span>`;
    return;
  }
  const img = new Image();
  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0);
  };
  img.src = s.png;
  $("spriteMeta").innerHTML =
    `<code>${esc(s.narcName || "ROM file #" + s.romFileId)}</code><br>` +
    `NCGR #${s.ncgrIndex} + NCLR #${s.nclrIndex} · ${s.width}×${s.height}px`;
}

const esc = (str) =>
  String(str).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

boot().catch((err) => {
  console.error(err);
  status("Boot failed: " + (err && err.message ? err.message : err));
});
