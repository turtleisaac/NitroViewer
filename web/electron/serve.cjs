"use strict";

// Tiny static server with HTTP Range/206 and no COOP/COEP — the combination CheerpJ
// needs to load the jars. Mirrors scripts/serve-static.py; Electron cannot load the
// SPA from file:// because CheerpJ refuses hosts that don't answer Range.

const fs = require("fs");
const http = require("http");
const path = require("path");

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jar": "application/java-archive",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".list": "text/plain; charset=utf-8",
  ".map": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".ttc": "font/collection",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
  ".xml": "application/xml",
};

const CDN_LOADER = "https://cjrtnc.leaningtech.com/4.3/loader.js";

function cheerpjDir(webRoot) {
  const bundled = path.join(webRoot, "cheerpj");
  if (fs.existsSync(path.join(bundled, "loader.js"))) return bundled;
  const nextToApp = path.join(__dirname, "..", "vendor", "cheerpj");
  if (fs.existsSync(path.join(nextToApp, "loader.js"))) return nextToApp;
  return null;
}

function rewriteIndex(html, localCheerpj) {
  if (!localCheerpj) return html;
  return html
    .replaceAll(CDN_LOADER, "/cheerpj/loader.js")
    .replace(/\s*<link rel="preconnect" href="https:\/\/cjrtnc\.leaningtech\.com"[^>]*>/g, "")
    .replace(/\s*<link rel="dns-prefetch" href="https:\/\/cjrtnc\.leaningtech\.com"[^>]*>/g, "");
}

function contentType(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function resolvePath(root, urlPath, localCheerpj) {
  const decoded = decodeURIComponent((urlPath || "/").split("?")[0]);
  let rel = decoded.replace(/^\/+/, "");
  if (rel === "" || rel.endsWith("/")) rel = path.join(rel, "index.html");
  const posix = rel.split(path.sep).join("/");
  if (localCheerpj && (posix === "cheerpj" || posix.startsWith("cheerpj/"))) {
    const rest = posix === "cheerpj" ? "" : posix.slice("cheerpj/".length);
    const abs = path.resolve(localCheerpj, rest);
    const rootAbs = path.resolve(localCheerpj);
    if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return null;
    return { filePath: abs, underCheerpj: true };
  }
  const abs = path.resolve(root, rel);
  const rootAbs = path.resolve(root);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return null;
  return { filePath: abs, underCheerpj: false };
}

function send(res, status, headers, body) {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    "Accept-Ranges": "bytes",
    ...headers,
  });
  if (body === undefined) res.end();
  else res.end(body);
}

function handle(root, req, res, localCheerpj) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, { Allow: "GET, HEAD" });
    return;
  }

  const resolved = resolvePath(root, req.url || "/", localCheerpj);
  if (!resolved) {
    send(res, 403, { "Content-Type": "text/plain" }, "Forbidden");
    return;
  }
  const { filePath, underCheerpj } = resolved;

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    // Official CheerpJ CDN answers 204 for missing runtime files; match that so
    // omitted optional assets (Noto fonts, Java 11/17, Tailscale) don't abort init.
    if (underCheerpj) {
      send(res, 204, {});
      return;
    }
    send(res, 404, { "Content-Type": "text/plain" }, "Not found");
    return;
  }
  if (stat.isDirectory()) {
    const index = path.join(filePath, "index.html");
    try {
      stat = fs.statSync(index);
    } catch {
      if (underCheerpj) {
        send(res, 204, {});
        return;
      }
      send(res, 404, { "Content-Type": "text/plain" }, "Not found");
      return;
    }
    return serveFile(req, res, index, stat, localCheerpj);
  }
  serveFile(req, res, filePath, stat, localCheerpj);
}

function serveFile(req, res, filePath, stat, localCheerpj) {
  if (path.basename(filePath) === "index.html" && localCheerpj) {
    const html = rewriteIndex(fs.readFileSync(filePath, "utf8"), localCheerpj);
    const buf = Buffer.from(html);
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": buf.length,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    });
    if (req.method === "HEAD") res.end();
    else res.end(buf);
    return;
  }

  const size = stat.size;
  const type = contentType(filePath);
  const rng = req.headers.range;
  const isHead = req.method === "HEAD";

  if (!rng) {
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": size,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    });
    if (isHead) {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const m = /^\s*bytes=(\d*)-(\d*)\s*$/i.exec(rng);
  if (!m) {
    send(res, 416, { "Content-Range": `bytes */${size}` });
    return;
  }
  let start = m[1] ? parseInt(m[1], 10) : 0;
  let end = m[2] ? parseInt(m[2], 10) : size - 1;
  end = Math.min(end, size - 1);
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
    send(res, 416, { "Content-Range": `bytes */${size}` });
    return;
  }
  const length = end - start + 1;
  res.writeHead(206, {
    "Content-Type": type,
    "Content-Range": `bytes ${start}-${end}/${size}`,
    "Content-Length": length,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  });
  if (isHead) {
    res.end();
    return;
  }
  fs.createReadStream(filePath, { start, end }).pipe(res);
}

function startServer(root) {
  const localCheerpj = cheerpjDir(root);
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        handle(root, req, res, localCheerpj);
      } catch (err) {
        if (!res.headersSent) send(res, 500, { "Content-Type": "text/plain" }, "Internal error");
        else res.destroy();
        req.destroy();
        console.error(err);
      }
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, url: `http://127.0.0.1:${addr.port}/` });
    });
  });
}

module.exports = { startServer, cheerpjDir };
