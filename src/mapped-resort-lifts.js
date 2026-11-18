import * as THREE from 'three';
import { clamp, damp, lerp, smoothstep, wrapAngle } from './util.js';
import { buildLiftProfile, liftPoint } from './mapped-lift-profile.js';
import { buildAerialLanes, buildLiftConnector, buildLiftTerminal, buildSurfaceLine, chairGeometry,
  createLiftInstances, gondolaGeometry, movingGlass, seatedRiderGeometry } from './mapped-lift-machinery.js';

const TAU = Math.PI * 2;
const views = ['forward','valley','chase'];
const chairShades = ['#45616a','#6e7d78','#52707a','#71828c'];
const palettes = [
  ['#ad4837','#263138','#e4dac5'], ['#39717a','#404047','#31424a'],
  ['#c38c44','#3d5053','#303942'], ['#52617b','#262f32','#cc6754'],
];

function clockCurve(lift) {
  const { profile, speed, detachable } = lift;
  const count = Math.max(16, Math.ceil(profile.length / 1.6)), lut = [0];
  const length = profile.length / count;
  for (let i = 0; i < count; i++) {
    const berth = Math.min((i+.5)*length, profile.length-(i+.5)*length);
    const velocity = detachable ? lerp(1.15,speed,smoothstep(1,22,berth)) : speed;
    lut.push(lut[i]+length/velocity);
  }
  const duration = lut.at(-1);
  return {
    duration,
    fractionAt(seconds) {
      const time=clamp(seconds,0,duration);
      let lo=0,hi=count;
      while (hi-lo>1) {
        const mid=(hi+lo)>>1;
        if(time<lut[mid])hi=mid;
        else lo=mid;
      }
      return (lo+(time-lut[lo])/(lut[hi]-lut[lo]))/count;
    },
  };
}

function mappedExit(lift, config, ground, colliders) {
  const { profile, def, surface, gauge } = lift;
  const { top } = profile;
  if (def.unload) return { ...liftPoint(def.unload), heading:def.unload.heading ?? top.heading+Math.PI, holdAtUnload:true };
  if (lift.stationStyle === 'tye-mill') return { x: 552.1, z: 1384, heading: -.039, holdAtUnload: true };
  if (lift.stationStyle === 'rope-tow') return { ...top.world(3.9, -2.35), heading: top.heading + Math.PI, holdAtUnload: true };
  const estimate = top.world(gauge,0);
  const summitY = ground.heightAt(estimate.x,estimate.z);
  const nearby = colliders.filter(c=>Math.hypot(c.x-estimate.x,c.z-estimate.z)<94);
  const best = { score:Infinity, pose:null };
  function consider(x,z,heading,routeBonus) {
    const gap=Math.hypot(x-estimate.x,z-estimate.z);
    if(gap>75 || gap<2.25 || (ground.bounds && (x<ground.bounds.minX || x>ground.bounds.maxX ||
      z<ground.bounds.minZ || z>ground.bounds.maxZ))) return;
    const dx=Math.sin(heading),dz=Math.cos(heading);
    for(const offset of [0,1.6,3.2,5]) for(const c of nearby) {
      const xx=x+dx*offset,zz=z+dz*offset,yy=ground.heightAt(xx,zz)+.18;
      if(yy>(c.maxY??Infinity)||yy<(c.minY??-Infinity))continue;
      const a=xx-c.x,b=zz-c.z;
      if(c.r) {
        if(Math.hypot(a,b)<c.r+.60)return;
      } else {
        const cos=Math.cos(c.rot),sin=Math.sin(c.rot);
        if(Math.abs(a*cos+b*sin)<c.hw+.44&&Math.abs(b*cos-a*sin)<c.hd+.44)return;
      }
    }
    const y=ground.heightAt(x,z), nearY=ground.heightAt(x+dx*2.7,z+dz*2.7);
    const drop=y-ground.heightAt(x+dx*10,z+dz*10);
    const approach = Math.max(0,y-summitY-2.1);
    const score = gap + approach*7 + Math.max(0,nearY-y-.16)*74
      + Math.max(0,.55-drop)*19 + Math.max(0,drop-5.1)*8 - routeBonus;
    if(score<best.score) {
      best.score=score;
      best.pose={x,z,heading,holdAtUnload:true};
    }
  }
  for(const run of config.runs ?? []) {
    const way=run.points.map(liftPoint);
    for(let i=1;i<way.length;i++) {
      const a=way[i-1],b=way[i],dx=b.x-a.x,dz=b.z-a.z,len2=dx*dx+dz*dz;
      if(len2<.005)continue;
      let t=clamp(((estimate.x-a.x)*dx+(estimate.z-a.z)*dz)/len2,0,.96);
      if(t===0)t=Math.min(.18,3/Math.sqrt(len2));
      const preferred=(def.id===config.startLift && run.id===config.startRun) ||
        (def.id===config.beginnerLift && run.id===config.beginnerRun);
      consider(a.x+dx*t,a.z+dz*t,Math.atan2(dx,dz),preferred?40:run.connector?9:16);
    }
  }
  for(const radius of surface?[4,7,10]:[5.9,9.0,14,21]) for(let i=0;i<16;i++) {
    const heading=top.heading+TAU*i/16;
    const x=estimate.x+Math.sin(heading)*radius,z=estimate.z+Math.cos(heading)*radius;
    consider(x,z,heading,0);
  }
  return best.pose ?? { ...top.world(gauge+3.2,-5), heading:top.heading+Math.PI, holdAtUnload:true };
}

function planLift(source, ground, index, resortId) {
  const def={ ...source, type:source.kind, seats:source.capacity, rideable:source.rideable!==false };
  const surface=def.kind==='surface';
  const carpet=surface&&/carpet/i.test(def.liftType??def.surfaceType??def.name);
  const seats=clamp(def.capacity??(surface?1:4),1,10);
  const gondola=def.kind==='gondola';
  const detachable=def.detachable??(gondola||def.kind==='chair'&&/express/i.test(def.name));
  const vintage=!detachable && (!def.manufacturer || /riblet|engineering/i.test(def.manufacturer));
  const gauge=surface?0:gondola?2.18:seats<=2?1.19:seats===3?1.43:1.75;
  const speed=Number.isFinite(def.speed)&&def.speed>0?def.speed:carpet?.70:surface?2.18:detachable?4.92:vintage?2.26:2.36;
  const stationStyle = resortId === 'stevens-pass' && ['tye-mill', 'rope-tow', 'hogsback-express'].includes(def.id) ? def.id : null;
  const paint=stationStyle === 'tye-mill' ? '#252c2d' : def.color??(/skytrac/i.test(def.manufacturer)?'#617765':chairShades[index%chairShades.length]);
  const profile=buildLiftProfile(def,ground,gauge,surface?0:gondola?1.11:seats*.26+.11,surface,carpet);
  const p=new THREE.Vector3(),tangent=new THREE.Vector3();
  let sideDifference=0;
  for(const t of [.27,.49,.71]) {
    profile.at(t,p,tangent,0);
    const x=tangent.z*83,z=-tangent.x*83;
    sideDifference+=ground.heightAt(p.x+x,p.z+z)-ground.heightAt(p.x-x,p.z-z);
  }
  const valleySide=sideDifference>1.5?-1:1;
  const lift={ def,profile,carpet,surface,gondola,gauge,seats,speed,detachable,vintage,paint,stationStyle,
    length:profile.length,clearance:profile.clearance,at:profile.at,wheels:[],valleySide };
  lift.timing=clockCurve(lift);
  lift.duration=lift.timing.duration;
  const startOffset = stationStyle === 'rope-tow' ? -5.9 : surface ? -1.8 : -4.3;
  const boarding=def.board ?? profile.bottom.world(surface?0:gauge, startOffset);
  lift.boardPose={...liftPoint(boarding),heading:boarding.heading??profile.bottom.heading};
  return lift;
}

function turnSection(lift, top) {
  return { type:'turn', lift, top, duration:Math.PI*lift.gauge/(lift.detachable?1.15:lift.speed) };
}

function lineSection(lift, reverse) {
  return { type:'line', lift, reverse, duration:lift.duration };
}

function fleetSections(first, second, connector) {
  const uphill=lineSection(first,false), downhill=lineSection(first,true), bottom=turnSection(first,false);
  if(!second)return [uphill,turnSection(first,true),downhill,bottom];
  return [uphill,{type:'connector',path:connector[1],duration:connector[1].getLength()/first.speed},
    lineSection(second,true),turnSection(second,false),lineSection(second,false),
    {type:'connector',path:connector[0],duration:connector[0].getLength()/first.speed,reverse:true},downhill,bottom];
}

function sampleSection(section, elapsed, position,tangent) {
  const f=clamp(elapsed/section.duration,0,1);
  if(section.type==='connector') {
    const t=section.reverse?1-f:f;
    section.path.getPointAt(t,position);section.path.getTangentAt(t,tangent);
    if(section.reverse)tangent.negate();
    return 12;
  }
  const { lift }=section;
  if(section.type==='line') {
    const t=lift.timing.fractionAt(section.reverse?section.duration-elapsed:elapsed);
    lift.at(t,position,tangent,section.reverse?-lift.gauge:lift.gauge);
    if(section.reverse)tangent.negate();
    return Math.min(t,1-t)*lift.length;
  }
  const frame=section.top?lift.profile.top:lift.profile.bottom;
  const a=f*Math.PI, side=section.top?1:-1;
  const p=frame.world(Math.cos(a)*lift.gauge*side,Math.sin(a)*lift.gauge*side);
  const dir=frame.world(-Math.sin(a)*side,Math.cos(a)*side);
  position.set(p.x,frame.y,p.z);tangent.set(dir.x-frame.x,0,dir.z-frame.z);
  return 0;
}

function makeFleet(group, first, second, connector, guestGeometry) {
  const sections=fleetSections(first,second,connector);
  let duration=0;
  for(const section of sections) {
    section.offset=duration;
    duration+=section.duration;
    if(section.type==='line'&&!section.reverse)section.lift.departure=section.offset;
  }
  const throughput=first.def.chairsPerHour??((first.def.ridersPerHour??(first.detachable?2400:1400))/first.seats);
  const interval=3600/Math.max(1,throughput);
  const n=clamp(Math.round(duration/interval),3,265);
  const geometry=first.gondola?gondolaGeometry(first):chairGeometry(first);
  const prefix=second?`${first.def.name} / ${second.def.name}`:first.def.name;
  const body=createLiftInstances(group,geometry.body,n,`${prefix} · carriers`);
  const far=geometry.far?createLiftInstances(group,geometry.far,n,`${prefix} · distant carriers`):null;
  const bar=geometry.bar?createLiftInstances(group,geometry.bar,n,`${prefix} · restraints`):null;
  const glass=geometry.glass?createLiftInstances(group,geometry.glass,n,`${prefix} · glazing`,movingGlass):null;
  const guests=first.gondola?[]:guestGeometry.map((geo,i)=>createLiftInstances(group,geo,Math.ceil(n/2),`${prefix} · riders ${i+1}`));
  const fleet={sections,duration,n,step:duration/n,shift:0,body,bar,far,glass,guests,first,guestSeats:new Uint8Array(n)};
  first.fleet=fleet;
  if(second)second.fleet=fleet;
  return fleet;
}

function turnClass(lift, distance) {
  return -1.32*(1-smoothstep(0,7.4,distance)) - (lift.vintage?.04:0);
}

/**
 * Build the operating lift system for a mapped resort. Horizontal inputs are in
 * projected meters. Each def.points runs from the loading terminal to the unload.
 * nearby() supplies an ordered set of walk-up boarding choices. board() also
 * accepts a lift/id for direct resort starts. update()/exit() return a completed
 * ride once, after placing the player on its downhill exit and clearing active.
 */
export function buildMappedResortLifts(scene, config, ground) {
  const group=new THREE.Group();group.name=`${config.name??'Mapped resort'} · Lift operations`;scene.add(group);
  const colliders=[], fleets=[], byId=new Map();
  const lifts=(config.lifts??[]).filter(def=>def.points?.length>1 && def.points.some(point=>{
    const a=liftPoint(point),b=liftPoint(def.points[0]);
    return Math.hypot(a.x-b.x,a.z-b.z)>.015;
  })).map((def,i)=>planLift(def,ground,i,config.id));
  const guestGeometry=palettes.map(seatedRiderGeometry);
  const mounted=createLiftInstances(group,guestGeometry[0],1,'Player · seated lift rider');
  const mountedPosition=new THREE.Vector3(), mountedTangent=new THREE.Vector3();
  const carrierPosition=new THREE.Vector3(),carrierTangent=new THREE.Vector3();
  const cameraPosition=new THREE.Vector3(), chaseDesired=new THREE.Vector3();
  const cameraTarget=new THREE.Vector3(), cameraBoom=new THREE.Vector3();
  const matrix=new THREE.Matrix4(), carriage=new THREE.Matrix4(), local=new THREE.Matrix4();
  const turn=new THREE.Matrix4(), anchor=new THREE.Matrix4(), lean=new THREE.Matrix4();
  const clip=new THREE.Vector3();
  let active=null, clock=0, ambientRiders=true;

  for(const lift of lifts) {
    byId.set(lift.def.id,lift);
    const section=new THREE.Group();section.name=lift.def.name;group.add(section);lift.group=section;
  }
  const paired=new Set();
  for(const lift of lifts) {
    if(lift.surface) {
      buildSurfaceLine(lift.group,lift,ground,colliders);
      continue;
    }
    if(paired.has(lift))continue;
    const top=lift.profile.top, key=lift.def.sharedLine;
    const other=key&&lifts.find(candidate=>candidate!==lift&&candidate.def.sharedLine===key&&!candidate.surface&&
      Math.hypot(candidate.profile.top.x-top.x,candidate.profile.top.z-top.z)<45&&
      Math.cos(candidate.profile.top.heading-top.heading)<-.45);
    for(const branch of other?[lift,other]:[lift]) {
      buildAerialLanes(branch.group,branch,ground,colliders,!!other);
      buildLiftTerminal(branch.group,branch,false,ground,colliders);
      buildLiftTerminal(branch.group,branch,true,ground,colliders,!!other);
    }
    const connector=other?buildLiftConnector(group,lift,other,ground,colliders):null;
    if(other)paired.add(other);
    fleets.push(makeFleet(group,lift,other,connector,guestGeometry));
  }
  for(const lift of lifts)lift.exitPose=mappedExit(lift,config,ground,colliders);

  function nearby(position) {
    return lifts.filter(lift=>lift.def.rideable).map(lift=>{
      const { boardPose,profile,gauge }=lift;
      const load=profile.bottom.world(gauge,0);
      const distance=Math.min(Math.hypot(position.x-boardPose.x,position.z-boardPose.z),Math.hypot(position.x-load.x,position.z-load.z));
      const elevation=ground.heightAt(boardPose.x,boardPose.z);
      return { lift,distance,direction:1,destination:lift.def.topName??lift.def.name,elevation };
    }).filter(choice=>choice.distance<15.2 && (!Number.isFinite(position.y)||Math.abs(position.y-choice.elevation)<10.5))
      .sort((a,b)=>a.distance-b.distance);
  }

  function carrierPhase(fleet,slot,time) {
    return active?.lift.fleet===fleet&&active.slot===slot?active.lift.departure+active.elapsed:
      THREE.MathUtils.euclideanModulo(time+fleet.shift+slot*fleet.step,fleet.duration);
  }

  function carrierSection(fleet,phase) {
    return fleet.sections.findLast(candidate=>candidate.offset<=phase)??fleet.sections[0];
  }

  function sampleCarrier(lift,slot,time,position,tangent) {
    const fleet=lift.fleet;
    if(!fleet||slot<0||slot>=fleet.n)return null;
    const phase=carrierPhase(fleet,slot,Number.isFinite(time)?time:clock);
    const section=carrierSection(fleet,phase);
    sampleSection(section,phase-section.offset,position,tangent);
    return section;
  }

  function animateFleets(camera) {
    mounted.count=0;
    for(const lift of lifts) for(const wheel of lift.wheels) wheel.rotation.y=-clock*lift.speed/lift.gauge;
    for(const fleet of fleets) {
      let nearCount=0,farCount=0;
      const riderCounts=[0,0,0,0];
      let occupied=false;
      for(let i=0;i<fleet.n;i++) {
        const phase=carrierPhase(fleet,i,clock), section=carrierSection(fleet,phase);
        const stationDistance=sampleSection(section,phase-section.offset,carrierPosition,carrierTangent);
        const distance=camera?camera.position.distanceToSquared(carrierPosition):0;
        const passenger=active?.lift.fleet===fleet&&active.slot===i;
        if(distance>1450**2&&!passenger)continue;
        const heading=Math.atan2(carrierTangent.x,carrierTangent.z);
        carriage.makeRotationY(heading).setPosition(carrierPosition);
        if(fleet.far&&distance>175**2&&!passenger) {
          fleet.far.setMatrixAt(farCount++,carriage);
          continue;
        }
        if(!fleet.first.gondola) {
          const roll=Math.sin(clock*1.4+i*3.17)*.012*smoothstep(2,16,stationDistance);
          lean.makeRotationZ(roll);carriage.multiply(lean);
        }
        fleet.body.setMatrixAt(nearCount,carriage);
        if(fleet.glass)fleet.glass.setMatrixAt(nearCount,carriage);
        if(fleet.bar) {
          anchor.makeTranslation(0,-1.77,-.253);
          turn.makeRotationX(turnClass(fleet.first,stationDistance));
          matrix.copy(carriage).multiply(anchor).multiply(turn);
          fleet.bar.setMatrixAt(nearCount,matrix);
        }
        nearCount++;
        if(passenger&&fleet.bar&&active.view==='chase') {
          local.makeTranslation(.19,-2.54,.01);
          mounted.setMatrixAt(0,matrix.copy(carriage).multiply(local));
          occupied=true;
        } else if(ambientRiders&&!passenger&&!fleet.guestSeats[i]&&fleet.guests.length&&distance<106**2&&stationDistance>8.5&&i%3===0) {
          const palette=(i+fleet.first.seats)%fleet.guests.length;
          const riderIndex=riderCounts[palette]++;
          if(riderIndex<fleet.guests[palette].instanceMatrix.count) {
            local.makeTranslation((i%2===0?-1:1)*.27,-2.54,.01);
            fleet.guests[palette].setMatrixAt(riderIndex,matrix.copy(carriage).multiply(local));
          }
        }
      }
      fleet.body.count=nearCount;fleet.body.instanceMatrix.needsUpdate=nearCount>0;
      if(fleet.glass){fleet.glass.count=nearCount;fleet.glass.instanceMatrix.needsUpdate=nearCount>0;}
      if(fleet.bar){fleet.bar.count=nearCount;fleet.bar.instanceMatrix.needsUpdate=nearCount>0;}
      if(fleet.far){fleet.far.count=farCount;fleet.far.instanceMatrix.needsUpdate=farCount>0;}
      for(let i=0;i<fleet.guests.length;i++) {
        const mesh=fleet.guests[i];mesh.count=Math.min(riderCounts[i],mesh.instanceMatrix.count);
        mesh.instanceMatrix.needsUpdate=mesh.count>0;
      }
      if(occupied){mounted.count=1;mounted.instanceMatrix.needsUpdate=true;}
    }
  }

  function clipViewArm(from,desired,env) {
    let t=1;
    for(let i=1;i<=12;i++) {
      clip.lerpVectors(from,desired,i/12);
      if(clip.y<ground.heightAt(clip.x,clip.z)+.61) {
        t=Math.max(.17,(i-1)/12);
        break;
      }
    }
    desired.lerpVectors(from,desired,t);
    desired.y=Math.max(desired.y,ground.heightAt(desired.x,desired.z)+.66);
    env?.clipCameraArm?.(from.x,from.y,from.z,desired);
    return from.distanceTo(desired);
  }

  function placeRider(ride, player, camera, dt) {
    const { lift,view,progress }=ride;
    lift.at(progress,mountedPosition,mountedTangent);
    const heading=Math.atan2(mountedTangent.x,mountedTangent.z);
    const feetY=ground.heightAt(mountedPosition.x,mountedPosition.z)+.075;
    const seat=lift.gondola?-3.05:-2.54;
    const bodyY=lift.surface?feetY:Math.max(feetY,mountedPosition.y+seat);
    player.pos.set(mountedPosition.x,bodyY,mountedPosition.z);
    player.heading=heading;
    if(!camera)return;
    const targetBlend=view==='valley'?1:0;
    const easing=dt>0?1-Math.exp(-dt*4.2):1;
    ride.lookBlend=lerp(ride.lookBlend,targetBlend,easing);
    const stationDistance = Math.min(progress,1-progress)*lift.length;
    const sweep=lerp(.88,1.70,smoothstep(3.5,42,stationDistance));
    const x=Math.cos(heading), z=-Math.sin(heading), viewYaw=heading+ride.lookOffset+ride.lookBlend*sweep*lift.valleySide;
    const eye=lift.surface?1.58:lift.gondola?1.53:1.07;
    const shoulderOffset=lift.surface?0:lerp(.20,lift.valleySide*Math.min(.66,(lift.seats-1)*.26),ride.lookBlend);
    cameraBoom.set(player.pos.x+x*shoulderOffset,bodyY+eye,player.pos.z+z*shoulderOffset);
    if(view==='chase') {
      const angle = heading + ride.lookOffset - (lift.surface ? .64 : 2.12) * lift.valleySide;
      const distance = lift.surface ? 6.2 : 10.4;
      const rise = (lift.surface ? 2.4 : 2.9) - ride.lookPitch * distance * .42;
      chaseDesired.set(player.pos.x-Math.sin(angle)*distance,bodyY+rise,player.pos.z-Math.cos(angle)*distance);
      cameraPosition.copy(chaseDesired);
      const allowed = clipViewArm(cameraBoom,cameraPosition,player.env);
      const fraction = clamp(allowed / Math.max(.001,cameraBoom.distanceTo(chaseDesired)),0,1);
      ride.arm = dt <= 0 ? fraction : Math.min(fraction,damp(ride.arm,fraction,2.8,dt));
      cameraPosition.copy(cameraBoom).lerp(chaseDesired,ride.arm);
      cameraTarget.set(player.pos.x-Math.sin(heading)*1.4,bodyY+(lift.surface?.8:1.42),player.pos.z-Math.cos(heading)*1.4);
    } else {
      cameraPosition.copy(cameraBoom);
      cameraPosition.x+=Math.sin(heading)*.26;cameraPosition.z+=Math.cos(heading)*.26;
      cameraTarget.set(cameraPosition.x+Math.sin(viewYaw)*32,
        cameraPosition.y+mountedTangent.y*5-2.2-ride.lookBlend*4.9+Math.tan(ride.lookPitch)*32,
        cameraPosition.z+Math.cos(viewYaw)*32);
    }
    if(lift.surface&&player.model) {
      player.model.visible=view==='chase';
      if(player.model.visible) {
        if(player.rig)player.rig.group.visible=true;
        player.updateModel?.(dt,{},true);
      }
    }
    camera.position.copy(cameraPosition);camera.up.set(0,1,0);camera.lookAt(cameraTarget);
    const fov=view==='chase'?70:76;
    if(camera.fov!==fov){camera.fov=fov;camera.updateProjectionMatrix();}
  }

  function board(choice, player, camera) {
    if(active||!choice||!player)return null;
    const lift=typeof choice==='string'?byId.get(choice):choice.lift??choice;
    if(!lift?.def?.rideable || byId.get(lift.def.id)!==lift)return null;
    let slot=-1;
    if(lift.fleet) {
      const { fleet }=lift;
      const reference=THREE.MathUtils.euclideanModulo(lift.departure-clock-fleet.shift,fleet.duration);
      slot=Math.round(reference/fleet.step)%fleet.n;
      if(fleet.guestSeats[slot]) {
        const neighbors=[slot,(slot+1)%fleet.n,(slot+fleet.n-1)%fleet.n];
        slot=neighbors.find(i=>fleet.guestSeats[i]===0) ?? neighbors.find(i=>fleet.guestSeats[i]<lift.seats) ?? slot;
      }
      fleet.shift=lift.departure-clock-slot*fleet.step;
    }
    active={ lift,slot,view:'forward',progress:0,elapsed:0,duration:lift.duration,remaining:lift.duration,
      destination:choice.destination??lift.def.topName??lift.def.name,direction:1,
      lookOffset:0,lookBlend:0,lookPitch:0,arm:1 };
    if(player.setRiding)player.setRiding(true);
    else player.riding=true;
    if(player.model)player.model.visible=false;
    placeRider(active,player,camera,0);
    animateFleets(camera);
    return active;
  }

  function exit(player) {
    if(!active||!player)return null;
    const ride=active;
    active=null;
    ride.progress=1;ride.elapsed=ride.duration;ride.remaining=0;
    mounted.count=0;
    if(player.setRiding)player.setRiding(false);
    else player.riding=false;
    if(player.setFootMode)player.setFootMode(false);
    else player.footMode=false;
    if(player.model)player.model.visible=true;
    player.teleport(ride.lift.exitPose);
    return ride;
  }

  function update(dt,time,player,camera,keys={}) {
    const elapsed=Math.max(0,Number.isFinite(dt)?dt:0);
    clock=Number.isFinite(time)?time:clock+elapsed;
    let finished=null;
    if(active&&player) {
      const steer=Number(!!(keys.KeyD||keys.ArrowRight))-Number(!!(keys.KeyA||keys.ArrowLeft));
      active.lookOffset=wrapAngle(active.lookOffset-steer*elapsed*.86);
      active.elapsed=Math.min(active.duration,active.elapsed+elapsed);
      active.remaining=active.duration-active.elapsed;
      active.progress=active.lift.timing.fractionAt(active.elapsed);
      if(active.remaining<=0)finished=exit(player);
      else placeRider(active,player,camera,elapsed);
    }
    animateFleets(camera);
    return finished;
  }

  animateFleets(null);
  return { group,lifts,colliders,nearby,board,exit,update,sampleCarrier,
    setAmbientRiders(enabled) { ambientRiders=!!enabled; },
    changeView() {
      if(!active)return null;
      active.view=views[(views.indexOf(active.view)+1)%views.length];
      active.lookOffset=0;
      active.lookPitch=0;
      active.arm=1;
      return active.view;
    },
    look(dx,dy) {
      if (!active) return;
      active.lookOffset = wrapAngle(active.lookOffset-dx*.003);
      active.lookPitch = clamp(active.lookPitch-dy*.003,-.86,.78);
    },
    cancel(player) {
      if(!active)return;
      active=null;mounted.count=0;
      if(player) {
        if(player.setRiding)player.setRiding(false);
        else player.riding=false;
        if(player.model)player.model.visible=true;
      }
    },
    get active(){return active;},
  };
}
