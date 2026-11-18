import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { ROUNDHOUSE_STONE_SITE } from './inukshuk.js';
import { lodgeSocialSlots } from './lodge-interiors.js';
import { guestClear } from './guest-navigation.js';
import { createSkier } from './skier.js';
import { box, mergedMesh, part } from './scenery.js';
import { createServiceAsset } from './service-assets.js';
import { createPatrolFlight } from './patrol-flight.js';

const assignments = {
  overlook:{name:'The overlook',giver:'Nora',instruction:'Photograph the inukshuk beyond the Olympic rings.',reward:8,color:'Glacier teal'},
  wildlife:{name:'Tracks & feathers',giver:'Ellis',instruction:'Photograph a Canada jay, red fox or black bear.',reward:12,color:'Fireweed'},
  delivery:{name:'Lunch dispatch',giver:'Jo',instruction:'Carry Jo’s handwritten order to Robin at the village warming hut.',reward:10,color:'Lichen'},
  rescue:{name:'Patrol airlift',giver:'Morgan',instruction:'Ski with patrol down Upper Whiskey Jack, then fly two rescue pickups.',reward:20,color:'Alpine Patrol Shell'},
};
const storageKey='alpine.assignments.v1';
const keyFor=id=>id==='rescue'?'quest.patrol-shell':'quest.'+id;
const flightStages=['rally','escort','board','tree','ledge'];
const radioSearch=['search','tree','ledge'];
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
function airliftSite(env, home) {
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

export function createMountainQuests({scene,env,ui,wildlife,expeditions,shop,player,camera,multiplayer,season=()=> 'winter'}) {
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
  const flight=createPatrolFlight({scene,env,ui,expeditions,player});
  const {tree:airSite,ledge,base,rally}=flight;
  const legacySite=airliftSite(env,home.legacyPose ?? base);
  const siteFor=stage=>stage==='tree'?airSite:stage==='ledge'?ledge:legacySite;
  const targetFor=stage=>stage==='tree'?'patrol-air-site':stage==='ledge'?'patrol-ledge-site':'patrol-legacy-site';
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
  waypoints.push({id:'patrol-air-site',...airSite},{id:'patrol-ledge-site',...ledge},
    {id:'patrol-legacy-site',name:'Patrol ground team callout',...legacySite},
    {id:'air-base',name:'Alpine Patrol helipad',...base},{id:'patrol-rally',name:'Ski patrol · Upper Whiskey Jack',...rally});
  for(const s of wildlife.sites)waypoints.push({id:s.id,name:s.title,x:s.x,z:s.z});
  atlas.addLandmarks(waypoints);
  let pendingPhoto=false, rescuers, bivy, helping, remoteAircraft, delivered=0, call;
  let state={id:null,stage:null,photos:{}};
  try {
    const saved=JSON.parse(localStorage.getItem(storageKey)||'{}');
    if(saved.photos && typeof saved.photos==='object')state.photos=saved.photos;
    if(assignments[saved.id] && !shop.state.finds.includes(keyFor(saved.id))){
      if(saved.id==='rescue'){
        state.id=saved.id;
        state.stage=['evacuate','return','ledge'].includes(saved.stage)?'ledge':
          ['board','tree'].includes(saved.stage)?saved.stage:'rally';
      }else if(['target','return'].includes(saved.stage)){
        state.id=saved.id;state.stage=saved.stage;
      }
    }
  }catch{}
  const panel=document.getElementById('assignment-list'), hud=document.getElementById('assignment-hud');
  const journal=document.getElementById('assignment-photos');
  const message=document.getElementById('assignment-next');
  const dispatch=document.getElementById('patrol-dispatch');
  dispatch.onclick=()=>{if(call)atlas.setDestination(targetFor(call[1].patrol),player);};
  const save=()=>{try{localStorage.setItem(storageKey,JSON.stringify(state));}catch{}};
  const title=()=>assignments[state.id];
  function targetId() {
    if(state.stage==='return')return 'assignment-'+state.id;
    if(state.id==='rescue'){
      if(state.stage==='rally')return 'patrol-rally';
      return expeditions.active===home?targetFor(state.stage):'air-base';
    }
    return {overlook:'roundhouse-stone',delivery:'dispatch-recipient',wildlife:'red-fox'}[state.id];
  }
  function guide() {
    const id=targetId();if(id)atlas.setDestination(id,player);
  }
  function rescueInstruction() {
    if(season()==='summer')return 'Switch to winter to rejoin ski patrol.';
    switch(state.stage){
      case 'rally':return 'Meet Sasha and Ren at the top of Upper Whiskey Jack.';
      case 'escort':return dist(player.pos,base)<24?
        'Follow the patrollers up the ramp. Press B to switch to boots at the pad.':
        'Follow the red jackets down Upper Whiskey Jack to the helipad.';
      case 'board':return 'Walk up the ramp and board from the side. Sasha and Ren are seated.';
      case 'tree':return expeditions.active===home?'Fly to the tree pickup. Hover over the marker and press E.':'Board the helicopter to reach the skier in the tree.';
      case 'ledge':return expeditions.active===home?'Fly to the second pickup at the rock ledge.':'Board the helicopter to reach the skier on the rock ledge.';
      default:return title().instruction;
    }
  }
  function show() {
    hud.hidden=!title();
    document.getElementById('assignment-actions').hidden=!title();
    message.textContent=!title()?'':state.id==='rescue'?rescueInstruction():
      state.stage==='return'?'Return to '+title().giver+' at Roundhouse Lodge.':title().instruction;
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
  function clearAssignment() {
    pendingPhoto=false;flight.reset();state.id=null;state.stage=null;save();show();ui.routeGuide.setDestination(null);
  }
  function act(item) {
    if(!item || player.crash)return false;
    if(item.kind==='accept'){
      if(item.id==='rescue'){
        if(season()==='summer'){
          ui.toast('Morgan','The ski escort is available in winter.','blue','lift');return true;
        }
        flight.reset();expeditions.resetHome(home);home.boardBlocked=true;
        state.id=item.id;advance('rally');
        ui.toast('Morgan','Two skiers need a pickup. Meet Sasha and Ren on Upper Whiskey Jack.','gold','star');
      }else{
        state.id=item.id;advance('target');ui.toast(title().giver,title().instruction,'gold','star');
      }
    }else if(item.kind==='claim'){
      const q=title();
      if(shop.find(keyFor(state.id),q.reward))ui.toast(q.name,q.color+' jacket unlocked · '+q.reward+' coins','gold','star');
      clearAssignment();
    }else if(item.kind==='note'){
      advance('return');ui.toast('Order delivered','Robin signed the receipt. Take it back to Jo.','green','check');
    }else if(item.kind==='photo'){
      pendingPhoto=true;
    }else if(item.kind==='escort'){
      player.setFootMode(false);
      advance('escort');
      ui.toast('Sasha','Follow our red jackets. We’ll board ahead of you and meet you at the pad.','gold','lift');
    }else if(item.kind==='wait'){
      return true;
    }else if(item.kind==='lift'){
      const site=siteFor(state.stage);
      const assisted=Array.from(multiplayer.peers.values()).some(({pose,assist})=>assist===multiplayer.id &&
        Math.hypot(pose[0]-site.anchor.x,pose[2]-site.anchor.z)<17);
      if(flight.beginLift(site,assisted))ui.toast('Hold position','Sasha is holding the helicopter steady for the pickup.','blue','lift');
    }else if(item.kind==='assist'){
      helping={id:item.id,stage:item.stage,site:siteFor(item.stage)};
      ui.toast('Ground team ready','Hold position near the pickup while the helicopter lifts.','green','check');
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
    const p=player.pos, rescue=state.id==='rescue'&&season()!=='summer';
    if(rescue && expeditions.active===home && ['tree','ledge'].includes(state.stage)){
      if(flight.hoisting)return {kind:'wait',title:'Rescue in progress',detail:'Watch the patroller work the winch'};
      if(flight.approach(siteFor(state.stage)).ready)
        return {kind:'lift',title:'Lower rescue rope',detail:state.stage==='tree'?'Pick up the skier in the tree':'Pick up the skier on the rock ledge'};
    }
    if(player.riding || player.speed>4)return null;
    if(rescue && state.stage==='rally' && dist(p,rally)<5 && Math.abs(p.y-rally.y)<2.5)
      return {kind:'escort',title:'Set off with ski patrol',detail:'Follow Sasha and Ren downhill'};
    if(rescue && ['rally','escort'].includes(state.stage) && dist(p,base)<9)
      return {kind:'wait',title:'Wait for the patrol crew',detail:state.stage==='rally'?'Meet the crew uphill at Upper Whiskey Jack':'The patrollers will board first'};
    if(!helping && state.id!=='rescue'){
      for(const [id,peer] of multiplayer.peers){
        if(radioSearch.includes(peer.patrol)&&dist(p,siteFor(peer.patrol).anchor??legacySite)<8)
          return {kind:'assist',id,stage:peer.patrol,title:'Secure the rescue sling',detail:'Join '+multiplayer.callsign(id)+' on the ground team'};
      }
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
  }
  function drawRemoteCall(dt) {
    if(remoteAircraft)remoteAircraft.group.visible=false;
    const peer=call?.[1], site=peer && siteFor(peer.patrol);
    const near=site && dist(player.pos,site)<475;
    if(near&&!rescuers)deployTeam();
    if(rescuers){
      bivy.visible=!!near;
      for(const person of rescuers)person.visible=!!near;
    }
    if(!near)return;
    const anchor=site.anchor??site, guest=site.guest??site;
    const ground=heightAt(anchor.x,anchor.z);
    bivy.position.set(anchor.x,ground,anchor.z);
    rescuers[0].position.set(anchor.x-1.1,ground,anchor.z);
    rescuers[0].rotation.set(0,Math.PI/2,.035);
    rescuers[1].position.set(guest.x,guest.y??ground+.28,guest.z-.30);
    rescuers[1].rotation.x=peer.patrol==='search'?Math.PI/2:.42;
    if((peer.pose[10]&8) && Math.hypot(peer.pose[0]-site.x,peer.pose[2]-site.z)<170){
      if(!remoteAircraft){
        remoteAircraft=createServiceAsset('helicopter');scene.add(remoteAircraft.group);
        remoteAircraft.setOccupied?.(true);
      }
      remoteAircraft.group.visible=true;remoteAircraft.group.position.fromArray(peer.pose);
      remoteAircraft.group.quaternion.fromArray(peer.pose,3).normalize();
      remoteAircraft.animate?.(dt);
    }
  }
  function update(dt) {
    for(const spot of Object.values(stops)) if(spot?.mark?.visible)
      spot.mark.rotation.y=Math.atan2(camera.position.x-spot.x,camera.position.z-spot.z);
    const stage=state.id==='rescue'&&season()!=='summer'&&flightStages.includes(state.stage)?state.stage:null;
    const result=flight.update(dt,stage,guide);
    if(result==='crew-ready')advance('board');
    if(result==='boarded')advance('tree');
    if(result==='tree-rescued'){
      advance('ledge');
      ui.toast('Skier aboard','Ren is back inside. The next pickup is on the rock ledge.','green','check');
    }
    if(result==='ledge-rescued'){
      if(shop.find(keyFor('rescue'),assignments.rescue.reward)){
        shop.equipPatrolShell();
        ui.toast('Alpine Patrol Shell equipped','Both skiers aboard · 2× landing trick points · 20 mountain coins','gold','star');
      }
      delivered=9;
      clearAssignment();
    }
    if(state.id==='rescue'){
      const instruction=rescueInstruction();
      if(message.textContent!==instruction)message.textContent=instruction;
    }
    delivered=Math.max(0,delivered-dt);
    const phase=delivered>0?'delivered':expeditions.active===home && ['tree','ledge'].includes(stage)?stage:'idle';
    if(helping){
      const pilot=multiplayer.peers.get(helping.id);
      const groundSite=helping.site.anchor??helping.site;
      if(!pilot || pilot.patrol!==helping.stage || dist(player.pos,groundSite)>22){
        const completionStage={search:'evacuate',tree:'ledge',ledge:'delivered'}[helping.stage];
        if(pilot && [completionStage,'delivered'].includes(pilot.patrol) && dist(player.pos,groundSite)<22 && shop.find('quest.ground-team',5))
          ui.toast('Ground assist','Skier aboard · 5 mountain coins','green','check');
        helping=null;
      }
    }
    multiplayer.patrolRadio(phase,helping?.id??'');
    call=state.id!=='rescue'?Array.from(multiplayer.peers).find(([,peer])=>radioSearch.includes(peer.patrol)):null;
    dispatch.hidden=!call;
    drawRemoteCall(dt);
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
  document.getElementById('assignment-abandon').onclick=clearAssignment;
  show();
  return {nearby,act,update,capture,stops,airSite,base,flight,get state(){return state;}};
}
