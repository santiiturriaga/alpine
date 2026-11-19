"""Render generated 3D broadleaf woods, seasons and detail budgets in WebGL."""
from pathlib import Path
import argparse, json
from playwright.sync_api import sync_playwright

HTML = r'''<!doctype html><html><head><link rel="icon" href="data:,"></head><body style="margin:0">
<script type="importmap">{"imports":{"three":"/vendor/three.module.js"}}</script><script type="module">
import * as THREE from 'three';
import {buildDeciduousForest} from '/src/deciduous-forest.js';
import {climateUniforms} from '/src/climate-state.js';
import {compactDevice} from '/src/device-budget.js';
const renderer=new THREE.WebGLRenderer({antialias:!compactDevice,preserveDrawingBuffer:true});renderer.setSize(1200,800);
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.03;document.body.append(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#a3c2d7');scene.fog=new THREE.FogExp2('#a3c2d7',.00026);
scene.add(new THREE.HemisphereLight(0xd5e4f0,0xa7b7c0,1.13));const sun=new THREE.DirectionalLight(0xfff1dc,2.18);sun.position.set(-6,8,4);scene.add(sun);
const snow=new THREE.Mesh(new THREE.PlaneGeometry(3000,3000),new THREE.MeshStandardMaterial({color:'#dfebf0',roughness:.96}));snow.rotation.x=-Math.PI/2;snow.position.y=-.06;scene.add(snow);
const camera=new THREE.PerspectiveCamera(58,1.5,.05,6000);camera.position.set(10,3.2,18);camera.lookAt(0,7,-2);
const group=new THREE.Group();scene.add(group);const patches=new Map();let count=0;
for(let z=0;z<100;z++)for(let x=0;x<100;x++){
 const px=(x-50)*16+Math.sin(x*83+z*17)*5,pz=(z-50)*16+Math.cos(x*23+z*41)*5;
 if(Math.hypot(px,pz)<25)continue;
 const key=`${Math.floor(px/128)}:${Math.floor(pz/128)}`;if(!patches.has(key))patches.set(key,[]);
 patches.get(key).push({x:px,y:0,z:pz,height:9+5*(.5+.5*Math.sin(x*9+z*17)),width:.85+.3*(.5+.5*Math.cos(x+z*3)),rotation:x*7+z*9});count++;
}
patches.set('hero',[{x:0,y:0,z:0,height:15,width:1.1,rotation:1.3},{x:-7,y:0,z:-5,height:13,width:.94,rotation:2.4},{x:8,y:0,z:-6,height:11,width:1.1,rotation:4.1}]);
const planted=[...patches.values()].flat();for(const tree of planted)tree.kind='deciduous';
const plantedBefore=JSON.stringify(planted);
const forest=buildDeciduousForest(group,patches,'niseko-united');
function draw(season='winter',quality='HIGH'){
 Object.assign(climateUniforms.snowpack,{value:season==='winter'?1:season==='spring'?.56:season==='autumn'?.16:0});
 climateUniforms.spring.value=season==='spring'?1:0;climateUniforms.autumn.value=season==='autumn'?1:0;
 forest.update(camera,quality);renderer.info.reset();renderer.render(scene,camera);
 const arrays=new Set(),staticAttributes=new Set();let staticBytes=0;
 group.traverse(o=>{if(!o.geometry)return;for(const a of Object.values(o.geometry.attributes)){
  if(a.isInstancedBufferAttribute||arrays.has(a.array))continue;arrays.add(a.array);staticBytes+=a.array.byteLength;staticAttributes.add(a);
 }});
 return {...group.userData.deciduous,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,staticBytes,
  plantedObjectsUnchanged:JSON.stringify(planted)===plantedBefore,
  nearbySpecies:[...new Set(group.children.filter(o=>o.name.startsWith('Nearby')).map(o=>o.name.split(' ')[1]))],
  visibleLeafMeshes:group.children.filter(o=>/canopy|leaves/.test(o.name)&&o.visible).length,
  geometryTriangles:[...new Set(group.children.filter(o=>o.isMesh).map(o=>o.geometry.index.count/3))]};
}
window.fixture={draw,forest,group,renderer,scene,camera,ready:true};
</script></body></html>'''

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--url',default='http://127.0.0.1:8779/')
    ap.add_argument('--mobile',action='store_true')
    args=ap.parse_args()
    out=Path('test-output/deciduous-audit');out.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome',headless=True,args=['--enable-webgl','--use-angle=d3d11'])
        options={'viewport':{'width':1200,'height':800}}
        if args.mobile: options.update(user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',has_touch=True,is_mobile=True)
        page=browser.new_page(**options);errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
        page.route('**/deciduous-fixture.html',lambda route:route.fulfill(body=HTML,content_type='text/html'))
        page.goto(args.url.rstrip('/')+'/deciduous-fixture.html',wait_until='networkidle');page.wait_for_function('fixture.ready')
        result={}
        for season,quality in [('winter','HIGH'),('summer','HIGH'),('autumn','HIGH'),('winter','LOW'),('winter','MAX')]:
            key=f'{season}-{quality}';result[key]=page.evaluate('([season,quality])=>fixture.draw(season,quality)',[season,quality])
            assert result[key]['nearTrees']<=result[key]['nearBudget'],result[key]
            assert result[key]['plantedObjectsUnchanged'] and len(result[key]['nearbySpecies'])==2,result[key]
            if season=='winter': assert result[key]['visibleLeafMeshes']==0,result[key]
            page.screenshot(path=str(out/f'{"mobile-" if args.mobile else ""}{key}.png'))
        result['relocation']=page.evaluate('()=>{fixture.camera.position.set(650,3,650);fixture.camera.lookAt(650,6,620);return fixture.draw("winter","HIGH");}')
        result['errors']=errors;assert not errors,errors
        (out/f'{"mobile" if args.mobile else "desktop"}.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
        print(json.dumps(result,indent=2),flush=True);browser.close()

if __name__=='__main__':main()
