"""Check skier motion during live gameplay and after a delayed frame using SwiftShader."""
import argparse
import json
import math

from playwright.sync_api import sync_playwright


def sample_live(page, game, people_path):
    return page.evaluate('''async ({game, peoplePath}) => {
        const runtime = window[game], people = peoplePath ? runtime.env.people : runtime.people;
        const {player, renderer} = runtime, gl = renderer.getContext();
        const gpu = gl.getExtension('WEBGL_debug_renderer_info');
        const adapter = gl.getParameter(gpu.UNMASKED_RENDERER_WEBGL);
        const guest = people.people.find(p => p.state === 'skiing' && p.speed > 3 &&
            p.path.length - (p.progress ?? p.distance) > 100);
        player.teleport({x: guest.x - Math.sin(guest.heading) * 5,
            z: guest.z - Math.cos(guest.heading) * 5, heading: guest.heading, holdAtUnload: true});
        const update = people.update, samples = [];
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                people.update = update;
                reject(new Error('No live guest updates: ' + JSON.stringify({samples, state: runtime.state,
                    visible: !document.hidden, dialogs: Array.from(document.querySelectorAll('dialog[open]'), d => d.id)})));
            }, 60000);
            people.update = function(dt, time, camera, player) {
                const start = performance.now();
                update.call(this, dt, time, camera, player);
                samples.push({start, work: performance.now() - start});
                if (samples.length < 10) return;
                people.update = update;
                clearTimeout(timer);
                const median = values => values.sort((a,b) => a-b)[Math.floor(values.length/2)];
                resolve({adapter, guestMs: median(samples.map(p => p.work)),
                    frameMs: median(samples.slice(1).map((p, i) => p.start - samples[i].start)),
                    guests: people.debug().visible,
                    detailed: people.debug().detailed ?? null});
            };
        });
    }''', {'game': game, 'peoplePath': people_path})


def whistler_motion(page):
    return page.evaluate('''async () => {
        const {Vector3} = await import('./vendor/three.module.js');
        const {env, camera} = __alpine, people = env.people;
        const skier = people.people.find(p => p.state === 'skiing' && p.speed > 5 &&
            p.path.length - p.progress > 100);
        const time = people.debug().clock;
        const near = camera.clone();
        near.position.set(skier.x - Math.sin(skier.heading) * 4, skier.y + 1.8,
            skier.z - Math.cos(skier.heading) * 4);
        near.lookAt(skier.x, skier.y + 1, skier.z);
        const jacket = people.group.getObjectByName('Resort people · jacket');
        const position = new Vector3();
        const samples = [];
        const elapsed = people.debug().simulation.elapsed;
        for (const offset of [.016, .032, .448, .464, .480, .496]) {
            people.update(.016, time + offset, near);
            const stats = people.debug();
            let nearest = Infinity, x, z;
            for (let i = 0; i < jacket.count; i++) {
                position.fromArray(jacket.instanceMatrix.array, 16 * i + 12);
                const d2 = (position.x - skier.x) ** 2 + (position.z - skier.z) ** 2;
                if (d2 >= nearest) continue;
                nearest = d2;
                x = position.x;
                z = position.z;
            }
            samples.push({offset, ticks: Math.round((stats.simulation.elapsed - elapsed) * 20),
                nearby: stats.detailed, x, z, progress: skier.progress});
        }
        return samples;
    }''')


def mapped_motion(page):
    return page.evaluate('''() => {
        const {people, camera} = __mappedResort;
        const skier = people.people.find(p => p.state === 'skiing' && p.circuit.path.length - p.distance > 20);
        const dt = 1 / 120;
        const original = {...skier};
        const trials = [];
        for (let i = 0; i < 18; i++) {
            const x = skier.x, z = skier.z;
            const {heading, lane, y} = skier;
            const range = i % 2 ? 2.9 : 3.1;
            const player = {pos: {x: x + Math.sin(heading) * range - Math.cos(heading) * lane,
                y, z: z + Math.cos(heading) * range + Math.sin(heading) * lane}, speed: 0};
            people.update(dt, i * dt, camera, player);
            trials.push({travel: Math.hypot(skier.x - x, skier.z - z),
                limit: 2.05 * dt * Math.max(1.6, skier.speed), bypass: skier.bypass ?? null});
        }
        const {x,z} = original;
        Object.assign(skier, original, {state: 'join queue', path: {length: 5, nodes: [
            {x,z,distance:0,heading:0}, {x,z:z+5,distance:5,heading:0}]},
            distance: 0, pace: 1, heading: Math.PI / 2, speed: 0});
        for (let i = 0; i < 30; i++) people.update(dt, .2 + i * dt, camera, null);
        return {trials, heading: skier.heading, travel: skier.z - z};
    }''')


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument('--url', default='http://127.0.0.1:8080/')
    args.add_argument('--mountain', choices=['both', 'whistler', 'mapped'], default='both')
    cfg = args.parse_args()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='chrome', args=['--disable-gpu',
            '--disable-gpu-compositing', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        for mountain in ['whistler', 'mapped'] if cfg.mountain == 'both' else [cfg.mountain]:
            page = browser.new_page(viewport={'width': 854, 'height': 480}, reduced_motion='reduce')
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.add_init_script("localStorage.setItem('alpine.multiplayer','off')")
            whistler = mountain == 'whistler'
            game = '__alpine' if whistler else '__mappedResort'
            destination = 'start=come-along' if whistler else 'mountain=stevens-pass'
            try:
                page.goto(cfg.url + '?' + destination + '&quality=budget&resolution=480p&weather=clear&time=day',
                    wait_until='domcontentloaded', timeout=120000)
                if not whistler:
                    page.locator('#drop-in').click(timeout=120000)
                page.wait_for_function(f'window.{game}?.state.playing && !window.{game}.state.paused', timeout=120000)
                live = sample_live(page, game, whistler)
            except Exception:
                if errors:
                    print(json.dumps({'mountain': mountain, 'errors': errors[:4]}), flush=True)
                raise
            assert 'SwiftShader' in live['adapter'] and live['guests'] > 0, live
            motion = whistler_motion(page) if whistler else mapped_motion(page)
            print(json.dumps({'mountain': mountain, 'runtime': live, 'motion': motion}), flush=True)
            if whistler:
                ticks = [row['ticks'] for row in motion]
                assert 2 <= ticks[2] - ticks[1] <= 3, ticks
                assert all(b - a <= 1 for a, b in zip(ticks[2:], ticks[3:])), ticks
                assert all(row['nearby'] > 0 for row in motion), motion
                recovery_motion = [math.hypot(b['x'] - a['x'], b['z'] - a['z'])
                    for a, b in zip(motion[2:], motion[3:])]
                assert all(.025 < travel < .4 for travel in recovery_motion), recovery_motion
                assert motion[-1]['progress'] > motion[1]['progress'], motion
            else:
                assert all(sample['travel'] <= sample['limit'] + 1e-6 for sample in motion['trials']), motion
                assert 0 < motion['trials'][-1]['bypass'] < 1, motion
                assert motion['travel'] > .3 and motion['heading'] < .65, motion
            assert not errors, errors
            page.close()
        browser.close()


if __name__ == '__main__':
    main()
