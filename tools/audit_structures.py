"""Run the resort structure and lift audit against a locally served game."""

import argparse
import base64
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
SCENE_CHECK = (ROOT / 'tools' / 'audit_structures.js').read_text(encoding='utf-8')
ANGLES = [
    ('roundhouse-approach', [512, 4828], [517, 4869], 3.0),
    ('rendezvous-terminal', [3798, 1895], [3764, 1868], 3.8),
    ('village-skiers-plaza', [-24, -29], [39, 37], 4.5),
    ('fairmont-approach', [486, -420], [505, -350], 3.1, 21.0),
    ('creekside-approach', [-2536, 2146], [-2551, 2111], 3.2),
    ('creekside-kadenwood', [-2538, 2164], [-2558, 2165], 2.9),
    ('franz-loading', [-277.4, 4214.9], [-302, 4210], 3.0),
    ('learner-carpet', [247, 1557], [218, 1540], 3.2),
    ('whistler-tow', [179, 5152], [161, 5121], 4.0),
]


def capture(page, output, name, target, position, eye, target_height=2.7):
    data_url = page.evaluate("""async ([target, position, eye, targetHeight]) => {
      const { heightAt } = await import('/src/terrain.js');
      const {camera, renderer, scene} = __alpine;
      camera.position.set(position[0], heightAt(...position) + eye, position[1]);
      camera.lookAt(target[0], heightAt(...target) + targetHeight, target[1]);
      renderer.shadowMap.needsUpdate = true;
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    }""", [target, position, eye, target_height])
    (output / f'{name}.png').write_bytes(base64.b64decode(data_url.split(',', 1)[1]))


def check_rides(page, report):
    for lift in report['lifts']:
        if lift['access'] != 'public':
            continue
        for direction, station in enumerate(lift['boarding']):
            record = {'name': lift['name'], 'direction': direction}
            try:
                before = page.evaluate("""async ([s,id]) => {
                  const { stationPoint } = await import('/src/station-sites.js');
                  const { env, player } = __alpine;
                  const here = (x,z) => !env.queryColliders(x,z,2).some(c => c.r
                    ? Math.hypot(c.x-x,c.z-z)<c.r+.5 : env.pointInBox(x,z,c,.5,.5));
                  const test = [[0,-5],[-3,-5],[3,-5],[0,-2],[-6,0],[6,0],[0,3],[-2,0],[0,0]];
                  const access = test.map(([x,z])=>stationPoint(s,x,z)).find(p=>here(p.x,p.z)) ?? s;
                  player.teleport({...access,heading:s.yaw,holdAtUnload:true},{resetStats:true});
                  return {access, candidates: env.lifts.lifts.filter(({def})=>def.rideable && def.id!==id)
                    .map(({def})=>[def.id, Math.hypot(def.points[0][0]-access.x,def.points[0][1]-access.z)])
                    .filter(([,distance])=>distance<6)};
                }""", [station, lift['id']])
                page.wait_for_function("!document.getElementById('interaction-prompt').classList.contains('hidden')", timeout=6500)
                for _ in range(12):
                    if page.locator('#prompt-title').text_content() == lift['name']:
                        break
                    page.keyboard.press('KeyQ')
                    page.wait_for_timeout(110)
                page.keyboard.press('KeyE')
                page.wait_for_function('__alpine.ride !== null', timeout=7000)
                started = page.evaluate('__alpine.ride')
                if (started['name'], started['direction']) != (lift['name'], direction):
                    raise AssertionError(f"boarded {started['name']} direction {started['direction']}")
                should_have_cabin = lift['type'] in ('gondola', 'p2p')
                if started['inside'] != should_have_cabin:
                    raise AssertionError(f'initial cabin view {started["inside"]}')
                if should_have_cabin:
                    page.keyboard.press('KeyV')
                    page.wait_for_function('__alpine.ride?.inside === false', timeout=2500)
                    page.keyboard.press('KeyV')
                    page.wait_for_function('__alpine.ride?.inside === true', timeout=2500)
                else:
                    view = page.locator('#ride-view-label').text_content()
                    page.keyboard.press('KeyC')
                    page.wait_for_function("view => document.getElementById('ride-view-label').textContent !== view", arg=view, timeout=2500)
                    if lift['type'] in ('magic_carpet', 't-bar'):
                        eye = page.evaluate('__alpine.camera.position.y-__alpine.player.pos.y')
                        if abs(eye - 1.62) > .025:
                            raise AssertionError(f'surface ride eye height {eye}')
                page.wait_for_function('t => __alpine.ride?.t > t', arg=started['t'], timeout=4500)
                page.keyboard.press('KeyE')
                page.wait_for_function('__alpine.ride === null', timeout=7000)
                exit_state = page.evaluate("""async () => {
                  const {heightAt}=await import('/src/terrain.js');
                  const {player,env}=__alpine;
                  const {x,y,z}=player.pos;
                  const hit=env.queryColliders(x,z,3).filter(c=>y >= (c.minY ?? -Infinity) && y <= (c.maxY ?? Infinity) &&
                    (c.r ? Math.hypot(c.x-x,c.z-z)<c.r+.22 : env.pointInBox(x,z,c,.1,.1))).map(c=>c.type);
                  return { location: [x,y,z], delta: y-heightAt(x,z), blockedBy: hit };
                }""")
                if exit_state['blockedBy'] or abs(exit_state['delta']) > 1.25:
                    raise AssertionError(f"unload {exit_state}")
                record.update({'board': started, 'exit': exit_state, 'access': before, 'passed': True})
            except Exception as error:
                record.update({'passed': False, 'reason': str(error)})
                if page.evaluate('__alpine.ride !== null'):
                    page.keyboard.press('KeyE')
                    page.wait_for_function('__alpine.ride === null', timeout=7000)
            print(lift['name'], direction, 'PASS' if record['passed'] else record['reason'], flush=True)
            yield record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://localhost:8779')
    parser.add_argument('--output', type=Path, default=ROOT / 'test-output' / 'structure-audit')
    parser.add_argument('--rides', action='store_true', help='Exercise real board, ride view, and skip controls for every public lift.')
    parser.add_argument('--images', action='store_true', help='Capture representative architecture and lift screenshots.')
    parser.add_argument('--software', action='store_true', help='Use SwiftShader on systems without an available GPU.')
    parser.add_argument('--chrome', action='store_true', help='Use the installed Chrome channel instead of bundled Chromium.')
    args = parser.parse_args()
    args.output.mkdir(exist_ok=True, parents=True)
    with sync_playwright() as playwright:
        flags = ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] if args.software else ['--enable-webgl']
        browser = playwright.chromium.launch(headless=True, args=flags, channel='chrome' if args.chrome else None)
        page = browser.new_page(viewport={'width': 1056 if args.images else 680, 'height': 594 if args.images else 400})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(args.url.rstrip('/') + '/?start=roundhouse&weather=clear', wait_until='domcontentloaded', timeout=90000)
        page.wait_for_function('window.__alpine?.state.playing === true', timeout=200000)
        report = page.evaluate(SCENE_CHECK)
        report['pageErrors'] = errors
        report_path = args.output / 'structures.json'
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f"Scanned {report['mapped']['modeled']} mapped shells, {len(report['geometry']['inspectedModels'])} detailed groups and {len(report['lifts'])} lift routes.", flush=True)
        mapped = report['mapped']
        failed = bool(errors or report['geometry']['invalid'] or mapped['roofGaps'] or mapped['foundationGaps'] or mapped['missingWalls']
                      or any(lift['groundClearance'] < -.015 or lift['buildingContacts'] for lift in report['lifts'])
                      or any(crossing['gap'] <= 0 for crossing in report['crossings']))
        if args.images:
            for angle in ANGLES:
                capture(page, args.output, *angle)
        if args.rides:
            # Check the interactive simulation and event loop without spending
            # GPU time drawing each transitional frame. The same scene, game
            # state, controller, frame timing and DOM handlers remain live.
            page.evaluate("() => { window.__alpine.renderer.render = () => {}; }")
            ride_path = args.output / 'ride-controls.json'
            checks = []
            for entry in check_rides(page, report):
                checks.append(entry)
                failed |= not entry['passed']
                ride_path.write_text(json.dumps(checks, ensure_ascii=False, indent=2), encoding='utf-8')
        browser.close()
    if failed:
        raise SystemExit(f'Structure or lift checks failed. See {args.output}.')


if __name__ == '__main__':
    main()
