"""Check the running game through rotation in Playwright WebKit's iPhone profile.

Run: python tools/test_mobile_rotation.py --url http://127.0.0.1:8942/
Requires Pillow and Playwright's WebKit browser.
"""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageStat
from playwright.sync_api import sync_playwright


def pointer(button, event, pointer_id):
    button.dispatch_event(event, {
        'pointerId': pointer_id, 'pointerType': 'touch', 'isPrimary': pointer_id == 1,
        'button': 0, 'buttons': int(event == 'pointerdown'),
    })


def capture(page, out, name):
    frame = page.evaluate('__mappedResort.renderer.info.render.frame')
    page.wait_for_function(r"""frame => __mappedResort.renderer.info.render.frame >= frame + 12 &&
        /^[1-9]\d* FPS$/.test(document.getElementById('fps-counter').textContent)""", arg=frame)
    path = out / f'{name}.png'
    page.screenshot(path=str(path))
    with Image.open(path) as image:
        width, height = image.size
        center = image.convert('RGB').crop((width // 4, height // 3, 3 * width // 4, 2 * height // 3))
        contrast = max(ImageStat.Stat(center).stddev)
        assert contrast > 8, f'{name}: no terrain visible in {path} ({contrast:.1f} pixel variation)'
    state = page.evaluate("""() => {
        const { renderer, camera } = __mappedResort, { game, canvas, gl, lost } = rotationProbe;
        return {
            sameGame: game === __mappedResort && renderer.domElement === canvas && renderer.getContext() === gl,
            contextLost: lost || gl.isContextLost(),
            cssSize: [innerWidth, innerHeight],
            renderSize: [gl.drawingBufferWidth, gl.drawingBufferHeight],
            aspect: camera.aspect,
            fps: document.getElementById('fps-counter').textContent,
        };
    }""")
    assert state['sameGame'] and not state['contextLost'], state
    width, height = state['cssSize']
    assert abs(state['aspect'] - width / height) < .01, state
    state['imageContrast'] = round(contrast, 1)
    return state


def rotate(page, size):
    page.set_viewport_size(size)
    page.wait_for_function("""({width, height}) => innerWidth === width && innerHeight === height &&
        !document.querySelector('[data-held]')""", arg=size)
    page.get_by_role('button', name='Pause game').tap()
    page.wait_for_function('__mappedResort.state.paused')
    page.get_by_role('button', name='Resume', exact=True).first.tap()
    page.wait_for_function('!__mappedResort.state.paused')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:8942/')
    args = parser.parse_args()
    out = Path('test-output/mobile-rotation')
    out.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as pw:
        browser = pw.webkit.launch(headless=True)
        page = browser.new_page(**pw.devices['iPhone 13'])
        page.add_init_script("localStorage.setItem('alpine.multiplayer', 'off')")
        errors, navigations = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
        page.on('framenavigated', lambda frame: navigations.append(frame.url) if frame == page.main_frame else None)
        query = '?mountain=stevens-pass&start=default&quality=budget&traffic=quiet'
        page.goto(args.url.rstrip('/') + '/' + query, wait_until='domcontentloaded')
        page.wait_for_function('window.__mappedResort?.state.playing', timeout=180_000)
        page.evaluate("""() => {
            const game = __mappedResort, canvas = game.renderer.domElement;
            window.rotationProbe = { game, canvas, gl: game.renderer.getContext(), lost: false };
            canvas.addEventListener('webglcontextlost', () => { rotationProbe.lost = true; });
        }""")

        portrait = page.viewport_size
        landscape = {'width': 844, 'height': 390}
        forward = page.get_by_role('button', name='Go forward or tuck')
        steer = page.get_by_role('button', name='Steer left')
        forward.wait_for(state='visible')
        results = {'portrait': capture(page, out, 'portrait')}
        baseline = page.evaluate('({ pos: __mappedResort.state.pos, heading: __mappedResort.player.heading })')

        # WebKit's touchscreen tap drives the modal buttons. Pointer events drive
        # two simultaneous held inputs, which Playwright's tap API cannot express.
        pointer(forward, 'pointerdown', 1)
        pointer(steer, 'pointerdown', 2)
        page.wait_for_function("""({pos, heading}) => {
            const { state, player } = __mappedResort;
            const distance = Math.hypot(state.pos[0] - pos[0], state.pos[2] - pos[2]);
            const turn = Math.sin((player.heading - heading) / 2);
            return distance > .5 && Math.abs(turn) > .015 &&
                document.querySelectorAll('[data-held]').length === 2;
        }""", arg=baseline)
        assert page.evaluate("getSelection().toString() === ''"), 'Movement selected text'
        pointer(steer, 'pointerup', 2)

        rotate(page, landscape)
        results['landscape'] = capture(page, out, 'landscape')
        mode = page.evaluate('__mappedResort.player.cameraMode')
        page.get_by_role('button', name='Change camera').tap()
        page.wait_for_function('mode => __mappedResort.player.cameraMode !== mode', arg=mode)

        rotate(page, portrait)
        results['portrait-return'] = capture(page, out, 'portrait-return')
        assert len(navigations) == 1, f'Unexpected navigation during rotation: {navigations}'
        assert not errors, errors
        print(json.dumps(results, indent=2), flush=True)
        browser.close()


if __name__ == '__main__':
    main()
