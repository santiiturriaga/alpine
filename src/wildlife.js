import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { MOUNTAIN } from './worlddata.js';
import { mergedMesh,part } from './scenery.js';
import { mulberry32 } from './util.js';

// Ring-built bodies and separate flight feathers keep the silhouette from
// collapsing into intersecting spheres when a bird turns or lifts a wing.
function body(rings,tint,seed) {
  const vertices=[],colors=[],indices=[],ring=28,random=mulberry32(seed),c=new THREE.Color();
  for(const [j,[z,y,rx,ry,color]] of rings.entries()){
    for(let k=0;k<ring;k++){
      const a=k/ring*Math.PI*2,dy=Math.cos(a);
      vertices.push(rx*Math.sin(a),y+ry*dy,z);
      c.set(color||tint).multiplyScalar(.85+.13*random()+.13*(1+dy)*.5);
      colors.push(c.r,c.g,c.b);
      if(j){const n=j*ring+k,b=j*ring+(k+1)%ring;indices.push(n-ring,n,b,n-ring,b,b-ring);}
    }
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  g.setIndex(indices);g.computeVertexNormals();
  const mesh=new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.89}));
  mesh.castShadow=true;return mesh;
}
function ellipsoid(x,y,z,w,h,d,color,rot=[0,0,0]){
  return part(new THREE.SphereGeometry(1,16,12),color,[x,y,z],rot,[w,h,d]);
}
function bird(){
  const group=new THREE.Group(),head=new THREE.Group();group.add(head);
  group.add(body([[-.16,.089,.004,.005],[-.095,.10,.044,.044],[-.025,.11,.057,.062],
    [.035,.127,.055,.064,'#c8ccc5'],[.078,.145,.033,.038,'#cecfca'],[.092,.16,.004,.004]],'#869193',56));
  head.position.set(0,.172,.048);
  head.add(body([[-.042,.003,.002,.002],[-.023,.009,.039,.038,'#515b5e'],[.007,.018,.042,.042,'#aeb4b0'],
    [.033,.016,.034,.035,'#e3e3d8'],[.049,.009,.019,.019,'#e7e5d9'],[.05,.006,.001,.001]],'#cbcfc6',41));
  const details=[];
  for(const s of [-1,1]){
    details.push(ellipsoid(s*.035,.025,.03,.005,.005,.004,'#191d1f'));
    details.push(ellipsoid(s*.038,.027,.033,.0013,.0011,.0011,'#ede9da'));
  }
  head.add(mergedMesh(details),body([[.044,.009,.014,.011],[.068,.006,.010,.006],[.08,.003,.0007,.001]],'#303437',81));
  const wings=[];
  for(const s of [-1,1]){
    const wing=new THREE.Group();wing.position.set(s*.039,.138,.012);
    const feathers=[];
    for(let i=0;i<9;i++)feathers.push(ellipsoid(s*(.008+.0022*i),-.008-i*.0015,-.054+i*.0048,
      .009,.009,.098-i*.006,i%3===0?'#929997':'#636e72',[.08,s*(.067+i*.014),0]));
    wing.add(mergedMesh(feathers));group.add(wing);wings.push(wing);
  }
  const extremities=[];
  for(let i=0;i<7;i++)extremities.push(ellipsoid((i-3)*.0047,.096,-.146,.009,.005,.068,'#738082',[.08,(i-3)*.027,0]));
  for(const s of [-1,1]){
    extremities.push(ellipsoid(s*.023,.034,.018,.003,.028,.003,'#43443e'));
    for(let i=-1;i<=1;i++)extremities.push(ellipsoid(s*.023+i*.004,.011,.024,.002,.002,.014,'#494740',[0,i*.43,0]));
  }
  group.add(mergedMesh(extremities));
  return {group,head,wings};
}
function marmot(){
  const group=new THREE.Group(),head=new THREE.Group();group.add(head);
  group.add(body([[-.315,.107,.008,.015],[-.234,.152,.102,.106,'#695d50'],[-.14,.178,.145,.149],
    [-.025,.194,.154,.159,'#909189'],[.08,.204,.114,.135,'#a6a59a'],[.146,.226,.074,.081],[.166,.23,.002,.003]],'#858378',24));
  head.position.set(0,.245,.119);
  head.add(body([[-.055,.022,.005,.004],[-.021,.035,.093,.074,'#8b8b7f'],[.039,.034,.092,.081,'#919084'],
    [.096,.013,.069,.055,'#aca89b'],[.149,-.003,.046,.034,'#a49c8c'],[.168,-.003,.014,.01]],'#787b73',55));
  const face=[ellipsoid(0,.009,.158,.029,.018,.018,'#302d29')],feet=[];
  for(const s of [-1,1]){
    face.push(ellipsoid(s*.067,.093,-.002,.025,.024,.019,'#685e52'),
      ellipsoid(s*.071,.092,.012,.016,.014,.006,'#8f8070'),
      ellipsoid(s*.079,.053,.067,.013,.012,.013,'#282824'),ellipsoid(s*.088,.057,.072,.003,.003,.003,'#d7d3bd'));
    for(const z of [-.136,.116])feet.push(ellipsoid(s*.094,.047,z,.046,.038,.072,'#554e45'));
  }
  head.add(mergedMesh(face));group.add(mergedMesh(feet));
  const tail=body([[-.48,.071,.002,.004],[-.425,.075,.025,.025],[-.36,.088,.042,.033],[-.26,.117,.055,.048],[-.184,.127,.005,.004]],'#66564b',22);
  tail.rotation.y=.24;group.add(tail);
  return {group,head,tail};
}
export const WILDLIFE_START={x:478,z:4838,heading:-.87,holdAtUnload:true};
export function buildWildlife(scene,shop,audio) {
  const sites=[
    {id:'grey-jay',title:'Canada jay',hint:'Listen near the Roundhouse deck.',x:474.8,z:4841.5,bird:true},
    {id:'alpine-marmot',title:'Hoary marmot',hint:'Look by the rocks above Rendezvous during the thaw.',
      x:MOUNTAIN.rendezvous.x+56,z:MOUNTAIN.rendezvous.z+29,bird:false},
  ];
  for(const s of sites){
    const animal=s.bird?bird():marmot();Object.assign(s,animal);
    const y=heightAt(s.x,s.z),r=mulberry32(215);
    const stones=Array.from({length:7},(_,i)=>part(new THREE.DodecahedronGeometry(1,1),
      i%2?'#77786c':'#6e7776',[s.x+(i? (r()-.5)*1.8:0),y+.05,s.z+(i?(r()-.5)*1.18:0)],
      [.1,r()*4,.16],i?[.30+r()*.3,.16+r()*.16,.36]:[.66,.48,.53]));
    scene.add(mergedMesh(stones),s.group);s.base=y+.49;s.group.position.set(s.x,s.base,s.z);s.timer=0;s.cooldown=0;
    s.group.name=s.title;
  }
  shop.catalog=[...(shop.catalog||[]),...sites];
  return {
    sites,
    nearest(p){return sites.find(s=>s.group.visible&&Math.hypot(p.x-s.x,p.z-s.z,p.y-s.base)<5.8);},
    observe(s){if(s.cooldown>0)return;
      s.timer=2.7;s.cooldown=3.1;
      const tones=s.bird?[1780,2140,1860]:[1650,2040];
      tones.forEach((f,i)=>audio.tone(f,{dur:s.bird?.12:.24,gain:.032,when:i*.19,attack:.028,slide:f*(s.bird?1.10:.77)}));
      return shop.find(s.id,4);
    },
    update(dt,t,season,p){
      for(const s of sites){
        s.group.visible=s.bird||season!=='winter';if(!s.group.visible)continue;
        s.cooldown=Math.max(0,s.cooldown-dt);s.timer=Math.max(0,s.timer-dt);
        if(Math.hypot(p.x-s.x,p.z-s.z)>65)continue;
        const gesture=Math.sin(s.timer/2.7*Math.PI);
        s.head.rotation.y=Math.sin(t*(s.bird?2.1:.84))*(s.bird?.45:.17);
        s.group.rotation.y=Math.atan2(p.x-s.x,p.z-s.z)+Math.sin(t*.8)*.10;
        if(s.bird){
          s.group.position.y=s.base+gesture*.49;
          s.wings.forEach((w,i)=>w.rotation.z=(i?1:-1)*gesture*(.55+.72*Math.sin(t*26)));
        }else{s.head.rotation.x=-.23*gesture;s.tail.rotation.y=.24+Math.sin(t*.72)*.06;}
      }
    },
  };
}
