import * as THREE from 'three';
import { RUNS, WORLD, runPointAt } from './worlddata.js';
import { heightAt, normalAt } from './terrain.js';
import { clamp, damp, wrapAngle } from './util.js';
import { createServiceAsset } from './service-assets.js';
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
        this.addVehicle(scene, spec, pose);
      }
    }
    for (const { id, pose, label } of bikes) {
      this.addVehicle(scene, { ...bikeSpec, destination:id, label:label ?? bikeSpec.label }, pose);
    }
    this.wings = winterVehicles ? new WingTrails(scene) : null;
  }

  addVehicle(scene, spec, pose) {
    const model = new THREE.Group();
    model.name = spec.label;
    model.position.set(pose.x,this.ground.heightAt(pose.x,pose.z),pose.z);
    scene.add(model);
    const v = { ...spec, model, home:model.position.clone(), homeYaw:pose.heading ?? 0,
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
    if (flying) normal.copy(vertical);
    else this.ground.normalAt(p.x,p.z,normal);
    forward.set(Math.sin(v.yaw),0,Math.cos(v.yaw)).addScaledVector(normal,-normal.dot(forward)).normalize();
    side.crossVectors(normal,forward).normalize();
    basis.makeBasis(side,normal,forward);
    v.model.quaternion.setFromRotationMatrix(basis);
  }

  available(v) { return v.id !== 'bike' || this.season() === 'summer'; }

  drawNear(pos) {
    for (const v of this.fleet) {
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
    const c = v.collider, cell = this.grid.cells.get(this.grid.key(c.x,c.z));
    for (const list of [cell,this.grid.circles]) {
      const i = list?.indexOf(c) ?? -1;
      if (i !== -1) list.splice(i,1);
    }
    v.collider = null;
  }

  arrival(id, reset = false) {
    const v = this.fleet.find(entry => (entry.destination ?? entry.id) === id);
    if (!v) return null;
    if (reset && v !== this.active) {
      v.model.position.copy(v.home);
      v.yaw = v.homeYaw;
      this.pose(v,false);
    }
    const p = v.model.position, offset = v.radius + 1.5;
    for (let i=0; i<16; i++) {
      const angle = v.yaw + Math.PI/2 + i*Math.PI/8;
      const x = p.x + Math.sin(angle)*offset, z = p.z + Math.cos(angle)*offset;
      if (!this.obstructed(x,z,this.ground.heightAt(x,z),.33)) {
        return {x,z,heading:Math.atan2(p.x-x,p.z-z),holdAtUnload:true,footMode:true};
      }
    }
    return {x:p.x+offset,z:p.z,heading:-Math.PI/2,holdAtUnload:true,footMode:true};
  }

  nearest(pos) {
    return this.fleet.find(v => this.available(v) && Math.abs(pos.y-v.model.position.y)<4 &&
      Math.hypot(pos.x-v.model.position.x,pos.z-v.model.position.z)<v.radius+3.4);
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
    v.model.position.y = this.ground.heightAt(v.model.position.x,v.model.position.z);
    this.pose(v,false);
    v.asset.animate?.(0,0,0,0,false);
    v.asset.setOccupied?.(false);
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
    if (v?.id === 'wingsuit') return 'Space spread · Shift tuck · A/D bank · E exit';
    if (v?.id === 'bike') return 'W pedal · S brake · A/D steer · Space hop · E exit';
    if (v?.id === 'helicopter') return 'Space / Shift altitude · W/S travel · E exit';
    return 'W/S travel · A/D steer · E exit';
  }

  update(dt,keys,player,camera,clock) {
    const v = this.active, p = v.model.position;
    const steering = Number(!!(keys.KeyD||keys.ArrowRight)) - Number(!!(keys.KeyA||keys.ArrowLeft));
    const throttle = Number(!!(keys.KeyW||keys.ArrowUp)) - Number(!!(keys.KeyS||keys.ArrowDown));
    const tuck = !!(keys.ShiftLeft||keys.ShiftRight);
    const spread = !!keys.Space;
    const heli = v.id === 'helicopter', glide = v.id === 'wingsuit', bike = v.id === 'bike';
    const up = Number(spread) - Number(tuck);
    const ground = this.ground;
    const pGround = ground.heightAt(p.x,p.z);
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
      v.yaw -= steering * dt * clamp(v.speed*.39,0,1) * (1.88 - v.speed*.043);
      if (spread && !v.jumpHeld && v.clearance < .1 && v.speed > 1.8) v.verticalSpeed = 3.75;
      v.jumpHeld = spread;
    } else {
      const desired = throttle > 0 ? v.top : throttle < 0 ? -v.top*.22 : 0;
      v.speed = damp(v.speed,desired,heli ? .7 : 1.35,dt);
      const turn = heli ? 1.1 : 1.27 * clamp(Math.abs(v.speed)/3,0,1) * (v.speed < 0 ? -1 : 1);
      v.yaw -= steering * dt * turn;
    }
    const { minX,maxX,minZ,maxZ } = ground.bounds;
    const x = clamp(p.x + Math.sin(v.yaw)*v.speed*dt,minX+8,maxX-8);
    const z = clamp(p.z + Math.cos(v.yaw)*v.speed*dt,minZ+8,maxZ-8);
    const groundY = ground.heightAt(x,z);
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
    v.clearance = p.y-ground.heightAt(p.x,p.z);
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
    if (v.cockpit) {
      v.model.updateMatrixWorld(true);
      view.copy(v.asset.eye || vertical).applyMatrix4(v.model.matrixWorld);
      view.y += Math.sin(clock*33)*shake;
      const pitch = v.lookPitch - (glide ? .11 + v.posture*.07 : 0);
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
    const fov = v.cockpit ? (glide ? 85 : 77) : glide ? 79 : 69;
    camera.fov = snap ? fov : damp(camera.fov,fov,5,dt);
    camera.updateProjectionMatrix();
  }
}
