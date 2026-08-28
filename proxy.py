#!/usr/bin/env python3
"""FINN vNext local fallback server.

Serves the app (index.html & friends) and forwards GET /api/* to
https://www.finn.com/api/* server-side, so the browser never hits CORS.
Python 3 standard library only. Usage:

    python proxy.py            # http://localhost:8020
    python proxy.py 9000       # custom port
"""
import sys
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

UPSTREAM = "https://www.finn.com/api"   # fixed upstream — this is NOT an open proxy
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8020
HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "host",
    "accept-encoding", "content-length",
}


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; "
            "connect-src 'self' https:; object-src 'none'; base-uri 'none'; "
            "frame-ancestors 'none'; form-action 'self'",
        )
        super().end_headers()

    def do_GET(self):
        if self.path == "/api" or self.path.startswith("/api/"):
            self.forward()
        else:
            super().do_GET()

    def forward(self):
        url = UPSTREAM + self.path[len("/api"):]
        req = urllib.request.Request(url, method="GET")
        for name, value in self.headers.items():
            if name.lower() not in HOP_BY_HOP:
                req.add_header(name, value)
        req.add_header("User-Agent", "finn-vnext-proxy/1.0")
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                body = res.read()
                self.send_response(res.status)
                ctype = res.headers.get("Content-Type", "application/json")
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
        except urllib.error.HTTPError as e:
            body = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", e.headers.get("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except OSError as e:
            body = ('{"error":"upstream unreachable: %s"}' % e).encode()
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # Windows cp1252 consoles
        except (AttributeError, OSError):
            pass
    print(f"FINN vNext - http://localhost:{PORT}  (forwarding /api/* -> {UPSTREAM})")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
