"""Measure a complete mapped Whistler ski run with real browser input and rendering.

Install Playwright for Python and run the game from the origin you want to test.
Each invocation opens Chrome with a fresh temporary profile, closes it after
the cold run, and relaunches the same profile and URL for the warm run.
"""
import argparse
import json
import re
import tempfile
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from playwright.sync_api import sync_playwright


BOOT_PROBE = """
(() => {
  localStorage.setItem('alpine.multiplayer', 'off');
  localStorage.setItem('alpine.performance-options', JSON.stringify(SETTINGS));
  const milestones = window.skiBenchmarkBoot = { loader: [] };
  const observer = new MutationObserver(() => {
    const status = document.getElementById('load-status');
    const snowball = document.querySelector('.snowball-loader');
    if (snowball && milestones.snowballMs == null) milestones.snowballMs = performance.now();
    if (status && status.textContent !== milestones.loader.at(-1)?.label) {
      milestones.loader.push({ ms: performance.now(), label: status.textContent });
    }
    const loader = document.getElementById('loading-screen');
    if (loader?.classList.contains('hidden') && milestones.loaderHiddenMs == null) {
      milestones.loaderHiddenMs = performance.now();
      observer.disconnect();
    }
  });
  observer.observe(document, { childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['class'] });
})();
"""

CONTROLLER = Path(__file__).resolve().parents[1] / 'src' / 'ski-run-benchmark.js'
INJECT_CONTROLLER = """async source => {
  // The code lives in the current checkout even when the server serves an old ref.
  const url = URL.createObjectURL(new Blob([source], {type:'text/javascript'}));
  try { window.skiBenchmarkModule = await import(url); }
  finally { URL.revokeObjectURL(url); }
}"""


def options():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', required=True, help='Game URL with optional extra query parameters')
    parser.add_argument('--output', type=Path, required=True, help='Output JSON path')
    parser.add_argument('--adapter-luid', help='Windows DXGI adapter HighPart,LowPart')
    parser.add_argument('--expect-gpu', required=True, help='Case-insensitive regular expression matched against unmasked WebGL renderer')
    parser.add_argument('--width', type=int, default=1920)
    parser.add_argument('--height', type=int, default=1080)
    parser.add_argument('--quality', default='budget')
    parser.add_argument('--resolution', default='native')
    parser.add_argument('--cap', type=int, default=60)
    parser.add_argument('--cpu-rate', type=float, default=1, help='Chrome CDP CPU throttling factor, applied before navigation')
    parser.add_argument('--route', default='d69cb22c9615', help='Whistler OSM run ID (default is Ego Bowl)')
    parser.add_argument('--run-timeout', type=float, default=260, help='Seconds allowed from first W')
    parser.add_argument('--boot-timeout', type=float, default=180)
    parser.add_argument('--headless', action='store_true', help='Useful for controller development and smoke checks')
    parser.add_argument('--cold-only', action='store_true', help='Stop after the first browser run')
    parser.add_argument('--direct', action='store_true', help='Use the Roundhouse URL arrival instead of the title Drop in button')
    return parser.parse_args()


def target_url(args):
    parts = urlsplit(args.origin)
    params = dict(parse_qsl(parts.query))
    params.pop('start', None)
    if args.direct:
        params['start'] = 'roundhouse'
    params.update(season='winter', weather='clear', time='day',
                  quality=args.quality, resolution=args.resolution)
    return urlunsplit(parts._replace(query=urlencode(params)))


def measure(playwright, args, profile, phase, report):
    flags = ['--use-angle=d3d11', '--enable-webgl', '--disable-renderer-backgrounding',
             '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling']
    if args.adapter_luid:
        flags.append(f'--use-adapter-luid={args.adapter_luid}')
    errors, page_errors = [], []
    cache = {'responses': 0, 'disk': 0, 'cacheHits': 0, 'serviceWorker': 0}
    report.update(passed=False, cache=cache, errors=errors, pageErrors=page_errors)
    context = playwright.chromium.launch_persistent_context(
        profile, channel='chrome', args=flags, headless=args.headless, device_scale_factor=1,
        viewport={'width': args.width, 'height': args.height},
    )
    try:
        page = context.pages[0]
        page.on('pageerror', lambda error: page_errors.append(error.stack or str(error)))

        def console_error(msg):
            url = msg.location.get('url', '')
            if msg.type == 'error' and not urlsplit(url).path.lower().endswith('/favicon.ico'):
                errors.append(msg.text)

        page.on('console', console_error)
        session = context.new_cdp_session(page)
        session.send('Network.enable')
        if args.cpu_rate != 1:
            session.send('Emulation.setCPUThrottlingRate', {'rate': args.cpu_rate})

        def response(event):
            result = event['response']
            if urlsplit(result['url']).netloc != urlsplit(args.origin).netloc:
                return
            cache['responses'] += 1
            cache['disk'] += bool(result.get('fromDiskCache'))
            cache['serviceWorker'] += bool(result.get('fromServiceWorker'))

        def cache_hit(event):
            cache['cacheHits'] += 1

        session.on('Network.responseReceived', response)
        session.on('Network.requestServedFromCache', cache_hit)
        settings = json.dumps({'frameLimit': args.cap, 'resolution': args.resolution})
        page.add_init_script(BOOT_PROBE.replace('SETTINGS', settings, 1))
        page.goto(target_url(args), wait_until='domcontentloaded', timeout=args.boot_timeout * 1000)
        page.wait_for_function('window.__alpine?.renderer', timeout=args.boot_timeout * 1000)
        page.evaluate(INJECT_CONTROLLER, CONTROLLER.read_text(encoding='utf-8'))
        meta = page.evaluate('window.skiBenchmarkModule.inspectSkiBenchmark()')
        meta.update(requestedAdapterLuid=args.adapter_luid, cpuThrottle=args.cpu_rate,
                    browser=page.evaluate('navigator.userAgent'), headless=args.headless)
        report['meta'] = meta
        if not meta['renderer'] or not re.search(args.expect_gpu, meta['renderer'], re.IGNORECASE):
            raise RuntimeError(f"{phase} GPU mismatch. Requested {args.expect_gpu!r}, actual {meta['renderer']!r}")
        if meta['contextLost'] or not meta['pageVisible']:
            raise RuntimeError(f'{phase} requires a visible page and live WebGL context. Measured: {meta}')
        if args.quality.lower() != 'auto' and str(meta['quality']).casefold() != args.quality.casefold():
            raise RuntimeError(f"{phase} quality mismatch. Requested {args.quality!r}, actual {meta['quality']!r}")
        if meta['frameLimit'] is None:
            raise RuntimeError(f'{phase} cannot verify the {args.cap} FPS cap. The cap control is missing.')
        if meta['frameLimit'] != str(args.cap):
            raise RuntimeError(f"{phase} frame limit mismatch. Requested {args.cap}, actual {meta['frameLimit']}")
        if args.resolution == 'native' and meta['size'] != [args.width, args.height]:
            raise RuntimeError(f"{phase} native canvas mismatch: {meta['size']}")
        print(phase, 'READY', meta['renderer'], meta['size'], f"{meta['boot']['readyMs']/1000:.2f}s", flush=True)
        if not args.direct:
            page.locator('#drop-in').wait_for(state='visible', timeout=args.boot_timeout * 1000)
            page.evaluate('() => { window.skiBenchmarkModule.captureTitleArrival(); }')
            page.locator('#drop-in').click(timeout=args.boot_timeout * 1000)
            page.wait_for_function('window.skiBenchmarkBoot?.firstPlayableSubmissionMs != null',
                                   timeout=args.boot_timeout * 1000)
            meta['boot'].update(page.evaluate('window.skiBenchmarkBoot'))
        else:
            page.wait_for_function('window.__alpine?.state.playing === true', timeout=args.boot_timeout * 1000)
        route = page.evaluate('async settings => (await window.skiBenchmarkModule.driveSkiRun(settings)).route',
                              {'runId': args.route, 'timeoutMs': args.run_timeout * 1000})
        print(phase, 'SKI', route['name'], round(route['lengthM']), 'm', flush=True)
        page.wait_for_function('window.skiBenchmark?.done', timeout=(args.run_timeout + 15)*1000,
                               polling=1000)
        report.update(page.evaluate('window.skiBenchmarkModule.summarizeSkiRun(window.skiBenchmark)'))
        report['passed'] &= not page_errors and not any(
            re.search(r'shader|WebGLProgram|SyntaxError', error, re.I) for error in errors)
        if args.resolution == 'native':
            changed_size = any(row[4:] != [args.width, args.height] for row in report['frames'])
            report['nativeCanvasChanged'] = changed_size
            report['passed'] &= not changed_size
        print(phase, report['run']['reason'], report['run']['result'], flush=True)
    finally:
        context.close()


def main():
    args = options()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    report = {'url': target_url(args), 'options': vars(args) | {'output': str(args.output)}, 'phases': {},
              'definition': 'Completed main-scene draws submitted to the visible WebGL canvas. GPU scan-out is not measured.'}
    try:
        with tempfile.TemporaryDirectory(prefix='alpine-full-ski-') as profile, sync_playwright() as playwright:
            for phase in ('cold',) if args.cold_only else ('cold', 'warm'):
                result = report['phases'][phase] = {}
                measure(playwright, args, profile, phase, result)
                args.output.write_text(json.dumps(report, indent=2), encoding='utf-8')
                if not result['passed']:
                    raise RuntimeError(f'{phase} never met complete-run criteria. See {args.output}')
    except Exception as error:
        report['failure'] = str(error)
        args.output.write_text(json.dumps(report, indent=2), encoding='utf-8')
        raise


if __name__ == '__main__':
    main()
