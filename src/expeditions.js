import * as THREE from 'three';
import { RUNS, WORLD, runPointAt } from './worlddata.js';
import { heightAt, normalAt } from './terrain.js';
import { clamp, damp, smoothstep, wrapAngle } from './util.js';
import { createServiceAsset } from './service-assets.js';
import { createPatrolPad } from './patrol-flight-assets.js';
import { WingTrails } from './effects.js';

const stations = [
  {id:'helicopter',label:'Alpine helicopter',piste:'Upper Whiskey Jack',metres:270,radius:2.1,top:49},
  {id:'snowcat',label:'Service snowcat',piste:'Springboard',metres:259,radius:2.4,top:6.3},
  {id:'snowmobile',label:'Snowmobile',piste:'Ego Bowl',metres:335,radius:.85,top:23},
  {id:'wingsuit',label:'Wingsuit launch',piste:'The Saddle',metres:48,radius:.55,top:38},
];
const bikeSpec = {id:'bike',label:'Mountain bike',radius:.6,top:24};
const normal = new THREE.Vector3(), view = new THREE.Vector3(), target = new THREE.Vector3();
const forward = new THREE.Vector3(), side = new THREE.Vector3(), basis = new THREE.Matrix4();
const vertical = new THREE.Vector3(0,1,0), trackPoint = new THREE.Vector3();
const desiredView = new THREE.Vector3();
const whistler = { heightAt, normalAt, bounds:WORLD };
const distanceTo = (a,b) => Math.hypot(a.x-b.x,a.z-b.z);

export class Expeditions {
  constructor(scene, grid, { ground = whistler, env, fx, bikes = [], winterVehicles = true, season = () => 'winter' } = {}) {
    this.grid = grid;
    this.ground = ground;
    this.env = env;
    this.fx = fx;
    this.season = season;
    this.active = null;
    this.fleet = [];
    this.chasePoint = new THREE.Vector3();
    if (winterVehicles) {
      for (const spec of stations) {
        const candidates = RUNS.filter(r => r.name.toLowerCase() === spec.piste.toLowerCase());
        const run = (candidates.length ? candidates : RUNS.filter(r => r.name === 'Upper Whiskey Jack'))
          .sort((a,b) => b.length-a.length)[0];
        let pose;
        for (let d = spec.metres; d < spec.metres + 300; d += 6) {
          const p = runPointAt(run, Math.min(.96,d/run.length));
          pose = {x:p.x,z:p.z,heading:Math.atan2(p.tx,p.tz)};
          const x = p.x + p.nx * 5, z = p.z + p.nz * 5;
          if (!this.obstructed(x,z,ground.heightAt(x,z),spec.radius+1)) {
            pose.x = x;
            pose.z = z;
            break;
          }
        }
        const helipad = spec.id==='helicopter' && this.helicopterParking(run,spec.metres);
        this.addVehicle(scene, spec, helipad || pose, spec.id==='helicopter' ? pose : null);
      }
    }
    for (const { id, pose, label } of bikes) {
      this.addVehicle(scene, { ...bikeSpec, destination:id, label:label ?? bikeSpec.label }, this.bikeParking(pose));
    }
    this.wings = winterVehicles ? new WingTrails(scene) : null;
    const pad = this.fleet.find(v=>v.pad)?.pad;
    if (pad && env?.walkSurfaceAt) {
      const walkSurfaceAt = env.walkSurfaceAt.bind(env);
      const raisedPadAt = env.raisedPadAt?.bind(env);
      const helipadAt = (x,z,y) => {
        const deck=pad.walkAt(x,z);
        return deck !== null && deck<=y+.65 ? deck : null;
      };
      env.raisedPadAt = (x,z,y) => helipadAt(x,z,y) ?? raisedPadAt?.(x,z,y);
      env.walkSurfaceAt = (x,z,y) => helipadAt(x,z,y) ?? walkSurfaceAt(x,z,y);
    }
  }

  helicopterParking(run,metres) {
    let best, cost=Infinity;
    for (let d=metres-45; d<=metres+50; d+=5) {
      const trail=runPointAt(run,d/run.length);
      const trailY=this.ground.heightAt(trail.x,trail.z);
      for (const offset of [-13,13,-16,16,-19,19]) {
        const x=trail.x+trail.nx*offset, z=trail.z+trail.nz*offset, y=this.ground.heightAt(x,z);
        if (this.obstructed(x,z,y,7.5)) continue;
        const heading=Math.atan2(x-trail.x,z-trail.z);
        const rim=Array.from({length:8},(_,i)=>{
          const a=heading+Math.PI/8+i*Math.PI/4;
          return this.ground.heightAt(x+Math.sin(a)*7.2,z+Math.cos(a)*7.2);
        });
        const deck=Math.max(y,...rim)+.14;
        const spread=deck-Math.min(y,...rim);
        const step=Math.abs(deck-trailY);
        const pathClear=[.18,.4,.65,.85].every(t=>{
          const sx=trail.x+(x-trail.x)*t, sz=trail.z+(z-trail.z)*t;
          return !this.obstructed(sx,sz,this.ground.heightAt(sx,sz),.75);
        });
        if (!pathClear) continue;
        const score=Math.abs(d-metres)*.049+Math.abs(offset)*.075+spread*.85+step*1.8;
        if (score<cost) { cost=score;best={x,z,heading,trailD:d}; }
      }
    }
    return best;
  }

  bikeParking(pose) {
    const heading = pose.heading ?? 0, fx = Math.sin(heading), fz = Math.cos(heading);
    for (const advance of [0,3,6,9,13,18,24]) {
      for (const across of [0,1.2,-1.2,2.4,-2.4,4,-4]) {
        const x = pose.x+fx*advance+fz*across, z = pose.z+fz*advance-fx*across;
        const startHeight = this.ground.heightAt(x,z);
        if (this.ground.heightAt(x+fx*4,z+fz*4) > startHeight + .85) continue;
        const open = [0,1,2.5,4,6].every(distance => {
          const px = x+fx*distance, pz = z+fz*distance;
          return !this.obstructed(px,pz,this.ground.heightAt(px,pz),bikeSpec.radius+.10);
        });
        if (open) return { ...pose,x,z };
      }
    }
    return pose;
  }

  addVehicle(scene, spec, pose, legacyPose) {
    const model = new THREE.Group();
    model.name = spec.label;
    const pad = spec.id==='helicopter' ? createPatrolPad(scene,pose,this.ground.heightAt,this.grid) : null;
    const homeY=pad?.y ?? this.ground.heightAt(pose.x,pose.z);
    model.position.set(pose.x,homeY,pose.z);
    scene.add(model);
    const v = { ...spec, model, pad, legacyPose, homeX:pose.x, homeY, homeZ:pose.z, homeYaw:pose.heading ?? 0, trailD:pose.trailD ?? spec.metres,
      asset:null, yaw:pose.heading ?? 0, speed:0, clearance:0, cockpit:false };
    this.pose(v,false);
    this.park(v);
    this.fleet.push(v);
  }

  obstructed(x,z,y,radius) {
    if (this.grid?.buildingsAt(x,z).some(b => y < b.roofAt(x,z) + 1)) return true;
    const colliders = this.grid?.query(x,z,radius+3) ?? this.env?.queryColliders(x,z,radius+3) ?? [];
    return colliders.some(c => {
      if (y > (c.maxY ?? Infinity) + .65 || y + 1.35 < (c.minY ?? -Infinity)) return false;
      const dx=x-c.x,dz=z-c.z;
      if(c.hw===undefined)return dx*dx+dz*dz<(radius+c.r)**2;
      const a=Math.cos(c.rot),b=Math.sin(c.rot);
      return Math.abs(dx*a+dz*b)<c.hw+radius && Math.abs(dz*a-dx*b)<c.hd+radius;
    });
  }

  pose(v,flying) {
    const p = v.model.position;
    if (flying || v.pad?.surfaceAt(p.x,p.z)!=null) normal.copy(vertical);
    else this.ground.normalAt(p.x,p.z,normal);
    forward.set(Math.sin(v.yaw),0,Math.cos(v.yaw)).addScaledVector(normal,-normal.dot(forward)).normalize();
    side.crossVectors(normal,forward).normalize();
    basis.makeBasis(side,normal,forward);
    v.model.quaternion.setFromRotationMatrix(basis);
  }

  available(v) { return v.id !== 'bike' || this.season() === 'summer'; }

  drawNear(pos) {
    for (const v of this.fleet) {
      if (v.pad) v.pad.group.visible=Math.hypot(v.homeX-pos.x,v.homeZ-pos.z)<360;
      const visible = v === this.active || (this.available(v) && Math.hypot(v.model.position.x-pos.x,v.model.position.z-pos.z) < 340);
      v.model.visible = visible;
      if (visible && !v.asset) {
        v.asset = createServiceAsset(v.id);
        v.model.add(v.asset.group);
      }
    }
  }

  park(v) {
    if (!this.grid || v.id === 'bike') return;
    const p = v.model.position;
    v.collider = this.grid.addCircle(p.x,p.z,v.radius,'vehicle',{minY:p.y-.5,maxY:p.y+2.6});
  }

  unpark(v) {
    if (!v.collider) return;
    const c=v.collider, cells=new Set();
    for (const x of [c.x-c.r,c.x+c.r]) for (const z of [c.z-c.r,c.z+c.r])
      cells.add(this.grid.cells.get(this.grid.key(x,z)));
    for (const list of [...cells,this.grid.circles]) {
      const i = list?.indexOf(c) ?? -1;
      if (i !== -1) list.splice(i,1);
    }
    v.collider = null;
  }

  arrival(id, reset = false) {
    const v = this.fleet.find(entry => (entry.destination ?? entry.id) === id);
    if (!v) return null;
    if (reset && v !== this.active) this.resetHome(v);
    const p = v.model.position, offset = v.radius + 1.5;
    if (v.pad && distanceTo(p,v.pad.boarding)<5 && Math.abs(p.y-v.homeY)<.25)
      return {...v.pad.boarding,holdAtUnload:true,footMode:true};
    for (let i=0; i<16; i++) {
      const angle = v.yaw + Math.PI/2 + i*Math.PI/8;
      const x = p.x + Math.sin(angle)*offset, z = p.z + Math.cos(angle)*offset;
      if (!this.obstructed(x,z,this.floorAt(v,x,z),.33)) {
        return {x,z,heading:Math.atan2(p.x-x,p.z-z),holdAtUnload:true,footMode:true};
      }
    }
    return {x:p.x+offset,z:p.z,heading:-Math.PI/2,holdAtUnload:true,footMode:true};
  }

  nearest(pos) {
    return this.fleet.find(v => !v.boardBlocked && this.available(v) && Math.abs(pos.y-v.model.position.y)<4 &&
      distanceTo(pos,v.model.position)<v.radius+3.4);
  }

  floorAt(v,x,z) { return v.pad?.surfaceAt(x,z) ?? this.ground.heightAt(x,z); }

  resetHome(v) {
    this.unpark(v);
    v.model.position.set(v.homeX,v.homeY,v.homeZ);
    v.yaw=v.homeYaw;
    this.pose(v,false);
    this.park(v);
  }

  board(v,player) {
    this.drawNear(v.model.position);
    const glide = v.id === 'wingsuit';
    this.active = v;
    this.unpark(v);
    v.speed = glide ? 24 : 0;
    v.clearance = glide ? 12 : 0;
    v.model.position.y += v.clearance;
    v.cockpit = false;
    v.lookYaw = v.id === 'helicopter' ? .32 : 0;
    v.lookPitch = v.bank = v.posture = v.verticalSpeed = 0;
    v.arm = 1;
    v.jumpHeld = false;
    v.snapView = true;
    v.asset.setOccupied?.(true);
    player.setRiding(true);
    player.vehicleLabel = v.label;
    player.pos.copy(v.model.position);
    player.model.visible = !!v.asset.mount;
    if (v.asset.mount) {
      v.model.add(player.model);
      player.model.position.set(0,glide ? .63 : 0,glide ? -.99 : 0);
      player.model.rotation.set(glide ? Math.PI/2 : 0,0,0);
      player.rig.group.visible = true;
      player.rig.showHelmetGear(false,player);
      for (const shadow of player.bootShadows) shadow.visible = false;
      v.asset.animate?.(0,0,0,0,false);
      this.placeMountedRider(v,player,.016);
    }
  }

  placeMountedRider(v,player,dt) {
    const { mount } = v.asset;
    mount.gaze = clamp(v.lookYaw,-.96,.96);
    player.rig.animate(dt,{speed:Math.abs(v.speed),steer:0,brake:0,footMode:true,mount});
    player.model.visible = !v.cockpit;
  }

  leave(player,force=false) {
    const v = this.active;
    if (!v || (!force && v.clearance > 2)) return false;
    const aerial = v.id === 'wingsuit' || v.id === 'helicopter';
    if (aerial) {
      v.model.rotation.set(0,0,0);
    }
    if (v.asset.mount) player.scene.add(player.model);
    v.speed = v.clearance = 0;
    v.model.position.y = this.floorAt(v,v.model.position.x,v.model.position.z);
    this.pose(v,false);
    v.asset.animate?.(0,0,0,0,false);
    v.asset.setOccupied?.(false);
    v.rescueFocus=null;
    v.rescueSite=null;
    this.park(v);
    this.wings?.clear();
    this.fx?.breakVehicleTrack();
    this.active = null;
    player.setRiding(false);
    player.camera.near = .27;
    player.footMode = v.id !== 'wingsuit' || this.season() === 'summer';
    player.teleport(this.arrival(v.destination ?? v.id));
    return true;
  }

  look(dx,dy) {
    const v = this.active;
    v.lookYaw = wrapAngle(v.lookYaw - dx*.003);
    v.lookPitch = clamp(v.lookPitch-dy*.003,-.9,.86);
  }

  changeView() {
    const v = this.active;
    v.cockpit = !v.cockpit;
    v.snapView = true;
    v.asset.setOccupied?.(true,v.cockpit);
  }

  controls(v = this.active) {
    if (v?.id === 'wingsuit') return 'A/D bank · Space spread · Shift tuck · C view · E exit';
    if (v?.id === 'bike') return 'W pedal · S brake · A/D steer · Space hop · C view · E exit';
    if (v?.id === 'helicopter') return 'Space/Shift altitude · W/S fly · A/D turn · C view · E exit';
    return 'W/S travel · A/D steer · C view · E exit';
  }

  update(dt,keys,player,camera,clock) {
    const v = this.active, p = v.model.position;
    if (v.rescueFocus) {
      v.speed=player.speed=0;
      v.verticalSpeed=0;
      v.bank=damp(v.bank,0,5,dt);
      this.pose(v,true);
      v.asset.animate?.(dt);
      this.updateCamera(v,camera,dt,clock);
      return;
    }
    const steering = Number(!!(keys.KeyD||keys.ArrowRight)) - Number(!!(keys.KeyA||keys.ArrowLeft));
    const throttle = Number(!!(keys.KeyW||keys.ArrowUp)) - Number(!!(keys.KeyS||keys.ArrowDown));
    const tuck = !!(keys.ShiftLeft||keys.ShiftRight);
    const spread = !!keys.Space;
    const heli = v.id === 'helicopter', glide = v.id === 'wingsuit', bike = v.id === 'bike';
    const oldY = p.y;
    const up = Number(spread) - Number(tuck);
    const ground = this.ground;
    const pGround = this.floorAt(v,p.x,p.z);
    const banking = glide ? .66 : heli ? .12 : bike ? .43 * clamp(v.speed/7,.12,1) : .045;
    v.bank = damp(v.bank,steering*banking,glide ? 4.5 : 7,dt);
    if (glide) {
      v.posture = damp(v.posture,clamp(throttle-up,-1,1),3.5,dt);
      v.speed = damp(v.speed,27 + v.posture*10,1.23,dt);
      v.yaw -= v.bank * 1.62 * dt;
    } else if (bike) {
      ground.normalAt(p.x,p.z,normal);
      const downhill = normal.x*Math.sin(v.yaw) + normal.z*Math.cos(v.yaw);
      const drive = Math.max(0,throttle) * (1-clamp(v.speed/v.top,0,1)) * 5.7;
      const loss = .38 + v.speed*.055 + Math.max(0,-throttle)*(6.4+v.speed*.31);
      if (v.clearance < .1) v.speed = clamp(v.speed + (downhill*8.8 + drive - loss)*dt,0,v.top);
      v.yaw -= steering * dt * clamp(.27+v.speed*.39,.27,1) * (1.88 - v.speed*.043);
      if (spread && !v.jumpHeld && v.clearance < .1 && v.speed > 1.8) v.verticalSpeed = 3.75;
      v.jumpHeld = spread;
    } else {
      const limit = v.rescueSite ? 3+(v.top-3)*smoothstep(8,36,distanceTo(p,v.rescueSite)) : v.top;
      const reverse = v.rescueSite ? Math.max(1.8,limit*.22) : limit*.22;
      const desired = throttle > 0 ? limit : throttle < 0 ? -reverse : 0;
      v.speed = damp(v.speed,desired,heli ? .7 : 1.35,dt);
      const turn = heli ? 1.1 : 1.27 * clamp(Math.abs(v.speed)/3,0,1) * (v.speed < 0 ? -1 : 1);
      v.yaw -= steering * dt * turn;
    }
    const { minX,maxX,minZ,maxZ } = ground.bounds;
    const x = clamp(p.x + Math.sin(v.yaw)*v.speed*dt,minX+8,maxX-8);
    const z = clamp(p.z + Math.cos(v.yaw)*v.speed*dt,minZ+8,maxZ-8);
    const groundY = this.floorAt(v,x,z);
    let altitude = groundY;
    if (heli) altitude = Math.max(groundY,p.y+up*13*dt);
    if (glide) altitude = p.y - dt*(4.7+v.posture*2.7+Math.abs(v.bank)*.9);
    if (bike && (v.verticalSpeed || v.clearance > .04 || pGround-groundY > .33)) {
      v.verticalSpeed -= 9.81 * dt;
      altitude = p.y + v.verticalSpeed * dt;
      if (altitude <= groundY) v.verticalSpeed = 0;
    }
    if (((heli||glide) && altitude>groundY+30) || !this.obstructed(x,z,altitude,v.radius)) {
      p.set(x,Math.max(groundY,altitude),z);
    } else {
      v.speed = 0;
      if (heli) p.y = Math.max(pGround,p.y+up*13*dt);
      if (glide) { this.leave(player,true); return; }
      if (bike) { v.verticalSpeed = 0; p.y = pGround; }
    }
    if (heli) v.verticalSpeed = (p.y-oldY)/dt;
    v.clearance = p.y-this.floorAt(v,p.x,p.z);
    if (glide && v.clearance < .4) { this.leave(player,true); return; }
    this.pose(v,(heli||glide||bike) && v.clearance>.6);
    v.model.rotateZ(v.bank);
    if (glide) v.model.rotateX(.13 + v.posture*.125);
    v.asset.animate?.(dt,v.speed,clock,steering,glide ? v.posture : throttle > 0);
    if (v.asset.mount) this.placeMountedRider(v,player,dt);
    if (glide) this.wings.update(dt,v.model,v.asset.span,v.speed,!v.cockpit);
    if (!(heli || glide)) {
      if (Math.abs(v.speed) > .75 && v.clearance < .15) {
        const aft = (bike ? .64 : v.id === 'snowmobile' ? 1.23 : 1.94) * Math.sign(v.speed);
        trackPoint.set(p.x-Math.sin(v.yaw)*aft,p.y,p.z-Math.cos(v.yaw)*aft);
        this.fx?.vehicleTrack(v.id,trackPoint,v.yaw,this.season() === 'summer');
      } else this.fx?.breakVehicleTrack();
    }
    player.stats.distance += Math.hypot(p.x-player.pos.x,p.z-player.pos.z);
    player.stats.topSpeed = Math.max(player.stats.topSpeed,Math.abs(v.speed));
    if (!heli) player.stats.vertical += Math.max(0,player.pos.y-p.y);
    player.pos.copy(p);
    player.speed = Math.abs(v.speed);
    player.heading = v.yaw;
    player.grounded = v.clearance < .13;
    player.airborne = !player.grounded;
    this.updateCamera(v,camera,dt,clock);
  }

  updateCamera(v,camera,dt,clock) {
    const heli = v.id === 'helicopter', glide = v.id === 'wingsuit', bike = v.id === 'bike';
    const p = v.model.position;
    const angle = v.yaw + v.lookYaw;
    const length = heli ? 16 : glide ? 7.65 : v.id === 'snowcat' ? 10 : bike ? 5.6 : 7;
    const snap = v.snapView;
    v.snapView = false;
    camera.near = v.cockpit ? .055 : .27;
    const shake = glide ? clamp((v.speed-17)/19,0,1) * (v.cockpit ? .028 : .065) : 0;
    const focus=v.rescueFocus;
    if (focus) {
      const shotAngle=focus.heading+.90;
      const distance=focus.length ?? 23;
      target.set(focus.x,focus.y+2.3,focus.z);
      target.lerp(p,.49);
      desiredView.set(target.x+Math.sin(shotAngle)*distance,target.y+distance*.24,target.z+Math.cos(shotAngle)*distance);
      const span=target.distanceTo(desiredView);
      const clear=this.env?.clipCameraArm?.(target.x,target.y,target.z,desiredView) ?? span;
      desiredView.lerp(target,1-clamp(clear/Math.max(.001,span),.3,1));
      this.chasePoint.lerp(desiredView,snap ? 1 : 1-Math.exp(-dt*4.5));
      camera.position.copy(this.chasePoint);
      camera.near=.27;
    } else if (v.cockpit) {
      v.model.updateMatrixWorld(true);
      view.copy(v.asset.eye || vertical).applyMatrix4(v.model.matrixWorld);
      view.y += Math.sin(clock*33)*shake;
      const pitch = v.lookPitch - (glide ? .11 + v.posture*.07 + Math.sin(clock*31)*shake*.24 : 0);
      target.copy(view).addScaledVector(forward.set(Math.sin(angle)*Math.cos(pitch),Math.sin(pitch),Math.cos(angle)*Math.cos(pitch)),15);
      camera.position.copy(view);
    } else {
      desiredView.set(p.x-Math.sin(angle)*length,p.y+length*(.34-v.lookPitch*.39),p.z-Math.cos(angle)*length);
      desiredView.y = Math.max(desiredView.y,this.ground.heightAt(desiredView.x,desiredView.z)+1.2) + Math.sin(clock*29)*shake;
      this.chasePoint.lerp(desiredView,snap ? 1 : 1-Math.exp(-dt*10));
      target.set(p.x,p.y+(heli ? .9 : 1.04),p.z);
      camera.position.copy(this.chasePoint);
      const span = target.distanceTo(this.chasePoint);
      const clear = this.env?.clipCameraArm?.(target.x,target.y,target.z,camera.position) ?? span;
      const fraction = clamp(clear / Math.max(.001,span),0,1);
      v.arm = snap ? fraction : Math.min(fraction,damp(v.arm,fraction,2.8,dt));
      camera.position.copy(target).lerp(this.chasePoint,v.arm);
    }
    camera.up.set(0,1,0);
    camera.lookAt(target);
    if (v.cockpit && glide) camera.rotateZ(-v.bank*.14);
    const fov = focus ? 62 : v.cockpit ? (glide ? 85 : 77) : glide ? 79 : 69;
    camera.fov = snap ? fov : damp(camera.fov,fov,5,dt);
    camera.updateProjectionMatrix();
  }
}
