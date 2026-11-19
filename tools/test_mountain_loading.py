"""Check snowball retargeting against the running static site.

Run: python tools/test_mountain_loading.py --url http://127.0.0.1:8942/
Add --actual to check cold and warm startups on both resorts.
"""
import argparse
import json

from playwright.sync_api import sync_playwright


OBSERVE = """() => {
    const samples = window.loadingSamples = [];
    function measure(now) {
        const screen = document.getElementById('loading-screen');
        if (screen?.classList.contains('hidden')) return;
        const track = screen?.querySelector('.snowball-path');
        const ball = track?.querySelector('.snowball-carriage');
        if (ball && getComputedStyle(ball).visibility === 'visible') {
            const base = track.getBoundingClientRect();
            if (base.width > 0) {
                const position = (ball.getBoundingClientRect().x - base.x) / base.width;
                const stage = Number(track.querySelector('[role=progressbar]').getAttribute('aria-valuenow'));
                samples.push({now, position, stage});
            }
        }
        requestAnimationFrame(measure);
    }
    requestAnimationFrame(measure);
}"""


def check_motion(samples):
    assert len(samples) > 10, len(samples)
    assert samples[0]['position'] < .05 and samples[-1]['position'] > .997, samples[-1]
    backwards = max(a['position'] - b['position'] for a, b in zip(samples, samples[1:]))
    assert backwards < .002, f'Snowball moved backward by {backwards:.3%}'
    extra_forward = max(b['position'] - a['position'] - (b['now'] - a['now']) * .00125
                        for a, b in zip(samples, samples[1:]))
    assert extra_forward < .015, f'Snowball jumped forward by {extra_forward:.3%} beyond elapsed travel'
    assert all(a['stage'] <= b['stage'] for a, b in zip(samples, samples[1:])), 'Progress regressed'
    return {'samples': len(samples), 'finish': round(samples[-1]['position'], 4), 'backward': round(backwards, 5)}


def synthetic(browser, base):
    page = browser.new_page(viewport={'width': 390, 'height': 720})
    page.route('**/src/resort-entry.js', lambda route: route.fulfill(body='', content_type='text/javascript'))
    page.add_init_script(f'({OBSERVE})()')
    page.goto(base, wait_until='load')
    result = page.evaluate("""async () => {
        const { loadingProgress: report, finishMountainLoading: finish } = await import('./src/mountain-loading.js');
        const status = document.getElementById('load-status');
        const screen = document.getElementById('loading-screen');
        const bar = document.querySelector('.load-track');
        const carriage = document.querySelector('.snowball-carriage');
        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
        const position = () => (carriage.getBoundingClientRect().x - carriage.parentElement.getBoundingClientRect().x)
            / carriage.parentElement.getBoundingClientRect().width;
        report(.11, 'Reading the terrain…');
        await delay(170);
        report(.41, 'Planting the old-growth forest…');
        await delay(215);
        const deadline = performance.now() + 310;
        while (performance.now() < deadline) { /* Simulate a synchronous terrain build. */ }
        const before = position();
        report(.71, 'Stringing the lifts…');
        const after = position();
        report(.29, 'Old terrain report');
        const oldReportIgnored = status.textContent === 'Stringing the lifts…' && bar.getAttribute('aria-valuenow') === '71';
        await delay(220);
        screen.dataset.recovering = 'true';
        report(.90, 'Should not appear');
        await finish();
        const recoveryStayed = !screen.classList.contains('hidden') &&
            getComputedStyle(carriage).visibility === 'hidden' && bar.getAttribute('aria-valuenow') === '71';
        delete screen.dataset.recovering;
        report(.82, 'Preparing the view…');
        await delay(205);
        const ending = finish();
        const singleCompletion = ending === finish();
        const visibleWhileRolling = !screen.classList.contains('hidden') && position() < .98;
        await ending;
        return { before, after, oldReportIgnored, recoveryStayed, singleCompletion, visibleWhileRolling,
            finished: screen.classList.contains('hidden') && bar.getAttribute('aria-valuenow') === '100' };
    }""")
    assert abs(result['after'] - result['before']) < .002, result
    assert all(result[key] for key in ('oldReportIgnored', 'recoveryStayed', 'singleCompletion', 'visibleWhileRolling', 'finished')), result
    summary = check_motion(page.evaluate("loadingSamples"))
    page.reload(wait_until='load')
    fail = page.evaluate("""async () => {
        const { failMountainLoading, loadingProgress, finishMountainLoading } = await import('./src/mountain-loading.js');
        loadingProgress(.42);
        failMountainLoading('Terrain failed to load.');
        loadingProgress(.98);
        await finishMountainLoading();
        return [
            document.getElementById('load-status').textContent,
            document.querySelector('.load-track').getAttribute('aria-valuenow'),
            document.getElementById('loading-screen').classList.contains('hidden'),
            document.getElementById('load-destinations').hidden,
        ];
    }""")
    assert fail == ['Terrain failed to load.', '42', False, False], fail
    page.close()
    return summary


def actual(browser, base):
    for title, route, ready in [
        ('Whistler', 'start=roundhouse', 'window.__alpine?.state.playing'),
        ('Stevens Pass', 'mountain=stevens-pass&start=default', 'window.__mappedResort?.state.playing'),
    ]:
        context = browser.new_context(viewport={'width': 960, 'height': 540})
        page = context.new_page()
        page.add_init_script(f'({OBSERVE})()')
        page.add_init_script("localStorage.setItem('alpine.multiplayer', 'off')")
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        url = f'{base}?{route}&quality=budget&traffic=quiet'
        for phase in ('cold', 'warm'):
            page.goto(url, wait_until='domcontentloaded')
            page.wait_for_function(f"{ready} && document.getElementById('loading-screen').classList.contains('hidden')", timeout=180_000)
            result = check_motion(page.evaluate('loadingSamples'))
            assert not errors, errors
            print(title, phase, json.dumps(result), flush=True)
        context.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:8942/')
    parser.add_argument('--actual', action='store_true')
    args = parser.parse_args()
    base = args.url.rstrip('/') + '/'
    with sync_playwright() as pw:
        for engine in (pw.chromium, pw.webkit):
            browser = engine.launch(headless=True)
            print(engine.name, 'retargeting', json.dumps(synthetic(browser, base)), flush=True)
            browser.close()
        if args.actual:
            browser = pw.chromium.launch(headless=True, channel='chrome')
            actual(browser, base)
            browser.close()


if __name__ == '__main__':
    main()
