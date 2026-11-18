"""Replay the Whistler patrol and vehicle rider poses against a served game."""

import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8779')
    parser.add_argument('--chrome', action='store_true', help='Use installed Chrome instead of bundled Chromium.')
    parser.add_argument('--software', action='store_true', help='Enable SwiftShader for headless WebGL.')
    args = parser.parse_args()
    flags = ['--enable-webgl']
    if args.software:
        flags += ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    audit = Path(__file__).with_suffix('.js').read_text(encoding='utf-8')
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='chrome' if args.chrome else None, args=flags)
        page = browser.new_page(viewport={'width': 680, 'height': 400})
        page.goto(args.url.rstrip('/') + '/?start=roundhouse&weather=clear', wait_until='domcontentloaded', timeout=90000)
        page.wait_for_function('window.__alpine?.state.playing === true', timeout=200000)
        report = page.evaluate(audit)
    print(json.dumps(report, indent=2))
    if report['failures']:
        raise SystemExit('Patrol or vehicle rider verification failed.')


if __name__ == '__main__':
    main()
