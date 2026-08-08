#!/usr/bin/env python3
"""Serve one fixed HTTP status on 127.0.0.1, for the FOLLOW-904 negative control.

The llm-gateway half of ``scripts/check-modal-container-effect.py`` asserts that the
deployed endpoint answers an invalid bearer with 401. To prove that assertion FIRES, the
negative control points the real probe (via ``--endpoint-url``) at this server and runs it
once per status shape: 401 must pass, 500 / 200 / 404 must alarm, and a port with nothing
listening must alarm too.

usage: python3 status_server.py <status> [port]
"""

from __future__ import annotations

import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

STATUS = int(sys.argv[1]) if len(sys.argv) > 1 else 401
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8931


class Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's required spelling
        body = b'{"detail":"negative control"}'
        self.send_response(STATUS)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args: object) -> None:
        sys.stderr.write("status_server: " + (fmt % args) + "\n")


if __name__ == "__main__":
    print(f"status_server: serving HTTP {STATUS} on 127.0.0.1:{PORT}", flush=True)
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
