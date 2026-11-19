"""Exercise Player equipment and poses with SwiftShader. Pass --live for a Whistler run."""
import argparse
import base64
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


SHELL = '''<!doctype html><script type="importmap">
{"imports":{"three":"/vendor/three.module.js"}}
</script>'''

TEST = '''async () => {
    const THREE = await import('three');
    const {Player} = await import('/src/player.js');
    const {createSkiSnowSurface} = await import('/src/ski-snow-surface.js');
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(54, 1.5, .1, 1200);
    const track = { steps: [], breakTrack() {}, addStep(a,b,time,powder,options) { this.steps.push(options); } };
    const ground = {
        bounds:{}, slope:.26, powder:.05, grip:1,
        startPose:()=>({x:0,z:0,heading:0}),
        heightAt(x,z) { return -this.slope*z; },
        normalAt(x,z,out) { return out.set(0,1,this.slope).normalize(); },
        surfaceAt(x,z,out) { return Object.assign(out, {id:this.powder > .5 ? 'powder' : 'packed', powder:this.powder, grip:this.grip, drag:1.1}); }
    };
    const p = new Player(scene,camera,{ground,tracks:track});
    let now = 0;
    const step = (n,input={}) => { for(let k=0;k<n;k++) p.update(1/60,input,now+=1/60); };
    const seed = () => { p.teleport({x:0,z:0,heading:0}); track.steps.length=0; };
    const check = (pass, text) => { if(!pass) throw new Error(text); };
    const visiblePoles = () => {
        const names=[];
        p.rig.group.traverseVisible(node=>{ if(node.name.toLowerCase().includes('ski pole')) names.push(node.name); });
        return names.length;
    };
    const skis = {};
    for(const model of ['all-mountain','carver','laser-wrt-pro','powder','park']) {
        p.setEquipment({skiModel:model});
        seed(); p.vel.z=16;
        step(48,{steer:.34});
        skis[model]={turn:Math.abs(p.heading), deviation:Math.abs(p.pos.x), bounds:[p.rig.skiContact.start,p.rig.skiContact.end]};
        check(track.steps.at(-1).planted.every(Boolean),'ski track must use two plants');
    }
    check(skis.carver.turn > skis['all-mountain'].turn*1.15, 'short slalom sidecut did not turn tighter');
    check(skis.park.bounds[0] !== skis.carver.bounds[0], 'ski size did not change deck');
    ground.powder = .98;
    const powder={};
    for(const model of ['powder','carver']) {
        p.setEquipment({skiModel:model}); seed(); p.vel.z=16; step(100);
        powder[model]={speed:p.speed,sink:p.snowSink};
    }
    check(powder.powder.speed>powder.carver.speed && powder.powder.sink<powder.carver.sink, 'wide ski did not float');
    const boards = {};
    for(const model of ['burton-custom-camber','jones-flagship']) {
        p.setEquipment({discipline:'snowboard', snowboardModel:model});
        seed(); p.vel.z=16; step(40,{steer:.45});
        boards[model]={speed:p.speed,sink:p.snowSink,turn:Math.abs(p.heading)};
        step(1,{ollie:true}); boards[model].pop=p.vy;
    }
    const jones=boards['jones-flagship'], burton=boards['burton-custom-camber'];
    check(jones.sink<burton.sink && jones.speed>burton.speed && jones.turn<burton.turn && jones.pop<burton.pop,
        'directional board and camber twin behaved identically');
    const contact = createSkiSnowSurface({
        snowMaps:{}, heightAt:ground.heightAt.bind(ground), surfaceAt:ground.surfaceAt.bind(ground),
        sampleSurface(x,z,color,normal) {color.set('#ffffff'); ground.normalAt(x,z,normal); return ground.heightAt(x,z);}, setCutout() {}
    });
    ground.skiSnowDepthAt=contact.depthAt;
    seed(); step(30); contact.update(p);
    const {x,z}=p.rig.boardContact.point;
    check(contact.group.children.filter(mesh=>mesh.visible).length===1 && contact.depthAt(x,z)>.01,
        'board did not press its own snow footprint');
    delete ground.skiSnowDepthAt;
    ground.powder=.06;
    p.setEquipment({discipline:'snowboard', snowboardModel:'burton-custom-camber', stance:'regular'});
    const deck=p.rig.gearAnchors.snowboard;
    seed();
    step(23,{tuck:true});
    const oneFoot = p.boardOneFoot;
    check(oneFoot>.30 && p.speed>1,'one-foot skate did not push');
    const bindings=()=>Object.fromEntries(deck.children.filter(n=>n.name.endsWith('snowboard binding')).map(n=>[n.name,n.position.z]));
    const regular=bindings();
    check(regular['Left snowboard binding']>.27 && regular['Right snowboard binding']<-.27,'regular stance');
    p.setEquipment({stance:'goofy'}); step(1);
    check(bindings()['Right snowboard binding']>.27 && bindings()['Left snowboard binding']<-.27,'goofy stance');
    p.setEquipment({stance:'regular'}); seed();
    const carve={};
    for(const side of [-1,1]) {
        seed(); p.vel.z=16; step(43,{steer:side*.58});
        carve[side]={x:p.pos.x, edge:p.boardEdge, speed:p.speed, slip:p.boardSlip};
        check(Math.sign(p.boardEdge)===side && Math.sign(p.pos.x)===-side,'wrong edge or travel direction');
        check(track.steps.at(-1).planted.filter(Boolean).length===1 && !p.rig.skiPlanted.some(Boolean),'board made double ski tracks');
    }
    const speedBefore = p.speed;
    step(90,{brake:true});
    const speedAfter = p.speed;
    check(speedAfter < speedBefore*.25,'the edge did not stop the board');
    seed(); p.vel.z=15;
    step(1,{ollie:true});
    check(p.airborne && p.vy>4,'board ollie was not launched');
    step(140);
    check(p.grounded && !p.crash && p.stats.longestAir>.4,'board did not land');
    seed(); p.vel.z=14; step(1,{ollie:true});
    for(let i=0;i<65 && p.airborne && p.spin + p.spinVel/5.4 < Math.PI; i++) step(1,{air:true,steer:-.75});
    step(135);
    check(p.switchStance && Math.cos(p.travelHeading)>.95 && !p.crash,'switch landing lost the travel direction');
    check(!p.swingPole() && visiblePoles()===0,'boarder used a ski pole');
    p.cameraMode=2; p.snapCamera();
    check(visiblePoles()===0 && deck.visible && !p.rig.gearAnchors.helmet.parent.visible &&
      camera.position.distanceTo(p.rig.boardEyes)<.001,'helmet view rendered incorrect hardware');
    p.cameraMode=0;
    seed();
    check(p.setFootMode(true),'could not unstrap'); step(1);
    check(deck.visible && deck.position.y>.8,'board was not carried when walking');
    check(p.setFootMode(false)===false,'could not strap back in'); step(1);
    check(deck.visible && deck.position.y<.2,'strapping in did not ground the board');
    p.setEquipment({discipline:'ski'}); step(1);
    check(!deck.visible && p.rig.gearAnchors.skis.visible,'switching back left the board equipped');
    const renderer = new THREE.WebGLRenderer();
    const gl = renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
    const backend=debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
    check(/swiftshader/i.test(backend),'software rendering was not active');
    return {backend, skis, powder, boards, carve, oneFoot, speedBefore, speedAfter};
}'''


def capture_render(page, destination):
    encoded = page.evaluate('''() => {
      const {renderer,scene,camera}=__alpine;
      renderer.render(scene,camera);
      return renderer.domElement.toDataURL('image/png').split(',')[1];
    }''')
    destination.write_bytes(base64.b64decode(encoded))


def whistler(browser, url, screenshots):
    page = browser.new_page(viewport={'width': 960, 'height': 620})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url + '?start=come-along&quality=budget&resolution=480&weather=clear', timeout=120000)
    page.wait_for_function('window.__alpine?.state.playing', timeout=120000)
    start = page.evaluate('''() => {
      const {player:p}=__alpine;
      p.setEquipment({discipline:'snowboard', snowboardModel:'burton-custom-camber'});
      return {x:p.pos.x,z:p.pos.z,heading:p.heading,distance:p.stats.distance};
    }''')
    page.keyboard.down('KeyW')
    page.wait_for_function('window.__alpine.player.speed > 5', timeout=90000)
    page.keyboard.up('KeyW')
    page.keyboard.down('KeyD')
    page.wait_for_function('window.__alpine.player.boardEdge > .18', timeout=40000)
    page.keyboard.up('KeyD')
    if screenshots:
        page.evaluate('''() => { __alpine.player.lookYaw=.28; __alpine.player.snapCamera(); }''')
        capture_render(page, screenshots / 'whistler-snowboard-chase.png')
    page.keyboard.press('KeyC')
    page.keyboard.press('KeyC')
    state = page.evaluate('''() => {
      const {player:p, renderer}=__alpine;
      const gl=renderer.getContext(), debug=gl.getExtension('WEBGL_debug_renderer_info');
      const info=gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
      p.lookYaw=0; p.lookPitch=.64; p.snapCamera();
      return { info, distance:p.stats.distance, speed:p.speed, airborne:p.airborne, crash:p.crash,
          visible:p.rig.gearAnchors.snowboard.visible, helmetCamera:p.camera.position.distanceTo(p.rig.boardEyes)<.001 };
    }''')
    if screenshots:
        capture_render(page, screenshots / 'whistler-snowboard-helmet.png')
    assert state['distance'] > start['distance'] + 2 and state['speed'] > 2 and not state['crash'], state
    assert state['visible'] and state['helmetCamera'] and 'SwiftShader' in state['info'], state
    assert not errors, errors
    page.evaluate('''start => {
      const {player:p}=__alpine;
      p.cameraMode=0; p.setEquipment({discipline:'ski', skiModel:'laser-wrt-pro'});
      p.teleport(start,{resetStats:true});
    }''', start)
    page.keyboard.down('KeyW')
    page.wait_for_function('window.__alpine.player.speed > 5', timeout=90000)
    page.keyboard.up('KeyW')
    ski = page.evaluate('''() => {
      const p=__alpine.player;
      return {distance:p.stats.distance,speed:p.speed,model:p.skiModel.id,planted:p.rig.skiPlanted};
    }''')
    assert ski['distance']>2 and ski['model']=='laser-wrt-pro' and all(ski['planted']), ski
    assert not errors, errors
    print(json.dumps({'whistler': {'board':state,'ski':ski}}, indent=2))
    page.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8080/')
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--screenshots', type=Path)
    args = parser.parse_args()
    if args.screenshots:
        args.screenshots.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        flags = ['--disable-gpu', '--disable-gpu-compositing', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
        browser = playwright.chromium.launch(args=flags)
        page = browser.new_page()
        page.route('**/ride-test.html', lambda request: request.fulfill(body=SHELL, content_type='text/html'))
        page.goto(args.url + 'ride-test.html')
        print(json.dumps(page.evaluate(TEST), indent=2))
        page.close()
        if args.live:
            whistler(browser, args.url, args.screenshots)
        browser.close()


if __name__ == '__main__':
    main()
