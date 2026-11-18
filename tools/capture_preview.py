"""Render the README preview from a local Alpine Descent server.

Requires FFmpeg, Google Chrome, and Python Playwright. From the repository,
start the HTTP server in the README, then run python tools/capture_preview.py.
Pass another server URL as the first argument when using a different port.
"""

import base64
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import sync_playwright


SIZE = {"width": 1920, "height": 1080}
FPS = 24
SCENE_SECONDS = 3
ROOT = Path(__file__).resolve().parent.parent
DESTINATION = ROOT / "assets" / "opening.mp4"
FFMPEG = [
    "ffmpeg", "-hide_banner", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", str(FPS), "-c:v", "mjpeg", "-i", "pipe:0", "-an",
    "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-maxrate", "10M", "-bufsize", "14M",
    "-vf", "scale=in_color_matrix=bt601:out_color_matrix=bt709:out_range=tv,format=yuv420p",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-forced-idr", "1", "-force_key_frames", f"expr:gte(t,n_forced*{SCENE_SECONDS})",
    "-movflags", "+faststart",
]


def capture(server_url):
    with sync_playwright() as playwright, TemporaryDirectory(dir=DESTINATION.parent) as temp:
        browser = playwright.chromium.launch(channel="chrome", args=[
            "--enable-webgl", "--disable-background-timer-throttling",
            "--disable-renderer-backgrounding",
            *(["--use-angle=d3d11"] if sys.platform == "win32" else []),
        ])
        page = browser.new_page(viewport=SIZE, device_scale_factor=1)
        page.set_default_timeout(240_000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.goto(f"{server_url.rstrip('/')}/?intro=capture", wait_until="domcontentloaded")
        page.wait_for_function("typeof window.__alpine?.filmFrame === 'function'")
        durations = page.evaluate("""async ({width, height}) => {
            const { INTRO_SHOT_SECONDS } = await import('./src/intro-sequence.js');
            __alpine.renderer.setPixelRatio(1);
            __alpine.renderer.setSize(width, height, false);
            return INTRO_SHOT_SECONDS;
        }""", SIZE)
        assert len(durations) == 8, f"Expected eight preview scenes, got {len(durations)}"
        output = Path(temp) / DESTINATION.name
        with subprocess.Popen([*FFMPEG, str(output)], stdin=subprocess.PIPE) as encoder:
            frames = FPS * SCENE_SECONDS
            start = 0
            for number, duration in enumerate(durations, start=1):
                step = duration / frames
                for first in range(0, frames, 4):
                    timestamps = [start + frame * step + .00001 for frame in range(first, min(first + 4, frames))]
                    images = page.evaluate("""([times, dt]) =>
                        times.map(time => __alpine.filmFrame(time, dt).split(',', 2)[1])
                    """, [timestamps, step])
                    for image in images:
                        encoder.stdin.write(base64.b64decode(image))
                start += duration
                print(f"Captured scene {number}/{len(durations)}", flush=True)
            encoder.stdin.close()
            if encoder.wait() != 0:
                raise RuntimeError("FFmpeg failed to encode the preview")
        if errors:
            raise RuntimeError("\n".join(errors))
        output.replace(DESTINATION)
        browser.close()


if __name__ == "__main__":
    capture(sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8080")
