"""Deterministic WebGL trail render/expiry audit against a running static server.

Run: python tools/test_ski_tracks.py --url http://127.0.0.1:8779/ --label after
Use --effects-source PATH to compare an earlier effects.js without changing the checkout.
"""
from pathlib import Path
import argparse
import json
from playwright.sync_api import sync_playwright


HTML = """<!doctype html><html><head><link rel="icon" href="data:,"></head>
<body style="margin:0"><script type="importmap">{"imports":{"three":"/vendor/three.module.js"}}</script>
<script type="module">
import * as THREE from 'three';
import { SkiTracks } from '/src/effects.js';
const scene=new THREE.Scene();scene.background=new THREE.Color('#99b8ce');
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setSize(1200,800);renderer.setPixelRatio(1);renderer.setClearColor('#99b8ce');
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.03;
document.body.append(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xd5e4f0,0xa7b7c0,1.13));
const sun=new THREE.DirectionalLight(0xfff1dc,2.18);sun.position.set(-6,8,-2);scene.add(sun);
const ground={heightAt:(x,z)=>-z*.12+.025*Math.sin(x*.3)*Math.cos(z*.2),
 sampleSnowSurface(x,z,c,n){c.setRGB(.85,.91,.96);n.set(-.0075*Math.cos(x*.3)*Math.cos(z*.2),1,.12+.005*Math.sin(x*.3)*Math.sin(z*.2)).normalize();}};
const snowGeo=new THREE.PlaneGeometry(70,1100,140,1100);snowGeo.rotateX(-Math.PI/2);snowGeo.translate(0,0,520);
const pos=snowGeo.attributes.position;for(let i=0;i<pos.count;i++)pos.setY(i,ground.heightAt(pos.getX(i),pos.getZ(i)));
snowGeo.computeVertexNormals();const snow=new THREE.Mesh(snowGeo,new THREE.MeshStandardMaterial({color:'#dfeaf1',roughness:.96}));scene.add(snow);
const camera=new THREE.PerspectiveCamera(55,1.5,.05,1600);
const tracks=new SkiTracks(scene,8000,ground);
function point(d,side){const x=7*Math.sin(d/18)+.4*Math.sin(d/5),dx=7/18*Math.cos(d/18)+.08*Math.cos(d/5),length=Math.hypot(dx,1);
 return new THREE.Vector3(x+side*.21/length,0,d-side*.21*dx/length);}
for(let i=0;i<=4800;i++){const d=i*.24,dx=7/18*Math.cos(d/18)+.08*Math.cos(d/5),heading=Math.atan2(dx,1);
 tracks.addStep(point(d,-1),point(d,1),100+i/60,.83,{heading,carve:.7,compression:[.045,.059]});}
tracks.update(180);
await renderer.compileAsync(scene,camera);
function renderAt(x,y,z,tx,ty,tz){camera.position.set(x,y,z);camera.lookAt(tx,ty,tz);camera.updateMatrixWorld();
 renderer.info.autoReset=false;renderer.info.reset();snow.visible=false;renderer.render(scene,camera);
 const cost={triangles:renderer.info.render.triangles,calls:renderer.info.render.calls,activeSegments:tracks.segmentCount};
 snow.visible=true;renderer.info.autoReset=true;renderer.render(scene,camera);return cost;}
function near(){const d=1100,x=point(d,0).x;return renderAt(x+3,ground.heightAt(x,d)+3,d-9,x,ground.heightAt(x,d+15),d+15);}
function forward(){const d=1153,x=point(d,0).x;return renderAt(x,ground.heightAt(x,d)+2,d,x,ground.heightAt(x,d+30),d+30);}
function detail(){const d=1040,x=point(d,0).x;return renderAt(x+2,ground.heightAt(x,d)+5,d+4,x,ground.heightAt(x,d-2),d-2);}
window.fixture={scene,renderer,camera,tracks,ground,point,near,forward,detail,ready:true};
</script></body></html>"""


CHECKS = r"""() => {
const {tracks:t,ground,scene}=fixture,cols=t.columns.length,per=(cols-1)*6;
const check=(condition,message)=>{if(!condition)throw Error(message);};
const small=new t.constructor(scene,17,ground);
const row=(x,time)=>({x,z:20,time,rx:0,rz:-1,soft:.8,carve:.7,stop:0,compression:.05});
for(let i=0;i<17;i++)small.writeSegment(row(i*.24,100+i),row((i+1)*.24,101+i));
small.update(120);
function spans(){return small.chunks.flatMap(c=>c.mesh.visible?c.geometry.groups.map(g=>[g.start/per,g.count/per]):[]);}
let ranges=spans();check(ranges.reduce((n,r)=>n+r[1],0)===17,'Full ring must draw every segment exactly once');
// Retiring a prefix in a completely wrapped ring leaves the newest endpoint.
small.update(314);check(small.segmentCount===13,'Only fully faded segments may expire');
ranges=spans();check(ranges.reduce((n,r)=>n+r[1],0)===13,'Expired prefix still rendered');
small.clear();small.segmentCursor=16;
small.writeSegment(row(0,400),row(.24,400));small.writeSegment(row(.24,400),row(.48,400));small.update(400);
ranges=spans();check(ranges.length===2&&ranges.reduce((n,r)=>n+r[1],0)===2,'Partial wrap must preserve both sides of a chunk');
const position=small.chunks[0].geometry.attributes.position;
const updates=position.updateRanges.map(r=>({...r}));
check(updates.length===2&&updates.reduce((n,r)=>n+r.count,0)===108,'Ring uploads must remain two changed spans');
const a=16*cols*2+cols,b=0;for(let j=0;j<cols;j++)for(let k=0;k<3;k++)
 check(position.array[(a+j)*3+k]===position.array[(b+j)*3+k],'Chunk/ring endpoint cracked');
small.update(609.999);check(small.segmentCount===2,'Track expired before shader fade ended');
small.update(610);check(small.segmentCount===0&&spans().length===0,'Fully faded track still submitted');
small.clear();check(small.segmentCursor===0&&small.segmentCount===0&&!small.chunks.some(c=>c.mesh.visible),'Clear leaves drawable chunks');
const options={heading:0,compression:.04};small.addStep({x:0,z:0},{x:.4,z:0},700,.6,options);
small.addStep({x:0,z:1},{x:.4,z:1},700.1,.6,{...options,planted:[true,false]});
small.update(700.1);check(small.segmentCount===4,'An unloaded ski wrote a floating track');
const before=small.segmentCount;small.breakTrack();small.addStep({x:0,z:2},{x:.4,z:2},700.2,.6,options);
check(small.segmentCount===before,'Landing or teleport bridged a broken track');
// A non-multiple capacity crosses real chunk boundaries and wraps repeatedly.
const multi=new t.constructor(scene,257,ground),expected=[];
for(let i=0;i<900;i++){
 const birth=800+i*.1;multi.writeSegment(row(i*.24,birth),row((i+1)*.24,birth+.1));
 expected.push({slot:i%257,birth:birth+.1});if(expected.length>257)expected.shift();
 if(i%13===0||i===899){multi.update(birth+.1);
  const actual=multi.chunks.flatMap(c=>c.geometry.groups.flatMap(g=>Array.from({length:g.count/per},(_,j)=>c.start+g.start/per+j))).sort((a,b)=>a-b);
  check(JSON.stringify(actual)===JSON.stringify(expected.map(e=>e.slot).sort((a,b)=>a-b)),'Chunk omitted or duplicated a live wrapped slot');
  for(const c of multi.chunks)if(c.mesh.visible)for(const g of c.geometry.groups){
   const first=g.start/per*cols*2,end=first+g.count/per*cols*2;
   for(let v=first;v<end;v++)check(c.geometry.boundingBox.containsPoint(new fixture.camera.position.constructor().fromBufferAttribute(c.geometry.attributes.position,v)),'Chunk bounds clipped a live vertex');
  }
 }
}
multi.update(1097);const retained=expected.filter(e=>1097-e.birth<210).length;
check(multi.segmentCount===retained,'Wrapped expiry retained the wrong segments');
return {expiryBoundary:610,partialWrapRanges:ranges,partialUploadRanges:updates,connectedEndpoint:true,plantAndBreak:true,chunkWrapWrites:900,wrappedExpirySegments:retained};
}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://127.0.0.1:8779/')
    ap.add_argument('--label', default='after')
    ap.add_argument('--effects-source', type=Path)
    ap.add_argument('--software', action='store_true', help='Use SwiftShader for deterministic GPU-independent comparisons')
    args = ap.parse_args()
    out = Path('test-output/trail-audit')
    out.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        flags = ['--enable-webgl', '--use-angle=d3d11']
        if args.software:
            flags = ['--disable-gpu', '--disable-gpu-compositing', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
        browser = pw.chromium.launch(channel='chrome', headless=True, args=flags)
        page = browser.new_page(viewport={'width': 1200, 'height': 800})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
        page.route('**/trail-fixture.html', lambda route: route.fulfill(body=HTML, content_type='text/html'))
        if args.effects_source:
            source = args.effects_source.read_text(encoding='utf-8')
            page.route('**/src/effects.js', lambda route: route.fulfill(body=source, content_type='text/javascript'))
        page.goto(args.url.rstrip('/') + '/trail-fixture.html', wait_until='networkidle')
        page.wait_for_function('window.fixture?.ready')
        result = {}
        for view in ['near', 'forward', 'detail']:
            result[view] = page.evaluate(f'fixture.{view}()')
            page.screenshot(path=str(out / f'{args.label}-{view}.png'))
        result['expired'] = page.evaluate('() => {fixture.tracks.update(390); return fixture.near();}')
        if not args.effects_source:
            result['checks'] = page.evaluate(CHECKS)
        result['errors'] = errors
        assert not errors, errors
        (out / f'{args.label}.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(json.dumps(result, indent=2), flush=True)
        browser.close()


if __name__ == '__main__':
    main()
