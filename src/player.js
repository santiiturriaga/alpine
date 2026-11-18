import * as THREE from 'three';
import {
  clamp, lerp, damp, wrapAngle, shortestAngle, smoothstep,
} from './util.js';
import { heightAt, normalAt, surfaceAt } from './terrain.js';
import { WORLD, startPose } from './worlddata.js';
import { createSkier } from './skier.js';
import { pointInBox } from './environment.js';

/* ═══════════════════════════════════════════════════════════════
   PLAYER
   A carving, airborne, occasionally upside-down skier.
   Velocity is solved in the horizontal plane; the snow surface
   supplies gravity, grip and the occasional launch.
   ═══════════════════════════════════════════════════════════════ */

const GRAVITY = 9.81;
const P2 = Math.PI * 2;
const whistlerGround = {heightAt,normalAt,surfaceAt,bounds:WORLD,startPose};

const _normal = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _basis = new THREE.Matrix4();
const _qBase = new THREE.Quaternion();
const _qSpin = new THREE.Quaternion();
const _qFlip = new THREE.Quaternion();
const _qTarget = new THREE.Quaternion();
const _pivot = new THREE.Vector3();
const _tourLook = new THREE.Vector3();
const _cameraAnchor = new THREE.Vector3();
const _cameraArm = new THREE.Vector3();
const _stanceUp = new THREE.Vector3();
const _axisY = new THREE.Vector3(0, 1, 0);
const _axisX = new THREE.Vector3(1, 0, 0);
const _sole = new THREE.Vector3();
const _inverseModel = new THREE.Matrix4();

// Short-range occlusion under walking boots remains visible in diffuse dusk
// light. Each patch follows its own planted sole, including stairs and decks.
function bootOcclusion() {
  const geometry = new THREE.PlaneGeometry(.51, .72);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    transparent:true, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-1,
    uniforms:{ load:{value:1} },
    vertexShader:`varying vec2 atSole;
      void main(){atSole=uv*2.-1.;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`varying vec2 atSole;uniform float load;
      void main(){float r=dot(atSole,atSole);float shade=(1.-smoothstep(.03,1.,r));
        gl_FragColor=vec4(.040,.051,.072,shade*shade*load*.46);
        #include <colorspace_fragment>
      }`
  });
  return new THREE.Mesh(geometry,material);
}

export class Player {
  constructor(scene, camera, opts = {}) {
    this.scene = scene;
    this.camera = camera;
    this.env = opts.env || null;
    this.ground = opts.ground || whistlerGround;
    this.fx = opts.fx || null;
    this.tracks = opts.tracks || null;
    this.audio = opts.audio || null;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3(); // horizontal only
    this.vy = 0;
    this.vyGround = 0;
    this.heading = 0;
    this.steer = 0;
    this.speed = 0;
    this.grade = 0;
    this.grounded = true;
    this.airborne = false;
    this.airTime = 0;
    this.spin = 0;
    this.flip = 0;
    this.spinVel = 0;
    this.flipVel = 0;
    this.grabTime = 0;
    this.grab = 0;
    this.crash = false;
    this.crashTimer = 0;
    this.crashReason = '';
    this.riding = false;
    this.ollieCooldown = 0;
    this.snowSink = 0;
    this.landingLoad = 0;
    this.tuning={grip:1,drag:1,speed:1,pop:1};
    this.clearBoost();
    this.shake = 0;
    this.cameraMode = 0; // 0 chase, 1 wide, 2 helmet
    this.camYaw = 0;
    this.lookPitch = 0;
    this.lookYaw = 0;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.cameraArmFraction = 1;
    this.switchStance = false;
    this.switchLookSide = 1;
    this.lastLanding = null;
    this.snowState = 'PISTE';
    this.powder = 0;
    this.surfaceType = 'packed';
    this.surface = {};
    this.tuckAmount = 0;
    this.strideAmount = 0;
    this.stridePhase = 0;
    this.climbAmount = 0;
    this.footMode = false;
    this.walkAmount = 0;
    this.walkStride = .49;
    this.walkDirection = 1;
    this.lastFootfall = 0;
    this.sampleGround = (x, z) => this.groundHeight(x, z);
    this.beforeStep=new THREE.Vector3();

    this.stats = {
      vertical: 0,
      topSpeed: 0,
      air: 0,
      longestAir: 0,
      tricks: 0,
      distance: 0,
      crashes: 0,
      startY: 0,
      trickPoints: 0,
    };
    this.lastY = 0;
    this._lastX = 0;
    this._lastZ = 0;

    this.rig = createSkier();
    this.model = new THREE.Group();
    this.model.name = 'player';
    this.model.add(this.rig.group);
    this.bootShadows = [bootOcclusion(), bootOcclusion()];
    this.model.add(...this.bootShadows);
    scene.add(this.model);

    this.trackEnds = [new THREE.Vector3(), new THREE.Vector3()];

    this.onEvent = null;
    this.teleport(this.ground.startPose(), { resetStats: true });
  }

  emit(type, data = {}) {
    this.onEvent?.({ type, ...data });
  }

  breakSnowContact() {
    this.tracks?.breakTrack();
    this.fx?.breakWake();
  }

  get speedKmh() { return this.speed * 3.6; }
  get spinDegrees() { return Math.abs(this.spin) * 180 / Math.PI; }
  get flipDegrees() { return Math.abs(this.flip) * 180 / Math.PI; }

  teleport(pose = this.ground.startPose(), { resetStats = false, snap = true } = {}) {
    this.clearBoost();
    this.conveyor = null;
    this.lookPitch = this.lookYaw = 0;
    const { x, z } = pose;
    this.pos.set(x, this.groundHeight(x, z) + 0.03, z);
    this.heading = pose.heading ?? 0;
    this.holdAtUnload = !!pose.holdAtUnload;
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.vyGround = 0;
    this.speed = 0;
    this.steer = 0;
    this.tuckAmount = 0;
    this.strideAmount = 0;
    this.stridePhase = 0;
    this.walkAmount = 0;
    this.walkDirection = 1;
    this.lastFootfall = 0;
    this.switchStance = false;
    this.cameraArmFraction = 1;
    this.climbAmount = 0;
    this.shake = 0;
    this.grounded = true;
    this.airborne = false;
    this.airTime = 0;
    this.spin = 0;
    this.flip = 0;
    this.spinVel = 0;
    this.flipVel = 0;
    this.grabTime = 0;
    this.grab = 0;
    this.crash = false;
    this.crashTimer = 0;
    this.crashReason = '';
    this.riding = false;
    this.model.visible = true;
    this.rig.group.visible = this.cameraMode !== 2;
    this.camYaw = this.heading;
    this.camPos.copy(this.pos);
    this.camLook.copy(this.pos);
    this.lastLanding = null;
    this.breakSnowContact();
    this.landingLoad = 0;
    this.refreshSurface();
    this.lastY = this.pos.y;
    this._lastX = this.pos.x;
    this._lastZ = this.pos.z;
    if (resetStats) {
      this.stats.vertical = 0;
      this.stats.topSpeed = 0;
      this.stats.air = 0;
      this.stats.longestAir = 0;
      this.stats.tricks = 0;
      this.stats.distance = 0;
      this.stats.crashes = 0;
      this.stats.trickPoints = 0;
      this.stats.startY = this.pos.y;
    }
    this.groundNormal(x, z, _normal);
    this.updateModel(0.016, { steer: 0, tuck: false, brake: false, grab: false }, true);
    this.updateCamera(0.016, snap);
  }

  groundHeight(x, z) {
    const floor = this.footMode ? this.env?.walkSurfaceAt?.(x, z, this.pos.y) : null;
    if (floor != null) return floor;
    return this.ground.heightAt(x, z) + (this.conveyor?.offset ?? 0);
  }

  refreshSurface() {
    this.ground.surfaceAt(this.pos.x, this.pos.z, this.surface);
    this.powder = this.surface.powder;
    this.surfaceType = this.surface.id;
    this.snowState = this.surfaceType === 'ice' ? 'ICE' : this.surfaceType === 'powder' ? 'POWDER' : 'PISTE';
  }

  groundNormal(x, z, out) {
    if (!this.footMode) return this.ground.normalAt(x, z, out);
    const e = .18;
    return out.set(this.groundHeight(x - e, z) - this.groundHeight(x + e, z), e * 2,
      this.groundHeight(x, z - e) - this.groundHeight(x, z + e)).normalize();
  }

  canChangeFootMode() {
    return !this.riding && !this.crash && this.grounded && this.vel.lengthSq() <= 2.6 ** 2;
  }

  setFootMode(on) {
    if (!!on === this.footMode || !this.canChangeFootMode()) return this.footMode;
    if (this.switchStance) this.heading = this.travelHeading;
    this.switchStance = false;
    this.footMode = !!on;
    this.clearBoost();
    this.holdAtUnload = false;
    this.tuckAmount = this.strideAmount = this.walkAmount = 0;
    this.stridePhase = this.lastFootfall = 0;
    this.vel.multiplyScalar(Math.min(1, 1.6 / Math.max(.001, this.vel.length())));
    this.breakSnowContact();
    this.emit('mode', { footMode: this.footMode });
    return this.footMode;
  }

  toggleFootMode() { return this.setFootMode(!this.footMode); }

  simulateFoot(dt, input) {
    this.heading = wrapAngle(this.heading - (input.steer || 0) * 1.65 * dt);
    const forward = clamp(input.walkForward || 0, -1, 1);
    this.groundNormal(this.pos.x, this.pos.z, _normal);
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const incline = -(_normal.x * fx + _normal.z * fz) / Math.max(.15, _normal.y) * Math.sign(forward);
    const pace = (input.walkRun ? 3.15 : 1.72) * clamp(1 - Math.max(0, incline) * .8, .35, 1);
    this.vel.x = damp(this.vel.x, fx * forward * pace, 12, dt);
    this.vel.z = damp(this.vel.z, fz * forward * pace, 12, dt);
    this.strideAmount = this.tuckAmount = 0;
    this.beforeStep.copy(this.pos);
    const prevY = this.pos.y;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.clampToWorld();
    this.resolveCollisions(dt);
    if (!this.crash && this.env?.people?.hitPlayer?.(this.beforeStep, this.pos, dt)) {
      this.startCrash('collision with another rider');
      return;
    }
    const dx = this.pos.x - this.beforeStep.x, dz = this.pos.z - this.beforeStep.z;
    const travelled = Math.min(Math.hypot(dx, dz), this.vel.length() * dt);
    this.walkAmount = damp(this.walkAmount, smoothstep(.12, .85, travelled / dt), 9, dt);
    this.walkStride = damp(this.walkStride, input.walkRun ? .72 : .49, 8, dt);
    this.walkDirection = damp(this.walkDirection, Math.sign(dx * fx + dz * fz || this.walkDirection), 12, dt);
    this.stridePhase += travelled * Math.PI / this.walkStride;
    const gy = this.groundHeight(this.pos.x, this.pos.z);
    if (gy < prevY - .65) {
      this.grounded = false;
      this.airborne = true;
      this.airTime = this.spin = this.flip = this.spinVel = this.flipVel = this.grabTime = 0;
      this.vy = 0;
    } else {
      this.pos.y = gy + .035;
      this.vyGround = clamp((this.pos.y - prevY) / dt, -8, 8);
      this.vy = 0;
    }
  }

  setRiding(on) {
    this.clearBoost();
    this.riding = on;
    this.rig.group.visible = !on && this.cameraMode !== 2;
    if (on) {
      this.vel.set(0, 0, 0);
      this.vy = 0;
      this.airborne = false;
      this.crash = false;
      this.breakSnowContact();
    }
  }

  cycleCamera() {
    this.cameraMode = (this.cameraMode + 1) % 3;
    this.rig.group.visible = this.cameraMode !== 2 && !this.riding;
    this.snapCamera();
    return ['CHASE', 'WIDE', 'HELMET'][this.cameraMode];
  }

  snapCamera() {
    this.camYaw = this.travelHeading;
    this.updateCamera(0.016, true);
  }

  startCrash(reason = 'impact') {
    if (this.crash) return;
    this.clearBoost();
    this.crash = true;
    this.crashTimer = 0;
    this.crashReason = reason;
    this.stats.crashes++;
    this.vy = Math.min(this.vy, 0);
    this.vel.multiplyScalar(0.32);
    this.airTime = 0;
    this.spin = 0;
    this.flip = 0;
    this.spinVel = 0;
    this.flipVel = 0;
    this.grabTime = 0;
    this.breakSnowContact();
    this.fx?.burst(this.pos, 'snow', 26);
    this.shake = Math.max(this.shake, 0.5);
    this.emit('crash', { reason, speed: this.speed });
  }

  recover() {
    this.crash = false;
    this.crashTimer = 0;
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.vyGround = 0;
    this.pos.y = this.groundHeight(this.pos.x, this.pos.z) + .02;
    this.speed = 0;
    this.spin = 0;
    this.flip = 0;
    this.spinVel = 0;
    this.flipVel = 0;
    this.grounded = true;
    this.airborne = false;
    this.groundNormal(this.pos.x, this.pos.z, _normal);
    if (_normal.x !== 0 || _normal.z !== 0) {
      this.heading = Math.atan2(_normal.x, _normal.z);
    }
    this.camYaw = this.heading;
    this.breakSnowContact();
    this.emit('recover', {});
  }

  update(dt, input, time = 0) {
    if (this.riding) return;
    dt = Math.min(dt, 0.12);
    if (this.ollieCooldown > 0) this.ollieCooldown -= dt;

    this.steer = damp(this.steer, input.steer || 0, 9, dt);
    const belt = this.grounded && !this.crash && this.env?.stationOperations?.conveyorAt(this.pos.x,this.pos.z);
    this.conveyor = belt && Math.abs(belt.y - this.pos.y) < .6 ? belt : null;
    if (this.conveyor) {
      belt.offset = belt.y - this.ground.heightAt(this.pos.x,this.pos.z);
      this.pos.x += belt.vx * dt;
      this.pos.z += belt.vz * dt;
    }

    if (this.crash) {
      this.updateCrash(dt);
    } else {
      const steps = Math.max(1, Math.ceil(dt / 0.0115));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        if (this.footMode && this.grounded) this.simulateFoot(h, input);
        else this.simulate(h, input, time);
      }
    }

    this.groundNormal(this.pos.x, this.pos.z, _normal);
    this.grade = Math.atan2(Math.hypot(_normal.x, _normal.z), Math.max(0.001, _normal.y)) * 180 / Math.PI;
    this.refreshSurface();
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && !this.footMode && this.speed > 1.3) {
      const longitudinal = this.vel.x * Math.sin(this.heading) + this.vel.z * Math.cos(this.heading);
      if (Math.abs(longitudinal) > this.speed * .36) this.setSwitchStance(longitudinal < 0);
    }
    this.stats.topSpeed = Math.max(this.stats.topSpeed, this.speed);

    if (this.grounded && !this.crash) {
      const dy = this.lastY - this.pos.y;
      if (dy > 0) this.stats.vertical += dy;
    }
    const moved = Math.hypot(this.pos.x - this._lastX, this.pos.z - this._lastZ);
    if (Number.isFinite(moved) && !this.crash) this.stats.distance += moved;
    this._lastX = this.pos.x;
    this._lastZ = this.pos.z;
    this.lastY = this.pos.y;

    this.updateModel(dt, input);
    this.updateEffects(dt, time, !!input.brake);
    this.updateCamera(dt, false);
    this.shake = Math.max(0, this.shake - dt * 2.6);
  }

  clearBoost() {
    this.boostTime=0;this.boostDuration=0;
    this.trickChain=0;this.chainWindow=0;
  }

  get travelHeading() { return wrapAngle(this.heading + (this.switchStance ? Math.PI : 0)); }

  setSwitchStance(on) {
    if (on && !this.switchStance) this.switchLookSide = Math.sign(shortestAngle(this.heading, this.camYaw)) || 1;
    this.switchStance = on;
  }

  simulate(dt, input, time) {
    let speed = Math.hypot(this.vel.x, this.vel.z);
    this.beforeStep.copy(this.pos);
    this.chainWindow=Math.max(0,this.chainWindow-dt);
    if(!this.chainWindow)this.trickChain=0;
    this.boostTime=input.brake?0:Math.max(0,this.boostTime-dt);

    if (this.grounded) {
      // ── carving ──────────────────────────────────────────────
      const turnRate = (0.55 + 1.35 * clamp(speed / 26, 0, 1))
        * (input.brake ? 1.2 : 1) * (input.tuck ? 0.82 : 1);
      // Chase camera looks along +forward: its screen-right axis is -local X.
      this.heading -= (input.steer || 0) * turnRate * dt;
      this.heading = wrapAngle(this.heading);
      if (this.conveyor && speed < 1.15 && !input.tuck && !input.ollie) {
        this.vel.set(0,0,0);
        this.pos.y=this.groundHeight(this.pos.x,this.pos.z)+.035;
        return;
      }
      if (this.holdAtUnload) {
        if (!input.tuck && !input.ollie) return;
        this.holdAtUnload = false;
      }


      this.groundNormal(this.pos.x, this.pos.z, _normal);
      const ny = Math.max(0.15, _normal.y);
      this.ground.surfaceAt(this.pos.x, this.pos.z, this.surface);
      const uphill = -(_normal.x * Math.sin(this.heading) + _normal.z * Math.cos(this.heading)) / ny;
      const climbing = smoothstep(.035, .22, uphill);
      const strideTarget = input.tuck && !input.brake
        ? 1 - smoothstep(lerp(2.4, 1.1, climbing), lerp(6.1, 3.9, climbing), speed) : 0;
      this.strideAmount = damp(this.strideAmount, strideTarget, 8, dt);
      this.climbAmount = damp(this.climbAmount, climbing, 7, dt);
      this.stridePhase += dt * (5.4 + Math.min(speed, 6) * .85);
      this.tuckAmount = damp(this.tuckAmount, input.tuck && !input.brake ? smoothstep(4.5, 11, speed) : 0, 7, dt);

      // gravity projected on the slope
      const slopeScale = 1.16;
      this.vel.x += GRAVITY * ny * _normal.x * slopeScale * dt;
      this.vel.z += GRAVITY * ny * _normal.z * slopeScale * dt;

      // snow friction + aero drag + braking
      speed = Math.hypot(this.vel.x, this.vel.z);
      const drag = lerp(0.0032, 0.00165, this.tuckAmount) * this.surface.drag * this.tuning.drag + (input.brake ? 0.019 : 0);
      const friction = GRAVITY * ny * 0.042 * this.surface.drag + this.surface.powder * 0.48 + (input.brake ? 6.2 * this.surface.grip : 0);
      const decel = (friction + drag * speed * speed) * dt;
      const nextSpeed = Math.max(0, speed - decel);
      if (speed > 0.001) {
        this.vel.x *= nextSpeed / speed;
        this.vel.z *= nextSpeed / speed;
      }

      // edge grip: the skis rotate, the body follows
      speed = nextSpeed;
      if (speed > 0.0005) {
        const velYaw = Math.atan2(this.vel.x, this.vel.z);
        const grip = (input.brake ? 2.8 : 9.2 - clamp(speed / 38, 0, 1) * 3.0) * lerp(1, .72, this.tuckAmount) * this.surface.grip * this.tuning.grip;
        // Edges align backward travel too, without rotating downhill rollback into free uphill speed.
        const skiYaw = this.heading + (Math.cos(velYaw - this.heading) < 0 ? Math.PI : 0);
        const newYaw = velYaw + shortestAngle(velYaw, skiYaw) * (1 - Math.exp(-grip * dt));
        this.vel.x = Math.sin(newYaw) * speed;
        this.vel.z = Math.cos(newYaw) * speed;
      }

      // Alternating skate pushes on the flat, shorter grippy steps uphill.
      if (input.tuck && !input.brake && this.strideAmount > .01) {
        const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
        const forwardSpeed = this.vel.x * fx + this.vel.z * fz;
        const traction = lerp(.65, 1, this.surface.grip);
        const pulse = .78 + .22 * Math.abs(Math.sin(this.stridePhase));
        const push = (4.7 + this.climbAmount * 1.6) * this.strideAmount * traction * pulse * dt;
        // A planted boot supports the skier between uphill steps on walkable grades.
        if (forwardSpeed < 0 && speed < 2 && uphill < .55 && this.surface.grip > .5) {
          this.vel.x -= fx * forwardSpeed;
          this.vel.z -= fz * forwardSpeed;
        }
        this.vel.x += fx * push;
        this.vel.z += fz * push;
      }

      // cap ridiculous speeds
      if(this.boostTime>0 && speed>1){
        const acceleration=(1.55+this.trickChain*.56)*this.boostTime/this.boostDuration;
        this.vel.multiplyScalar(1+acceleration*dt/speed);
      }
      const cap = (input.tuck ? 43 : 39)*this.tuning.speed + (this.boostTime>0 ? 4+this.trickChain : 0);
      speed = Math.hypot(this.vel.x, this.vel.z);
      if (speed > cap) {
        this.vel.x *= cap / speed;
        this.vel.z *= cap / speed;
        speed = cap;
      }

      const prevY = this.pos.y;
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.clampToWorld();
      this.resolveCollisions(dt);
      if(!this.crash && this.env?.people?.hitPlayer?.(this.beforeStep,this.pos,dt))this.startCrash('collision with another rider');
      if (this.crash) return;

      const gy = this.groundHeight(this.pos.x, this.pos.z);
      const predicted = prevY + this.vyGround * dt;
      const threshold = 0.26 + speed * 0.0042;
      if (gy < predicted - Math.max(1, threshold) && speed > 6.0) {
        // the ground fell away: a lip, roller, or cliff
        this.grounded = false;
        this.airborne = true;
        this.airTime = 0;
        this.spin = 0;
        this.flip = 0;
        this.spinVel = 0;
        this.flipVel = 0;
        this.grabTime = 0;
        this.vy = clamp(this.vyGround, -10.5, 11.5) + 0.35;
        this.pos.y = Math.max(gy + .08, predicted);
        this.breakSnowContact();
        this.emit('launch', { speed, vy: this.vy });
      } else {
        this.pos.y = gy + 0.035;
        this.vyGround = clamp((this.pos.y - prevY) / dt, -22, 22);
        this.vy = 0;
        this.airborne = false;
      }

      // ollie
      if (input.ollie && this.ollieCooldown <= 0 && this.grounded) {
        this.grounded = false;
        this.airborne = true;
        this.airTime = 0;
        this.spin = 0;
        this.flip = 0;
        this.spinVel = 0;
        this.flipVel = 0;
        this.grabTime = 0;
        this.vy = 4.6*this.tuning.pop + Math.max(0, this.vyGround);
        this.pos.y += 0.04;
        this.ollieCooldown = 0.35;
        this.breakSnowContact();
        if (!this.footMode) this.fx?.skiSpray(this.pos, this.vel, .12 + 1.25 * this.surface.powder);
        this.emit('ollie', {});
      }
    } else {
      // ── airborne ─────────────────────────────────────────────
      this.strideAmount = damp(this.strideAmount, 0, 12, dt);
      this.tuckAmount = damp(this.tuckAmount, 0, 9, dt);
      this.airTime += dt;
      this.vy -= GRAVITY * dt;
      const airDrag = Math.exp(-0.045 * dt);
      this.vel.x *= airDrag;
      this.vel.z *= airDrag;
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.pos.y += this.vy * dt;
      this.clampToWorld();
      this.resolveCollisions(dt, true);
      if(!this.crash && this.env?.people?.hitPlayer?.(this.beforeStep,this.pos,dt))this.startCrash('collision with another rider');
      if (this.crash) return;

      // style
      const spinTarget = input.air ? -(input.steer || 0) * 5.4 : 0;
      this.spinVel = damp(this.spinVel, spinTarget, 5.4, dt);
      this.spin += this.spinVel * dt;

      const flipTarget = (input.flip || 0) * 4.8;
      this.flipVel = damp(this.flipVel, flipTarget, 5.0, dt);
      this.flip += this.flipVel * dt;

      if (input.grab) {
        this.grabTime += dt;
        this.grab = Math.min(1, this.grab + dt * 5);
      } else {
        this.grab = Math.max(0, this.grab - dt * 6);
      }

      const gy = this.groundHeight(this.pos.x, this.pos.z);
      if (this.pos.y <= gy + 0.06) this.land(gy);
    }
    this._lastX = this._lastX ?? this.pos.x;
    this._lastZ = this._lastZ ?? this.pos.z;
  }

  land(gy) {
    this.groundNormal(this.pos.x,this.pos.z,_normal);
    const impact = Math.max(0,-(this.vel.x*_normal.x+this.vy*_normal.y+this.vel.z*_normal.z));
    const speed=this.vel.length(), skiYaw=wrapAngle(this.heading+this.spin);
    // Switch landings use the same ski axis. Test against travel and the
    // local fall line, independent of camera and takeoff direction.
    const pathYaw=Math.atan2(this.vel.x,this.vel.z);
    const edgingError=Math.acos(clamp(Math.abs(Math.cos(skiYaw-pathYaw)),0,1));
    const fallLineError=Math.acos(clamp(Math.abs(Math.cos(skiYaw-Math.atan2(_normal.x,_normal.z))),0,1));
    const setDown=speed<3.5 || edgingError<1.10 || (_normal.y<.987 && fallLineError<.46 && edgingError<1.39);
    const flipErr = Math.abs(wrapAngle(this.flip));
    const good = setDown && flipErr < 1.16 && impact < 25;

    this.pos.y = gy + 0.02;
    this.vy = 0;
    this.vyGround = 0;
    this.airborne = false;
    this.grounded = true;
    this.breakSnowContact();

    if (!good) {
      this.startCrash(impact > 25 ? 'heavy landing' : 'sketchy landing');
      return;
    }

    const air = this.airTime;
    const turns = Math.round(Math.abs(this.spin) / Math.PI)*.5;
    const flips = Math.round(Math.abs(this.flip) / P2);
    const grab = this.grabTime;
    const points = Math.round(air * 72 + turns * 190 + flips * 320 + grab * 95);
    const label = trickLabel(turns, flips, grab);

    this.refreshSurface();
    this.landingLoad = clamp(impact / 9, 0, 1);
    this.fx?.burst(this.pos, 'snow', Math.round(Math.min(65, 10 + impact * 3) * (.12 + this.powder)));
    if (turns || flips) this.fx?.burst(this.pos, 'gold', Math.min(40, 12 + turns * 8 + flips * 12));
    this.shake = Math.max(this.shake, clamp(impact * 0.014, 0.05, 0.42));

    if (air > 0.42) {
      let earnedBoost=0;
      if((turns||flips||grab>.22) && speed>2.8){
        this.trickChain=Math.min(4,this.trickChain+1);
        this.boostDuration=Math.min(4.6,1.75+this.trickChain*.35+Math.min(1.2,turns*.34+flips*.65+grab*.4));
        this.boostTime=earnedBoost=this.boostDuration;
        this.chainWindow=this.boostDuration+6;
      }
      const event = {
        airTime: air,
        turns,
        flips,
        grabTime: grab,
        points,
        label,
        impact,
        boost:earnedBoost,
        spinDeg: Math.abs(this.spin) * 180 / Math.PI,
        flipDeg: Math.abs(this.flip) * 180 / Math.PI,
      };
      this.lastLanding = event;
      this.stats.longestAir = Math.max(this.stats.longestAir, air);
      this.stats.air += air;
      if (turns || flips || grab > 0.22) this.stats.tricks++;
      this.stats.trickPoints += points;
      this.emit('land', event);
    } else {
      this.emit('touchdown', { airTime: air, impact });
    }

    this.heading = skiYaw;
    if (!this.footMode && speed > 1.3) this.setSwitchStance(Math.cos(skiYaw - pathYaw) < 0);
    this.spin = 0;
    this.flip = 0;
    this.spinVel = 0;
    this.flipVel = 0;
    this.airTime = 0;
    this.grabTime = 0;
    this.grab = 0;
  }

  updateCrash(dt) {
    this.crashTimer += dt;
    this.vy = Math.min(0, this.vy - GRAVITY * dt);
    this.pos.y += this.vy * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.vel.multiplyScalar(Math.exp(-2.6 * dt));
    this.clampToWorld();
    const gy = this.groundHeight(this.pos.x, this.pos.z);
    if (this.pos.y < gy + 0.02) {
      this.pos.y = gy + 0.02;
      this.vy = 0;
    }
    if (this.crashTimer > 1.85) this.recover();
  }

  clampToWorld() {
    const bounds=this.ground.bounds;
    const pad = 150;
    if (this.pos.x < bounds.minX + pad) {
      this.pos.x = bounds.minX + pad;
      this.vel.x = Math.abs(this.vel.x) * 0.35;
    } else if (this.pos.x > bounds.maxX - pad) {
      this.pos.x = bounds.maxX - pad;
      this.vel.x = -Math.abs(this.vel.x) * 0.35;
    }
    if (this.pos.z < bounds.minZ + pad) {
      this.pos.z = bounds.minZ + pad;
      this.vel.z = Math.abs(this.vel.z) * 0.35;
    } else if (this.pos.z > bounds.maxZ - pad) {
      this.pos.z = bounds.maxZ - pad;
      this.vel.z = -Math.abs(this.vel.z) * 0.35;
    }
  }

  resolveCollisions(dt, inAir = false) {
    if (!this.env) return;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const cols = this.env.queryColliders(this.pos.x, this.pos.z, 5.2);
    if (!cols.length) return;
    const gy = this.groundHeight(this.pos.x, this.pos.z);
    const playerR = this.footMode ? .32 : .46;

    for (const c of cols) {
      if (this.pos.y < (c.minY ?? -Infinity) || this.pos.y > (c.maxY ?? Infinity)) continue;
      if (c.r) {
        if (inAir && this.pos.y > gy + 7.5) continue;
        const dx = this.pos.x - c.x;
        const dz = this.pos.z - c.z;
        const rr = c.r + playerR;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, nz = dz / d;
        this.pos.x = c.x + nx * rr;
        this.pos.z = c.z + nz * rr;
        const vn = this.vel.x * nx + this.vel.z * nz;
        if (vn < 0) {
          this.vel.x -= vn * nx * 1.25;
          this.vel.z -= vn * nz * 1.25;
        }
        if (speed > 5.5 && ['tree', 'boulder', 'rock', 'lift-tower', 'arch-pole'].includes(c.type)) {
          this.startCrash(c.type);
          return;
        }
        this.vel.multiplyScalar(0.72);
      } else if (c.hw) {
        if (inAir && !Number.isFinite(c.maxY) && this.pos.y > gy + 5.0) continue;
        if (!pointInBox(this.pos.x, this.pos.z, c, playerR * 0.5, playerR * 0.5)) continue;
        const cos = Math.cos(-c.rot), sin = Math.sin(-c.rot);
        const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
        const lx = dx * cos - dz * sin;
        const lz = dx * sin + dz * cos;
        const px = c.hw + playerR * 0.5 - Math.abs(lx);
        const pz = c.hd + playerR * 0.5 - Math.abs(lz);
        let nlx = lx, nlz = lz;
        if (px < pz) nlx = Math.sign(lx || 1) * (c.hw + playerR * 0.5);
        else nlz = Math.sign(lz || 1) * (c.hd + playerR * 0.5);
        const cr = Math.cos(c.rot), sr = Math.sin(c.rot);
        const wx = nlx * cr - nlz * sr;
        const wz = nlx * sr + nlz * cr;
        this.pos.x = c.x + wx;
        this.pos.z = c.z + wz;
        if (speed > 7.5) {
          this.startCrash('building');
          return;
        }
        this.vel.multiplyScalar(0.35);
      }
    }
  }

  updateEffects(dt, time, brake) {
    if (this.footMode && this.grounded && !this.crash && !this.riding) {
      const step = Math.floor(this.stridePhase / Math.PI);
      if (step !== this.lastFootfall && this.walkAmount > .4) {
        const foot = step % 2 ? 0 : 1;
        const point = this.rig.contactPoints[foot];
        if (this.surfaceType !== 'ice' && Math.abs(point.y - this.ground.heightAt(point.x,point.z)) < .12) {
          this.fx?.bootStep?.(point, this.heading, this.surfaceType, this.powder);
        }
      }
      this.lastFootfall = step;
    }
    if (this.crash || this.riding || this.footMode || !this.grounded) {
      this.breakSnowContact();
      return;
    }
    const { contactPoints, skiAxes, skiPlanted } = this.rig;
    this.fx?.skiWake(contactPoints[0], contactPoints[1], this.vel, this.heading,
      this.powder, this.steer, brake, dt, this.surfaceType, skiPlanted);
    if (this.speed < .12) {
      this.breakSnowContact();
      return;
    }
    for (let i = 0; i < 2; i++) {
      const trailingEnd = this.vel.dot(skiAxes[i]) < 0 ? .88 : -.8;
      this.trackEnds[i].copy(contactPoints[i]).addScaledVector(skiAxes[i], trailingEnd);
    }
    this.tracks?.addStep(this.trackEnds[0], this.trackEnds[1], time, this.powder, {
      heading: this.heading, carve: this.steer, brake, surface: this.surfaceType,
      compression: this.rig.skiSink, axes: skiAxes, planted: skiPlanted,
    });
  }

  updateModel(dt, input, snap = false) {
    const onSnow = this.grounded && !this.crash;
    // Slow skis sink under the rider's weight; speed spreads the load
    // along the running surface. Landing briefly compresses the soft layer.
    const planing = smoothstep(1.2, 19, this.speed);
    const compressible = onSnow && !this.footMode && this.surfaceType !== 'ice';
    const depth = compressible ? this.powder ** 1.45 * (.102 - .058 * planing
      + .018 * Math.abs(this.steer) * planing + .034 * this.landingLoad) : 0;
    this.snowSink = snap || !compressible ? depth : damp(this.snowSink, depth, 12, dt);
    this.landingLoad *= Math.exp(-7 * dt);
    const upVec = onSnow && !this.footMode ? _stanceUp.copy(_up).lerp(_normal, .58).normalize() : _up;
    _fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    _fwd.addScaledVector(upVec, -_fwd.dot(upVec));
    if (_fwd.lengthSq() < 0.001) _fwd.set(0, 0, 1);
    _fwd.normalize();
    _right.crossVectors(upVec, _fwd).normalize();
    _basis.makeBasis(_right, upVec, _fwd);
    _qBase.setFromRotationMatrix(_basis);
    _qSpin.setFromAxisAngle(_axisY, onSnow ? 0 : this.spin);
    _qFlip.setFromAxisAngle(_axisX, onSnow ? 0 : this.flip);
    _qTarget.copy(_qBase).multiply(_qSpin).multiply(_qFlip);

    if (this.crash) {
      _qTarget.multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(
          -.15 * Math.sin(Math.PI * Math.min(1, this.crashTimer / 1.85)),
          0,
          .74 * Math.sin(Math.PI * Math.min(1, this.crashTimer / 1.85)),
        )),
      );
    }

    const lambda = onSnow ? 19 : 12;
    this.model.quaternion.slerp(_qTarget, snap ? 1 : 1 - Math.exp(-lambda * dt));
    this.model.position.copy(this.pos);
    this.model.position.y -= this.snowSink;
    if (!onSnow) {
      // Air tricks still rotate about the skier's torso.
      this.model.position.addScaledVector(_up, .76)
        .sub(_pivot.set(0, .76, 0).applyQuaternion(this.model.quaternion));
    }
    this.model.updateMatrix();

    this.rig.animate(dt, {
      speed: this.speed,
      footMode: this.footMode,
      walk: this.walkAmount,
      walkStride: this.walkStride,
      walkDirection: this.walkDirection,
      switchStance: this.switchStance,
      switchSide: this.switchLookSide,
      snowSink: this.snowSink,
      steer: this.steer,
      tuck: this.tuckAmount,
      stride: onSnow ? this.strideAmount : 0,
      stridePhase: this.stridePhase,
      climb: this.climbAmount,
      brake: input.brake ? 1 : 0,
      airborne: this.airborne && !this.crash,
      airTime: this.airTime,
      grab: input.grab ? 1 : this.grab,
      crash: this.crash,
      crashTime: this.crashTimer,
      grounded: this.grounded,
    }, onSnow ? this.sampleGround : null);
    _inverseModel.copy(this.model.matrix).invert();
    for(const [i,shadow] of this.bootShadows.entries()){
      shadow.visible=onSnow && this.footMode;
      if(!shadow.visible)continue;
      const sole=this.rig.contactPoints[i],forward=this.rig.skiAxes[i];
      const yaw=Math.atan2(forward.x,forward.z),sin=Math.sin(yaw),cos=Math.cos(yaw);
      const ground=this.groundHeight(sole.x,sole.z);
      shadow.material.uniforms.load.value=1-smoothstep(.015,.16,sole.y-ground);
      const geometry=shadow.geometry, position=geometry.attributes.position, uv=geometry.attributes.uv;
      for(let k=0;k<4;k++){
        const u=(uv.getX(k)-.5)*.51,v=(.5-uv.getY(k))*.72;
        const x=sole.x+cos*u+sin*v,z=sole.z-sin*u+cos*v;
        const y=this.groundHeight(x,z);
        _sole.set(x,Math.abs(y-ground)<.16?y+.006:ground+.006,z).applyMatrix4(_inverseModel);
        position.setXYZ(k,_sole.x,_sole.y,_sole.z);
      }
      position.needsUpdate=true;
      shadow.frustumCulled=false;
    }
  }

  lookAround(dx, dy) {
    this.lookYaw = wrapAngle(this.lookYaw - dx * .003);
    this.lookPitch = clamp(this.lookPitch + dy * .004, -.67, 1.05);
  }

  updateHelmetCamera(dt, snap) {
    const walking = this.footMode;
    const yaw = this.travelHeading;
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    const rear = walking ? 0 : .20;
    const x = this.pos.x - sin * rear, z = this.pos.z - cos * rear;
    const ground = this.groundHeight(this.pos.x, this.pos.z);
    const eyeHeight = walking ? 1.65 - Math.cos(this.stridePhase * 2) * this.walkAmount * .016 : 1.52 - this.tuckAmount * .31 - this.snowSink;
    const air = Math.max(0, this.pos.y - ground - .035);
    this.camera.position.set(x, this.groundHeight(x, z) + eyeHeight + air, z);
    this.camPos.copy(this.camera.position);
    this.cameraArmFraction = 1;
    this.camYaw = snap ? yaw : wrapAngle(this.camYaw + shortestAngle(this.camYaw, yaw) * (1 - Math.exp(-23 * dt)));
    const viewYaw = this.camYaw + this.lookYaw;
    const slope = walking ? 0 : Math.atan2(this.groundHeight(x + sin * 3, z + cos * 3) - this.groundHeight(x,z), 3);
    const pitch = clamp(slope - (walking ? .035 : .26) - this.lookPitch, -1.43, .93);
    this.camLook.copy(this.camera.position).add(_tourLook.set(
      Math.sin(viewYaw)*Math.cos(pitch), Math.sin(pitch), Math.cos(viewYaw)*Math.cos(pitch)));
    this.camera.up.copy(_up);
    this.camera.lookAt(this.camLook);
    this.camera.fov = walking ? 72 : 86;
    this.camera.updateProjectionMatrix();
  }

  updateCamera(dt, snap = false) {
    const speed = clamp(this.speed / 34, 0, 1);
    const indoors = this.footMode && !!this.env?.interiorAt?.(this.pos.x, this.pos.z, this.pos.y);
    const helmet = (this.cameraMode === 2 || indoors) && !this.riding;
    this.rig.group.visible = !this.riding;
    this.rig.showHelmetGear(helmet, this);
    if (helmet) {
      this.updateHelmetCamera(dt, snap);
      return;
    }
    const wide = this.cameraMode === 1;
    const yaw = this.travelHeading;
    this.camYaw = snap ? yaw
      : wrapAngle(this.camYaw + shortestAngle(this.camYaw, yaw) * (1 - Math.exp(-4.4 * dt)));
    const fx = Math.sin(this.camYaw+this.lookYaw), fz = Math.cos(this.camYaw+this.lookYaw);
    const distance = wide ? 9.5 : this.holdAtUnload ? 6.9 : 4.5 + speed * 1.65;
    const height = (wide ? 3.4 : 1.95 + speed * .35) + this.lookPitch*distance*.65;
    const lookAhead = wide ? 13 : 8 + speed * 4;
    const ground = this.groundHeight(this.pos.x, this.pos.z);
    const airGap = Math.max(0, this.pos.y - ground);
    const px = this.pos.x - fx * distance, pz = this.pos.z - fz * distance;
    const follow = snap ? 1 : 1 - Math.exp(-9.2 * dt);
    _cameraArm.set(px, Math.max(this.groundHeight(px, pz) + height * .84, ground + height) + airGap, pz);
    this.camPos.lerp(_cameraArm, follow);
    const lx = this.pos.x + fx * lookAhead, lz = this.pos.z + fz * lookAhead;
    const forwardGround = this.groundHeight(lx, lz);
    _tourLook.set(lx, lerp(ground, forwardGround, .71) + .99 + airGap * .6 - this.lookPitch*2.7, lz);

    _cameraArm.copy(this.camPos);
    const cameraGround = this.groundHeight(_cameraArm.x, _cameraArm.z);
    _cameraArm.y = Math.max(_cameraArm.y, cameraGround + 1.05);
    // Raise the spring arm if a bank cuts across the line to the rider.
    for (const t of [.25, .5, .75]) {
      const x = lerp(this.pos.x, _cameraArm.x, t);
      const z = lerp(this.pos.z, _cameraArm.z, t);
      const y = lerp(this.pos.y + .9, _cameraArm.y, t);
      const lift = this.groundHeight(x, z) + .32 - y;
      if (lift > 0) _cameraArm.y += lift / t;
    }
    _cameraAnchor.set(this.pos.x, this.pos.y + 1.25, this.pos.z);
    this.camera.position.copy(_cameraArm);
    const length = _cameraAnchor.distanceTo(_cameraArm);
    const allowed = this.env?.clipCameraArm?.(_cameraAnchor.x, _cameraAnchor.y, _cameraAnchor.z, this.camera.position) ?? length;
    const fraction = clamp(allowed / Math.max(.001, length), 0, 1);
    // Contract immediately for solid geometry and ease back out once the arm clears it.
    this.cameraArmFraction = snap ? fraction : Math.min(fraction, damp(this.cameraArmFraction, fraction, 2.7, dt));
    this.camera.position.copy(_cameraAnchor).lerp(_cameraArm, this.cameraArmFraction);
    this.camLook.lerp(_tourLook, follow);
    this.camera.up.copy(_up);
    this.camera.lookAt(this.camLook);
    const verticalFov = wide ? 51 : 54 + speed * 7;
    // Preserve the chase framing without stretching the view on a wide display.
    const maxVertical = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(53)) / this.camera.aspect));
    this.camera.fov = snap ? Math.min(verticalFov, maxVertical)
      : damp(this.camera.fov, Math.min(verticalFov, maxVertical), 7, dt);
    this.camera.updateProjectionMatrix();
  }
}

function trickLabel(turns, flips, grab) {
  const bits = [];
  const spinDeg = Math.round(turns * 360);
  if (spinDeg > 0) bits.push(`${spinDeg}`);
  if (flips > 0) bits.push(flips > 1 ? `${flips}× FLIP` : 'FLIP');
  if (grab > 0.22) bits.push('MUTE');
  if (!bits.length) return 'CLEAN AIR';
  if (spinDeg > 0 && !flips) bits.push('SPIN');
  return bits.join(' ');
}
