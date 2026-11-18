import * as THREE from 'three';
import { mergedMesh, part } from './scenery.js';

// Elliptical sections run from tail to nose. The second shoulder mass of the
// black bear and the fox's tapering muzzle give each a distinct profile.
function coat(sections, palette) {
  const vertices=[], colors=[], triangles=[];
  const swatch = new THREE.Color(), lighter = new THREE.Color(palette[1]);
  const sides = 32;
  for (let j=0;j<sections.length;j++) {
    const [z,y,rx,ry] = sections[j];
    for (let i=0;i<sides;i++) {
      const angle=i*2*Math.PI/sides, up=Math.cos(angle);
      const tuft = 1 + .018*Math.sin(i*5+j*7) + .012*Math.cos(i*9-j*3);
      vertices.push(rx*Math.sin(angle)*tuft, y+ry*up*tuft,z);
      swatch.set(palette[0]).lerp(lighter,.16*(1-up)+.09*(1+Math.sin(i*13+j*3)));
      colors.push(swatch.r,swatch.g,swatch.b);
      if (j) {
        const a=j*sides+i,b=j*sides+(i+1)%sides;
        triangles.push(a-sides,b,a,a-sides,b-sides,b);
      }
    }
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  g.setIndex(triangles);g.computeVertexNormals();
  const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.97,side:THREE.DoubleSide}));
  m.castShadow=m.receiveShadow=true;
  return m;
}
const sphere=new THREE.SphereGeometry(1,16,12);
function oval(x,y,z,w,h,d,tint,rx=0) {
  return part(sphere,tint,[x,y,z],[rx,0,0],[w,h,d]);
}

export function forestAnimal(bear) {
  const group=new THREE.Group(),head=new THREE.Group(),tail=new THREE.Group(),legs=[];
  const coatColors=bear?['#302c29','#66564b']:['#ab522e','#f1d9ba'];
  const unit=bear?1:.56;
  group.scale.setScalar(unit);
  group.add(coat(bear ? [[-.79,.66,.018,.04],[-.66,.65,.29,.34],[-.40,.68,.345,.43],
    [-.07,.70,.31,.39],[.22,.76,.35,.43],[.40,.81,.29,.37],[.55,.84,.19,.22],[.60,.86,.02,.04]] :
    [[-.80,.70,.02,.03],[-.66,.70,.185,.25],[-.36,.71,.22,.28],[.05,.73,.21,.26],[.37,.81,.19,.29],
    [.50,.88,.16,.24],[.57,.97,.05,.07]],coatColors));
  head.position.set(0,bear?.97:1.02,bear?.48:.44);
  head.add(coat(bear ? [[-.12,0,.03,.05],[-.05,.014,.21,.20],[.10,.025,.206,.198],[.22,-.018,.151,.14],
    [.31,-.035,.11,.094],[.40,-.04,.078,.056]] : [[-.10,.0,.01,.04],[-.03,.04,.19,.19],[.08,.04,.176,.168],
    [.16,.026,.145,.126],[.28,-.004,.088,.083],[.42,-.032,.044,.042]],coatColors));
  const features=[oval(0,-.037,bear?.405:.426,bear?.073:.046,.042,.033,'#23221f')];
  for(const s of [-1,1]){
    features.push(oval(s*(bear?.146:.123),.071,.177,.024,.028,.020,'#211c18'),
      oval(s*(bear?.155:.136),.081,.19,.005,.006,.006,'#ede7d5'));
    if(bear)features.push(oval(s*.145,.208,-.002,.074,.089,.051,'#4f443a'),
      oval(s*.145,.221,.038,.040,.048,.014,'#2b2724'));
    else {
      features.push(part(new THREE.ConeGeometry(1,1,3),'#6c392b',[s*.12,.25,-.02],[0,s*.18,-s*.15],[.091,.259,.066]),
        part(new THREE.ConeGeometry(1,1,3),'#e9b691',[s*.12,.242,.024],[0,s*.18,-s*.15],[.058,.17,.021]),
        oval(s*.109,-.056,.18,.076,.063,.134,'#e2d0b7'));
    }
    for(const fore of [false,true]){
      const limb=new THREE.Group();limb.position.set(s*(bear?.205:.123),.655,fore?.36:-.48);
      limb.add(mergedMesh([oval(0,-.13,0,bear?.125:.070,.216,bear?.148:.092,coatColors[0],fore?-.09:.29),
        oval(0,-.418,fore?0:-.021,bear?.103:.046,.184,bear?.101:.050,bear?'#392f2a':'#4b352e',fore?.10:-.21),
        oval(0,-.598,.047,bear?.110:.060,.060,bear?.169:.100,'#40362d'),
        ...[-1,0,1].map(toe=>oval(toe*.031,-.615,bear?.178:.127,.016,.023,.032,'#625447'))]));
      group.add(limb);legs.push(limb);
    }
  }
  head.add(mergedMesh(features));group.add(head,tail);
  tail.position.set(0,.73,-.67);
  if(bear)tail.add(mergedMesh([oval(0,0,-.064,.086,.080,.097,'#3a322e')]));
  else {
    tail.add(coat([[-1.04,-.23,.012,.01],[-.89,-.26,.13,.145],[-.61,-.22,.167,.174],
      [-.35,-.13,.148,.146],[-.12,-.03,.112,.107],[.02,.01,.063,.072]],['#ac6137','#cb8d55']));
    tail.add(coat([[-1.10,-.224,.006,.006],[-1.00,-.24,.084,.081],[-.89,-.26,.136,.151]],['#e0d7b7','#faf2df']));
  }
  return {group,head,tail,legs};
}
