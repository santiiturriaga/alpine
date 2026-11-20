"""Check ski and snowboard takeoff, landing and ragdoll physics in Chromium."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

from test_ride_equipment import SHELL, capture_render


TEST = '''async () => {
    const THREE = await import('three');
    const {Player} = await import('/src/player.js');
    const ground = {
        bounds: {}, pitch: 0, shape: null,
        startPose: () => ({x:0,z:0,heading:0}),
        heightAt(x,z) { return this.shape ? this.shape(z) : this.pitch*z; },
        normalAt(x,z,out) { return out.set(0,1,(this.heightAt(x,z-.01)-this.heightAt(x,z+.01))/.02).normalize(); },
        surfaceAt(x,z,out) { return Object.assign(out, {id:'packed',powder:.08,grip:1,drag:1.1}); }
    };
    const p = new Player(new THREE.Scene(),new THREE.PerspectiveCamera(55,1.5,.27,1000),{ground});
    const events = [], step = (input={}) => p.update(1/90,input);
    const check = (pass, message) => { if(!pass) throw Error(message); };
    const reset = (pitch, speed, z=0) => {
        ground.pitch = pitch;
        p.teleport({x:0,z,heading:0},{resetStats:true});
        p.ollieCooldown = 0;
        p.vel.z = speed;
        events.length = 0;
    };
    p.onEvent = event => events.push(event);
    const records = {};
    for(const discipline of ['ski','snowboard']) {
        p.setEquipment({discipline});
        const recordsBySlope = {};
        for (const pitch of [-.46, 0, .24]) {
            ground.shape=null; reset(pitch,20);
            for(let i=0;i<42;i++) step();
            check(!events.some(e=>e.type==='launch') && p.grounded, 'Lost contact on a constant plane');
            step({ollie:true});
            const ollie=events.find(e=>e.type==='ollie');
            check(p.airborne && ollie, 'Ollie did not start');
            const takeoffVy=ollie.vy, normalVy=(p.vy - pitch*p.vel.z)/Math.hypot(1,pitch);
            let apex=0;
            for(let i=0;i<180 && p.airborne;i++) {
                step();
                apex=Math.max(apex,p.pos.y-ground.heightAt(p.pos.x,p.pos.z)-.035);
            }
            check(p.grounded && !p.crash, `${discipline} failed a neutral landing at pitch ${pitch}`);
            const landing=events.find(e=>e.type==='land');
            check(apex>.85 && apex<1.62 && landing.airTime>.80 && landing.airTime<1.19 && landing.impact<6,
                `Unexpected apex ${apex}, contact ${landing.airTime}s and impact ${landing.impact}`);
            check(normalVy>4.25 && normalVy<5.15, 'Takeoff impulse did not follow the snow normal');
            if(pitch<0) check(takeoffVy<0, 'Downhill momentum was erased at takeoff');
            recordsBySlope[pitch]={takeoffVy,normalVy,apex,airTime:landing.airTime,impact:landing.impact};
        }
        ground.shape=z=>z < -2.4 ? .144*(z+2.4)-.1728 : z > 2.4 ? -.144*(z-2.4)-.1728 : -.03*z*z;
        reset(0,21,-3.5);
        for(let i=0;i<43;i++) step();
        check(events.some(e=>e.type==='launch'), 'A smooth convex roller never lost support at speed');
        ground.shape=z=>z<0 ? .17*z : -.42*z;
        reset(0,18,-2.7);
        let gap=0;
        for(let i=0;i<280;i++) {
            step(); gap=Math.max(gap,p.pos.y-ground.heightAt(p.pos.x,p.pos.z)-.035);
            if(events.some(e=>e.type==='land' || e.type==='crash')) break;
        }
        const lip=events.find(e=>e.type==='launch');
        check(lip && lip.vy>1.8 && gap>.7 && p.grounded && !p.crash,
            `A real lip did not launch and land (${discipline}, ${gap}, ${events.map(e=>e.type+':'+e.reason)})`);
        ground.shape=z=>z<0 ? .17*z : -2.4-.42*z;
        reset(0,18,-.09);
        step({ollie:true});
        check(p.airborne && p.pos.y-ground.heightAt(p.pos.x,p.pos.z)>2.3,
            'Ollie on the departure frame snapped down to the lower slope');
        ground.shape=null; reset(-.27,18);
        step({ollie:true});
        p.spin=Math.PI*.5;
        while(p.airborne && p.airTime<1.4) step();
        check(p.crash && p.crashReason==='caught an edge', 'Crosswise landing rode away');
        const rag=p.ragdoll, points=rag.points;
        const hipStart=rag.pelvis.clone();
        const armStart=points.wrist0.at.clone().sub(points.shoulder0.at).normalize();
        let floorClearance=Infinity, stretch=0, minBody=100, visibleChange=0;
        for(let i=0;i<60 && p.crash;i++) {
            step();
            for(const point of rag.nodes) floorClearance=Math.min(floorClearance,point.at.y-point.radius-ground.heightAt(point.at.x,point.at.z));
            for(const link of rag.links) if(link.stiffness>=.85) stretch=Math.max(stretch,Math.abs(link.length-link.first.at.distanceTo(link.second.at)));
            minBody=Math.min(minBody,rag.pelvis.y-ground.heightAt(rag.pelvis.x,rag.pelvis.z));
            const arm=points.wrist0.at.clone().sub(points.shoulder0.at).normalize();
            visibleChange=Math.max(visibleChange,arm.angleTo(armStart));
        }
        const slide=rag.pelvis.distanceTo(hipStart);
        check(floorClearance>-.00001 && stretch<.15 && minBody<.60 && slide>1 && visibleChange>.60,
            `Invalid tumble: ground=${floorClearance} stretch=${stretch} body=${minBody} slide=${slide} arm=${visibleChange}`);
        let rising=false;
        for(let i=0;i<300 && p.crash;i++) { step(); rising ||= p.recoveryTime>0; }
        check(rising && !p.crash && p.grounded && !p.ragdoll && p.discipline===discipline &&
            events.filter(e=>e.type==='recover').length===1 && Math.abs(p.heading)<.02,'Did not stand up once and resume downhill');
        reset(0,10);
        step({ollie:true}); p.pos.y+=.25; p.vy=-17;
        for(let i=0;i<30 && p.airborne;i++) step();
        check(p.crash && p.crashReason==='heavy landing','Hard normal impact did not cause a crash');
        records[discipline]={slopes:recordsBySlope,lip:{vy:lip.vy,gap},ragdoll:{floorClearance,stretch,minBody,slide,visibleChange}};
    }
    const renderer = new THREE.WebGLRenderer();
    const gl=renderer.getContext();
    const backend=gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL);
    check(/swiftshader/i.test(backend), 'software renderer not active');
    return {backend,records};
}'''


def live_crash(browser, url, screenshots):
    page = browser.new_page(viewport={'width': 960, 'height': 620})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url + '?start=come-along&quality=budget&resolution=480&weather=clear', timeout=120000)
    page.wait_for_function('window.__alpine?.state.playing', timeout=120000)
    page.evaluate('''() => {
        const {player:p}=__alpine;
        p.setEquipment({discipline:'snowboard'});
        p.lookYaw=.37;
        const listener=p.onEvent;
        window.flightEvents=[];
        p.onEvent=event=>{listener?.(event); flightEvents.push(event);};
    }''')
    page.keyboard.down('KeyW')
    page.wait_for_function('window.__alpine.player.speed > 6', timeout=90000)
    page.keyboard.up('KeyW')
    page.keyboard.press('Space')
    page.wait_for_function('window.__alpine.player.airborne', timeout=40000)
    page.evaluate('''() => { __alpine.player.spin = Math.PI/2; }''')
    page.wait_for_function('window.__alpine.player.crashTimer > .32', timeout=40000)
    if screenshots:
        capture_render(page, screenshots / 'whistler-edge-catch.png')
    page.wait_for_function('window.flightEvents.some(event => event.type === "recover")', timeout=40000)
    result = page.evaluate('''() => {
      const {player:p,renderer}=__alpine;
      const gl=renderer.getContext(), ext=gl.getExtension('WEBGL_debug_renderer_info');
      return { events:flightEvents.filter(e=>['ollie','crash','recover'].includes(e.type)),
        grounded:p.grounded, crash:p.crash, backend:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) };
    }''')
    assert result['grounded'] and not result['crash'] and 'SwiftShader' in result['backend'] and not errors, (result, errors)
    assert result['events'][1]['reason'] == 'caught an edge', result
    if screenshots:
        capture_render(page, screenshots / 'whistler-recovered.png')
    print(json.dumps({'whistler': result}, indent=2))
    page.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8080/')
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--screenshots', type=Path)
    args = parser.parse_args()
    if args.screenshots:
        args.screenshots.mkdir(parents=True, exist_ok=True)
    flags = ['--disable-gpu', '--disable-gpu-compositing', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=flags)
        page = browser.new_page()
        page.route('**/flight-test.html', lambda request: request.fulfill(body=SHELL, content_type='text/html'))
        page.goto(args.url + 'flight-test.html')
        print(json.dumps(page.evaluate(TEST), indent=2))
        page.close()
        if args.live:
            live_crash(browser, args.url, args.screenshots)
        browser.close()


if __name__ == '__main__':
    main()
