#!/usr/bin/env python3
"""Static server for the CheerpJ spike.

Serves ./spike as the web root (so CheerpJ's /app mount maps to it). Two things CheerpJ needs that
Python's stock handler doesn't do out of the box:

  * NO COOP/COEP. CheerpJ 4.x runs single-threaded without cross-origin isolation, and require-corp
    blocks CheerpJ's own cross-origin helper iframe (c.html) with ERR_BLOCKED_BY_RESPONSE.
  * HTTP Range (206) support. CheerpJ streams the jars with byte-range requests and refuses to run
    ("HTTP server does not support the 'Range' header") against a server that only answers 200.
"""
import http.server
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "spike")


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
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"Serving {ROOT} at http://localhost:{port}  (Ctrl+C to stop)")
    http.server.HTTPServer(("127.0.0.1", port), Handler).serve_forever()
