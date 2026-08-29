#!/usr/bin/env python3
"""Range-capable static server for previewing a production build at domain root.

Usage: serve-static.py <dir> [port]

Serves <dir> at the origin root (so CheerpJ's /app mount + absolute /jars paths resolve exactly as
they will on the custom domain) with HTTP Range/206 support and no COOP/COEP — the combination
CheerpJ needs. Mirrors how GitHub Pages serves the site at nitroviewer.com.
"""
import http.server
import os
import re
import sys

ROOT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else "."
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8080


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def do_GET(self):
        rng = self.headers.get("Range")
        path = self.translate_path(self.path)
        if not rng or not os.path.isfile(path):
            return super().do_GET()
        size = os.path.getsize(path)
        m = re.match(r"bytes=(\d*)-(\d*)$", rng.strip())
        if not m:
            return super().do_GET()
        start = int(m.group(1)) if m.group(1) else 0
        end = int(m.group(2)) if m.group(2) else size - 1
        end = min(end, size - 1)
        if start > end or start >= size:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return
        length = end - start + 1
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(length))
        self.end_headers()
        with open(path, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(65536, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)


if __name__ == "__main__":
    print(f"Serving {ROOT} at http://localhost:{PORT}")
    http.server.HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
