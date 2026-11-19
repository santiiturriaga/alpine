import * as THREE from 'three';
import { guestVisibility } from './guest-visibility.js';
import { MOUNTAIN } from './worlddata.js';
import { heightAt, normalAt } from './terrain.js';
import { mulberry32, clamp, makeCanvas, canvasTexture } from './util.js';
import { part, box, mergeParts } from './scenery.js';
import { guestClear } from './guest-navigation.js';
import { createGuestSimulation } from './guest-simulation.js';

// Identity and simulation stay alive outside the camera. Distance batches
// preserve clothing and equipment silhouettes with fewer articulated parts.
const MAX_VISIBLE = 420;
const JACKETS = {
  green:[0x39935b,0x57a269,0x267344,0x80a862],
  blue:[0x2878ad,0x3e6f9b,0x528cae,0x275d83],
  black:[0x20282d,0x303237,0x252c33,0x394043],
};
const PANTS=[0x26303a,0x3d474c,0x75695a,0x463e45,0x9b9786,0x39473c];
const HELMETS=[0xe0dbce,0x30393e,0x756e68,0xd28d4c,0x607b82];
const TOPICS=[
  ['Shall we do one more before lunch?','Yes! Meet you by the blue sign.'],
  ['That snow was lovely up there.','Let’s stay together on the next run.'],
  ['Coffee first, or another lap?','One more lap. Then hot chocolate.'],
  ['I’ll wait just below the bend.','Perfect. Give me a little space.'],
  ['How are your legs feeling?','A little tired. Let’s take a breather.'],
  ['Ready for the next chair?','Almost. Just fixing this glove.'],
];

// Elliptic garment sections, with optional rounded rectangular pack sections.
// The folds are part of the silhouette, so they remain visible without textures.
function loft(profile,{sides=20,folds=0,square=1}={}) {
  const vertices=[],indices=[];
  for(let j=0;j<profile.length;j++) {
    const [y,w,d,z=0]=profile[j];
    for(let i=0;i<=sides;i++) {
      const a=i/sides*Math.PI*2,s=Math.sin(a),c=Math.cos(a);
      const fold=1+folds*(Math.sin(a*5+y*39)+.45*Math.sin(a*9-y*61));
      vertices.push(Math.sign(s)*Math.abs(s)**square*w*fold,y,z+Math.sign(c)*Math.abs(c)**square*d*fold);
      if(i<sides&&j<profile.length-1){const k=j*(sides+1)+i;indices.push(k,k+1,k+sides+1,k+1,k+sides+2,k+sides+1);}
    }
  }
  for(const top of [false,true]){
    const ring=top?profile.length-1:0,[y,,,z=0]=profile[ring],center=vertices.length/3;vertices.push(0,y,z);
    for(let i=0;i<sides;i++){const k=ring*(sides+1)+i;if(top)indices.push(center,k,k+1);else indices.push(center,k+1,k);}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();
  return g;
}

function pipe(points,radius=.004) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),Math.max(6,points.length*3),radius,5,false);
}

function boardGeometry(board) {
  const length=board?1.54:1.82,width=board?.29:.105,vertices=[],indices=[],rows=[];
  const half=length*.5,cap=board?.145:.12,straight=half-cap;
  for(let i=0;i<=9;i++)rows.push(-half+cap*(1-Math.cos(i/9*Math.PI*.5)));
  for(let i=1;i<13;i++)rows.push(-straight+straight*2*i/13);
  for(let i=0;i<=9;i++)rows.push(straight+cap*Math.sin(i/9*Math.PI*.5));
  // True semicircular caps in plan, with rocker that rises through the nose.
  for(let i=0;i<rows.length;i++) {
    const z=rows[i],tip=Math.abs(z)/half,u=Math.max(0,(Math.abs(z)-straight)/cap);
    const w=Math.max(.0008,width*.5*(board?.94+.06*tip*tip:.84+.16*tip*tip)*Math.sqrt(Math.max(0,1-u*u)));
    const y=.023+Math.max(0,(tip-.70)/.30)**2*(board?.060:.078);
    vertices.push(-w,y,z,w,y,z,-w,y-.013,z,w,y-.013,z);
    if(i<rows.length-1){const k=i*4;indices.push(k,k+4,k+1,k+1,k+4,k+5,k+2,k+3,k+6,k+3,k+7,k+6,
      k,k+2,k+4,k+2,k+6,k+4,k+1,k+5,k+3,k+3,k+5,k+7);}
  }
  const end=(rows.length-1)*4;indices.push(0,1,2,1,3,2,end,end+2,end+1,end+1,end+2,end+3);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  g.setIndex(indices);g.computeVertexNormals();return g;
}

function guestGeometry() {
  const jacket=loft([[-.06,.169,.117,-.017],[-.035,.184,.131,-.015],[.018,.182,.130,-.013],
    [.11,.175,.119,-.015],[.22,.177,.114,-.012],[.33,.196,.131,-.004],[.44,.221,.135,.003],
    [.49,.215,.121,.007],[.535,.164,.095,.010],[.575,.091,.077,.015]],{folds:.012,sides:24});
  const hood=loft([[.49,.092,.061,-.070],[.535,.114,.089,-.077],[.59,.113,.100,-.071],
    [.65,.096,.088,-.052],[.69,.078,.061,-.011]],{folds:.025});
  const hem=loft([[-.061,.171,.120,-.017],[-.049,.183,.131,-.015],[-.037,.184,.132,-.015]],{sides:24});
  const jacketParts=[part(jacket,0xffffff),part(hood,0xadb7b3),part(hem,0xc2c8c4),
    part(pipe([[0,-.025,.119],[0,.17,.113],[0,.34,.132],[0,.50,.122],[0,.57,.093]],.003),0x41494b)];
  for(const side of [-1,1])jacketParts.push(part(pipe([[side*.135,.08,.080],[side*.105,.18,.100],[side*.075,.235,.108]],.0035),0x7f8986));
  const sleeve=loft([[-.54,.86,.90],[-.48,1.03,1.01],[-.35,1.10,1.05],[-.16,1.03,1.0],
    [.06,.96,.94],[.20,.94,.96],[.33,.87,.89],[.43,.83,.86],[.49,.87,.88],[.53,.77,.78]],{folds:.024,sides:16});
  const trousers=loft([[-.53,.98,.98],[-.45,1.09,1.08],[-.31,1.09,1.04],[-.13,1.03,.99],
    [.05,.96,.98],[.21,.95,.95],[.33,1.0,1.03],[.42,.98,1.02],[.48,1.04,1.04],[.53,.96,.95]],{folds:.026,sides:16});
  const helmet=loft([[-.65,.80,.93,-.06],[-.56,.99,1.04,-.04],[-.28,1.03,1.09,-.02],
    [.12,.99,1.06,-.035],[.48,.87,.94,-.08],[.74,.63,.73,-.09],[.91,.30,.39,-.07],[.95,.015,.02,-.06]],{sides:24});
  const helmetParts=[part(helmet,0xffffff),part(loft([[-.66,.82,.94,-.06],[-.59,.99,1.045,-.04]],{sides:24}),0x707a7b)];
  for(const side of [-1,1])for(const x of [.35,.57])helmetParts.push(part(pipe([[side*x,.50,-.63],[side*(x+.025),.63,-.41],[side*(x+.015),.69,-.20]],.025),0x879196));
  const outline=new THREE.Shape();outline.moveTo(-.95,.38);
  outline.quadraticCurveTo(-1.03,.86,-.65,.91);outline.quadraticCurveTo(0,.78,.65,.91);outline.quadraticCurveTo(1.03,.86,.95,.38);
  outline.lineTo(.90,-.42);outline.quadraticCurveTo(.72,-.92,.30,-.76);outline.quadraticCurveTo(.17,-.72,.13,-.40);
  outline.quadraticCurveTo(0,-.23,-.13,-.40);outline.quadraticCurveTo(-.17,-.72,-.30,-.76);outline.quadraticCurveTo(-.72,-.92,-.90,-.42);outline.closePath();
  const lens=new THREE.ExtrudeGeometry(outline,{depth:.14,bevelEnabled:true,bevelSize:.07,bevelThickness:.06,bevelSegments:1,curveSegments:5});
  const lensPos=lens.attributes.position;for(let i=0;i<lensPos.count;i++)lensPos.setZ(i,lensPos.getZ(i)-lensPos.getX(i)**2*.44);lens.computeVertexNormals();
  const goggles=mergeParts([part(lens,0x272e34,[0,0,-.12],[0,0,0],[1.09,1.12,1.1]),part(lens,0xffffff,[0,0,.05])]);
  const boot=loft([[-.5,.45,.47,.03],[-.43,.51,.51,.035],[-.30,.50,.50,.03],[-.10,.46,.45,-.015],
    [.02,.41,.36,-.10],[.20,.38,.28,-.18],[.45,.39,.29,-.18],[.5,.36,.27,-.18]],{sides:20,square:.7});
  const bootParts=[part(boot,0xffffff),part(loft([[-.51,.45,.48,.03],[-.45,.52,.52,.035],[-.40,.51,.51,.035]],{sides:20,square:.7}),0x717a80),
    box(.72,.045,.045,0xd7dedc,[0,.33,.10]),box(.78,.045,.045,0xc6cfce,[0,.12,.15]),box(.76,.045,.05,0xc6cfce,[0,-.12,.39])];
  const bindingParts=[box(.96,.13,.97,0xa3b2b7,[0,-.36,0]),box(.67,.22,.16,0xe0e6e2,[0,-.08,.40]),
    box(.68,.20,.13,0x8b999e,[0,.02,-.41])];
  for(const side of [-1,1])bindingParts.push(box(.15,.31,.23,0xabb8bb,[side*.43,-.02,.38]),
    box(.12,.68,.31,0xa4b2b6,[side*.43,.04,-.36],[side*.05,0,-side*.12]));
  const packBody=loft([[-1,.64,.58],[-.88,.88,.85],[-.60,.98,.95],[.30,.95,.95],[.70,.80,.81],[.94,.44,.56],[1,.15,.24]],{sides:20,square:.55,folds:.009});
  const pocket=loft([[-.70,.54,.20,-.91],[-.57,.73,.32,-.95],[.08,.72,.33,-.95],[.28,.56,.24,-.92],[.34,.24,.12,-.89]],{sides:16,square:.6});
  const packParts=[part(packBody,0xffffff),part(pocket,0xb5bfba),box(1.30,.036,.035,0x566560,[0,.12,-1.24]),
    part(pipe([[-.30,.89,.10],[-.29,1.10,.04],[.29,1.10,.04],[.30,.89,.10]],.065),0x6e7e78)];
  for(const s of [-1,1])packParts.push(part(pipe([[s*.48,.80,.69],[s*.68,.35,.85],[s*.64,-.64,.80]],.078),0x84958c));
  return {jacket:mergeParts(jacketParts),sleeve,trousers,helmet:mergeParts(helmetParts),goggles,boots:mergeParts(bootParts),binding:mergeParts(bindingParts),pack:mergeParts(packParts)};
}

function buildBatches(parent) {
  const cloth=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.83,vertexColors:true});
  const hard=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.36,metalness:.16,vertexColors:true});
  const glass=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.2,metalness:.38,vertexColors:true});
  const cylinder=new THREE.CylinderGeometry(1,1,1,8),sphere=new THREE.SphereGeometry(1,12,8),box=new THREE.BoxGeometry(1,1,1);
  const shaped=guestGeometry();
  const definitions={jacket:[shaped.jacket,1,cloth],pelvis:[sphere,1,cloth],sleeve:[shaped.sleeve,4,cloth],trousers:[shaped.trousers,4,cloth],
    gloves:[sphere,2,cloth],face:[sphere,1,cloth],helmet:[shaped.helmet,1,hard],goggles:[shaped.goggles,1,glass],boots:[shaped.boots,2,hard],
    binding:[shaped.binding,2,hard],skis:[boardGeometry(false),2,hard],boards:[boardGeometry(true),1,hard],
    poles:[cylinder,2,hard],pack:[shaped.pack,1,cloth],trim:[box,2,cloth],joints:[sphere,4,cloth],
    cups:[new THREE.CylinderGeometry(.045,.033,.091,6),1,hard],
    snacks:[box,1,cloth],
    farSuit:[new THREE.CapsuleGeometry(1,1,2,5),1,cloth],
    farLimb:[new THREE.CylinderGeometry(1,1,1,5),6,cloth],
    farHelmet:[new THREE.SphereGeometry(1,6,5),1,hard],farGear:[box,2,hard]};
  const batches={};
  for(const [name,[geometry,multiplier,mat]] of Object.entries(definitions)) {
    if(!geometry.attributes.color){const rgb=new Float32Array(geometry.attributes.position.count*3);rgb.fill(1);geometry.setAttribute('color',new THREE.BufferAttribute(rgb,3));}
    const mesh=new THREE.InstancedMesh(geometry,mat,MAX_VISIBLE*multiplier);
    mesh.name=`Resort people · ${name}`;mesh.count=0;mesh.frustumCulled=false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow=!name.startsWith('far')&&name!=='poles'&&name!=='trim';
    mesh.receiveShadow=true;
    parent.add(mesh);batches[name]={mesh,n:0};
  }
  return batches;
}

export function buildResortPeople(scene,{grid,interiors,lifts,queueSlots=[],socialSlots=[]}={}) {
  const random=mulberry32(20261117),group=new THREE.Group();
  group.name='Resort guests · friends, lessons and lift queues';scene.add(group);
  const batches=buildBatches(group),people=[],parties=[];
  const view = guestVisibility(), active = [], draws = Object.values(batches);
  let density=1,listener=null,chatter=true,nextConversation=3,conversation=null;
  let lastSpeech=-100,utterance=null,snapshot={};
  const clear=(x,z,pad=.85)=>guestClear(x,z,pad,grid.query(x,z,pad+1));
  const person=(properties={})=>{
    const skill=properties.skill||(['green','blue','black'][Math.floor(random()*3)]);
    const p={id:people.length,skill,board:random()<.34,height:.91+random()*.15,jacket:JACKETS[skill][Math.floor(random()*4)],
      pants:PANTS[Math.floor(random()*PANTS.length)],helmet:HELMETS[Math.floor(random()*HELMETS.length)],phase:random()*6.28,
      regular:random()<.77,pack:random()<.27,seed:random(),...properties};people.push(p);return p;
  };
  const sim = createGuestSimulation({ grid, lifts, queueSlots, interiors, person, people, parties, random });
  const socialGroup=(x,z,count=3,y,heading=0,kind='social',foot=false)=>{
    const social={id:parties.length,kind,center:{x,z},members:[],topic:Math.floor(random()*TOPICS.length)};
    for(let i=0;i<count;i++) {
      const a=heading+i/count*Math.PI*2,r=count===2?.85:1.12,px=x+Math.sin(a)*r,pz=z+Math.cos(a)*r;
      if(!clear(px,pz,1.05))continue;
      social.members.push(person({kind,x:px,z:pz,y,heading:a+Math.PI,social,foot,board:foot?false:random()<.34}));
    }
    if(social.members.length)parties.push(social);
  };
  // Leave a clear path from the Village Gondola unload to the lodge.
  for(const [x,z,n] of [[466,4842,3],[481,4842,3],[493,4849,3],[507,4858,4],[537,4868,3],[455,4855,3],
    [485.5,4864,3],[491,4877,3],[447,4842,2],[505,4876,3],[468,4873,3]])socialGroup(x,z,n);
  for(const [x,z,n] of [[459.3,4838.1,3],[467.2,4844.2,4],[472.5,4846.4,3],
    [488.8,4842,3],[495.5,4837.7,3],[504,4846.2,4],[520,4848.6,3]])socialGroup(x,z,n);
  for(const [x,z] of [[8,-24],[-13,-28],[25,-16],[-24,-5],[31,17],[-8,24],
    [MOUNTAIN.rendezvous.x-22,MOUNTAIN.rendezvous.z+19],[MOUNTAIN.rendezvous.x+23,MOUNTAIN.rendezvous.z+18]])socialGroup(x,z,3);
  // Authored lodge slots already avoid chairs, railings and the door aisle.
  // Keep those exact positions, including the upper floor's height.
  for(const spot of socialSlots){
    let social=parties.find(p=>p.lodge===spot.lodge&&p.center&&Math.hypot(p.center.x-spot.x,p.center.z-spot.z)<3.5&&p.members.length<4);
    if(!social){social={id:parties.length,kind:'lodge',lodge:spot.lodge,center:{x:spot.x,z:spot.z},members:[],topic:Math.floor(random()*TOPICS.length)};parties.push(social);}
    const working=spot.activity==='server'||spot.activity==='operator';
    social.members.push(person({...spot,kind:'lodge',foot:true,board:false,pack:false,social,
      ...(working ? { jacket:spot.activity==='operator'?0xea952a:0x315c62,pants:0x252e34,helmet:0x2d3439 } : {})}));
  }
  for(const room of interiors?.rooms||[]) {
    if(room.kind==='outfitter'||room.kind==='barber')continue;
    if(room.id.startsWith('roundhouse'))continue; // The café and market have authored occupied seats and service lanes.
    const c=Math.cos(room.yaw),s=Math.sin(room.yaw);
    for(const sign of [-1,1]) {
      const lx=sign*Math.min(3,room.w*.22),lz=-Math.min(3.7,room.d*.22),x=room.x+lx*c+lz*s,z=room.z-lx*s+lz*c;
      if(clear(x,z,1))socialGroup(x,z,2,room.y+.018,room.yaw,'lodge',true);
    }
  }
  socialGroup(-115.7,-621,3,undefined,.2,'social',true);
  socialGroup(-143.5,-628,3,undefined,-.4,'social',true);

  const canvas=makeCanvas(1024,160),bubbleMap=canvasTexture(canvas.canvas);
  const bubble=new THREE.Sprite(new THREE.SpriteMaterial({map:bubbleMap,transparent:true,depthWrite:false}));
  bubble.name='Nearby resort conversation';bubble.scale.set(3.65,.57,1);bubble.visible=false;scene.add(bubble);
  const writeBubble=(line)=>{
    const c=canvas.ctx;c.clearRect(0,0,1024,160);c.fillStyle='rgba(20,35,43,.91)';c.beginPath();c.roundRect(3,4,1018,139,22);c.fill();
    c.fillStyle='#eef4ec';c.textAlign='center';c.textBaseline='middle';c.font='500 39px Arial';c.fillText(line,512,76,960);
    c.beginPath();c.moveTo(490,139);c.lineTo(512,159);c.lineTo(534,139);c.fill();bubbleMap.needsUpdate=true;
  };
  const root=new THREE.Matrix4(),local=new THREE.Matrix4(),matrix=new THREE.Matrix4(),torsoMatrix=new THREE.Matrix4();
  const rootQ=new THREE.Quaternion(),q=new THREE.Quaternion(),position=new THREE.Vector3(),scale=new THREE.Vector3();
  const up=new THREE.Vector3(),forward=new THREE.Vector3(),right=new THREE.Vector3(),basis=new THREE.Matrix4();
  const from=new THREE.Vector3(),to=new THREE.Vector3(),axis=new THREE.Vector3(0,1,0),color=new THREE.Color(),euler=new THREE.Euler(),v=new THREE.Vector3();
  const add=(name,x,y,z,sx,sy,sz,rx,ry,rz,tint)=>{
    const b=batches[name];if(b.n>=b.mesh.instanceMatrix.count)return;
    q.setFromEuler(euler.set(rx||0,ry||0,rz||0));local.compose(position.set(x,y,z),q,scale.set(sx,sy,sz));matrix.multiplyMatrices(root,local);
    b.mesh.setMatrixAt(b.n,matrix);b.mesh.setColorAt(b.n,color.set(tint));b.n++;
  };
  const limb=(name,a,b,r,tint)=>{
    from.set(...a);to.set(...b);position.copy(from).add(to).multiplyScalar(.5);const length=from.distanceTo(to);
    q.setFromUnitVectors(axis,to.sub(from).normalize());local.compose(position,q,scale.set(r,length,r*.94));matrix.multiplyMatrices(root,local);
    const batch=batches[name];if(batch.n>=batch.mesh.instanceMatrix.count)return;
    batch.mesh.setMatrixAt(batch.n,matrix);batch.mesh.setColorAt(batch.n,color.set(tint));batch.n++;
  };
  const onTorso=(x,y,z)=>{v.set(x,y,z).applyMatrix4(torsoMatrix);return [v.x,v.y,v.z];};
  const renderPerson=(p,time,detail)=>{
    const moving=clamp((p.speed||0)*.46,0,1),footMode=p.foot||p.seasonFoot,board=p.board&&!footMode,side=board?(p.regular?1:-1):0;
    const recovery=p.recovery||0,seated=p.seated||0,walk=footMode?Math.sin((p.stride||0)*6.1)*moving*(1-seated):0;
    const socialTurn=p.social&&p.social.members[(Math.floor(time/4)+p.social.id)%p.social.members.length]===p;
    const working=p.activity==='server'||p.activity==='operator';
    const service=working?(.5+.5*Math.sin(time*1.45+p.phase))**4:0;
    const gesture=p.talking||socialTurn?(Math.sin(time*3.2+p.phase)*.12+.12):Math.sin(time*.75+p.phase)*.016;
    if (p.ride && (p.state==='boarding'||p.state==='riding'||p.state==='unloading')) up.set(0,1,0);
    else if (!detail || footMode) up.set(0,1,0);
    else normalAt(p.x,p.z,up);
    const stanceHeading=p.heading-(board&&p.social?side*Math.PI*.5:0);
    forward.set(Math.sin(stanceHeading),0,Math.cos(stanceHeading)).addScaledVector(up,-up.dot(forward)).normalize();right.crossVectors(up,forward).normalize();
    rootQ.setFromRotationMatrix(basis.makeBasis(right,up,forward));
    const ground=p.y??heightAt(p.x,p.z)+.006;
    if (recovery) {
      q.setFromAxisAngle(axis.set(0,0,1),(p.id%2?1:-1)*recovery*1.26);
      rootQ.multiply(q);
      axis.set(0,1,0);
    }
    root.compose(position.set(p.x,ground,p.z),rootQ,scale.setScalar(p.height));
    const lean=(p.turn||0)*(p.skill==='green'?.10:.22),crouch=moving*.08+(board?.065:0)+recovery*.26+seated*.38;
    const hipY=.91-crouch,bodyYaw=side*Math.PI*.5*(1-seated*.45),pitch=moving*.12;
    q.setFromEuler(euler.set(pitch,bodyYaw,-lean+recovery*.28));torsoMatrix.compose(position.set(0,hipY,-moving*.07),q,scale.set(1,1,1));
    if(!detail){
      add('farSuit',...onTorso(0,.25,0),.186,.215,.125,pitch,bodyYaw,-lean,p.jacket);
      add('farHelmet',...onTorso(0,.73,0),.118,.126,.117,0,bodyYaw,0,p.helmet);
      for(const s of [-1,1]){
        const knee=[s*.16,.48-crouch*.55,.085+seated*.29+s*walk*.15];
        const foot=[s*.19,.11+Math.max(0,s*walk)*.10,seated*.30+s*walk*.24];
        limb('farLimb',[s*.115,hipY-.05,0],knee,.066,p.pants);
        limb('farLimb',knee,foot,.067,p.pants);
        limb('farLimb',onTorso(s*.184,.41,0),onTorso(s*.31,.024,.105-s*walk*.22+(p.sip||0)*.16),.061,p.jacket);
        if(!footMode&&!board)add('farGear',s*.19,.023,seated*.30,.095,.024,1.75,0,0,0,0x526571);
      }
      if(board)add('farGear',0,.025,0,.26,.026,1.5,0,0,0,0x516873);
      p.headY=ground+1.6*p.height;
      return;
    }
    add('jacket',...onTorso(0,0,0),1,1,1,pitch,bodyYaw,-lean+recovery*.28,p.jacket);
    add('pelvis',0,hipY-.035,-.03,.172,.145,.118,0,bodyYaw,0,p.pants);
    const headYaw=board&&moving?side*.25:bodyYaw,face=onTorso(0,.647,.015);
    add('face',...face,.086,.115,.086,0,headYaw,0,0xbb9277);
    add('helmet',...onTorso(0,.755,.006),.116,.116,.119,0,headYaw,0,p.helmet);
    if(detail){if(!working&&p.activity!=='diner'&&p.activity!=='customer')add('goggles',face[0]+Math.sin(headYaw)*.103,face[1]+.045,face[2]+Math.cos(headYaw)*.103,.106,.039,.036,0,headYaw,0,p.seed>.5?0x799ba6:0x494e6d);
      add('trim',...onTorso(.009,.46,.137),.012,.025,.008,pitch,bodyYaw,0,0xc4c9bc);
      add('trim',...onTorso(.15,.40,.074),.10,.075,.014,0,bodyYaw,0,p.seed>.6?0xd4d9cc:0x344d5c);}
    if(p.pack)add('pack',...onTorso(0,.27,-.15),.135,.195,.093,0,bodyYaw,0,0x4c5150);
    for(const s of [-1,1]) {
      const stance=board?.27:.19,wedge=p.skill==='green'?.14*moving:0;
      const foot=board?[0,.15,s*stance]:[s*stance,(footMode?.10:.13)+Math.max(0,s*walk)*.13,s*walk*.30+seated*.30];
      const knee=board?[.11,.47-crouch*.55,s*stance*.90]:[s*(.17-lean*.08),.48-crouch*.55,.105+recovery*.15+seated*.29+s*walk*.16];
      const hip=board?[0,hipY-.06,s*.12]:[s*.12,hipY-.06,-.025];
      limb('trousers',hip,knee,.092,p.pants);limb('trousers',knee,foot,.075,p.pants);
      if(detail)add('joints',...knee,.083,.083,.082,0,0,0,p.pants);
      add('boots',...foot,.12,.20,.27,0,board?bodyYaw+s*.13:-s*wedge,0,0x343c43);
      if(!footMode){add('binding',foot[0],board?.10:.067,foot[2],.135,board?.14:.065,.25,0,board?bodyYaw+s*.13:-s*wedge,0,0x39464e);
        if(!board)add('skis',s*stance,.006,foot[2],1,1,1,seated*.12,-s*wedge,lean*.6,0x49616b);}
      const sip=s>0?(p.activity==='diner' ? (.5+.5*Math.sin(time*.92+p.phase))**6 : p.sip||0):0;
      const shoulder=onTorso(s*.205,.45,0),elbow=onTorso(s*(.27+gesture),.18+gesture*.65,.06+moving*.07);
      const wrist=onTorso(s*(.31+gesture*.7-sip*.22),.025+gesture+sip*.565+service*.19,.17+(board?.03:0)-s*walk*.19+sip*.035+service*.27);
      limb('sleeve',shoulder,elbow,.077,p.jacket);limb('sleeve',elbow,wrist,.057,p.jacket);
      if(detail)add('joints',...elbow,.064,.066,.064,0,0,0,p.jacket);
      add('gloves',...wrist,.049,.059,.05,0,bodyYaw,0,0x2b3338);
      if(s>0&&(p.state==='cafe'||p.activity==='diner')){
        if(p.seed>.47)add('cups',wrist[0],wrist[1]+.052,wrist[2]+.037,1,1,1,-sip*.4,0,0,0xf1dfbc);
        else add('snacks',wrist[0],wrist[1]+.052,wrist[2]+.037,.070,.096,.028,-sip*.4,0,.38,0xc78a47);
      }
      if(s<0&&footMode&&p.state==='queue'&&!p.station.chair){
        if(p.board)add('boards',wrist[0]-.14,wrist[1]+.24,wrist[2],.96,1,.9,-1.38,0,.12,0x526675);
        else for(const offset of [-.041,.041])add('skis',wrist[0]-.12+offset,wrist[1]+.32,wrist[2],.86,1,.92,-1.45,0,.06,0x49616b);
      }
      if(!board&&!footMode)limb('poles',wrist,[s*.39,.035+seated*.10,wrist[2]-.48-moving*.17],.0045,0xa3b1b7);
    }
    if(board&&!footMode)add('boards',0,.007,0,1,1,1,0,0,lean*.6,p.seed>.6?0x98634c:0x40566b);
    p.headY=ground+1.62*p.height;
  };
  const updateConversation=(time,camera)=>{
    for(const p of people)p.talking=false;
    const listen=listener?.position||camera?.position;if(!chatter||!listen||listener?.paused||density===0){bubble.visible=false;return;}
    if(conversation) {
      const age=time-conversation.start,line=age<4.2?0:1,speaker=conversation.party.members[line%conversation.party.members.length];
      const near=speaker.seed<=density&&Math.hypot(speaker.x-listen.x,speaker.z-listen.z)<15&&Math.abs((speaker.y??heightAt(speaker.x,speaker.z))-listen.y)<3.2;
      if(age>8.4||!near){conversation=null;bubble.visible=false;}
      else {
        speaker.talking=true;bubble.visible=true;bubble.position.set(speaker.x,(speaker.headY||heightAt(speaker.x,speaker.z)+1.6)+.52,speaker.z);
        bubble.material.opacity=clamp((4.2-age%4.2)*2,0,1);
        if(line!==conversation.line){conversation.line=line;const text=TOPICS[conversation.party.topic][line];writeBubble(text);
          if(listener?.audioEnabled&&listener?.audioReady&&'speechSynthesis' in window&&time-lastSpeech>3.8&&!window.speechSynthesis.speaking){
            utterance=new SpeechSynthesisUtterance(text);utterance.volume=.16;utterance.rate=.93+speaker.seed*.13;utterance.pitch=.85+speaker.seed*.33;
            window.speechSynthesis.speak(utterance);lastSpeech=time;}
        }
      }
    }
    if(!conversation&&time>nextConversation){nextConversation=time+14+random()*7;
      const nearby=parties.filter(p=>p.center&&p.members.length>1&&p.members.slice(0,2).every(n=>n.seed<=density)&&Math.hypot(p.center.x-listen.x,p.center.z-listen.z)<11&&Math.abs((p.members[0].y??heightAt(p.center.x,p.center.z))-listen.y)<3.2);
      for(const cafe of sim.cafes.values()) {
        const members=cafe.spots.map(s=>s.guest).filter(p=>p?.state==='cafe'&&p.seed<=density&&Math.hypot(p.x-listen.x,p.z-listen.z)<10&&Math.abs(p.y-listen.y)<3.2);
        if(members.length>1)nearby.push({members,topic:2});
      }
      if(nearby.length)conversation={party:nearby[Math.floor(random()*nearby.length)],start:time,line:-1};}
  };
  return {
    group, people, parties, routes: sim.routes,
    setListener(value){listener=value;if((!value?.audioEnabled||value?.paused)&&utterance&&window.speechSynthesis?.speaking){window.speechSynthesis.cancel();utterance=null;}},
    setDensity(value){density=clamp(Number.isFinite(Number(value))?Number(value):1,0,1);},
    setChatter(value){chatter=!!value;if(!chatter){bubble.visible=false;conversation=null;if(utterance)window.speechSynthesis?.cancel();}},
    hitPlayer(previous, current, dt) { return sim.hitPlayer(previous, current, dt, density); },
    reset(){
      conversation=null;nextConversation=3;bubble.visible=false;if(utterance)window.speechSynthesis?.cancel();
      sim.reset();
    },
    update(dt,time,camera){
      sim.advance(time, density);
      const indoor = camera && interiors?.interiorAt?.(camera.position.x, camera.position.z, camera.position.y);
      const radius = indoor ? 80 : 365;
      for (const b of draws) b.n = 0;
      active.length = 0;
      view.prepare(camera);
      for (const p of people) {
        if (p.seed > density) continue;
        const d2 = camera ? (p.x - camera.position.x) ** 2 + (p.z - camera.position.z) ** 2 + (p.y !== undefined ? (p.y - camera.position.y) ** 2 : 0) : 0;
        if (d2 > radius * radius) continue;
        const y = p.y ?? p.ground;
        if (camera && Number.isFinite(y) && !view.contains(p.x, y, p.z, d2 < 90**2)) continue;
        p.viewDistance = d2;
        active.push(p);
      }
      active.sort((a,b) => a.viewDistance - b.viewDistance);
      let visible = 0, detailed = 0, moving = 0, resting = 0, recovering = 0;
      for (const p of active) {
        if (visible >= MAX_VISIBLE) break;
        let pose = sim.pose(p, time);
        if(p.shift){
          const phase=time*.54+p.phase, offset=Math.sin(phase)*p.shift;
          pose={...p,x:p.x+Math.cos(p.heading)*offset,z:p.z-Math.sin(p.heading)*offset,
            heading:p.heading+Math.cos(phase)*.31,speed:Math.abs(Math.cos(phase))*p.shift*.54,stride:time*.6};
        }
        const useDetail = p.viewDistance < 64 ** 2 && detailed < 32;
        renderPerson(pose, time, useDetail);
        p.headY = pose.headY;
        visible++;
        detailed += Number(useDetail);
        moving += Number(pose.speed > .35 || pose.state === 'riding');
        resting += Number(!!pose.rest);
        recovering += Number(pose.recovery > 0);
      }
      for (const b of draws) {
        b.mesh.count = b.n;
        b.mesh.visible = b.n > 0;
        if (b.n) {
          b.mesh.instanceMatrix.clearUpdateRanges();
          b.mesh.instanceMatrix.addUpdateRange(0, b.n * 16);
          b.mesh.instanceMatrix.needsUpdate = true;
          b.mesh.instanceColor.clearUpdateRanges();
          b.mesh.instanceColor.addUpdateRange(0, b.n * 3);
          b.mesh.instanceColor.needsUpdate = true;
        }
      }
      updateConversation(time,camera);
      snapshot={total:people.length,visible,detailed,moving,resting,recovering,parties:parties.length,routes:sim.routes.length,
        density,clock:time,conversation:conversation?TOPICS[conversation.party.topic][Math.max(0,conversation.line)]:null};
    },
    debug(){
      const simulation = sim.debug();
      return {...snapshot, simulation, snowboarders:people.filter(p=>p.board).length, queues:simulation.states.queue ?? 0};
    },
  };
}
