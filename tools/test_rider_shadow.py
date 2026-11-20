"""Check the rendered shadow between scenery updates and the jacket's downhill perk."""
import argparse
import json
from playwright.sync_api import sync_playwright


CHECK = """async () => {
  const T = await import('three');
  const { Player } = await import('/src/player.js');
  const { createRiderShadow } = await import('/src/rider-shadow.js');
  const { createLighting } = await import('/src/effects.js');
  const { Outfitter } = await import('/src/outfitter.js');
  const renderer = new T.WebGLRenderer({ antialias:false });
  renderer.setSize(320,192);
  const gl = renderer.getContext();
  const backend = gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL);
  if (!backend.includes('SwiftShader')) throw Error(backend);
  const scene = new T.Scene(), cam = new T.OrthographicCamera(-3.2,3.2,1.92,-1.92,.1,40);
  cam.up.set(0,0,-1); cam.position.set(0,12,0); cam.lookAt(0,0,0);
  const snow = new T.Mesh(new T.PlaneGeometry(40,40),new T.MeshStandardMaterial({color:0xffffff}));
  snow.receiveShadow=true; snow.rotation.x=-Math.PI/2; scene.add(snow);
  const lighting=createLighting(scene), { sun }=lighting;
  const dir=new T.Vector3(-.48,1,-.28).normalize();
  sun.position.copy(dir).multiplyScalar(22);
  sun.shadow.mapSize.set(384,384);
  Object.assign(sun.shadow.camera,{left:-73,right:73,top:73,bottom:-73,near:.1,far:150});
  sun.shadow.camera.updateProjectionMatrix();
  renderer.shadowMap.enabled=true; renderer.shadowMap.type=T.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate=false; renderer.shadowMap.needsUpdate=true;
  const ground={ slope:0,startPose:()=>({x:0,z:0,heading:0}),bounds:{},
    heightAt(x,z){return -z*this.slope},normalAt(x,z,out){return out.set(0,1,this.slope).normalize()},
    surfaceAt(x,z,o){return Object.assign(o,{id:'packed',powder:.04,drag:1,grip:1})} };
  const p=new Player(scene,new T.PerspectiveCamera(),{ground});
  const outfit=new Outfitter(p,()=>{});
  const shadow=createRiderShadow(renderer,lighting,p);
  outfit.dialog.addEventListener('outfitterchange',shadow.equipmentChanged);
  const target=new T.WebGLRenderTarget(320,192);
  const rgba=new Uint8Array(320*192*4);
  renderer.setRenderTarget(target);
  function pixels(active) {
    shadow.update(active,dir);
    // Isolate the shadow in the framebuffer. Its articulated pose is still live.
    p.model.visible=false;
    renderer.render(scene,cam);
    p.model.visible=true;
    renderer.readRenderTargetPixels(target,0,0,320,192,rgba);
  }
  pixels(false);
  const clear=new Uint8Array(rgba), centroids=[];
  for(let i=0;i<14;i++) {
    p.teleport({x:-1.1+i*.08,z:0,heading:0});
    pixels(true);
    let weightedX=0, weight=0;
    for(let j=0;j<320*192;j++) {
      const diff=clear[j*4]-rgba[j*4];
      if(diff<3)continue;
      weight+=diff; weightedX+=(j%320)*diff;
    }
    if(weight<100)throw Error('Missing rendered rider shadow on frame '+i);
    centroids.push(weightedX/weight);
  }
  for(let i=1;i<centroids.length;i++) {
    const shift=centroids[i]-centroids[i-1];
    if(Math.abs(shift-4)>.28)throw Error('Shadow drift: '+JSON.stringify(centroids));
  }
  pixels(false);
  if(rgba.some((v,i)=>v!==clear[i]))throw Error('Ghost rider on snow after dismount');
  const speeds={};
  ground.slope=.46;
  for(const discipline of ['ski','snowboard']) {
    for(const jacket of ['#ad4939','summit-shell','#ad4939']) {
      outfit.equipCustomization('jacket',jacket);
      p.setEquipment({discipline});
      p.teleport({x:0,z:0,heading:0});
      p.vel.z=27;
      for(let i=0;i<1800;i++)p.simulate(1/60,{tuck:true},i/60);
      const key=discipline+jacket;
      if(key in speeds && Math.abs(speeds[key]-p.vel.z)>.001)throw Error('Unequip retained perk');
      speeds[key]=p.vel.z;
    }
    const ratio=speeds[discipline+'summit-shell']/speeds[discipline+'#ad4939'];
    if(ratio<1.06 || ratio>1.081)throw Error('Downhill shell perk '+ratio);
  }
  return {backend,shadowCentersPx:centroids,speeds};
}"""


if __name__ == '__main__':
    args = argparse.ArgumentParser()
    args.add_argument('--url', default='http://127.0.0.1:8080/')
    base = args.parse_args().url.rstrip('/')
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--disable-gpu','--disable-gpu-compositing','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        page = browser.new_page()
        errors = []
        page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
        page.route('**/shadow-fixture', lambda route: route.fulfill(content_type='text/html',body=
            '<script type="importmap">{"imports":{"three":"/vendor/three.module.js"}}</script>'
            '<dialog id="outfitter"><button data-shop-close></button></dialog>'))
        page.goto(base+'/shadow-fixture')
        print(json.dumps(page.evaluate(CHECK),indent=2))
        assert not errors,errors
        browser.close()
