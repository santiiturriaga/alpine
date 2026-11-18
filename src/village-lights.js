import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { coniferGeometry, coniferMaterial } from './conifers.js';
import { box, beam, part, cacheStaticTransforms, mergeParts, mergedMesh } from './scenery.js';
import { surfaceMaterial } from './materials.js';
import { mulberry32, noise } from './util.js';
import { buildingData } from '../data/osm-whistler.js';

// Cached OSM node 1210013028 and way 146628098, projected with the same
// EPSG:32610 origin as the terrain. This is Village North, 616 m north of base.
// https://www.whistler.ca/parks-recreation-culture/parks/whistler-olympic-plaza/
// https://highmountainbrewing.ca/contact-us/
export const OLYMPIC_PLAZA = {
  rings: { x: -129.3, z: -616.0 },
  tower: { x: -108.6, z: -598.2 },
  start: { x: -128.1, z: -631.2, heading: -.015, holdAtUnload: true },
};

function clockFace() {
  // All clockwork is geometry: the four faces remain legible in raking light.
  const face = new THREE.Group();
  const ivory = new THREE.MeshStandardMaterial({ color: '#f6d993', emissive: '#ffbc54', emissiveIntensity: .7, roughness: .5 });
  const dark = new THREE.MeshStandardMaterial({ color: '#382e22', roughness: .76 });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(.75,.75,.055,48),ivory);
  disc.rotation.x=Math.PI/2; face.add(disc);
  for(let hour=0;hour<12;hour++) {
    const a=hour*Math.PI/6;
    const tick=new THREE.Mesh(new THREE.BoxGeometry(.035,hour%3===0?.15:.09,.022),dark);
    tick.position.set(Math.sin(a)*.62,Math.cos(a)*.62,.044);
    tick.rotation.z=-a; face.add(tick);
  }
  const hands = [box(.047,.46,.028,'#382e22',[.07,.17,.066],[0,0,-.40]),
    box(.035,.57,.032,'#382e22',[-.15,.20,.081],[0,0,.72])];
  face.add(mergedMesh(hands));
  return { face, ivory };
}

export function buildVillageLighting(scene, { grid } = {}) {
  const root = new THREE.Group(); root.name='Whistler Olympic Plaza · Village North'; scene.add(root);
  const rand=mulberry32(817363);
  const bulbs=[], wires=[], warmMaterials=[], localLights=[], snowCaps=[];
  const lampUniform={value:0};
  let holiday=true, night=0;
  const addBulb=(x,y,z,color='#ffca71')=>bulbs.push({position:[x,y,z],color});
  const light=(x,y,z,power,range=16,festive=false)=>{
    const lamp=new THREE.PointLight('#ffb95f',power,range,1.65);
    lamp.visible=false;
    lamp.position.set(x,y,z); lamp.userData.power=power; lamp.userData.festive=festive;
    root.add(lamp); localLights.push(lamp);
  };
  const stoneMat=surfaceMaterial('granite',{vertexColors:true,roughness:.87});
  const stoneParts=[];
  // Irregular columnar granite/andesite wall in front of the photo landmark.
  const {x:rx,z:rz}=OLYMPIC_PLAZA.rings;
  const y=heightAt(rx,rz), yaw=-2.92;
  const landmark=new THREE.Group(); landmark.position.set(rx,y,rz); landmark.rotation.y=yaw;
  landmark.name='Olympic Plaza white rings · mapped attraction'; root.add(landmark);
  const snowMat=new THREE.MeshStandardMaterial({color:'#e5edf4',roughness:.94});
  const coping=[];
  // Two staggered courses of split-faced retaining stone. Fit each cap to its
  // own block so the ledge has breaks, overhangs and pockets of settled snow.
  for(let row=0;row<2;row++){
    let left=-8.3;
    while(left<8.25){
      const w=Math.min(8.3-left,.44+rand()*1.02),h=.30+rand()*.09;
      const cx=left+w/2,cy=row*.33+h/2-.03,cz=.92+(rand()-.5)*.17;
      const color=['#686468','#716e68','#8a7c73','#67696c','#827c78'][Math.floor(rand()*5)];
      const rotation=[(rand()-.5)*.035,rand()*.075-.038,(rand()-.5)*.06];
      // An eight-sided plan leaves chipped corners between adjacent stones.
      const block=new THREE.CylinderGeometry(1,.99,1,8);
      const transform=[w*.53,h,.50];
      stoneParts.push(part(block,color,[cx,cy,cz],rotation,transform));
      if(row===1)coping.push(part(new THREE.CylinderGeometry(1,1,.095,8),'#e4eaf1',[cx,cy+h/2+.024,cz],rotation,[w*.55,1,.54]));
      left+=w;
    }
  }
  const wall=new THREE.Mesh(mergeParts(stoneParts),stoneMat); wall.castShadow=wall.receiveShadow=true;
  landmark.add(wall);
  const cap=new THREE.Mesh(mergeParts(coping),snowMat); landmark.add(cap); snowCaps.push(cap);
  const bankGeo=new THREE.PlaneGeometry(17,1,94,12), bankPositions=bankGeo.attributes.position;
  const snowPoint=new THREE.Vector3();
  for(let i=0;i<bankPositions.count;i++){
    const x=bankPositions.getX(i), across=.5-bankPositions.getY(i);
    const width=1.15+.55*noise.noise2(x*.91,3.9)+.21*noise.noise2(x*2.6,8);
    const z=1.09+across*width,edge=Math.max(0,1-(Math.abs(x)/8.5)**9);
    const drift=Math.sin(across*Math.PI)**1.7*edge*(.13+.13*noise.noise2(x*1.7,z)+.065*noise.noise2(x*5,z*7));
    snowPoint.set(x,0,z);landmark.localToWorld(snowPoint);
    const sy=heightAt(snowPoint.x,snowPoint.z)-y+drift-.015;
    bankPositions.setXYZ(i,x,sy,z);
  }
  bankGeo.computeVertexNormals();bankGeo.computeBoundingSphere();
  const bank=new THREE.Mesh(bankGeo,snowMat);bank.receiveShadow=true;landmark.add(bank);snowCaps.push(bank);
  const silver=new THREE.MeshStandardMaterial({color:'#e6e8e5',metalness:.38,roughness:.31,emissive:'#7c9ab7',emissiveIntensity:.07});
  for(const [x,cy] of [[-2.48,3.37],[0,3.37],[2.48,3.37],[-1.24,2.24],[1.24,2.24]]) {
    const ring=new THREE.Mesh(new THREE.TorusGeometry(1.13,.122,18,80),silver);
    ring.position.set(x,cy,-.03+(cy<3?.025:0)); ring.castShadow=true; landmark.add(ring);
    const post=new THREE.Mesh(new THREE.CylinderGeometry(.04,.045,cy-1.1,8),silver);
    post.position.set(x,.57+(cy-1.1)/2,0); landmark.add(post);
  }
  grid?.addBox(rx,rz,8.3,1.52,yaw,'landmark');
  const rail=mergedMesh([...[.84,1.05,1.29].map(h=>beam([-8.2,h,.89],[8.2,h,.89],.034,.045,'#a9aeb0')),
    ...[-8,-5.35,-2.67,0,2.67,5.35,8].map(x=>box(.075,.78,.075,'#a99882',[x,1.01,.89]))]);
  landmark.add(rail);
  for(const offset of [-4.25,3.9]){
    const p=landmark.localToWorld(new THREE.Vector3(offset,.35,1.67));
    light(p.x,p.y,p.z,14,5.5);
  }

  // The reference's tower belongs to the adjacent BrewHouse footprint. Its
  // architectural details are modeled from the reference rather than invented
  // on the summit, while the original mapped lodge shell stays in place.
  const {x:tx,z:tz}=OLYMPIC_PLAZA.tower;
  const ty=Math.max(heightAt(tx-2,tz-2),heightAt(tx+2,tz+2));
  const tower=new THREE.Group(); tower.name='BrewHouse clock tower'; tower.position.set(tx,ty,tz); root.add(tower);
  const structure=[box(4.4,9.9,4.4,'#685141',[0,4.95,0]),box(4.8,.34,4.8,'#8a7660',[0,9.9,0]),
    box(4.5,3.5,4.5,'#584c42',[0,11.65,0]),box(4.85,.3,4.85,'#9c8770',[0,13.45,0]),
    part(new THREE.ConeGeometry(3.72,2.2,4),'#3a4146',[0,14.7,0],[0,Math.PI/4,0]),
    box(5.7,.18,5.7,'#6c7377',[0,13.7,0])];
  for(const side of [-1,1]) for(const offset of [-1.95,1.95]){
    structure.push(box(.21,9.9,.21,'#8d7156',[offset,4.96,side*2.24]));
    structure.push(box(.21,9.9,.21,'#8d7156',[side*2.24,4.96,offset]));
  }
  tower.add(mergedMesh(structure));
  const shingles=[], shinglePalette=['#5d4c46','#72594e','#67524c','#80665a','#705b53'];
  for(let row=0;row<34;row++)for(let col=0;col<12;col++){
    const px=(col-5.5+(row%2)*.35)*.36, py=.19+row*.28;
    const color=shinglePalette[Math.floor(rand()*shinglePalette.length)];
    for(const side of [-1,1]){
      shingles.push(box(.36,.305,.055,color,[px,py,side*2.23],[side*.065,0,0]));
      shingles.push(box(.055,.305,.36,color,[side*2.23,py,px],[0,0,-side*.065]));
    }
  }
  tower.add(new THREE.Mesh(mergeParts(shingles),surfaceMaterial('timber',{vertexColors:true})));
  const wing=new THREE.Group();
  wing.scale.x=.856;wing.position.x=5.3;tower.add(wing);
  const lodgeParts=[box(39,1.2,19,'#777675',[16,.2,1.5]),box(39,6.1,19,'#67473a',[16,3.7,1.5])];
  // Long low timber wings and deep snow-laden gables frame, rather than hide,
  // the tower. The generic mapped shell for just this footprint is excluded.
  for(let row=0;row<28;row++) {
    const cy=1+row*.20;
    lodgeParts.push(box(39,.035,.06,'#352f2c',[16,cy,-8.04]),box(39,.035,.06,'#352f2c',[16,cy,11.04]));
  }
  for(const x of [-3.5,3.6,10.7,17.8,24.9,35.5]) for(const z of [-8.13,11.13])
    lodgeParts.push(box(.19,6.4,.20,'#ae8c66',[x,3.6,z]));
  const woodMesh=new THREE.Mesh(mergeParts(lodgeParts),surfaceMaterial('timber',{vertexColors:true,roughness:.86}));
  woodMesh.castShadow=woodMesh.receiveShadow=true;wing.add(woodMesh);
  const panes=[];
  for(const z of [-8.12,11.12])for(const x of [1.1,6.6,12.1,17.6,23.1,28.6,33.6])for(const floor of [0,1]) {
    panes.push(box(3.8,1.8,.04,'#b1803e',[x,2.18+floor*2.8,z]));
    wing.add(mergedMesh([box(.095,1.93,.075,'#b19a71',[x,2.18+floor*2.8,z+(z<0?-.03:.03)]),
      box(3.92,.10,.075,'#b19a71',[x,2.18+floor*2.8,z+(z<0?-.03:.03)])]));
  }
  const wingGlass=new THREE.MeshStandardMaterial({vertexColors:true,emissive:'#ffb85a',emissiveIntensity:.12,roughness:.4});
  wing.add(new THREE.Mesh(mergeParts(panes),wingGlass));warmMaterials.push(wingGlass);
  for(const side of [-1,1]) {
    const angle=side*.29;
    const pitch=new THREE.Mesh(new THREE.BoxGeometry(41,.20,10.52),new THREE.MeshStandardMaterial({color:'#3e4548',roughness:.85}));
    pitch.position.set(16,8.18,1.5+side*5.0);pitch.rotation.x=angle;pitch.castShadow=true;wing.add(pitch);
    const snowPitch=new THREE.Mesh(pitch.geometry,snowMat);snowPitch.position.copy(pitch.position);snowPitch.position.y+=.13;
    snowPitch.rotation.copy(pitch.rotation);wing.add(snowPitch);snowCaps.push(snowPitch);
    for(let j=0;j<95;j++) addBulb(tx+wing.position.x+wing.scale.x*(-4.3+j/94*40.6),ty+6.75,tz+1.5+side*10.0);
  }
  // Roof skins above describe the silhouette; the end triangles are explicit
  // geometry and do not depend on a photograph or texture sheet.
  const triGeo=new THREE.BufferGeometry();triGeo.setAttribute('position',new THREE.Float32BufferAttribute([
    -4.5,6.65,-8,-4.5,9.67,1.5,-4.5,6.65,11,
    36.5,6.65,11,36.5,9.67,1.5,36.5,6.65,-8],3));triGeo.computeVertexNormals();
  wing.add(new THREE.Mesh(triGeo,new THREE.MeshStandardMaterial({color:'#5e493b',side:THREE.DoubleSide,roughness:.88})));
  grid?.addBox(tx+wing.position.x+16*wing.scale.x,tz+1.5,19.8*wing.scale.x,9.8,0,'lodge');
  const clockMaterials=[];
  for(let side=0;side<4;side++) {
    const {face,ivory}=clockFace();
    const angle=side*Math.PI/2;
    face.position.set(Math.sin(angle)*2.29,11.85,Math.cos(angle)*2.29); face.rotation.y=angle;
    tower.add(face); clockMaterials.push(ivory);
  }
  const glassMat=new THREE.MeshStandardMaterial({color:'#a07737',emissive:'#ffad40',emissiveIntensity:.13,roughness:.36});
  warmMaterials.push(glassMat);
  for(const side of [-1,1]) for(let floor=0;floor<3;floor++) {
    const pane=new THREE.Mesh(new THREE.BoxGeometry(2.86-floor*.22,2.65,.04),glassMat);
    const py=1.85+floor*2.71;
    pane.position.set(0,py,side*2.29); tower.add(pane);
    const metal='#695344',trim=[box(.048,2.67,.055,metal,[0,py,side*2.33]),
      box(3-floor*.22,.11,.21,metal,[0,py-1.18,side*2.39]),
      box(3-floor*.22,.052,.095,metal,[0,py-.57,side*2.42])];
    for(let k=-4;k<=4;k++)trim.push(box(.024,.57,.032,metal,[k*.285,py-.87,side*2.42]));
    if(floor<2)trim.push(beam([-1.18,py-1.18,side*2.345],[1.1,py+.94,side*2.345],.09,.07,'#967950'));
    tower.add(mergedMesh(trim));
  }
  light(tx-.6,ty+2.3,tz-2.9,67,16);
  grid?.addBox(tx,tz,2.55,2.55,0,'lodge');
  for(const side of [-1,1]) for(let i=0;i<28;i++) {
    addBulb(tx-2.2+i/27*4.4,ty+9.91,tz+side*2.45);
    addBulb(tx+side*2.45,ty+9.91,tz-2.2+i/27*4.4);
  }
  const roofCap=new THREE.Mesh(new THREE.ConeGeometry(3.75,2.21,4),snowMat);
  roofCap.rotation.y=Math.PI/4; roofCap.position.set(0,14.75,0);tower.add(roofCap);snowCaps.push(roofCap);

  // The faceted north bay of Eagle Lodge is visible between the clock tower
  // and rings. Its wall vertices are in the surveyed building footprint.
  const eagle=buildingData.find(b=>b.id==='146630821');
  if(eagle){
    const bay=new THREE.Group(),cx=-102.2,cz=-541.9;
    const floor=Math.max(...eagle.points.map(([x,z])=>heightAt(x,z)))+9.35;
    bay.name='Eagle Lodge · north corner turret';bay.position.set(cx,floor,cz);root.add(bay);
    const timber=[],panes=[],roofEdges=[],count=8,radius=10.45,apex=7.7,eave=2.62;
    const point=(i,r,h)=>[Math.sin((i+.5)*Math.PI/4)*r,h,Math.cos((i+.5)*Math.PI/4)*r];
    const band=(r,h,depth,color)=>part(new THREE.CylinderGeometry(r,r,depth,count,Math.PI/8),color,[0,h,0]);
    timber.push(band(radius,1.02,2.76,'#765f57'),band(radius+.49,eave,.22,'#9e8976'),
      band(radius+.45,-.16,.28,'#654f43'),band(radius+.23,-2.75,.22,'#7d685d'));
    for(let i=0;i<count;i++){
      const a=point(i,radius,0),b=point(i+1,radius,0),angle=(i+1)*Math.PI/4;
      for(let j=0;j<3;j++){
        const t=(j+.5)/3;
        const at=[THREE.MathUtils.lerp(a[0],b[0],t)+Math.sin(angle)*.04,1.17,
          THREE.MathUtils.lerp(a[2],b[2],t)+Math.cos(angle)*.04];
        panes.push(box(1.57,1.45,.06,'#718395',at,[0,angle,0]));
        timber.push(box(.056,1.47,.085,'#745b4b',at,[0,angle,0]));
      }
      for(const h of [-2.0,-.82,-.38,2.53]){
        roofEdges.push(beam(point(i,radius+.46,h),point(i+1,radius+.46,h),.055,.08,'#9a8d81'));
      }
      timber.push(beam(point(i,radius+.08,-2.78),point(i,radius+.08,2.50),.14,.15,'#745c4d'));
      roofEdges.push(beam(point(i,radius+.57,eave+.07),[0,apex+.056,0],.085,.10,'#79828a'));
    }
    bay.add(mergedMesh(timber),mergedMesh(roofEdges),mergedMesh(panes,{roughness:.31,metalness:.13}));
    const roof=new THREE.ConeGeometry(radius+.60,apex-eave,8,1,false,Math.PI/8);
    const copper=new THREE.Mesh(roof,new THREE.MeshStandardMaterial({color:'#606e74',metalness:.27,roughness:.60}));
    copper.position.y=(apex+eave)/2;bay.add(copper);
    const snowRoof=new THREE.Mesh(roof,snowMat);snowRoof.scale.set(.997,.998,.997);
    snowRoof.position.y=copper.position.y+.05;bay.add(snowRoof);snowCaps.push(snowRoof);
  }

  const treeDefinitions=[[-130.6,-609.3,10.3],[-138,-608.6,8.7],[-118,-607.7,7.25],
    [-139,-634,10.9],[-119,-639,8.7],[-110,-651,12],[-148,-659,10.2],[-171,-637,9.2],[-101,-624,8.8]];
  const holidayRoot=new THREE.Group(); holidayRoot.name='Village festive spruce lights'; root.add(holidayRoot);
  const treeMaterial=coniferMaterial(-1);
  const treeLights=['#6241ff','#5384ff','#ff6649','#ffae52','#9f90ff','#ff9748','#9894ff','#ffe8a8','#ff7963'];
  for(const [i,[x,z,h]] of treeDefinitions.entries()) {
    const y=heightAt(x,z);
    const spruce=new THREE.Mesh(coniferGeometry('spruce',0,i%3),treeMaterial);
    spruce.scale.set(h,h,h); spruce.position.set(x,y,z); spruce.rotation.y=rand()*Math.PI*2;
    // The forest's 'tree' colliders carry an instanced-tree batch. These
    // individually authored plaza spruces have their own draw meshes.
    spruce.castShadow=spruce.receiveShadow=true; root.add(spruce); grid?.addCircle(x,z,.40,'plaza-tree');
    const pitch=.52, loops=h/pitch;
    const length=Math.ceil(loops*23), path=[];
    for(let j=0;j<length;j++) {
      const u=j/(length-1), cy=.7+u*(h-.85), a=u*loops*Math.PI*2;
      const r=(1-u)*h*.185+.055;
      const bx=x+Math.cos(a)*r, bz=z+Math.sin(a)*r;
      if(j%2===0) addBulb(bx,y+cy,bz,treeLights[i%treeLights.length]);
      path.push(new THREE.Vector3(bx,y+cy,bz));
    }
    wires.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path),Math.min(450,length),.006,3,false));
    if(i<2)light(x,y+2.9,z,13,8,true);
  }
  // Plaza maples carry smaller lamps along their actual forks. Branches,
  // cables and bulbs have depth when the player walks around them.
  const twigs=[];
  const maple=(x,z,h,color)=>{
    const ground=heightAt(x,z),start=new THREE.Vector3(x,ground,z);
    grid?.addCircle(x,z,.18,'plaza-tree');
    const fork=(p,azimuth,slope,len,r,level)=>{
      const radial=len*Math.sin(slope);
      const q=p.clone().add(new THREE.Vector3(Math.cos(azimuth)*radial,len*Math.cos(slope),Math.sin(azimuth)*radial));
      const rotation=new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0,1,0),q.clone().sub(p).normalize()));
      twigs.push(part(new THREE.CylinderGeometry(r*.63,r,len,5),'#5b4a42',
        p.clone().lerp(q,.5).toArray(),rotation.toArray().slice(0,3)));
      for(let t=.10;t<len;t+=.18){
        const at=p.clone().lerp(q,t/len),a=t*15;
        addBulb(at.x+Math.cos(a)*r,at.y,at.z+Math.sin(a)*r,rand()<.065?'#ffc176':color);
      }
      if(!level)return;
      for(let i=0;i<(level>2?3:2);i++)fork(p.clone().lerp(q,.77+rand()*.22),azimuth+i*2.39+rand()*.91,
        .24+rand()*.74,len*(.61+rand()*.22),r*.60,level-1);
    };
    fork(start,rand()*6,.07,h*.38,.11,4);
  };
  maple(-119.7,-612.8,6.8,'#ff3429');maple(-113.6,-613.2,5.2,'#fec83c');maple(-136.7,-607.2,5.8,'#ea4469');
  root.add(mergedMesh(twigs));

  // Arcade and timber balconies follow the surveyed plaza-facing walls.
  const arcade=[], arcadeSnow=[],hotel=buildingData.find(b=>b.id==='146589337');
  if(hotel){
    const ground=Math.max(...hotel.points.map(([x,z])=>heightAt(x,z)));
    for(let i=0;i<hotel.points.length;i++){
      const [ax,az]=hotel.points[i],[bx,bz]=hotel.points[(i+1)%hotel.points.length];
      const dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz);
      if((ax+bx)/2 < -170||dz<5)continue;
      const nx=dz/len,nz=-dx/len,rotation=[0,-Math.atan2(dz,dx),0];
      const along=(t,y,w)=>[ax+dx*t+nx*w,y,az+dz*t+nz*w];
      const deck=(w,h,d,c,t,y,out)=>box(w,h,d,c,along(t,y,out),rotation);
      const bays=Math.ceil(len/4.8);
      for(let floor=0;floor<2;floor++){
        const y=ground+3.44+floor*2.83,depth=floor===0?1.36:.99;
        arcade.push(deck(len+.12,.23,depth,'#675448',.5,y,depth/2));
        arcade.push(deck(len+.12,.074,.093,'#857868',.5,y+1.03,depth));
        arcadeSnow.push(deck(len+.12,.045,.14,'#e5edf2',.5,y+1.085,depth));
        for(let j=0;j<bays;j++){
          const t=(j+.08)/bays;
          arcade.push(deck(.16,2.82,.16,'#756251',t,y-1.49,depth-.12));
          if(!floor)arcade.push(deck(.31,.71,.33,'#84827f',t,y-2.55,depth-.12));
          for(let k=0;k<7;k++)arcade.push(deck(.028,.82,.032,'#454548',(j+(k+.4)/7)/bays,y+.53,depth));
          for(let k=0;k<9;k++){
            const at=along((j+k/9)/bays,y-.12,depth+.015);
            addBulb(...at,'#ffba60');
          }
        }
      }
    }
    if(arcade.length)root.add(mergedMesh(arcade));
    if(arcadeSnow.length){const s=new THREE.Mesh(mergeParts(arcadeSnow),snowMat);root.add(s);snowCaps.push(s);}
  }
  const paths=[ [[-171,-637],[-139,-634]], [[-139,-634],[-119,-639]], [[-119,-639],[-110,-651]], [[-148,-659],[-110,-651]] ];
  for(const [a,b] of paths) {
    const ay=heightAt(...a)+5.1, by=heightAt(...b)+5.1, path=[];
    const length=Math.hypot(a[0]-b[0],a[1]-b[1]), count=Math.ceil(length/.42);
    for(let j=0;j<=count;j++) {
      const u=j/count, x=THREE.MathUtils.lerp(a[0],b[0],u), z=THREE.MathUtils.lerp(a[1],b[1],u);
      const y=THREE.MathUtils.lerp(ay,by,u)-Math.sin(u*Math.PI)*1.3;
      path.push(new THREE.Vector3(x,y,z)); addBulb(x,y-.06,z);
    }
    wires.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path),count*2,.011,3,false));
  }
  const wireMat=new THREE.MeshStandardMaterial({color:'#333a36',roughness:.85});
  for(const wire of wires) holidayRoot.add(new THREE.Mesh(wire,wireMat));
  const bulbMat=new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false});
  const bulbMesh=new THREE.InstancedMesh(new THREE.SphereGeometry(.041,5,4),bulbMat,bulbs.length);
  bulbMesh.name='Individual warm village bulbs';const matrix=new THREE.Matrix4();
  for(const [i,bulb] of bulbs.entries()) {matrix.makeTranslation(...bulb.position);bulbMesh.setMatrixAt(i,matrix);bulbMesh.setColorAt(i,new THREE.Color(bulb.color));}
  holidayRoot.add(bulbMesh);
  // A procedural screen-sized halo per bulb; the emitters themselves remain
  // real geometry and the nearby snow receives light from bounded point lights.
  const haloGeo=new THREE.BufferGeometry();haloGeo.setAttribute('position',new THREE.Float32BufferAttribute(bulbs.flatMap(b=>b.position),3));
  haloGeo.setAttribute('lampColor',new THREE.Float32BufferAttribute(bulbs.flatMap(b=>new THREE.Color(b.color).toArray()),3));
  const haloMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
    uniforms:{strength:lampUniform},
    vertexShader:`attribute vec3 lampColor; varying vec3 tint; varying float attenuation; void main(){tint=lampColor;vec4 p=modelViewMatrix*vec4(position,1.);attenuation=1.-smoothstep(90.,280.,-p.z);gl_PointSize=clamp(160./max(3.,-p.z),2.,15.);gl_Position=projectionMatrix*p;}`,
    fragmentShader:`uniform float strength; varying vec3 tint; varying float attenuation;void main(){float r=length(gl_PointCoord-.5)*2.;float a=exp(-r*r*4.)*(1.-smoothstep(.65,1.,r));gl_FragColor=vec4(tint,a*.63*strength*attenuation);}`});
  const halos=new THREE.Points(haloGeo,haloMat);haloGeo.computeBoundingSphere();holidayRoot.add(halos);
  const villageWindows=new Set();
  scene.getObjectByName('Village · mapped building footprints')?.traverse(mesh=>{
    if(mesh.isMesh && mesh.material?.roughness===.42 && mesh.material?.metalness===.1) villageWindows.add(mesh.material);
  });
  for(const mat of villageWindows) {
    mat.onBeforeCompile=shader=>{
      shader.uniforms.villageDusk=lampUniform;
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute vec3 windowPane; varying vec3 glazing;')
        .replace('#include <begin_vertex>','#include <begin_vertex>\n glazing=windowPane;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float villageDusk; varying vec3 glazing;')
        .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
          float seed=glazing.z;
          float lit=step(.21,seed);
          float curtain=smoothstep(.18+seed*.28,.20+seed*.28,abs(glazing.x-.5));
          float pleat=.65+.35*cos(glazing.x*109.+seed*5.);
          float shade=smoothstep(.95-.52*fract(seed*19.),.98-.52*fract(seed*19.),glazing.y)*step(.73,fract(seed*11.));
          vec3 amber=mix(vec3(.95,.46,.15),vec3(.87,.67,.44),fract(seed*26.43));
          float lamp=.31+.42*exp(-3.1*distance(glazing.xy,vec2(fract(seed*83.),.31)));
          totalEmissiveRadiance+=amber*lamp*lit*villageDusk*(1.-curtain*(.48+.29*pleat))*(1.-.82*shade);
          diffuseColor.rgb*=1.-.28*curtain*step(.001,seed);`);
    };
    mat.customProgramCacheKey=()=> 'mapped-village-warm-windows-v2';mat.needsUpdate=true;
  }
  cacheStaticTransforms(root);
  return {
    root, coordinates:OLYMPIC_PLAZA,
    setClimate(state) { holiday=state.season==='winter'||state.season==='autumn'; },
    update(dt,time,state={},camera) {
      night=state.night??night;
      lampUniform.value=night;
      holidayRoot.visible=holiday;
      bulbMat.color.setScalar(.24+night*.96);
      silver.emissiveIntensity=.06+night*.26;
      for(const mat of warmMaterials) mat.emissiveIntensity=.10+night*1.75;
      for(const mat of clockMaterials) mat.emissiveIntensity=.18+night*1.2;
      for(const lamp of localLights){
        lamp.visible=night>.015&&(!camera||camera.position.distanceToSquared(lamp.position)<190*190);
        lamp.intensity=lamp.userData.power*night*(holiday||!lamp.userData.festive?1:0);
      }
      for(const cap of snowCaps)cap.visible=state.season!=='summer'&&state.season!=='autumn';
    },
  };
}
