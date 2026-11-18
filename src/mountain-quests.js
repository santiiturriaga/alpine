import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { ROUNDHOUSE_STONE_SITE } from './inukshuk.js';
import { lodgeSocialSlots } from './lodge-interiors.js';
import { guestClear } from './guest-navigation.js';
import { createSkier } from './skier.js';
import { box, mergedMesh, part } from './scenery.js';
import { createServiceAsset } from './service-assets.js';

const assignments = {
  overlook:{name:'The overlook',giver:'Nora',instruction:'Photograph the inukshuk beyond the Olympic rings.',reward:8,color:'Glacier teal'},
  wildlife:{name:'Tracks & feathers',giver:'Ellis',instruction:'Photograph a Canada jay, red fox or black bear.',reward:12,color:'Fireweed'},
  delivery:{name:'Lunch dispatch',giver:'Jo',instruction:'Carry Jo’s handwritten order to Robin at the village warming hut.',reward:10,color:'Lichen'},
  rescue:{name:'Patrol airlift',giver:'Morgan',instruction:'Board the alpine helicopter and locate the orange rescue bivy.',reward:20,color:'Alpine crimson'},
};
const storageKey='alpine.assignments.v1';
const keyFor=id=>'quest.'+id;
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const markerColor=new THREE.MeshStandardMaterial({color:0xffc35f,emissive:0xffab39,emissiveIntensity:.32,roughness:.45});
function questionMark() {
  const path=new THREE.CatmullRomCurve3([[-.29,.50],[-.22,.68],[.01,.76],[.25,.66],[.30,.47],[.21,.32],[.04,.21],[0,.075]].map(([x,y])=>new THREE.Vector3(x,y,0)));
  const g=new THREE.Group();g.add(new THREE.Mesh(new THREE.TubeGeometry(path,28,.065,9,false),markerColor));
  const dot=new THREE.Mesh(new THREE.SphereGeometry(.077,12,10),markerColor);dot.position.y=-.12;g.add(dot);
  return g;
}
function teamMember(scene, jacket, name) {
  const frame=new THREE.Group(), rig=createSkier({jacket,accessories:false});
  frame.name=name;frame.add(rig.group);scene.add(frame);
  frame.updateMatrix();rig.animate(.1,{speed:0,steer:0,tuck:0,brake:0,grab:0,crash:false,crashTime:0,footMode:true},null);
  frame.visible=false;return frame;
}
function airliftSite(env, aircraft) {
  const home={x:aircraft.homeX,z:aircraft.homeZ};
  let best, score=Infinity;
  for (const c of env.grid.circles) {
    if(c.type!=='tree')continue;
    const distance=dist(c,home);
    if(distance<155||distance>520)continue;
    const err=Math.abs(distance-305);
    if(err>=score)continue;
    const dx=(home.x-c.x)/distance,dz=(home.z-c.z)/distance;
    const x=c.x+dx*4.2,z=c.z+dz*4.2;
    if(env.grid.query(x,z,3).some(o=>o.r&&Math.hypot(o.x-x,o.z-z)<o.r+1.6))continue;
    best={x,z};score=err;
  }
  return best ?? {x:home.x+80,z:home.z-90};
}

export function createMountainQuests({scene,env,ui,wildlife,expeditions,shop,player,camera,multiplayer}) {
  document.getElementById('assignments').hidden=false;
  const bookings=lodgeSocialSlots();
  const customers=bookings.filter(s=>s.lodge==='roundhouse' || s.lodge==='roundhouse-dining');
  const market=customers.filter(s=>s.lodge==='roundhouse-dining');
  const porch=bookings.find(s=>s.kind==='social' && String(s.lodge).startsWith('roundhouse')) || market.at(-1);
  const recipient=bookings.find(s=>s.lodge==='village-cafe' && s.activity==='customer') ||
    bookings.find(s=>s.lodge==='village-cafe');
  const stops={
    overlook:customers.find(s=>s.activity==='diner'),wildlife:porch,
    delivery:market.find(s=>s.activity==='diner'),rescue:market.find(s=>s.activity==='customer'),
  };
  const home=expeditions.fleet.find(v=>v.id==='helicopter');
  const airSite=airliftSite(env,home), base={x:home.homeX,z:home.homeZ};
  const atlas=ui.resortMap, badge=questionMark();
  const ringsSite={...ROUNDHOUSE_STONE_SITE,y:heightAt(ROUNDHOUSE_STONE_SITE.x,ROUNDHOUSE_STONE_SITE.z)+1.75};
  const waypoints=[];
  // A seat or a counter is a good place to find someone, but a poor
  // destination for walking. Route to a clear spot on the same floor.
  function approach(spot) {
    for(const radius of [1.35,1.85,2.25])for(let i=0;i<12;i++){
      const yaw=spot.heading+i*Math.PI/6;
      const x=spot.x+radius*Math.sin(yaw),z=spot.z+radius*Math.cos(yaw);
      const y=env.walkSurfaceAt(x,z,spot.y+.1)??heightAt(x,z);
      if(Math.abs(spot.y-y)<.5 && guestClear(x,z,.37,env.queryColliders(x,z,2),y+.05))
        return {x,y,z,heading:Math.atan2(spot.x-x,spot.z-z)};
    }
    return spot;
  }
  for(const [id,spot] of Object.entries(stops)){
    if(!spot)continue;
    const mark=badge.clone();mark.position.set(spot.x,spot.y+(spot.seated?1.86:2.12),spot.z);scene.add(mark);
    const arrival=approach(spot);
    stops[id]={...spot,mark,arrival};waypoints.push({id:'assignment-'+id,name:assignments[id].giver+' · '+assignments[id].name,...spot,arrival});
  }
  if(recipient)waypoints.push({id:'dispatch-recipient',name:'Robin · Village Warming Hut',...recipient,arrival:approach(recipient)});
  waypoints.push({id:'patrol-air-site',name:'Patrol search sector',...airSite},{id:'air-base',name:'Alpine helicopter base',...base});
  for(const s of wildlife.sites)waypoints.push({id:s.id,name:s.title,x:s.x,z:s.z});
  atlas.addLandmarks(waypoints);
  let pendingPhoto=false, hoist=0, rescuers, rope, bivy, helping='', remoteAircraft;
  let state={id:null,stage:null,photos:{}};
  try {
    const saved=JSON.parse(localStorage.getItem(storageKey)||'{}');
    if(saved.photos && typeof saved.photos==='object')state.photos=saved.photos;
    if(assignments[saved.id] && !shop.state.finds.includes(keyFor(saved.id)) && ['target','return','evacuate'].includes(saved.stage)){
      state.id=saved.id;state.stage=saved.stage;
    }
  }catch{}
  const panel=document.getElementById('assignment-list'), hud=document.getElementById('assignment-hud');
  const journal=document.getElementById('assignment-photos');
  const message=document.getElementById('assignment-next');
  const dispatch=document.getElementById('patrol-dispatch');
  dispatch.onclick=()=>atlas.setDestination('patrol-air-site',player);
  const save=()=>{try{localStorage.setItem(storageKey,JSON.stringify(state));}catch{}};
  const title=()=>assignments[state.id];
  function targetId() {
    if(state.stage==='return')return 'assignment-'+state.id;
    if(state.id==='rescue')return state.stage==='evacuate' || expeditions.active?.id!=='helicopter'?'air-base':'patrol-air-site';
    return {overlook:'roundhouse-stone',delivery:'dispatch-recipient',wildlife:'red-fox'}[state.id];
  }
  function guide() {
    const id=targetId();if(id)atlas.setDestination(id,player);
  }
  function show() {
    hud.hidden=!title();
    document.getElementById('assignment-actions').hidden=!title();
    message.textContent=!title()?'':state.stage==='return'?'Return to '+title().giver+' at Roundhouse Lodge.':
      state.stage==='evacuate'?'Land at the marked helicopter base to transfer the guest.':title().instruction;
    hud.querySelector('b').textContent=title()?.name??'';
    panel.replaceChildren();
    for(const [id,q] of Object.entries(assignments)){
      if(!stops[id] || (id==='delivery'&&!recipient))continue;
      const button=document.createElement('button');button.type='button';
      button.textContent=q.name+(shop.state.finds.includes(keyFor(id))?' · complete':' · '+q.giver);
      button.title=q.instruction;
      button.onclick=()=>{if(id===state.id)guide();else atlas.setDestination('assignment-'+id,player);};
      panel.append(button);
    }
    journal.replaceChildren();
    for(const [id,photo] of Object.entries(state.photos)){
      if(!assignments[id]||typeof photo!=='string'||!photo.startsWith('data:image/jpeg;base64,'))continue;
      const image=document.createElement('img');image.src=photo;image.alt=assignments[id].name+' field photograph';journal.append(image);
    }
    for(const [id,spot] of Object.entries(stops))if(spot?.mark)
      spot.mark.visible=!shop.state.finds.includes(keyFor(id)) && (!state.id || id===state.id);
  }
  function advance(stage) {
    state.stage=stage;save();show();guide();
  }
  function act(item) {
    if(!item || player.crash)return false;
    if(item.kind==='accept'){
      state.id=item.id;advance('target');ui.toast(title().giver,title().instruction,'gold','star');
    }else if(item.kind==='claim'){
      const q=title();
      if(shop.find(keyFor(state.id),q.reward))ui.toast(q.name,q.color+' jacket unlocked · '+q.reward+' coins','gold','star');
      state.id=null;state.stage=null;save();show();ui.routeGuide.setDestination(null);
    }else if(item.kind==='note'){
      advance('return');ui.toast('Order delivered','Robin signed the receipt. Take it back to Jo.','green','check');
    }else if(item.kind==='photo'){
      pendingPhoto=true;
    }else if(item.kind==='lift'){
      if(hoist===0)hoist=.001;
    }else if(item.kind==='assist'){
      helping=item.id;
      ui.toast('Ground team ready','Hold position beside the bivy while the helicopter lifts.','green','check');
    }else if(item.kind==='transfer'){
      advance('return');ui.toast('Guest transferred','The ground team has taken over. Report to Morgan.','green','check');
    }else return false;
    return true;
  }
  const projected=new THREE.Vector3();
  function framed(p) {
    const dx=p.x-camera.position.x,dy=p.y-camera.position.y,dz=p.z-camera.position.z;
    const distance=Math.hypot(dx,dy,dz);
    if(distance>42)return false;
    projected.set(p.x,p.y,p.z).project(camera);
    if(projected.z< -1 || projected.z>=1 || Math.abs(projected.x)>=.84 || Math.abs(projected.y)>=.82)return false;
    for(let d=.6;d<distance-1.85;d+=1.1){
      const f=d/distance, x=camera.position.x+f*dx, z=camera.position.z+f*dz, y=camera.position.y+f*dy;
      if(y<heightAt(x,z)-.05)return false;
      for(const c of env.queryColliders(x,z,.9)){
        if(y<(c.minY??-Infinity)||y>(c.maxY??heightAt(c.x,c.z)+(c.height??2.5)))continue;
        if(c.r ? Math.hypot(c.x-x,c.z-z)<c.r : env.pointInBox(x,z,c))return false;
      }
    }
    return true;
  }
  function nearby(){
    const p=player.pos, aircraft=expeditions.active?.id==='helicopter'?expeditions.active:null;
    if(state.id==='rescue' && aircraft){
      if(state.stage==='target' && dist(p,airSite)<10 && aircraft.clearance<22 && Math.abs(aircraft.speed)<3)
        return {kind:'lift',title:hoist?'Hoisting guest…':'Lower rescue sling',detail:'Hold position over the orange bivy'};
      if(state.stage==='evacuate' && dist(p,base)<20 && aircraft.clearance<1.4 && Math.abs(aircraft.speed)<2)
        return {kind:'transfer',title:'Transfer guest to ground team',detail:'Complete the airlift'};
    }
    if(player.riding || player.speed>4)return null;
    if(!helping && state.id!=='rescue' && dist(p,airSite)<8){
      const pilot=Array.from(multiplayer.peers).find(([,peer])=>peer.patrol==='search');
      if(pilot)return {kind:'assist',id:pilot[0],title:'Secure the rescue sling',detail:'Join '+multiplayer.callsign(pilot[0])+' on the ground team'};
    }
    if(state.stage==='target'){
      if(state.id==='overlook' && framed(ringsSite))return {kind:'photo',title:'Photograph the inukshuk',detail:'Save this view to your field journal'};
      if(state.id==='wildlife'){
        const subject=wildlife.sites.find(s=>s.id!=='alpine-marmot' && s.group.visible && framed({x:s.x,z:s.z,y:s.base+(s.bird?.15:.50)}));
        if(subject)return {kind:'photo',title:'Photograph the '+subject.title.toLowerCase(),detail:'Save this sighting to your field journal'};
      }
      if(state.id==='delivery' && dist(p,recipient)<3.2 && Math.abs(p.y-recipient.y)<2.2)
        return {kind:'note',title:'Give Robin the lunch order',detail:'Village Warming Hut'};
    }
    const options=[];
    for(const [id,spot] of Object.entries(stops)) {
      if(!spot || shop.state.finds.includes(keyFor(id)) || (id==='delivery'&&!recipient))continue;
      const distance=dist(p,spot);
      if(distance>3.0 || Math.abs(p.y-spot.y)>1.9)continue;
      if(!state.id)options.push({kind:'accept',id,distance,title:'Talk to '+assignments[id].giver,detail:assignments[id].name});
      else if(state.id===id && state.stage==='return')return {kind:'claim',title:'Report to '+title().giver,detail:'Claim '+title().color+' jacket'};
    }
    return options.sort((a,b)=>a.distance-b.distance)[0];
  }
  function deployTeam() {
    rescuers=[teamMember(scene,0xcc392c,'Flight paramedic'),teamMember(scene,0xda872e,'Airlift guest')];
    bivy=mergedMesh([part(new THREE.SphereGeometry(1,18,12),'#ed7d33',[0,.14,0],[0,0,0],[.42,.18,1.04]),
      box(.055,.012,1.68,'#ffe794',[.31,.24,0]),box(.055,.012,1.68,'#ffe794',[-.31,.24,0])]);
    scene.add(bivy);
    rope=new THREE.Mesh(new THREE.CylinderGeometry(.023,.023,1,8),new THREE.MeshStandardMaterial({color:0xe2c16a,roughness:.75}));
    scene.add(rope);rope.visible=false;
  }
  const top=new THREE.Vector3(),bottom=new THREE.Vector3(),up=new THREE.Vector3(0,1,0),axis=new THREE.Vector3();
  let routedToSite=false;
  function update(dt) {
    for(const spot of Object.values(stops)) if(spot?.mark?.visible)
      spot.mark.rotation.y=Math.atan2(camera.position.x-spot.x,camera.position.z-spot.z);
    const target=state.id==='rescue'&&state.stage==='target';
    const phase=state.id!=='rescue'?'idle':target?'search':state.stage==='evacuate'?'evacuate':'delivered';
    const pilot=helping?multiplayer.peers.get(helping):null;
    if(helping && (!pilot || pilot.patrol!=='search')){
      if(pilot && ['evacuate','delivered'].includes(pilot.patrol) && shop.find('quest.ground-team',5))
        ui.toast('Ground assist','Guest aboard · 5 mountain coins','green','check');
      helping='';
    }
    multiplayer.patrolRadio(phase,helping);
    let call;
    if(state.id!=='rescue')for(const member of multiplayer.peers.values()){
      if(member.patrol==='search'){call=member;break;}
    }
    if(dispatch.hidden!==!call)dispatch.hidden=!call;
    const near=(target || call) && dist(player.pos,airSite)<750;
    if(remoteAircraft)remoteAircraft.group.visible=false;
    if(!near && !rescuers)return;
    if(near && !rescuers)deployTeam();
    bivy.visible=near;rope.visible=false;
    for(const person of rescuers)person.visible=near;
    if(!near){hoist=0;routedToSite=false;return;}
    const ground=heightAt(airSite.x,airSite.z);
    bivy.position.set(airSite.x,ground,airSite.z);
    rescuers[0].position.set(airSite.x-1.1,ground,airSite.z);
    rescuers[0].rotation.set(0,Math.PI/2,.035);
    rescuers[1].position.set(airSite.x,ground+.28,airSite.z-.77);
    rescuers[1].rotation.set(Math.PI/2,0,0);
    if(!target){
      if(call && (call.pose[10]&8) && Math.hypot(call.pose[0]-airSite.x,call.pose[2]-airSite.z)<170){
        if(!remoteAircraft){remoteAircraft=createServiceAsset('helicopter');scene.add(remoteAircraft.group);}
        remoteAircraft.group.visible=true;remoteAircraft.group.position.fromArray(call.pose);
        remoteAircraft.group.quaternion.fromArray(call.pose,3).normalize();
        remoteAircraft.animate?.(dt,call.pose[7],performance.now()/1000,0);
      }
      return;
    }
    const aircraft=expeditions.active;
    if(aircraft?.id==='helicopter'&&!routedToSite){routedToSite=true;guide();}
    if(aircraft?.id!=='helicopter'){hoist=0;routedToSite=false;return;}
    const p=aircraft.model.position;
    if(!hoist)return;
    if(dist(p,airSite)>13||aircraft.clearance>24||Math.abs(aircraft.speed)>4){
      hoist=0;ui.toast('Sling recovered','Return over the bivy and slow to a hover.','blue','lift');return;
    }
    const assisted=Array.from(multiplayer.peers.values()).some(({pose,assist})=>assist===multiplayer.id && Math.hypot(pose[0]-airSite.x,pose[2]-airSite.z)<15);
    hoist=Math.min(1,hoist+dt/(assisted?4:6));
    const raise=THREE.MathUtils.smoothstep(hoist,.42,1);
    top.copy(p);top.y+=.55;
    bottom.set(airSite.x,ground+.36,airSite.z).lerp(top,raise);
    const deployment=THREE.MathUtils.smoothstep(hoist,0,.34);
    const tip=axis.copy(top).lerp(bottom,deployment);
    rope.position.addVectors(tip,top).multiplyScalar(.5);
    axis.subVectors(top,tip);rope.scale.y=axis.length();rope.visible=axis.lengthSq()>.03;
    if(rope.visible)rope.quaternion.setFromUnitVectors(up,axis.normalize());
    rescuers[1].position.copy(bottom);rescuers[1].rotation.x=(1-raise)*1.38;
    if(hoist>=1){hoist=0;advance('evacuate');ui.toast('Guest aboard','Return to the alpine helicopter base.','green','check');}
  }
  function capture(canvas) {
    if(!pendingPhoto)return;
    pendingPhoto=false;
    if(!state.id || state.stage!=='target')return;
    const snapshot=document.createElement('canvas');snapshot.width=Math.min(720,canvas.width);
    snapshot.height=Math.max(1,Math.round(snapshot.width*canvas.height/canvas.width));
    snapshot.getContext('2d').drawImage(canvas,0,0,snapshot.width,snapshot.height);
    state.photos[state.id]=snapshot.toDataURL('image/jpeg',.74);
    advance('return');ui.toast('Photo saved','Your field journal is in the Mountain menu.','green','check');
  }
  document.getElementById('assignment-route').onclick=guide;
  document.getElementById('assignment-abandon').onclick=()=>{pendingPhoto=false;hoist=0;state.id=null;state.stage=null;save();show();ui.routeGuide.setDestination(null);};
  show();
  return {nearby,act,update,capture,stops,airSite,base,get state(){return state;}};
}
