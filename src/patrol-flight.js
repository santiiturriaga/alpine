import * as THREE from 'three';
import { RUNS, runPointAt } from './worlddata.js';
import { heightAt, normalAt } from './terrain.js';
import { guestClear, makeGuestPath, sampleGuestPath, turnDelta } from './guest-navigation.js';
import { clamp, smoothstep } from './util.js';
import { createPatrolActor, createPatrolCable, createPatrolLedge, createPatrolSignal, posePatrolActor } from './patrol-flight-assets.js';
import { MAX_CABLE } from './patrol-winch-link.js';

const distance = (a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const headingTo = (a,b)=>Math.atan2(b.x-a.x,b.z-a.z);
const headingDegrees = yaw=>((180-yaw*180/Math.PI)%360+360)%360;
const degrees = value=>String(Math.round(value)%360).padStart(3,'0')+'°';
const cardinal = {0:'N',90:'E',180:'S',270:'W'};
const seated = {hipY:.53,hipZ:0,hinge:.063,feet:[new THREE.Vector3(-.17,.10,.31),new THREE.Vector3(.17,.10,.31)],grip:[.24,.63,.23]};
const hanging = {hipY:.79,hipZ:-.04,hinge:.06,feet:[new THREE.Vector3(-.19,.22,.28),new THREE.Vector3(.21,.13,.23)],grip:[.12,1.12,.29]};
const patientPose = {hipY:.68,hipZ:0,hinge:.23,feet:[new THREE.Vector3(-.18,.12,.30),new THREE.Vector3(.18,.07,.29)],grip:[.21,.80,.26]};
const top = new THREE.Vector3(), tip = new THREE.Vector3(), patientPoint = new THREE.Vector3(), slopeNormal = new THREE.Vector3();
const attachPoint = new THREE.Vector3();
const HOVER_RADIUS = 2.6;
const WINCH_OFFSET = [1.74, 1.62, -.34];
const WINCH_SPEED = 3.4;
const REACH = 2.4;
const MIN_CABLE = 12;
const REACH_Y = .55;

function point(x,z) { return {x,z,y:heightAt(x,z)}; }

function escortPath(env,helicopter) {
  const run=RUNS.filter(r=>r.name==='Upper Whiskey Jack').sort((a,b)=>b.length-a.length)[0];
  const nodes=[];
  for(let d=51;d<=helicopter.trailD;d=Math.min(helicopter.trailD,d+3.5)){
    const trail=runPointAt(run,d/run.length);
    const options=[0,-1.5,1.5,-3,3,-4.5,4.5].map(o=>point(trail.x+trail.nx*o,trail.z+trail.nz*o));
    nodes.push(options.find(p=>guestClear(p.x,p.z,.87,env.queryColliders(p.x,p.z,4),p.y))??options[0]);
    if(d===helicopter.trailD)break;
  }
  const trailLength=makeGuestPath(nodes).length;
  nodes.push(helicopter.pad.access,...helicopter.pad.turns,helicopter.pad.boarding);
  const path=makeGuestPath(nodes);
  return {path,trailLength,rally:{...path.nodes[0],heading:path.nodes[0].heading}};
}

function hoverSite(env,name,anchor,guest,x,z) {
  const ground=heightAt(x,z);
  let obstacleHeight=ground;
  for (const c of env.queryColliders(x,z,12)) {
    if (c.type==='tree' && distance(c,{x,z})<(c.tree.apex*.16+5.4+HOVER_RADIUS))
      obstacleHeight=Math.max(obstacleHeight,c.maxY);
    if(c.type==='lift-tower' && distance(c,{x,z})<12) return null;
  }
  const hoverY=Math.max(ground+19,guest.y+16,obstacleHeight+4.3);
  if(hoverY-guest.y>MAX_CABLE-5) return null;
  return {name,anchor,guest,x,z,ground,hoverY,markerY:hoverY+.03,heading:headingTo(anchor,{x,z}),radius:HOVER_RADIUS};
}

function rescueSites(env,base) {
  let tree, bestTree=Infinity;
  for (const c of env.grid.circles) {
    if(c.type!=='tree' || c.tree.apex<10 || c.tree.apex>27) continue;
    const range=distance(c,base);
    if(range<235 || range>440)continue;
    const anchor={x:c.x,y:c.tree.y,z:c.z};
    const fromBase=headingTo(c,base);
    for(const angle of [0,1.15,-1.15,2.2,-2.2,Math.PI]){
      const sx=Math.sin(fromBase+angle),sz=Math.cos(fromBase+angle);
      const guest={x:c.x+sx*1.24,y:c.tree.y+clamp(c.tree.apex*.48,4.25,7.2),z:c.z+sz*1.24};
      const candidate=hoverSite(env,'Treeline pickup',anchor,guest,c.x+sx*2.72,c.z+sz*2.72);
      if(!candidate)continue;
      const score=Math.abs(range-322)*.17+Math.abs(c.tree.apex-15)*.64+
        Math.abs(angle)*.85+(candidate.hoverY-guest.y-16)*1.2;
      if(score<bestTree){tree=candidate;bestTree=score;}
    }
  }

  if(!tree){
    const c=env.grid.circles.find(c=>c.type==='tree' && distance(c,base)>170 && distance(c,base)<550);
    const p=c?point(c.x,c.z):point(base.x+175,base.z+175);
    const guest={...p,y:p.y+5,x:p.x+1.24};
    tree=hoverSite(env,'Treeline pickup',p,guest,p.x+2.72,p.z) ??
      {name:'Treeline pickup',anchor:p,guest,x:p.x+2.72,z:p.z,hoverY:p.y+25,markerY:p.y+25,heading:Math.PI/2,radius:HOVER_RADIUS};
  }

  let ledge,bestLedge=Infinity;
  for(let step=0;step<24;step++) for(const radius of [190,220,255,290,320]){
    const a=step*Math.PI/12;
    const anchor=point(tree.x+Math.sin(a)*radius,tree.z+Math.cos(a)*radius);
    if(distance(anchor,base)<170 || distance(anchor,base)>565)continue;
    if(!guestClear(anchor.x,anchor.z,5.8,env.queryColliders(anchor.x,anchor.z,11),anchor.y))continue;
    normalAt(anchor.x,anchor.z,slopeNormal);
    const heading=Math.atan2(slopeNormal.x,slopeNormal.z);
    const sx=Math.sin(heading),sz=Math.cos(heading);
    const guest={x:anchor.x+sx*1.42,y:anchor.y+3.19,z:anchor.z+sz*1.42};
    const candidate=hoverSite(env,'Scree ridge ledge',anchor,guest,anchor.x+sx*2.90,anchor.z+sz*2.90);
    if(!candidate)continue;
    const rise=candidate.hoverY-tree.hoverY;
    const score=Math.abs(radius-245)*.023+Math.abs(rise)*.07+
      Math.abs(anchor.y-candidate.ground-2.7)*1.35+(candidate.hoverY-guest.y-16)*.7;
    if(score<bestLedge){ledge=candidate;bestLedge=score;}
  }
  if(!ledge){
    const anchor=point(tree.x-210,tree.z+90);
    const guest={...anchor,y:anchor.y+3.19,z:anchor.z+1.42};
    ledge=hoverSite(env,'Scree ridge ledge',anchor,guest,anchor.x,anchor.z+2.90) ??
      {name:'Scree ridge ledge',anchor,guest,x:anchor.x,z:anchor.z+2.90,hoverY:anchor.y+22,markerY:anchor.y+22,heading:0,radius:HOVER_RADIUS};
  }
  return {tree,ledge};
}

export function winchTop(position,yaw,out) {
  const [x,y,z]=WINCH_OFFSET;
  const c=Math.cos(yaw),s=Math.sin(yaw);
  return out.set(position.x+x*c+z*s,position.y+y,position.z+z*c-x*s);
}

function pickupDepth(site,overhead) {
  return clamp(overhead.y-(site.guest.y+1.12),0,MAX_CABLE);
}

export function winchReach(site,overhead,depth) {
  if(depth<MIN_CABLE)return false;
  const dy=Math.abs(depth-pickupDepth(site,overhead));
  return dy<=REACH_Y && Math.hypot(distance(overhead,site.guest),dy)<=REACH;
}

function winchEnd(overhead,depth,time,out) {
  const sway=Math.min(1,depth/6)*.07;
  return out.set(overhead.x+Math.sin(time*2.5)*sway,overhead.y-depth,overhead.z+Math.cos(time*1.8)*sway);
}

function flightDisplay() {
  const byId=id=>document.getElementById(id);
  const panel=byId('patrol-nav'), head=byId('patrol-heading'), leg=byId('patrol-leg');
  const course=byId('patrol-course-marker'), container=byId('patrol-bearing-ticks');
  const target=byId('patrol-target'), range=byId('patrol-distance'), tip=byId('patrol-flight-tip');
  const ticks=Array.from({length:11},()=>{
    const tick=document.createElement('span');container.append(tick);return tick;
  });
  const setText=(element,text)=>{if(element.textContent!==text)element.textContent=text;};
  return {
    hide(){panel.hidden=true;},
    show(v,site,info,hoisting,number){
      const bearing=headingDegrees(headingTo(v.model.position,site));
      const h=headingDegrees(v.yaw), deviation=(bearing-h+540)%360-180;
      panel.hidden=false;
      panel.dataset.ready=String(info.ready && !hoisting);
      panel.dataset.hoisting=String(!!hoisting);
      setText(head,degrees(h));
      setText(leg,`Pickup ${number} of 2`);
      setText(target,`${site.name} · ${degrees(bearing)}`);
      setText(range,`${Math.round(info.range)} m`);
      setText(tip,hoisting || info.detail);
      const nearest=Math.round(h/15)*15;
      for(const [i,tick] of ticks.entries()){
        const raw=nearest+(i-5)*15, angle=(raw+360)%360;
        tick.style.left=(50+(raw-h)*.79)+'%';
        setText(tick,cardinal[angle]??(angle%30===0?String(angle).padStart(3,'0'):''));
      }
      course.style.left=(50+clamp(deviation*.79,-45,45))+'%';
    },
  };
}

export function createPatrolFlight({scene,env,expeditions,player,ui}) {
  const aircraft=expeditions.fleet.find(v=>v.id==='helicopter');
  const base={x:aircraft.homeX,y:aircraft.homeY,z:aircraft.homeZ,arrival:aircraft.pad.boarding};
  const {path,trailLength,rally}=escortPath(env,aircraft);
  const {tree,ledge}=rescueSites(env,base);
  const outcrop=createPatrolLedge(scene,ledge);
  env.grid.addCircle(ledge.anchor.x,ledge.anchor.z,3.1,'boulder',{
    minY:ledge.anchor.y-2.6,maxY:ledge.anchor.y+3.25,
  });
  const root=new THREE.Group();
  root.name='Alpine Patrol airlift crew';
  root.visible=false;
  scene.add(root);
  const nav=flightDisplay(), sample={};
  let cast, travelled=0, elapsed=0, crewReady=false, lift=null, currentSite=null;

  function makeCast() {
    const crew=[
      createPatrolActor(root,{name:'Patroller Sasha',jacket:0xb52538,helmet:0xf5e7cd,patrol:true}),
      createPatrolActor(root,{name:'Patroller Ren',jacket:0x9c2433,helmet:0xd1dacd,patrol:true}),
    ];
    return {
      crew,
      patients:[
        createPatrolActor(root,{name:'Skier in the tree',jacket:0xf2a13b,helmet:0x243747}),
        createPatrolActor(root,{name:'Skier on the rock ledge',jacket:0x2e88a7,helmet:0xe7af5a}),
      ],
      cable:createPatrolCable(root),
      signals:[createPatrolSignal(root,tree),createPatrolSignal(root,ledge)],
    };
  }
  function setVisible(stage) {
    root.visible=!!stage;
    if(!cast)return;
    for(const a of [...cast.crew,...cast.patients])a.frame.visible=false;
    for(const s of cast.signals)s.group.visible=false;
    cast.cable.mesh.visible=false;
  }
  function moveFrame(actor,parent) {
    if(actor.frame.parent!==parent)parent.add(actor.frame);
    actor.frame.visible=true;
  }
  function seat(actor,i,dt,model=aircraft.model) {
    moveFrame(actor,model);
    posePatrolActor(actor,{x:[.48,.51,-.51,0][i],y:.71,z:i===0?.79:-1.22,heading:0},dt,{mount:seated});
  }
  function reset() {
    travelled=elapsed=0;
    crewReady=false;
    lift=currentSite=null;
    aircraft.rescueFocus=null;
    aircraft.rescueSite=null;
    aircraft.boardBlocked=false;
    nav.hide();
    setVisible(null);
  }
  function ski(dt,stage) {
    const {crew}=cast;
    const start=stage==='rally';
    const lead=sampleGuestPath(path,travelled,sample);
    const gap=distance(player.pos,lead);
    const walking=travelled>=trailLength;
    const ahead=(player.pos.x-lead.x)*Math.sin(lead.heading)+(player.pos.z-lead.z)*Math.cos(lead.heading)>12;
    const rate=start?0:walking?2.1:!ahead&&gap>51?0:!ahead&&gap>32?4.3:!ahead&&gap>16?9.5:15.5;
    travelled=Math.min(path.length+4.1,travelled+rate*dt);
    for(const [i,actor] of crew.entries()){
      const d=travelled-i*2.9;
      if(d>=path.length){
        if(d>=path.length+1.0){seat(actor,i,dt);continue;}
        moveFrame(actor,root);
        const p=aircraft.pad.boarding,t=clamp(d-path.length,0,1);
        posePatrolActor(actor,{...p,x:p.x+Math.sin(p.heading)*t*2,z:p.z+Math.cos(p.heading)*t*2,y:p.y+t*.61},dt,
          {walk:.68,phase:elapsed*8.3,speed:rate});
        continue;
      }
      moveFrame(actor,root);
      const p=sampleGuestPath(path,Math.max(0,d),sample);
      const walking=d>=trailLength || start;
      const across=start?(i===0?-.9:1.35):Math.sin(elapsed*1.24+i)*.77+(i===1?.43:-.23);
      const x=p.x+Math.cos(p.heading)*across, z=p.z-Math.sin(p.heading)*across;
      const y=walking?(aircraft.pad.walkAt(x,z)??heightAt(x,z)):heightAt(x,z);
      const heading=start?headingTo({x,z},player.pos):p.heading;
      normalAt(x,z,slopeNormal);
      const tilt=walking?0:clamp(Math.atan2(slopeNormal.x*Math.sin(heading)+slopeNormal.z*Math.cos(heading),slopeNormal.y),-.36,.36);
      posePatrolActor(actor,{x,y,z,heading},dt,{footMode:walking,speed:rate,walk:walking&&rate>0?.79:0,
        phase:elapsed*8.4,steer:walking?0:Math.sin(elapsed*1.5+i)*.45,pitch:tilt});
    }
    const ready=travelled>=path.length+4.0;
    if(ready && !crewReady){
      crewReady=true;
      aircraft.boardBlocked=false;
      ui.toast('Sasha on the radio','We’re aboard. Meet us at the pad and take the controls.','gold','lift');
      return 'crew-ready';
    }
    return null;
  }
  function approach(site) {
    const p=aircraft.model.position, range=distance(p,site);
    const verticalError=p.y-site.hoverY;
    const speed=Math.abs(aircraft.speed);
    const turn=turnDelta(aircraft.yaw,headingTo(p,site));
    const verticalSpeed=Math.abs(aircraft.verticalSpeed);
    const overhead=winchTop(p,aircraft.yaw,top);
    const linedUp=distance(overhead,site.guest)<=REACH-.12;
    const ready=range<=site.radius && verticalError>=-1.2 && verticalError<=4 && speed<=1.8 && verticalSpeed<=1.6 && linedUp;
    let detail='Align the gold marker and fly toward the pickup.';
    if(aircraft.clearance<5)detail='Hold Space to lift off. A/D turns, W/S moves.';
    else if(range>22 && Math.abs(turn)>.55)detail=turn>0?'Turn left toward the gold marker.':'Turn right toward the gold marker.';
    else if(range<speed/.7+12 && speed>1.8)detail='Release W/S to slow for the pickup.';
    else if(range>22 && p.y<site.hoverY+8)detail='Climb with Space to clear the terrain ahead.';
    else if(range<=22 && verticalError < -1.2)detail=`Climb ${Math.ceil(-verticalError)} m with Space.`;
    else if(range<=22 && verticalError > 4)detail=`Descend ${Math.ceil(verticalError)} m with Shift.`;
    else if(range<=22 && range>site.radius)detail='Ease into the gold hover circle.';
    else if(range<=site.radius && !linedUp)detail='Turn the right side of the helicopter toward the skier.';
    else if(range<=site.radius && verticalSpeed>1.6)detail='Release the altitude controls to hold your hover.';
    if(ready)detail='Press E to hold this hover and start the winch.';
    return {range,ready,detail};
  }
  function beginLift(site,crew) {
    if(lift || !approach(site).ready)return false;
    lift={depth:0,phase:1,attachTime:0,crew};
    const length=clamp((aircraft.model.position.y-site.guest.y)*1.2,23,43);
    aircraft.rescueFocus={...site.guest,heading:site.heading,length};
    return true;
  }
  function drawRescue(site,index,dt,model,yaw,depth,attachMix,firstPerson=false) {
    const {patients,crew,signals,cable}=cast;
    const guest=patients[index], rescuer=crew[1];
    const marker=signals[index];
    marker.group.visible=depth===null;
    marker.diamond.rotation.y=elapsed*1.45;
    marker.diamond.position.y=.67+Math.sin(elapsed*3)*.23;
    moveFrame(guest,root);
    if(depth===null){
      posePatrolActor(guest,{...site.guest,heading:site.heading},dt,{mount:patientPose,roll:index===0?.21:-.13});
      return;
    }
    winchTop(model.position,yaw,top);
    winchEnd(top,depth,elapsed,tip);
    cable.set(top,tip);
    moveFrame(rescuer,root);
    rescuer.frame.visible=!firstPerson;
    const heading=headingTo(top,site.guest);
    posePatrolActor(rescuer,{x:tip.x,y:tip.y-1.18,z:tip.z,heading},dt,
      {mount:hanging,roll:Math.sin(elapsed*2.5)*.064});
    patientPoint.set(tip.x+Math.sin(heading)*.67,tip.y-1.32,tip.z+Math.cos(heading)*.67);
    patientPoint.lerp(site.guest,1-attachMix);
    posePatrolActor(guest,{x:patientPoint.x,y:patientPoint.y,z:patientPoint.z,heading:site.heading},dt,
      {mount:patientPose,roll:index===0?.20*(1-attachMix):-.14*(1-attachMix)});
  }
  function runLift(site,index,dt,crew,direction,attach) {
    if(!lift){
      drawRescue(site,index,dt,aircraft.model,aircraft.yaw,null,0);
      return null;
    }
    if(lift.crew!==crew)lift.crew='';
    const overhead=winchTop(aircraft.model.position,aircraft.yaw,top);
    const maxDepth=pickupDepth(site,overhead);
    if(lift.phase===1){
      lift.depth=clamp(lift.depth+(lift.crew?direction:1)*WINCH_SPEED*dt,0,maxDepth);
      if((attach||!lift.crew) && winchReach(site,overhead,lift.depth))lift.phase=2;
    }
    if(lift.phase===2){
      lift.attachTime=Math.min(.6,lift.attachTime+dt);
      const move=lift.crew?Math.min(0,direction):-1;
      if(lift.attachTime>=.35)lift.depth=Math.max(0,lift.depth+move*WINCH_SPEED*dt);
      if(lift.depth<=.08){
        lift=null;
        aircraft.rescueFocus=null;
        aircraft.snapView=true;
        seat(cast.crew[1],1,dt);
        seat(cast.patients[index],index+2,dt);
        return 'success';
      }
    }
    drawRescue(site,index,dt,aircraft.model,aircraft.yaw,lift.depth,smoothstep(0,.35,lift.attachTime));
    if(lift.crew)return lift.phase===2?'Skier clipped in · operator reeling in':'Winch operator has the controls';
    return lift.phase===2?'Hoisting the skier aboard…':'Ren is descending to the skier…';
  }
  function update(dt,stage,overflight,crew='',direction=0,attach=false) {
    elapsed+=dt;
    outcrop.visible=distance(player.pos,ledge)<470;
    setVisible(stage);
    aircraft.rescueSite=null;
    if(!stage){
      if(lift){lift=null;aircraft.rescueFocus=null;aircraft.snapView=true;}
      aircraft.boardBlocked=false;
      nav.hide();
      return null;
    }
    cast??=makeCast();
    const inAircraft=expeditions.active===aircraft;
    aircraft.boardBlocked=stage==='rally'||stage==='escort';
    if(stage==='rally'||stage==='escort'){
      nav.hide();
      return ski(dt,stage);
    }
    seat(cast.crew[0],0,dt);
    seat(cast.crew[1],1,dt);
    if(stage==='done'){
      seat(cast.patients[0],2,dt);
      seat(cast.patients[1],3,dt);
      nav.hide();
      return null;
    }
    if(stage==='tree'||stage==='ledge'){
      const index=Number(stage==='ledge'), site=index?ledge:tree;
      if(inAircraft)aircraft.rescueSite=site;
      if(index)seat(cast.patients[0],2,dt);
      if(!inAircraft && lift){
        lift=null;
        aircraft.rescueFocus=null;
      }
      const result=runLift(site,index,dt,crew,direction,attach);
      if(inAircraft) nav.show(aircraft,site,approach(site),result==='success'?'Skier aboard':result,index+1);
      else nav.hide();
      if(currentSite!==site && inAircraft){currentSite=site;overflight?.(site);}
      if(!inAircraft)currentSite=null;
      return result==='success'?stage+'-rescued':null;
    }
    nav.hide();
    return inAircraft?'boarded':null;
  }
  function passenger(dt,stage,model,yaw,depth,phase,mix) {
    elapsed+=dt;
    setVisible(stage);
    outcrop.visible=distance(player.pos,ledge)<470;
    nav.hide();
    cast??=makeCast();
    seat(cast.crew[0],0,dt,model);
    if(stage==='ledge'||stage==='done')seat(cast.patients[0],2,dt,model);
    if(stage==='done')seat(cast.patients[1],3,dt,model);
    if(stage==='tree'||stage==='ledge'){
      const i=Number(stage==='ledge');
      drawRescue(i?ledge:tree,i,dt,model,yaw,phase?depth:null,mix,true);
    }
    if(!phase || depth<.52)return attachPoint.set(.46,1.84,-1.13).applyMatrix4(model.matrixWorld);
    winchEnd(winchTop(model.position,yaw,top),depth,elapsed,attachPoint);
    attachPoint.y-=.33;
    return attachPoint;
  }
  return {base,rally,path,tree,ledge,approach,beginLift,update,passenger,reset,get hoisting(){return !!lift;},get winch(){return lift;}};
}
