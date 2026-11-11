#!/usr/bin/env python3
"""Designer client for installed Helix fixture commands."""
import json
import subprocess
import sys
import argparse
import tempfile
import threading
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from workflow import project_root

ROOT = project_root(HERE)
OUTPUT = ROOT / ".helix" / "port-handoffs"
CLI = ROOT / "Tools/Helix/bin/helix"
RECORDING = threading.Lock()


def cli(*args):
    reply = subprocess.run([str(CLI), *args], cwd=ROOT, capture_output=True, text=True)
    if reply.returncode:
        raise ValueError(reply.stderr.strip())
    return json.loads(reply.stdout)


def record(case):
    key = uuid.uuid4().hex
    result = cli("fixture-record", case, "--out", str(OUTPUT / key))
    return {"id": key, "scenario": result["id"]}


def recording_path(key):
    if len(key) != 32 or any(c not in "0123456789abcdef" for c in key):
        raise ValueError("Unknown recording.")
    folder = OUTPUT / key
    if not (folder / "motion.json").is_file():
        raise ValueError("Recording is unavailable.")
    return folder


def export(data):
    folder = recording_path(data["id"])
    key = uuid.uuid4().hex
    destination = folder / (key + ".zip")
    with tempfile.TemporaryDirectory() as tmp:
        notes = Path(tmp) / "notes.json"
        notes.write_text(json.dumps(data["notes"]))
        cli("fixture-handoff", "--recording", str(folder), "--notes", str(notes), "--out", str(destination))
    return {"url": f"/export/{folder.name}/{key}", "path": str(destination)}


class Handler(BaseHTTPRequestHandler):
    def send(self, status, kind, body, filename=None):
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.headers.get("Host") != self.server.authority:
            return self.send_error(403)
        path = urlparse(self.path).path
        files = {"/": ("index.html", "text/html; charset=utf-8"), "/app.js": ("app.js", "text/javascript"),
                 "/style.css": ("style.css", "text/css")}
        if path in files:
            name, kind = files[path]
            return self.send(200, kind, (HERE / name).read_bytes())
        parts = path.strip("/").split("/")
        try:
            if path == "/fixtures":
                return self.send(200, "application/json", json.dumps(cli("fixture-list")).encode())
            if len(parts) == 2 and parts[0] == "clip":
                return self.send(200, "video/webm", (recording_path(parts[1]) / "motion.webm").read_bytes())
            if len(parts) == 3 and parts[0] == "export" and uuid.UUID(hex=parts[2]).hex == parts[2]:
                archive = recording_path(parts[1]) / (parts[2] + ".zip")
                return self.send(200, "application/zip", archive.read_bytes(), "port-handoff.zip")
        except (ValueError, FileNotFoundError):
            pass
        self.send_error(404)

    def do_POST(self):
        if (self.headers.get("Host") != self.server.authority or
                self.headers.get("Origin") != "http://" + self.server.authority or
                self.headers.get_content_type() != "application/json"):
            return self.send_error(403)
        try:
            size = int(self.headers["Content-Length"])
            if not 0 < size <= 1048576:
                return self.send_error(413)
            data = json.loads(self.rfile.read(size))
            if self.path == "/record" and isinstance(data["scenario"], str) and not data["scenario"].startswith("--"):
                if not RECORDING.acquire(blocking=False):
                    return self.send(409, "application/json", b'{"error":"Another recording is in progress."}')
                try:
                    result = record(data["scenario"])
                finally:
                    RECORDING.release()
            elif self.path == "/export":
                result = export(data)
            else:
                return self.send_error(404)
        except (ValueError, KeyError, TypeError, OSError, subprocess.TimeoutExpired) as error:
            return self.send(400, "application/json", json.dumps({"error": str(error)}).encode())
        self.send(200, "application/json", json.dumps(result).encode())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("port", type=int, nargs="?", default=48195)
    parser.add_argument("--open", action="store_true", help="Open the designer workspace in a browser")
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.authority = f"127.0.0.1:{server.server_port}"
    print(f"Create port handoff at http://{server.authority}", flush=True)
    if args.open:
        webbrowser.open("http://" + server.authority)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
