import * as THREE from 'three';
import {
  clamp, lerp, damp, wrapAngle, shortestAngle, smoothstep,
} from './util.js';
import { heightAt, normalAt, pisteAt } from './terrain.js';
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

const _normal = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _basis = new THREE.Matrix4();
const _qBase = new THREE.Quaternion();
const _qSpin = new THREE.Quaternion();
const _qFlip = new THREE.Quaternion();
const _qTarget = new THREE.Quaternion();
const _axisY = new THREE.Vector3(0, 1, 0);
const _axisX = new THREE.Vector3(1, 0, 0);

export class Player {
  constructor(scene, camera, opts = {}) {
    this.scene = scene;
    this.camera = camera;
    this.env = opts.env || null;
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
    this.sprayTimer = 0;
    this.trackAccum = 0;
    this.shake = 0;
    this.cameraMode = 0; // 0 chase, 1 wide, 2 helmet
    this.camYaw = 0;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.lastLanding = null;
    this.snowState = 'PISTE';
    this.powder = 0;

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
    this.rig.group.position.y = -0.85;
    this.model.add(this.rig.group);
    scene.add(this.model);

    this._left = { x: 0, y: 0, z: 0 };
    this._rightPoint = { x: 0, y: 0, z: 0 };
    this._point = new THREE.Vector3();
    this._side = new THREE.Vector3();

    this.onEvent = null;
    this.teleport(startPose(), { resetStats: true });
  }

  emit(type, data = {}) {
    this.onEvent?.({ type, ...data });
  }

  get speedKmh() { return this.speed * 3.6; }
  get spinDegrees() { return Math.abs(this.spin) * 180 / Math.PI; }
  get flipDegrees() { return Math.abs(this.flip) * 180 / Math.PI; }

  teleport(pose = startPose(), { resetStats = false, snap = true } = {}) {
    const x = pose.x ?? 1186;
    const z = pose.z ?? -902;
    this.pos.set(x, heightAt(x, z) + 0.03, z);
    this.heading = pose.heading ?? 0;
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.vyGround = 0;
    this.speed = 0;
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
    this.tracks?.breakTrack();
    this.trackAccum = 0;
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
    normalAt(x, z, _normal);
    this.model.quaternion.identity();
    this.updateModel(0.016, { steer: 0, tuck: false, brake: false, grab: false }, 0);
    this.updateCamera(0.016, snap);
  }

  setRiding(on) {
    this.riding = on;
    this.rig.group.visible = !on && this.cameraMode !== 2;
    if (on) {
      this.vel.set(0, 0, 0);
      this.vy = 0;
      this.airborne = false;
      this.crash = false;
      this.tracks?.breakTrack();
    }
  }

  cycleCamera() {
    this.cameraMode = (this.cameraMode + 1) % 3;
    this.rig.group.visible = this.cameraMode !== 2 && !this.riding;
    this.snapCamera();
    return ['CHASE', 'WIDE', 'HELMET'][this.cameraMode];
  }

  snapCamera() {
    this.camYaw = this.heading;
    this.updateCamera(0.016, true);
  }

  startCrash(reason = 'impact') {
    if (this.crash) return;
    this.crash = true;
    this.crashTimer = 0;
    this.crashReason = reason;
    this.stats.crashes++;
    this.vy = Math.max(this.vy, 2.4);
    this.pos.y += 0.12;
    this.vel.multiplyScalar(0.32);
    this.airTime = 0;
    this.spin = 0;
    this.flip = 0;
    this.spinVel = 0;
    this.flipVel = 0;
    this.grabTime = 0;
    this.tracks?.breakTrack();
    this.fx?.burst(this.pos, 'snow', 26);
    this.shake = Math.max(this.shake, 0.5);
    this.emit('crash', { reason, speed: this.speed });
  }

  recover() {
    this.crash = false;
    this.crashTimer = 0;
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.speed = 0;
    this.spin = 0;
    this.flip = 0;
    this.spinVel = 0;
    this.flipVel = 0;
    this.grounded = true;
    this.airborne = false;
    normalAt(this.pos.x, this.pos.z, _normal);
    if (_normal.x !== 0 || _normal.z !== 0) {
      this.heading = Math.atan2(_normal.x, _normal.z);
    }
    this.camYaw = this.heading;
    this.tracks?.breakTrack();
    this.emit('recover', {});
  }

  update(dt, input, time = 0) {
    if (this.riding) return;
    dt = Math.min(dt, 0.05);
    if (this.ollieCooldown > 0) this.ollieCooldown -= dt;

    this.steer = damp(this.steer, input.steer || 0, 9, dt);

    if (this.crash) {
      this.updateCrash(dt);
    } else {
      const steps = Math.max(1, Math.ceil(dt / 0.0115));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) this.simulate(h, input, time);
    }

    normalAt(this.pos.x, this.pos.z, _normal);
    this.grade = Math.atan2(Math.hypot(_normal.x, _normal.z), Math.max(0.001, _normal.y)) * 180 / Math.PI;
    this.powder = 1 - clamp(pisteAt(this.pos.x, this.pos.z) * 1.8, 0, 1);
    this.snowState = this.powder > 0.62 ? 'POWDER' : this.powder > 0.26 ? 'SOFT' : 'PISTE';
    this.speed = Math.hypot(this.vel.x, this.vel.z);
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

    this.updateEffects(dt, time);
    this.updateModel(dt, input, time);
    this.updateCamera(dt, false);
    this.shake = Math.max(0, this.shake - dt * 2.6);
  }

  simulate(dt, input, time) {
    let speed = Math.hypot(this.vel.x, this.vel.z);

    if (this.grounded) {
      // ── carving ──────────────────────────────────────────────
      const turnRate = (0.55 + 1.35 * clamp(speed / 26, 0, 1))
        * (input.brake ? 1.2 : 1) * (input.tuck ? 0.82 : 1);
      this.heading += (input.steer || 0) * turnRate * dt;
      this.heading = wrapAngle(this.heading);

      normalAt(this.pos.x, this.pos.z, _normal);
      const ny = Math.max(0.15, _normal.y);

      // gravity projected on the slope
      const slopeScale = 1.16;
      this.vel.x += GRAVITY * ny * _normal.x * slopeScale * dt;
      this.vel.z += GRAVITY * ny * _normal.z * slopeScale * dt;

      // snow friction + aero drag + braking
      speed = Math.hypot(this.vel.x, this.vel.z);
      const offPiste = 1 - clamp(pisteAt(this.pos.x, this.pos.z) * 2.2, 0, 1);
      const drag = (input.tuck ? 0.0020 : 0.0032) + offPiste * 0.0031 + (input.brake ? 0.019 : 0);
      const friction = GRAVITY * ny * 0.042 + offPiste * 0.55 + (input.brake ? 6.2 : 0);
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
        const grip = (input.brake ? 2.8 : 9.2 - clamp(speed / 38, 0, 1) * 3.0) * (input.tuck ? 0.72 : 1);
        const newYaw = velYaw + shortestAngle(velYaw, this.heading) * (1 - Math.exp(-grip * dt));
        this.vel.x = Math.sin(newYaw) * speed;
        this.vel.z = Math.cos(newYaw) * speed;
      }

      // cap ridiculous speeds
      const cap = input.tuck ? 43 : 39;
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

      const gy = heightAt(this.pos.x, this.pos.z);
      const predicted = prevY + this.vyGround * dt;
      const threshold = 0.26 + speed * 0.0042;
      if (gy < predicted - threshold && speed > 3.0) {
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
        this.pos.y = Math.max(gy, predicted);
        this.tracks?.breakTrack();
        this.emit('launch', { speed, vy: this.vy });
      } else {
        this.pos.y = gy + 0.035;
        this.vyGround = clamp((gy - prevY) / dt, -22, 22);
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
        this.vy = 4.6 + Math.max(0, this.vyGround);
        this.pos.y += 0.04;
        this.ollieCooldown = 0.35;
        this.tracks?.breakTrack();
        this.fx?.skiSpray(this.pos, this.vel, 1.4);
        this.emit('ollie', {});
      }
    } else {
      // ── airborne ─────────────────────────────────────────────
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

      // style
      const spinTarget = (input.steer || 0) * 5.4;
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

      const gy = heightAt(this.pos.x, this.pos.z);
      if (this.pos.y <= gy + 0.06) this.land(gy);
    }
    this._lastX = this._lastX ?? this.pos.x;
    this._lastZ = this._lastZ ?? this.pos.z;
  }

  land(gy) {
    const impact = Math.max(0, -this.vy);
    const spinErr = Math.abs(wrapAngle(this.spin));
    const flipErr = Math.abs(wrapAngle(this.flip));
    const good = spinErr < 1.16 && flipErr < 1.16 && impact < 25;

    this.pos.y = gy + 0.02;
    this.vy = 0;
    this.vyGround = 0;
    this.airborne = false;
    this.grounded = true;
    this.tracks?.breakTrack();

    if (!good) {
      this.startCrash(impact > 25 ? 'heavy landing' : 'sketchy landing');
      return;
    }

    const air = this.airTime;
    const turns = Math.round(Math.abs(this.spin) / P2);
    const flips = Math.round(Math.abs(this.flip) / P2);
    const grab = this.grabTime;
    const points = Math.round(air * 72 + turns * 190 + flips * 320 + grab * 95);
    const label = trickLabel(turns, flips, grab);

    this.fx?.burst(this.pos, 'snow', Math.min(56, 14 + impact * 2.2));
    if (turns || flips) this.fx?.burst(this.pos, 'gold', Math.min(40, 12 + turns * 8 + flips * 12));
    this.shake = Math.max(this.shake, clamp(impact * 0.014, 0.05, 0.42));

    if (air > 0.42) {
      const event = {
        airTime: air,
        turns,
        flips,
        grabTime: grab,
        points,
        label,
        impact,
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

    this.spin = wrapAngle(this.spin);
    this.flip = wrapAngle(this.flip);
    this.spinVel = 0;
    this.flipVel = 0;
    this.airTime = 0;
    this.grabTime = 0;
    this.grab = 0;
  }

  updateCrash(dt) {
    this.crashTimer += dt;
    this.vy -= GRAVITY * dt;
    this.pos.y += this.vy * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.vel.multiplyScalar(Math.exp(-2.6 * dt));
    this.clampToWorld();
    const gy = heightAt(this.pos.x, this.pos.z);
    if (this.pos.y < gy + 0.02) {
      this.pos.y = gy + 0.02;
      this.vy = 0;
    }
    if (this.crashTimer > 1.85) this.recover();
  }

  clampToWorld() {
    const pad = 150;
    if (this.pos.x < WORLD.minX + pad) {
      this.pos.x = WORLD.minX + pad;
      this.vel.x = Math.abs(this.vel.x) * 0.35;
    } else if (this.pos.x > WORLD.maxX - pad) {
      this.pos.x = WORLD.maxX - pad;
      this.vel.x = -Math.abs(this.vel.x) * 0.35;
    }
    if (this.pos.z < WORLD.minZ + pad) {
      this.pos.z = WORLD.minZ + pad;
      this.vel.z = Math.abs(this.vel.z) * 0.35;
    } else if (this.pos.z > WORLD.maxZ - pad) {
      this.pos.z = WORLD.maxZ - pad;
      this.vel.z = -Math.abs(this.vel.z) * 0.35;
    }
  }

  resolveCollisions(dt, inAir = false) {
    if (!this.env) return;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const cols = this.env.queryColliders(this.pos.x, this.pos.z, 5.2);
    if (!cols.length) return;
    const gy = heightAt(this.pos.x, this.pos.z);
    const playerR = 0.46;

    for (const c of cols) {
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
        if (inAir && this.pos.y > gy + 5.0) continue;
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

  updateEffects(dt, time) {
    if (!this.fx && !this.tracks) return;
    if (this.crash || this.riding) {
      this.tracks?.breakTrack();
      return;
    }
    const speed = this.speed;
    const grabbed = this.grab > 0.25;
    if (this.grounded && speed > 2.4) {
      this.sprayTimer -= dt;
      if (this.sprayTimer <= 0) {
        this.sprayTimer = 0.026 + Math.random() * 0.02;
        this._point.set(this.pos.x, this.pos.y + 0.05, this.pos.z);
        this._side.set(Math.cos(this.heading), 0, -Math.sin(this.heading));
        const intensity = clamp(speed / 28, 0.2, 1.4) * (0.6 + this.powder * 0.8);
        this.fx?.carve(this._point, this._side, speed, this.powder, dt);
        if (this.steer && Math.abs(this.steer) > 0.35 && speed > 7) {
          this.fx?.carve(this._point, this._side.clone().multiplyScalar(-1), speed * 0.7, this.powder, dt * 0.7);
        }
        if (intensity > 1.1 && this.powder > 0.5) {
          this.fx?.spray.spawn(
            this.pos.x + (Math.random() - 0.5) * 1.2, this.pos.y + 0.2, this.pos.z + (Math.random() - 0.5) * 1.2,
            -this.vel.x * 0.1, 1.2 + Math.random() * 2.2, -this.vel.z * 0.1,
            0.7 + Math.random() * 1.4, 0.8 + Math.random() * 0.7,
            this.fx.spray ? { r: 0.98, g: 0.99, b: 1 } : { r: 1, g: 1, b: 1 },
          );
        }
      }

      this.trackAccum += speed * dt;
      if (this.trackAccum > 1.25) {
        this.trackAccum = 0;
        const rx = Math.cos(this.heading) * 0.21;
        const rz = -Math.sin(this.heading) * 0.21;
        this._left.x = this.pos.x - rx; this._left.y = this.pos.y + 0.06; this._left.z = this.pos.z - rz;
        this._rightPoint.x = this.pos.x + rx; this._rightPoint.y = this.pos.y + 0.06; this._rightPoint.z = this.pos.z + rz;
        this.tracks?.addStep(this._left, this._rightPoint, this.heading, time, this.powder);
      }
    } else if (this.airborne) {
      this.tracks?.breakTrack();
    }
  }

  updateModel(dt, input, time) {
    // place the model
    this.model.position.set(this.pos.x, this.pos.y + 0.85, this.pos.z);

    // build an orientation basis on the snow, or level in the air
    const upVec = this.grounded && !this.crash ? _normal : _up;
    _fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    _fwd.addScaledVector(upVec, -_fwd.dot(upVec));
    if (_fwd.lengthSq() < 0.001) _fwd.set(0, 0, 1);
    _fwd.normalize();
    _right.crossVectors(upVec, _fwd).normalize();
    _basis.makeBasis(_right, upVec, _fwd);
    _qBase.setFromRotationMatrix(_basis);
    _qSpin.setFromAxisAngle(_axisY, this.spin);
    _qFlip.setFromAxisAngle(_axisX, this.flip);
    _qTarget.copy(_qBase).multiply(_qSpin).multiply(_qFlip);

    if (this.crash) {
      _qTarget.multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(
          Math.sin(this.crashTimer * 7.2) * 0.5,
          0,
          Math.cos(this.crashTimer * 6.1) * 0.35,
        )),
      );
    }

    const lambda = this.grounded ? 15 : 9;
    this.model.quaternion.slerp(_qTarget, 1 - Math.exp(-lambda * dt));

    this.rig.animate(dt, {
      speed: this.speed,
      steer: this.steer,
      tuck: input.tuck ? 1 : 0,
      brake: input.brake ? 1 : 0,
      airborne: this.airborne && !this.crash,
      airTime: this.airTime,
      grab: input.grab ? 1 : this.grab,
      crash: this.crash,
      crashTime: this.crashTimer,
      grounded: this.grounded,
    });

  }

  updateCamera(dt, snap = false) {
    const f = _fwd.set(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    const speedN = clamp(this.speed / 34, 0, 1);
    let dist, height, lookAhead;

    if (this.cameraMode === 2 && !this.riding) {
      // helmet cam
      const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
      this.camPos.set(this.pos.x + fx * 0.18, this.pos.y + 1.56, this.pos.z + fz * 0.18);
      this.camLook.set(this.pos.x + fx * 13, this.pos.y + 1.2 - clamp(this.grade, 0, 32) * 0.09, this.pos.z + fz * 13);
      dist = 0.2; height = 0; lookAhead = 0;
    } else {
      dist = this.cameraMode === 1 ? 10.8 : 4.8 + speedN * 2.0 + (this.crash ? 1.4 : 0);
      height = this.cameraMode === 1 ? 4.3 : 2.05 + speedN * 0.55 + clamp(this.airTime * 0.08, 0, 0.9);
      lookAhead = this.cameraMode === 1 ? 7 : 5.5;
      this.camYaw += shortestAngle(this.camYaw, this.heading) * (1 - Math.exp(-(snap ? 60 : 3.6) * dt));
      const cf = _fwd.set(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
      this.camPos.set(this.pos.x - cf.x * dist, this.pos.y + height, this.pos.z - cf.z * dist);
      const ground = heightAt(this.camPos.x, this.camPos.z);
      if (this.camPos.y < ground + 1.15) this.camPos.y = ground + 1.15;
      this.camLook.set(
        this.pos.x + cf.x * lookAhead,
        this.pos.y + 1.35 - clamp(this.grade, 0, 34) * 0.045 + clamp(this.airTime * 0.1, 0, 1.2),
        this.pos.z + cf.z * lookAhead,
      );
    }

    if (this.shake > 0 && !snap) {
      this.camPos.x += (Math.random() - 0.5) * this.shake * 0.4;
      this.camPos.y += (Math.random() - 0.5) * this.shake * 0.3;
      this.camPos.z += (Math.random() - 0.5) * this.shake * 0.4;
    }

    const posK = snap ? 1 : 1 - Math.exp(-(this.cameraMode === 2 ? 30 : 8.5) * dt);
    this.camera.position.lerp(this.camPos, posK);
    if (snap) this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.camera.rotateZ(-this.steer * 0.032 * clamp(this.speed / 22, 0, 1));

    const fovTarget = this.cameraMode === 2 ? 74 : (this.cameraMode === 1 ? 52 : 58 + speedN * 13 + (this.airborne ? 2 : 0));
    if (Math.abs(this.camera.fov - fovTarget) > 0.01) {
      this.camera.fov = damp(this.camera.fov, fovTarget, 4, dt);
      this.camera.updateProjectionMatrix();
    }
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
