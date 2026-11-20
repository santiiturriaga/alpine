"""Check the sled mode picker, run HUD, and resort return in SwiftShader."""
import argparse
import base64
import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


FLAGS = [
    '--disable-gpu', '--disable-gpu-compositing', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--disable-background-timer-throttling',
]

REPLAY_PAGE = '''<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/sled-game.css">
<script type="importmap">{"imports":{"three":"/vendor/three.module.js"}}</script>
<button id="launch">Open sled run</button>
<script type="module">
  import { openSledGame } from '/src/sled-game.js';
  document.querySelector('#launch').onclick = () => openSledGame();
</script>'''

REPLAY_INPUT = '''    if (dialog.__replay?.pilot) {
      if (action === 'tuck') return true;
      if (mode === 'free') return false;
      const course = world.segmentAt(run.d).course;
      const marker = course.tokens.find(token => token.d > run.d + 8);
      const designated = course.logs.find(log => log.d > 35);
      const distance = (designated?.d ?? Infinity) - run.d;
      const tryingHit = !run.bumps && distance > -2 && distance < 50;
      const error = (tryingHit ? designated.x : marker?.x ?? 0) - run.x - run.dx * .13;
      if (action === 'left') return error < -.24;
      if (action === 'right') return error > .24;
      if (action !== 'jump' || tryingHit) return false;
      const log = course.logs.some(item => item.d > run.d && item.d - run.d < run.speed * .26 && Math.abs(item.x - run.x) < 4.8);
      const lip = course.gaps.some(gap => gap.start > run.d && gap.start - run.d < 1.6);
      return log || lip;
    }
'''

REPLAY_HOOK = '''  const originalRender = renderer.render;
  dialog.__replay = {
    pilot: false,
    stopAnimation() {
      cancelAnimationFrame(animation);
      animation = 0;
    },
    replayTo(distance, maxFrames) {
      this.pilot = true;
      this.stopAnimation();
      const segmentsSeen = new Set();
      let maxResident = 0, recovery = null;
      renderer.render = () => {};
      try {
        for (let frame=0; frame<maxFrames && state!=='finished' && run.d<distance; frame++) {
          draw(last + 100);
          this.stopAnimation();
          if (run.recovery > 0 && !recovery) recovery = {state, d:run.d, message:get('callout').textContent};
          const mounted = scene.children.filter(group => group.name.startsWith('Sled course segment ')).length;
          maxResident = Math.max(maxResident, world.segments.size, mounted);
          for (const index of world.segments.keys()) segmentsSeen.add(index);
        }
      } finally {
        this.pilot = false;
        renderer.render = originalRender;
      }
      originalRender.call(renderer, scene, camera);
      return {state, distance:run.d, time:run.elapsed, bumps:run.bumps, recovery, maxResident,
        segmentsSeen:[...segmentsSeen], rival:world.rival?.run?.d ?? null, result:title.textContent};
    },
  };
'''


def capture(page, destination):
    client = page.context.new_cdp_session(page)
    try:
        image = client.send('Page.captureScreenshot', {
            'format': 'png', 'fromSurface': True, 'captureBeyondViewport': False,
        })
        destination.write_bytes(base64.b64decode(image['data']))
    finally:
        client.detach()


def hud(dialog):
    return dialog.evaluate('''dialog => {
      const text = key => dialog.querySelector(`[data-sled-${key}]`)?.textContent.trim();
      return {state:dialog.dataset.state, distance:text('distance'), time:text('time'), race:text('race-status')};
    }''')


def check_renderer(page):
    result = page.locator('#sled-game .sled-stage canvas').evaluate('''canvas => {
      const gl=canvas.getContext('webgl2'), debug=gl?.getExtension('WEBGL_debug_renderer_info');
      return {adapter:debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
        lost:gl?.isContextLost(), width:canvas.width, height:canvas.height};
    }''')
    assert result['adapter'] and 'SwiftShader' in result['adapter'], result
    assert not result['lost'] and min(result['width'], result['height']) > 160, result
    return result


def check_modes(browser, url, screenshots=None):
    page = browser.new_page(viewport={'width': 960, 'height': 620}, reduced_motion='reduce')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script("localStorage.setItem('alpine.multiplayer', 'off')")
    page.goto(url + '?start=roundhouse&quality=budget&resolution=480p&weather=clear&traffic=quiet',
              wait_until='domcontentloaded', timeout=120000)
    page.wait_for_function('window.__alpine?.state.playing', timeout=150000)
    page.keyboard.press('KeyG')
    mountain = page.locator('#mountain-panel')
    expect(mountain).to_be_visible(timeout=30000)
    mountain.get_by_role('tab', name='Activities').click()
    launch = mountain.locator('[data-minigame="sled"]')
    launch.click()
    dialog = page.locator('#sled-game')
    expect(dialog).to_have_attribute('data-state', 'intro', timeout=90000)
    renderer = check_renderer(page)
    if screenshots:
        capture(page, screenshots / 'sled-mode-picker.png')

    race = dialog.locator('[data-sled-mode="race"]')
    free = dialog.locator('[data-sled-mode="free"]')
    expect(race).to_be_visible()
    expect(free).to_be_visible()
    race.click()
    dialog.get_by_role('button', name='Start race').click()
    expect(dialog).to_have_attribute('data-state', 'running', timeout=30000)
    page.wait_for_function('''() => {
      const node = document.querySelector('[data-sled-distance]');
      return node && Number(node.textContent.replace(/[^0-9.]/g,'')) >= 3;
    }''', timeout=60000)
    race_state = hud(dialog)
    expect(dialog.locator('[data-sled-race-status]')).to_be_visible()
    assert race_state['race'], race_state
    if screenshots:
        capture(page, screenshots / 'sled-race-running.png')
    page.keyboard.press('KeyP')
    expect(dialog).to_have_attribute('data-state', 'paused', timeout=30000)
    frozen = hud(dialog)
    page.wait_for_timeout(400)
    assert hud(dialog) == frozen, (frozen, hud(dialog))
    dialog.get_by_role('button', name='Resume', exact=False).click()
    expect(dialog).to_have_attribute('data-state', 'running', timeout=30000)
    page.keyboard.press('Escape')
    expect(dialog).to_have_count(0, timeout=30000)
    expect(launch).to_be_focused()

    launch.click()
    expect(dialog).to_have_attribute('data-state', 'intro', timeout=90000)
    free.click()
    dialog.get_by_role('button', name='Start run').click()
    expect(dialog).to_have_attribute('data-state', 'running', timeout=30000)
    page.keyboard.press('Space')
    page.wait_for_function('''() => {
      const node = document.querySelector('[data-sled-distance]');
      return node && Number(node.textContent.replace(/[^0-9.]/g,'')) >= 20;
    }''', timeout=60000)
    free_state = hud(dialog)
    expect(dialog.locator('[data-sled-race-status]')).to_be_hidden()
    if screenshots:
        capture(page, screenshots / 'sled-free-running.png')
    page.keyboard.press('Escape')
    expect(dialog).to_have_count(0, timeout=30000)
    expect(launch).to_be_focused()
    page.keyboard.press('Escape')
    page.wait_for_function('window.__alpine?.state.playing && !window.__alpine?.state.paused', timeout=60000)
    assert not errors, errors
    page.close()
    return {'renderer': renderer, 'race': race_state, 'free': free_state}


def replay_modes(browser, url, screenshots=None):
    # This fixture advances the real draw loop at a fixed step and suppresses
    # intermediate GPU draws. The ordinary resort entry runs unmodified above.
    source = (Path(__file__).resolve().parents[1] / 'src' / 'sled-game.js').read_text(encoding='utf-8-sig')
    changes = {
        '  const seed = Math.floor(Math.random() * 0x1_0000_0000);': '  const seed = 0x3ac09016 ^ 0x2f1e5;',
        '  const input = action => {\n': '  const input = action => {\n' + REPLAY_INPUT,
        '  draw(last);\n  return dialog;': '  draw(last);\n' + REPLAY_HOOK + '  return dialog;',
    }
    for original, replacement in changes.items():
        assert source.count(original) == 1, f'Replay fixture lost its hook at {original!r}'
        source = source.replace(original, replacement)
    page = browser.new_page(viewport={'width': 960, 'height': 620}, reduced_motion='reduce')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('**/sled-replay', lambda route: route.fulfill(body=REPLAY_PAGE, content_type='text/html'))
    page.route('**/src/sled-game.js', lambda route: route.fulfill(body=source, content_type='application/javascript'))
    page.goto(url + 'sled-replay', wait_until='networkidle')
    launch = page.get_by_role('button', name='Open sled run')
    launch.click()
    dialog = page.locator('#sled-game')
    expect(dialog).to_have_attribute('data-state', 'intro', timeout=90000)
    renderer = check_renderer(page)
    dialog.locator('[data-sled-mode="race"]').click()
    dialog.get_by_role('button', name='Start race').click()
    race = dialog.evaluate('''dialog => dialog.__replay.replayTo(Infinity, 2110)''')
    assert race['state'] == 'finished' and race['result'] == 'You won' and race['bumps'] > 0, race
    assert 150 < race['time'] < 205 and race['rival'] < race['distance'], race
    assert race['maxResident'] <= 2 and len(race['segmentsSeen']) >= 8, race
    assert race['recovery']['state'] == 'running' and race['recovery']['message'], race
    if screenshots:
        capture(page, screenshots / 'sled-race-win-after-hits.png')

    dialog.locator('[data-sled-show-modes]').click()
    dialog.locator('[data-sled-mode="free"]').click()
    dialog.get_by_role('button', name='Start run').click()
    free = dialog.evaluate('''dialog => dialog.__replay.replayTo(2150, 850)''')
    assert free['distance'] >= 2150 and free['state'] == 'running' and free['bumps'] > 0, free
    assert free['maxResident'] <= 2 and len(free['segmentsSeen']) >= 3 and free['rival'] is None, free
    assert not errors, errors
    page.close()
    return {'renderer': renderer, 'race': race, 'free': free}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8080/')
    parser.add_argument('--screenshots', type=Path)
    parser.add_argument('--replay', action='store_true', help='Also run a full time-accelerated race and streaming check')
    args = parser.parse_args()
    if args.screenshots:
        args.screenshots.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=FLAGS)
        print(json.dumps(check_modes(browser, args.url.rstrip('/') + '/', args.screenshots), indent=2))
        if args.replay:
            print(json.dumps(replay_modes(browser, args.url.rstrip('/') + '/', args.screenshots), indent=2))
        browser.close()


if __name__ == '__main__':
    main()
