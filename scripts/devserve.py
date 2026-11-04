#!/usr/bin/env python3
"""Static dev server for golf-swing-lab (python3 stdlib only).

Serves --root under --prefix (default /golf-swing-lab/), the same layout as GitHub Pages:

    python3 scripts/devserve.py --bind 127.0.0.1 --port 8790 --root dist --prefix /golf-swing-lab/

* every path outside the prefix is 404; the prefix without its trailing slash redirects (301) to it
* GET and HEAD only; no directory listing (a directory serves its index.html or is 404)
* path traversal safe: '..' segments, NUL, backslashes and symlinks that leave --root are 404
* sw.js and index.html are sent with Cache-Control: no-cache
* refuses to bind a wildcard address (0.0.0.0, ::) unless --allow-all is given
"""
import argparse
import email.utils
import http.server
import mimetypes
import os
import socket
import stat
import sys
import urllib.parse
from datetime import timezone

MIME = {
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".wasm": "application/wasm",
    ".task": "application/octet-stream",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".bin": "application/octet-stream",
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".map": "application/json",
    ".ico": "image/x-icon",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".woff2": "font/woff2",
}
NO_CACHE_NAMES = {"sw.js", "index.html"}
WILDCARD_ADDRS = {"", "0.0.0.0", "::", "0:0:0:0:0:0:0:0"}


def normalize_prefix(prefix):
    segs = [s for s in prefix.split("/") if s]
    if any(s in (".", "..") for s in segs):
        raise ValueError("--prefix must not contain '.' or '..' segments")
    return "/" + "/".join(segs) + ("/" if segs else "")


def content_type(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in MIME:
        return MIME[ext]
    guessed = mimetypes.guess_type(path)[0]
    return guessed or "application/octet-stream"


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "gsl-devserve"
    sys_version = ""
    root = ""          # real path of --root, set in main()
    prefix = "/"       # normalized, leading and trailing slash

    # ---- responses -------------------------------------------------------
    def _reply(self, code, body=b"", ctype="text/plain; charset=utf-8", extra=(), send_body=True):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in extra:
            self.send_header(k, v)
        self.end_headers()
        if send_body and body:
            self.wfile.write(body)

    def _not_found(self, send_body=True):
        self._reply(404, b"404 Not Found\n", send_body=send_body)

    # ---- request handling ------------------------------------------------
    def _locate(self):
        """Return (kind, value): ('redirect', url) | ('file', realpath) | ('404', None) | ('400', None)."""
        raw = self.path.split("#", 1)[0]
        raw_path, _, query = raw.partition("?")
        try:
            path = urllib.parse.unquote(raw_path, errors="strict")
        except UnicodeDecodeError:
            return "400", None
        if "\x00" in path or "\\" in path or not path.startswith("/"):
            return "404", None
        if self.prefix != "/" and path == self.prefix[:-1]:
            return "redirect", self.prefix + ("?" + query if query else "")
        if not path.startswith(self.prefix):
            return "404", None
        rel = path[len(self.prefix):]
        segs = [s for s in rel.split("/") if s not in ("", ".")]
        if any(s == ".." for s in segs):
            return "404", None
        target = os.path.join(self.root, *segs) if segs else self.root
        real = os.path.realpath(target)
        if real != self.root and not real.startswith(self.root + os.sep):
            return "404", None
        try:
            st = os.stat(real)
        except OSError:
            return "404", None
        if stat.S_ISDIR(st.st_mode):
            index = os.path.realpath(os.path.join(real, "index.html"))
            if index != self.root and not index.startswith(self.root + os.sep):
                return "404", None
            try:
                st = os.stat(index)
            except OSError:
                return "404", None  # no index.html: never list the directory
            if segs and not path.endswith("/"):
                return "redirect", path + "/" + ("?" + query if query else "")
            real = index
        if not stat.S_ISREG(st.st_mode):
            return "404", None
        return "file", real

    def _serve(self, send_body):
        kind, value = self._locate()
        if kind == "400":
            return self._reply(400, b"400 Bad Request\n", send_body=send_body)
        if kind == "404":
            return self._not_found(send_body)
        if kind == "redirect":
            return self._reply(301, b"", extra=[("Location", value)], send_body=False)
        try:
            f = open(value, "rb")
        except OSError:
            return self._not_found(send_body)
        with f:
            st = os.fstat(f.fileno())
            headers = [
                ("Last-Modified", email.utils.formatdate(st.st_mtime, usegmt=True)),
            ]
            if os.path.basename(value) in NO_CACHE_NAMES:
                headers.append(("Cache-Control", "no-cache"))
            ims = self.headers.get("If-Modified-Since")
            if ims:
                try:
                    t = email.utils.parsedate_to_datetime(ims)
                    if t.tzinfo is None:
                        t = t.replace(tzinfo=timezone.utc)
                    if int(st.st_mtime) <= int(t.timestamp()):
                        self.send_response(304)
                        for k, v in headers:
                            self.send_header(k, v)
                        self.send_header("Content-Length", "0")
                        self.end_headers()
                        return
                except (TypeError, ValueError, OverflowError):
                    pass
            self.send_response(200)
            self.send_header("Content-Type", content_type(value))
            self.send_header("Content-Length", str(st.st_size))
            self.send_header("X-Content-Type-Options", "nosniff")
            for k, v in headers:
                self.send_header(k, v)
            self.end_headers()
            if send_body:
                while True:
                    chunk = f.read(1 << 16)
                    if not chunk:
                        break
                    self.wfile.write(chunk)

    def do_GET(self):
        self._serve(True)

    def do_HEAD(self):
        self._serve(False)

    def _not_allowed(self):
        self._reply(405, b"405 Method Not Allowed\n", extra=[("Allow", "GET, HEAD")])

    do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = _not_allowed

    def version_string(self):
        return self.server_version

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


class Server(http.server.ThreadingHTTPServer):
    allow_reuse_address = True

    def __init__(self, addr, handler):
        if ":" in addr[0]:
            self.address_family = socket.AF_INET6
        super().__init__(addr, handler)


def main(argv=None):
    ap = argparse.ArgumentParser(description="golf-swing-lab static dev server")
    ap.add_argument("--bind", default="127.0.0.1", help="address to bind (default 127.0.0.1)")
    ap.add_argument("--port", type=int, default=8790, help="port (default 8790)")
    ap.add_argument("--root", default="dist", help="directory to serve (default dist)")
    ap.add_argument("--prefix", default="/golf-swing-lab/", help="URL prefix the root is served under")
    ap.add_argument("--allow-all", action="store_true",
                    help="allow binding a wildcard address such as 0.0.0.0 (exposes the server to the network)")
    args = ap.parse_args(argv)

    if args.bind in WILDCARD_ADDRS and not args.allow_all:
        print("devserve: refusing to bind %r (all interfaces); use --bind 127.0.0.1 or pass --allow-all"
              % args.bind, file=sys.stderr)
        return 2
    try:
        prefix = normalize_prefix(args.prefix)
    except ValueError as e:
        print("devserve: %s" % e, file=sys.stderr)
        return 2
    root = os.path.realpath(args.root)
    if not os.path.isdir(root):
        print("devserve: root %r is not a directory (run node scripts/build.mjs --dev first?)" % args.root,
              file=sys.stderr)
        return 2
    if not (0 < args.port < 65536):
        print("devserve: --port must be 1-65535", file=sys.stderr)
        return 2

    Handler.root = root
    Handler.prefix = prefix
    try:
        srv = Server((args.bind, args.port), Handler)
    except OSError as e:
        print("devserve: cannot bind %s:%d: %s" % (args.bind, args.port, e), file=sys.stderr)
        return 1
    host = "[%s]" % args.bind if ":" in args.bind else (args.bind or "0.0.0.0")
    print("serving %s at http://%s:%d%s" % (root, host, args.port, prefix), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
