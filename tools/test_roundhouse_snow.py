"""Check the stationary ski contact at the real Roundhouse arrival, including a streamed tile change."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


CONTACT = """async () => {
    const {terrain} = await import(new URL('src/terrain.js', document.baseURI));
    const {Color, Vector3} = await import('three');
    const {player, scene, camera, renderer} = window.__alpine;
    const group = scene.getObjectByName('Pressed snow beneath weighted skis');
    const tint = new Color(), normal = new Vector3();
    function rim() {
        const errors = [];
        for (const mesh of group.children.filter(mesh => mesh.visible)) {
            const pos = mesh.geometry.attributes.position;
            // The extreme front and rear vertices are on uncompressed snow.
            for (const i of [0, pos.count - 1]) {
                const x = mesh.position.x + pos.getX(i), z = mesh.position.z + pos.getZ(i);
                const y = mesh.position.y + pos.getY(i);
                errors.push(Math.abs(terrain.sampleSnowSurface(x, z, tint, normal) - y));
            }
        }
        return errors;
    }
    const before = rim(), start = player.pos.clone();
    const away = start.clone().add(new Vector3(550, 0, 560));
    terrain.updateDetail(away);
    terrain.updateSkiSnow(player, false);
    terrain.updateSkiSnow(player, true);
    terrain.updateDetail(start, camera.position);
    const changed = rim();
    // Wait for the ordinary game loop to update and render the same pose.
    await new Promise((resolve, reject) => {
        const draw = renderer.render;
        const timeout = setTimeout(() => { renderer.render = draw; reject(Error('No gameplay frame')); }, 30000);
        renderer.render = function(s, c) {
            const result = draw.call(this, s, c);
            if (s === scene && c === camera && !this.getRenderTarget()) {
                clearTimeout(timeout);
                this.render = draw;
                resolve();
            }
            return result;
        };
    });
    return {before, changed, after:rim(), movement:player.pos.distanceTo(start)};
}"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True, help='Game root, including its Pages subdirectory')
    parser.add_argument('--quality', choices=['budget', 'max'], default='budget')
    parser.add_argument('--screenshot', type=Path)
    options = parser.parse_args()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='chrome', args=[
            '--disable-gpu', '--disable-gpu-compositing', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
        ])
        page = browser.new_page(viewport={'width': 1180, 'height': 632}, device_scale_factor=1)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.add_init_script("localStorage.setItem('alpine.multiplayer', 'off')")
        page.goto(options.url.rstrip('/') + '/?start=roundhouse&time=day&resolution=native&quality=' + options.quality,
                  wait_until='domcontentloaded')
        page.wait_for_function("""() => window.__alpine?.state.playing &&
            __alpine.scene.getObjectByName('Pressed snow beneath weighted skis')?.children.every(m => m.visible) &&
            __alpine.scene.getObjectByName('Detailed snow surface')""", timeout=180000)
        contact = page.evaluate(CONTACT)
        assert len(contact['before']) == len(contact['after']) == 4 and contact['movement'] < .001, contact
        assert max(contact['changed']) > .02, f"The terrain swap did not exercise the original failure: {contact}"
        assert max(contact['after']) < .0015, contact
        assert not errors, errors
        if options.screenshot:
            options.screenshot.parent.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(options.screenshot))
        print(json.dumps(contact, indent=2))
        browser.close()


if __name__ == '__main__':
    main()
