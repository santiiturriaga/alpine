"""Check both PEAK 2 PEAK dismounts against a locally served game in SwiftShader."""

import argparse
import base64
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8080')
    parser.add_argument('--screenshots', type=Path)
    args = parser.parse_args()
    root = args.url.rstrip('/')
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='chrome', headless=True, args=[
            '--disable-gpu', '--disable-gpu-compositing', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
        ])
        page = browser.new_page(viewport={'width': 810, 'height': 490})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(root + '/') else route.abort())
        page.add_init_script("localStorage.setItem('alpine.multiplayer','off')")
        page.goto(root + '/?start=roundhouse&quality=budget&resolution=480&time=day&weather=clear',
                  wait_until='domcontentloaded', timeout=90000)
        page.wait_for_function('''() => {
          if (!window.__alpine?.state.playing) return false;
          const renderer = __alpine.renderer;
          window.renderDock = renderer.render.bind(renderer);
          renderer.render = () => {};
          return true;
        }''', timeout=120000)
        floors = page.evaluate('''async () => {
          const {Vector3} = await import('three');
          const {heightAt} = await import(new URL('src/terrain.js', document.baseURI).href);
          const {env, renderer} = __alpine;
          const lift = env.lifts.lifts.find(({def}) => def.type === 'p2p');
          const gl = renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
          return {
            renderer: gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
            terminals: [0, 1].map(end => {
              const hanger = new Vector3();
              lift.samplers[0].at(end, hanger, new Vector3());
              const deck = env.walkSurfaceAt(hanger.x, hanger.z, Infinity);
              return { deck, ground: heightAt(hanger.x, hanger.z), step: hanger.y - 3.32 - deck };
            }),
          };
        }''')
        assert 'SwiftShader' in floors['renderer'], floors
        for terminal in floors['terminals']:
            assert terminal['deck'] > terminal['ground'] + .35 and .12 < terminal['step'] < .36, floors

        for direction, name in enumerate(('blackcomb', 'whistler')):
            page.wait_for_function("document.getElementById('prompt-title').textContent === 'Peak 2 Peak Gondola'", timeout=12000)
            page.keyboard.press('KeyE')
            page.wait_for_function("side => __alpine.ride?.direction === side", arg=direction, timeout=12000)
            if direction == 0:
                page.keyboard.press('KeyE')
            else:
                # Advance the game through its natural arrival without waiting for the full crossing.
                page.evaluate('''() => {
                  const frame = requestAnimationFrame;
                  let time = performance.now();
                  window.requestAnimationFrame = callback => frame(real => callback(__alpine.ride ? time += 2000 : real));
                }''')
            page.wait_for_function('__alpine.ride === null', timeout=60000)
            pose = page.evaluate('''async side => {
              const {Vector3} = await import('three');
              const {peakToPeakAccess} = await import(new URL('src/station-sites.js', document.baseURI).href);
              const {player, camera, env} = __alpine;
              const lift = env.lifts.lifts.find(({def}) => def.type === 'p2p');
              const expected = peakToPeakAccess(lift.def, side === 0).unload;
              const {x, y, z} = player.pos;
              const deck = env.walkSurfaceAt(x, z, Infinity), view = camera.getWorldDirection(new Vector3());
              return {x, y, z, deck, expected, foot: player.footMode, riding: player.riding,
                facing: view.x * Math.sin(expected.heading) + view.z * Math.cos(expected.heading),
                eye: camera.position.y - y, room: env.interiorAt(x, z, y)?.id};
            }''', direction)
            expected = pose['expected']
            assert abs(pose['x'] - expected['x']) < .05 and abs(pose['z'] - expected['z']) < .05, pose
            assert abs(pose['y'] - pose['deck']) < .06 and pose['foot'] and not pose['riding'], pose
            assert pose['room'] == 'peak-to-peak-' + name and pose['facing'] > .9 and 1.4 < pose['eye'] < 1.9, pose
            if args.screenshots:
                args.screenshots.mkdir(parents=True, exist_ok=True)
                image = page.evaluate('''() => {
                  const {scene, camera, renderer} = __alpine;
                  renderDock(scene, camera);
                  return renderer.domElement.toDataURL('image/png').split(',')[1];
                }''')
                (args.screenshots / ('peak-to-peak-' + name + '-arrival.png')).write_bytes(base64.b64decode(image))

            page.evaluate('''() => {
              const {player} = __alpine;
              let previousY = player.pos.y;
              window.walkTrace = { frames: 0, airborneFrames: 0, largestStep: 0 };
              __alpine.setFrameObserver(() => {
                walkTrace.frames++;
                if (!player.grounded || player.crash) walkTrace.airborneFrames++;
                walkTrace.largestStep = Math.max(walkTrace.largestStep, Math.abs(previousY - player.pos.y));
                previousY = player.pos.y;
              });
            }''')
            page.keyboard.down('KeyW')
            page.wait_for_function('''([start, distance]) => {
              const {player, env} = __alpine;
              const {x, y, z} = player.pos;
              const heading = start.expected.heading;
              const progress = (x - start.x) * Math.sin(heading) + (z - start.z) * Math.cos(heading);
              return progress >= distance && !env.interiorAt(x, z, y) && player.grounded && !player.crash;
            }''', arg=[pose, 12.45 if direction == 0 else 7], timeout=26000)
            page.keyboard.up('KeyW')
            trace = page.evaluate('() => { __alpine.setFrameObserver(null); return walkTrace; }')
            assert trace['frames'] > 10 and not trace['airborneFrames'] and trace['largestStep'] < .45, trace
            print(f'{name}: cabin-height deck, on-foot camera facing the exit, and walk-out passed ({trace})', flush=True)

        assert not errors, errors
        browser.close()


if __name__ == '__main__':
    main()
