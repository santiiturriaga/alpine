"""Bake the game's procedural tree geometry and its filtered mip levels for distant views."""

import base64
from functools import partial
import gzip
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import struct
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    with ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=ROOT)) as server:
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(channel="chrome")
                page = browser.new_page()
                page.route("**/bake.html", lambda route: route.fulfill(content_type="text/html", body=
                           '<script type="importmap">{"imports":{"three":"/vendor/three.module.js"}}</script>'))
                page.goto(f"http://127.0.0.1:{server.server_port}/bake.html")
                result = page.evaluate("""async () => {
                    const { bakeDeciduousCrowns } = await import('/src/deciduous-forest.js');
                    const atlases = bakeDeciduousCrowns().map(texture => texture.mipmaps);
                    const encode = bytes => {
                      let text = '';
                      for (let i = 0; i < bytes.length; i += 8192)
                        text += String.fromCharCode(...bytes.subarray(i, i + 8192));
                      return btoa(text);
                    };
                    return {width: atlases[0][0].width, height: atlases[0][0].height,
                      levels: atlases.flat().map(level => encode(level.data))};
                }""")
                browser.close()
        finally:
            server.shutdown()
            worker.join()
    header = struct.pack("<4sHH", b"FOL1", result["width"], result["height"])
    payload = header + b"".join(base64.b64decode(level) for level in result["levels"])
    out = ROOT / "assets" / "forest" / "deciduous-crowns.bin.gz"
    out.write_bytes(gzip.compress(payload, compresslevel=9, mtime=0))
    print(f"{out.name}: {out.stat().st_size:,} bytes, {len(payload):,} bytes decoded")


if __name__ == "__main__":
    main()
