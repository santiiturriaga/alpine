"""Run an asset generator against the game's own browser modules."""

from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@contextmanager
def bake_page():
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
                try:
                    yield page
                finally:
                    browser.close()
        finally:
            server.shutdown()
            worker.join()
