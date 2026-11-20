import * as THREE from 'three';
import {
  clamp, lerp, damp, wrapAngle, shortestAngle, smoothstep,
} from './util.js';
import { heightAt, normalAt, surfaceAt } from './terrain.js';
import { WORLD, startPose } from './worlddata.js';
import { createSkier } from './skier.js';
import { DEFAULT_SKI_ID, DEFAULT_SNOWBOARD_ID, SKI_MODELS, SNOWBOARD_MODELS } from './gear-catalog.js';
import { GRAVITY, boardContact, boardFloat, resetBoardMotion, skiResponse } from './ride-dynamics.js';
import { departure, landingLimits, SNOW_CLEARANCE } from './snow-flight.js';
import { SkierRagdoll } from './skier-ragdoll.js';
import { TrickCombo, flipLabel, minimumScoringAir } from './trick-combo.js';

/* ═══════════════════════════════════════════════════════════════
   PLAYER
   A carving, airborne, occasionally upside-down skier.
   Velocity is solved in the horizontal plane; the snow surface
   supplies gravity, grip and the occasional launch.
   ═══════════════════════════════════════════════════════════════ */

const MIN_RIDER_IMPACT_SPEED = 6; // m/s, measured before obstacle push-out
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
const _impactVelocity = new THREE.Vector3();
const _flightUp = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _tourLook = new THREE.Vector3();
const _cameraAnchor = new THREE.Vector3();
const _cameraArm = new THREE.Vector3();
const _cameraTorso = new THREE.Vector3();
const _boardEyeOffset = new THREE.Vector3();
const _cameraBranches = { fraction: 1, walking: false };
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
    this.trickCombo = new TrickCombo();
    this.trickContextMultiplier = 1;
    this.crash = false;
    this.crashTimer = 0;
    this.crashReason = '';
    this.ragdoll = null;
    this.recoveryTime = null;
    this.airNormal = new THREE.Vector3(0, 1, 0);
    this.riding = false;
    this.vehicleLabel = null;
    this.ollieCooldown = 0;
    this.snowSink = 0;
    this.landingLoad = 0;
    this.landingSpray = 0;
    this.discipline = 'ski';
    this.stance = 'regular';
    this.skiModel = SKI_MODELS[DEFAULT_SKI_ID];
    this.snowboardModel = SNOWBOARD_MODELS[DEFAULT_SNOWBOARD_ID];
    this.skiResponse = skiResponse(this.skiModel, this.skiModel);
    this.tuning = this.skiModel.handling;
    resetBoardMotion(this);
    this.walkFootwear = null;
    this.shellSpeed = 1;
    this.clearBoost();
    this.shake = 0;
    this.cameraMode = 0; // 0 chase, 1 wide, 2 helmet
    this.camYaw = 0;
    this.lookPitch = 0;
    this.lookYaw = 0;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.camHeight = null;
    this.camPitchOffset = 0;
    this.helmetSlope = 0;
    this.cameraArmFraction = 1;
    this.walkCameraTight = false;
    this.boardEyeOffset = null;
    this.boardHelmetNear = null;
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
    this.sampleTread = (x, z) => this.env?.interiors?.stairTreadAt?.(x, z) ?? null;
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

    this.rig = createSkier({ snowDetail: true });
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
  get boarding() { return this.discipline === 'snowboard' && !this.footMode; }
  get rideTuning() { return this.boarding ? this.snowboardModel.handling : this.tuning; }

  setEquipment({ discipline = this.discipline, skiModel = this.skiModel,
    snowboardModel = this.snowboardModel, stance = this.stance } = {}) {
    const skiId = skiModel?.id ?? skiModel, boardId = snowboardModel?.id ?? snowboardModel;
    const skiing = SKI_MODELS[Object.hasOwn(SKI_MODELS, skiId) ? skiId : DEFAULT_SKI_ID];
    const board = SNOWBOARD_MODELS[Object.hasOwn(SNOWBOARD_MODELS, boardId) ? boardId : DEFAULT_SNOWBOARD_ID];
    const nextDiscipline = discipline === 'snowboard' ? 'snowboard' : 'ski';
    const nextStance = stance === 'goofy' ? 'goofy' : 'regular';
    const changed = nextDiscipline !== this.discipline || nextStance !== this.stance ||
      (nextDiscipline === 'ski' ? skiing !== this.skiModel : board !== this.snowboardModel);
    if (nextDiscipline !== this.discipline && this.switchStance) {
      this.heading = this.travelHeading;
      this.setSwitchStance(false);
    }
    this.discipline = nextDiscipline;
    this.stance = nextStance;
    this.skiModel = skiing;
    this.snowboardModel = board;
    this.tuning = skiing.handling;
    this.skiResponse = skiResponse(skiing, SKI_MODELS[DEFAULT_SKI_ID]);
    this.rig.setEquipment({ discipline: this.discipline, stance: this.stance, skiModel: skiing.id, snowboardModel: board.id });
    if (changed) {
      this.breakSnowContact();
      this.stopDirection = this.stopEdge = this.poleSwing = 0;
      this.poleTap = null;
      resetBoardMotion(this);
      if (this.crash) this.recover();
    }
  }

  teleport(pose = this.ground.startPose(), { resetStats = false, snap = true } = {}) {
    this.clearBoost();
    this.trickCombo.reset();
    this.conveyor = null;
    this.lookPitch = this.lookYaw = 0;
    this.stopEdge = 0;
    this.stopDirection = 0;
    resetBoardMotion(this);
    this.poleSwing = 0;
    this.poleTap = null;
    this.skiSnow = this.skiSnow ?? 0;
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
    this.walkCameraTight = false;
    this.boardEyeOffset = null;
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
    this.ragdoll = null;
    this.recoveryTime = null;
    this.airNormal.copy(_up);
    this.riding = false;
    this.vehicleLabel = null;
    this.model.visible = true;
    this.ollieCooldown = 0;
    this.rig.group.visible = this.cameraMode !== 2;
    this.camYaw = this.heading;
    this.camPos.copy(this.pos);
    this.camLook.copy(this.pos);
    this.camHeight = null;
    this.camPitchOffset = 0;
    this.lastLanding = null;
    this.breakSnowContact();
    this.landingLoad = 0;
    this.landingSpray = 0;
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
    const floor = this.footMode ? this.env?.walkSurfaceAt?.(x, z, this.pos.y) :
      this.env?.raisedPadAt?.(x, z, this.pos.y);
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
    if (!this.footMode && this.env?.raisedPadAt?.(x,z,this.pos.y) == null) return this.ground.normalAt(x, z, out);
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
    this.stopEdge = this.stopDirection = 0;
    resetBoardMotion(this);
    this.clearBoost();
    this.holdAtUnload = false;
    this.tuckAmount = this.strideAmount = this.walkAmount = 0;
    this.stridePhase = this.lastFootfall = 0;
    this.walkCameraTight = false;
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
    const { x, y, z } = this.pos;
    const footwear = this.walkFootwear && this.env?.walkSurfaceAt?.(x, z, y) == null &&
      !this.env?.interiorAt?.(x, z, y) && this.ground.surfaceAt(x, z, this.surface).id !== 'ground'
      ? this.walkFootwear : null;
    const pace = (input.walkRun ? 3.15 : 1.72) * (footwear?.speed ?? 1) *
      clamp(1 - Math.max(0, incline) * (footwear?.climbPenalty ?? .8), .35, 1);
    this.vel.x = damp(this.vel.x, fx * forward * pace, 12, dt);
    this.vel.z = damp(this.vel.z, fz * forward * pace, 12, dt);
    this.strideAmount = this.tuckAmount = 0;
    this.beforeStep.copy(this.pos);
    const prevY = this.pos.y;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.resolveCollisions(dt);
    if (this.crash) return;
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
    if (on) this.setBoardHelmetClip(false);
    this.riding = on;
    if (!on) this.vehicleLabel = null;
    this.rig.group.visible = !on && this.cameraMode !== 2;
    if (on) {
      this.trickCombo.reset();
      this.stopEdge = this.stopDirection = this.poleSwing = 0;
      resetBoardMotion(this);
      this.poleTap = null;
      this.vel.set(0, 0, 0);
      this.vy = 0;
      this.airborne = false;
      this.crash = false;
      this.ragdoll = null;
      this.recoveryTime = null;
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
    if (!this.boarding) this.camYaw = this.travelHeading;
    this.updateCamera(0.016, true);
  }

  startCrash(reason = 'impact', impact = 0) {
    if (this.crash) return;
    this.groundNormal(this.pos.x, this.pos.z, _normal);
    this.updateModel(0, {}, true);
    const entrySpeed = Math.hypot(this.vel.x, this.vel.z);
    _impactVelocity.set(this.vel.x, this.grounded ? this.vyGround : this.vy, this.vel.z);
    this.ragdoll = new SkierRagdoll(this.rig.captureCrashPose(this.footMode), _impactVelocity,
      _normal, this.spinVel, this.flipVel, impact, this.surface.grip);
    this.ragdoll.solve(this.sampleGround);
    this.recoveryTime = null;
    this.clearBoost();
    this.trickCombo.bail();
    this.crash = true;
    this.crashTimer = 0;
    this.crashReason = reason;
    this.stats.crashes++;
    this.grounded = false;
    this.airborne = false;
    this.airTime = 0;
    this.spin = 0;
    this.flip = 0;
    this.spinVel = 0;
    this.flipVel = 0;
    this.grabTime = 0;
    this.breakSnowContact();
    this.fx?.burst(this.pos, 'snow', 26);
    this.shake = Math.max(this.shake, 0.5);
    this.emit('crash', { reason, speed: entrySpeed, impact });
  }

  recover() {
    this.crash = false;
    this.crashTimer = 0;
    this.ragdoll = null;
    this.recoveryTime = null;
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.vyGround = 0;
    this.pos.y = this.groundHeight(this.pos.x, this.pos.z) + SNOW_CLEARANCE;
    this.speed = 0;
    this.spin = 0;
    this.flip = 0;
    this.spinVel = 0;
    this.flipVel = 0;
    this.grounded = true;
    this.airborne = false;
    this.aimDownhill();
    this.switchStance = false;
    resetBoardMotion(this);
    this.breakSnowContact();
    this.updateModel(0, {}, true);
    this.emit('recover', {});
  }

  beginFlight(vy, normal, event, speed) {
    this.airNormal.copy(normal);
    this.grounded = false;
    this.airborne = true;
    this.airTime = this.spin = this.flip = this.spinVel = this.flipVel = this.grabTime = this.grab = 0;
    this.vy = vy;
    this.trickCombo.begin();
    this.breakSnowContact();
    this.emit(event, { speed, vy });
  }

  update(dt, input, time = 0) {
    const wasSwinging = this.poleSwing > 0;
    this.poleSwing = Math.max(0, this.poleSwing - dt);
    if (wasSwinging && this.poleTap && this.poleSwing <= .30) {
      const tap = this.poleTap;
      this.poleTap = null;
      this.audio?.poleTap(tap.isTree);
      if (tap.tree) this.fx?.shedTreeSnow?.(tap.tree, tap.point);
    }
    if (this.riding) return;
    dt = Math.min(dt, 0.12);
    this.trickCombo.advance(dt);
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
        else this.simulate(h, input);
        if (this.crash) break;
      }
    }

    this.groundNormal(this.pos.x, this.pos.z, _normal);
    this.grade = Math.atan2(Math.hypot(_normal.x, _normal.z), Math.max(0.001, _normal.y)) * 180 / Math.PI;
    this.refreshSurface();
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && !this.footMode && this.speed > 1.3 && this.stopEdge < .2) {
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
    this.landingLoad *= Math.exp(-7 * dt);
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

  orientSkis(dt, input, speed) {
    if (input.brake && !this.stopDirection && speed >= 5.5) {
      this.stopApproach = Math.atan2(this.vel.x, this.vel.z);
      this.stopDirection = -Math.sign(input.steer || this.steer || -1);
      this.setSwitchStance(false);
    } else if (!input.brake) this.stopDirection = 0;
    this.stopEdge = damp(this.stopEdge, this.stopDirection ? 1 : 0, this.stopDirection ? 15 : 9, dt);
    const sideways = this.stopDirection !== 0;
    // ── carving ──────────────────────────────────────────────
    const powderResponse = lerp(1, Math.sqrt(this.skiResponse.float), this.surface.powder * .42);
    const turnRate = (0.55 + 1.35 * clamp(speed / 26, 0, 1))
      * (input.brake ? 1.2 : 1) * (input.tuck ? 0.82 : 1)
      * this.skiResponse.turn * powderResponse * lerp(1, 1 / this.skiResponse.stability, smoothstep(10, 34, speed) * .46);
    // Chase camera looks along +forward: its screen-right axis is -local X.
    if (sideways) {
      const across = this.stopApproach + this.stopDirection * Math.PI * .5;
      this.heading += shortestAngle(this.heading, across) * (1 - Math.exp(-13 * dt));
    } else this.heading -= (input.steer || 0) * turnRate * dt;
    this.heading = wrapAngle(this.heading);
  }

  skiContact(dt, input, speed) {
    const sideways = this.stopDirection !== 0;
    const ny = Math.max(0.15, _normal.y);
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
    const gearGrip = this.surface.grip * lerp(this.skiResponse.grip * this.tuning.grip, this.tuning.grip, this.surface.powder * .72);
    const slip = sideways && speed > .001
      ? Math.abs(this.vel.x * Math.cos(this.heading) - this.vel.z * Math.sin(this.heading)) / speed : 0;
    const braking = sideways ? (3.0 + 12.5 * slip * this.stopEdge) * gearGrip : input.brake ? 6.2 * gearGrip : 0;
    const aeroDrag = lerp(0.0032, 0.00165, this.tuckAmount) * this.tuning.drag / (this.shellSpeed ** 2);
    const drag = aeroDrag * this.surface.drag + (input.brake && !sideways ? .019 : 0);
    const friction = GRAVITY * ny * .042 * this.surface.drag + this.surface.powder * .48 / this.skiResponse.float + braking;
    const decel = (friction + drag * speed * speed) * dt;
    const nextSpeed = Math.max(0, speed - decel);
    if (speed > 0.001) {
      this.vel.x *= nextSpeed / speed;
      this.vel.z *= nextSpeed / speed;
    }

    // edge grip: the skis rotate, the body follows
    speed = nextSpeed;
    if (speed > 0.0005 && !sideways) {
      const velYaw = Math.atan2(this.vel.x, this.vel.z);
      const grip = (input.brake ? 2.8 : 9.2 - clamp(speed / 38, 0, 1) * 3.0) * lerp(1, .72, this.tuckAmount) *
        gearGrip * (this.switchStance ? this.skiResponse.switch : 1);
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
  }

  simulate(dt, input) {
    this.chainWindow=Math.max(0,this.chainWindow-dt);
    if(!this.chainWindow)this.trickChain=0;
    this.boostTime=input.brake?0:Math.max(0,this.boostTime-dt);
    const remaining = this.simulateStep(dt, input);
    // A touchdown inside this step still has time left to travel on the snow.
    if (remaining > 0 && this.grounded) {
      if (this.footMode) this.simulateFoot(remaining, input);
      else this.simulateStep(remaining, input);
    }
  }

  simulateStep(dt, input) {
    let speed = Math.hypot(this.vel.x, this.vel.z);
    this.beforeStep.copy(this.pos);

    if (this.grounded) {
      if (!this.boarding) this.orientSkis(dt, input, speed);
      if (this.conveyor && speed < 1.15 && !input.tuck && !input.ollie) {
        this.vel.set(0, 0, 0);
        this.pos.y = this.groundHeight(this.pos.x, this.pos.z) + .035;
        return;
      }
      if (this.holdAtUnload) {
        if (!input.tuck && !input.ollie) return;
        this.holdAtUnload = false;
      }
      this.groundNormal(this.pos.x, this.pos.z, _normal);
      this.ground.surfaceAt(this.pos.x, this.pos.z, this.surface);
      if (this.boarding) boardContact(this, dt, input, _normal, speed);
      else this.skiContact(dt, input, speed);
      speed = Math.hypot(this.vel.x, this.vel.z);

      // cap ridiculous speeds
      if(this.boostTime>0 && speed>1){
        const acceleration=(1.55+this.trickChain*.56)*this.boostTime/this.boostDuration;
        this.vel.multiplyScalar(1+acceleration*dt/speed);
      }
      const cap = (this.boarding ? (input.tuck ? 40 : 36) : (input.tuck ? 43 : 39)) * this.rideTuning.speed * this.shellSpeed +
        (this.boostTime > 0 ? 4 + this.trickChain : 0);
      speed = Math.hypot(this.vel.x, this.vel.z);
      if (speed > cap) {
        this.vel.x *= cap / speed;
        this.vel.z *= cap / speed;
        speed = cap;
      }

      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.resolveCollisions(dt);
      if (this.crash) return;

      const gy = this.groundHeight(this.pos.x, this.pos.z);
      if (this.env?.hitForestBump?.(this.beforeStep, this.pos, speed)) {
        this.pos.y = gy + SNOW_CLEARANCE;
        this.startCrash('mogul impact');
        return;
      }
      const takeoff = departure(this.beforeStep, this.pos, gy, this.sampleGround, dt);
      this.pos.y = gy + SNOW_CLEARANCE;
      this.vyGround = -(this.vel.x * _normal.x + this.vel.z * _normal.z) / Math.max(.25, _normal.y);
      this.vy = 0;
      if (input.ollie && this.ollieCooldown <= 0) {
        const impulse = (this.boarding ? 4.2 : 4.6) * this.rideTuning.pop;
        this.vel.addScaledVector(_normal, impulse);
        this.vel.y = 0;
        this.pos.y = (takeoff?.y ?? this.pos.y) + .005;
        this.ollieCooldown = 0.35;
        this.beginFlight((takeoff?.vy ?? this.vyGround) + _normal.y * impulse, _normal, 'ollie', speed);
        if (!this.footMode) this.fx?.skiSpray(this.pos, this.vel, .12 + 1.25 * this.surface.powder);
      } else if (takeoff) {
        this.pos.y = takeoff.y;
        this.beginFlight(takeoff.vy, _normal, 'launch', speed);
      }
    } else {
      this.stopDirection = 0;
      this.stopEdge = damp(this.stopEdge, 0, 12, dt);
      this.boardEdge = damp(this.boardEdge, 0, 6, dt);
      this.boardOneFoot = damp(this.boardOneFoot, 0, 14, dt);
      // ── airborne ─────────────────────────────────────────────
      this.strideAmount = damp(this.strideAmount, 0, 12, dt);
      this.tuckAmount = damp(this.tuckAmount, 0, 9, dt);
      this.airTime += dt;
      this.pos.y += (this.vy - GRAVITY * dt * .5) * dt;
      this.vy -= GRAVITY * dt;
      const airDrag = Math.exp(-0.045 * dt);
      this.vel.x *= airDrag;
      this.vel.z *= airDrag;
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.resolveCollisions(dt, true);
      if (this.crash) return;

      // style
      const spinTarget = input.air ? -(input.steer || 0) * (this.boarding ? 5.65 : 5.4) : 0;
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

      this.trickCombo.update(this, this.trickBonus);
      const gy = this.groundHeight(this.pos.x, this.pos.z);
      const gap = this.pos.y - gy - SNOW_CLEARANCE;
      if (gap <= 0) {
        const before = this.beforeStep.y - this.groundHeight(this.beforeStep.x, this.beforeStep.z) - SNOW_CLEARANCE;
        const crossing = before > 0 ? before / (before - gap) : 0;
        this.pos.lerp(this.beforeStep, 1 - crossing);
        const remaining = dt * (1 - crossing);
        this.vy += GRAVITY * remaining;
        this.airTime -= remaining;
        this.land(this.groundHeight(this.pos.x, this.pos.z));
        return remaining;
      }
    }
  }

  get trickBonus() { return this.trickContextMultiplier * (this.landingTrickMultiplier ?? 1); }

  land(gy) {
    this.groundNormal(this.pos.x, this.pos.z, _normal);
    this.refreshSurface();
    _impactVelocity.set(this.vel.x, this.vy, this.vel.z);
    const impact = Math.max(0, -_impactVelocity.dot(_normal));
    _impactVelocity.addScaledVector(_normal, impact);
    const speed = Math.hypot(_impactVelocity.x, _impactVelocity.z);
    const deckYaw = wrapAngle(this.heading + this.spin);
    const pathYaw = Math.atan2(_impactVelocity.x, _impactVelocity.z);
    const edgingError = Math.acos(clamp(Math.abs(Math.cos(deckYaw - pathYaw)), 0, 1));
    _flightUp.copy(_up).lerp(this.airNormal, .58).normalize();
    _fwd.set(Math.sin(deckYaw), 0, Math.cos(deckYaw));
    _fwd.addScaledVector(_flightUp, -_fwd.dot(_flightUp)).normalize();
    _flightUp.multiplyScalar(Math.cos(this.flip)).addScaledVector(_fwd, Math.sin(this.flip));
    const leanError = Math.acos(clamp(_flightUp.dot(_normal), -1, 1));
    const limits = landingLimits({ board: this.boarding, powder: this.powder, impact });
    const catchingEdge = speed > 3.5 && edgingError > limits.yaw;
    const heavy = impact > limits.normal;
    this.pos.y = gy + SNOW_CLEARANCE;
    if (heavy || catchingEdge || leanError > limits.lean || Math.abs(wrapAngle(this.flip)) > 1.12) {
      this.startCrash(heavy ? 'heavy landing' : catchingEdge ? 'caught an edge' : 'sketchy landing', impact);
      return;
    }
    this.vel.set(_impactVelocity.x, 0, _impactVelocity.z)
      .multiplyScalar(1 - clamp(impact * .004 + edgingError * .057, 0, .14));
    this.vy = 0;
    this.vyGround = -(this.vel.x * _normal.x + this.vel.z * _normal.z) / Math.max(.25, _normal.y);
    this.airborne = false;
    this.grounded = true;
    this.breakSnowContact();

    const air = this.airTime;
    const points = this.trickCombo.bank(this, this.trickBonus);
    const { spin, flips, backflip, grabPoints } = this.trickCombo;
    const turns = spin / 360;
    const grab = this.grabTime;
    const label = trickLabel(spin, flips, backflip, grabPoints);

    this.landingLoad = clamp(impact / 9, 0, 1);
    if (!this.footMode && this.powder > .30) this.landingSpray = impact;
    else this.fx?.burst(this.pos, 'snow', Math.round(Math.min(45, 6 + impact * 2) * this.powder));
    if (turns || flips) this.fx?.burst(this.pos, 'gold', Math.round(Math.min(7, 3 + turns * 2 + flips * 2)), .21);
    this.shake = Math.max(this.shake, clamp(impact * 0.014, 0.05, 0.42));

    if (air > minimumScoringAir) {
      let earnedBoost=0;
      if((turns||flips||grabPoints) && speed>2.8){
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
      if (turns || flips || grabPoints) this.stats.tricks++;
      this.stats.trickPoints += points;
      this.emit('land', event);
    } else {
      this.emit('touchdown', { airTime: air, impact });
    }

    this.heading = deckYaw;
    if (!this.footMode && speed > 1.3) this.setSwitchStance(Math.cos(deckYaw - pathYaw) < 0);
    this.spin = 0;
    this.flip = 0;
    this.spinVel = 0;
    this.flipVel = 0;
    this.airTime = 0;
    this.grabTime = 0;
    this.grab = 0;
  }

  updateCrash(dt) {
    if (!(dt > 0)) return;
    this.crashTimer += dt;
    if (this.recoveryTime !== null) {
      this.recoveryTime += dt;
      this.ragdoll.recoverToward(this.recoveryTime / .62, this.sampleGround);
      if (this.recoveryTime >= .62) this.recover();
      return;
    }
    const steps = Math.max(1, Math.ceil(dt * 120));
    let motion = 0;
    for (let i = 0; i < steps; i++) motion = this.ragdoll.step(dt / steps, this.sampleGround);
    const { x, z } = this.ragdoll.pelvis;
    this.vel.set((x - this.pos.x) / dt, 0, (z - this.pos.z) / dt);
    this.pos.set(x, this.groundHeight(x, z) + SNOW_CLEARANCE, z);
    if (this.crashTimer > 2.5 || (this.crashTimer > .85 && motion < 1.3)) {
      this.aimDownhill();
      this.switchStance = false;
      this.stopEdge = this.stopDirection = this.strideAmount = this.tuckAmount = this.walkAmount = 0;
      this.landingLoad = 0;
      resetBoardMotion(this);
      this.vel.set(0, 0, 0);
      this.speed = 0;
      this.crash = false;
      this.grounded = true;
      this.updateModel(.24, {}, true);
      this.ragdoll.beginRecovery(this.rig.captureCrashPose(this.footMode));
      this.crash = true;
      this.grounded = false;
      this.recoveryTime = 0;
    }
  }

  aimDownhill() {
    this.groundNormal(this.pos.x, this.pos.z, _normal);
    if (Math.hypot(_normal.x, _normal.z) > .02) this.heading = Math.atan2(_normal.x, _normal.z);
  }

  resolveCollisions(dt, inAir = false) {
    if (!this.env) return;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const { x, z } = this.pos;
    const cols = this.env.queryColliders(x, z, 5.2);
    let gy;
    const playerR = this.footMode ? .32 : .46;
    const bodyHeight = this.footMode ? 1.58 : 1.33;

    for (const c of cols) {
      const y = c.type === 'fallen log' && !inAir ? (gy ??= this.groundHeight(x, z)) + .035 : this.pos.y;
      // Rails and overhanging beams can hit the body even when the soles
      // clear their underside. Leave enough room to step over short lips.
      if (y + bodyHeight < (c.minY ?? -Infinity) || y + .07 > (c.maxY ?? Infinity)) continue;
      if (c.r) {
        if (inAir && this.pos.y > (gy ??= this.groundHeight(x, z)) + 7.5) continue;
        const dx = this.pos.x - c.x;
        const dz = this.pos.z - c.z;
        const rr = c.r + playerR;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2), along = Math.max(.001, speed);
        const nx = d > .0001 ? dx / d : speed > .001 ? -this.vel.x / along : 1;
        const nz = d > .0001 ? dz / d : speed > .001 ? -this.vel.z / along : 0;
        this.pos.x = c.x + nx * rr;
        this.pos.z = c.z + nz * rr;
        const vn = this.vel.x * nx + this.vel.z * nz;
        if (vn < 0) {
          this.vel.x -= vn * nx * 1.25;
          this.vel.z -= vn * nz * 1.25;
        }
        if (vn < -5.5 && ['tree', 'boulder', 'rock', 'lift-tower', 'arch-pole'].includes(c.type)) {
          this.startCrash(c.type);
          return;
        }
      } else if (c.hw) {
        if (inAir && !Number.isFinite(c.maxY) && this.pos.y > (gy ??= this.groundHeight(x, z)) + 5.0) continue;
        const cos = Math.cos(-c.rot), sin = Math.sin(-c.rot);
        const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
        const lx = dx * cos - dz * sin;
        const lz = dx * sin + dz * cos;
        const halfWidth = c.hw + playerR * 0.5, halfDepth = c.hd + playerR * 0.5;
        if (!(Math.abs(lx) < halfWidth && Math.abs(lz) < halfDepth)) continue;
        const px = halfWidth - Math.abs(lx), pz = halfDepth - Math.abs(lz);
        let nlx = lx, nlz = lz;
        const side = px < pz;
        if (side) nlx = Math.sign(lx || 1) * halfWidth;
        else nlz = Math.sign(lz || 1) * halfDepth;
        const cr = Math.cos(c.rot), sr = Math.sin(c.rot);
        const wx = nlx * cr - nlz * sr;
        const wz = nlx * sr + nlz * cr;
        this.pos.x = c.x + wx;
        this.pos.z = c.z + wz;
        const nx = side ? cr * Math.sign(nlx) : -sr * Math.sign(nlz);
        const nz = side ? sr * Math.sign(nlx) : cr * Math.sign(nlz);
        const inward = Math.min(0, this.vel.x * nx + this.vel.z * nz);
        if (inward < -7.5 || (!this.footMode && c.type === 'fallen log' && inward < -4.5)) {
          this.startCrash(c.type === 'fallen log' ? c.type : 'building');
          return;
        }
        this.vel.x -= inward * nx;
        this.vel.z -= inward * nz;
      }
    }

    // A guest crossing the lift queue can pass a pedestrian or a slow skier.
    // At speed, the crowd simulation tests the swept path and relative velocity.
    if (!this.footMode && speed > MIN_RIDER_IMPACT_SPEED &&
        this.env.people?.hitPlayer?.(this.beforeStep, this.pos, dt)) {
      this.startCrash('collision with another rider');
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
      this.landingSpray = 0;
      this.breakSnowContact();
      return;
    }
    if (this.boarding) {
      this.updateBoardEffects(dt, time, brake);
      return;
    }
    const { contactPoints, skiAxes, skiPlanted, skiContact } = this.rig;
    if (this.landingSpray > 0) {
      this.fx?.skiLanding?.(contactPoints, this.vel, this.travelHeading, this.powder, this.landingSpray);
      this.landingSpray = 0;
    }
    const scraping = this.stopEdge > .15 && brake;
    this.fx?.skiWake(contactPoints[0], contactPoints[1], this.vel, this.heading,
      this.powder, this.steer * (this.switchStance ? -1 : 1), brake, dt, this.surfaceType, skiPlanted, this.landingLoad);
    if (this.speed < .12) {
      this.breakSnowContact();
      return;
    }
    for (let i = 0; i < 2; i++) {
      const trailingEnd = scraping ? 0 : (this.vel.dot(skiAxes[i]) < 0 ? skiContact.end : skiContact.start) * .90;
      this.trackEnds[i].copy(contactPoints[i]).addScaledVector(skiAxes[i], trailingEnd);
    }
    this.tracks?.addStep(this.trackEnds[0], this.trackEnds[1], time, this.powder, {
      heading: this.heading, carve: this.steer, brake, surface: this.surfaceType,
      compression: this.rig.skiSink, axes: skiAxes, planted: skiPlanted,
      stop: scraping ? this.stopEdge : 0, velocity: this.vel,
    });
  }

  updateBoardEffects(dt, time, brake) {
    const { point, axis, right, start, end, compression } = this.rig.boardContact;
    const scraping = this.stopEdge > .15 && brake;
    const lean = Math.abs(this.boardEdge) / .82;
    const trailing = this.vel.dot(axis) < 0 ? end : start;
    const width = this.snowboardModel.waistMm * .001;
    this.trackEnds[0].copy(point).addScaledVector(right, -Math.sign(this.boardEdge) * width * .44 * lean);
    this.trackEnds[1].copy(this.trackEnds[0]);
    if (this.landingSpray > 0) {
      this.fx?.skiLanding?.(this.trackEnds, this.vel, this.travelHeading, this.powder, this.landingSpray);
      this.landingSpray = 0;
    }
    const carve = Math.max(lean * .68, this.boardSlip);
    this.fx?.skiWake(this.trackEnds[0], this.trackEnds[1], this.vel, this.travelHeading,
      this.powder, this.boardEdge, brake, dt, this.surfaceType,
      this.boardEdge <= 0 ? [true, false] : [false, true], this.landingLoad);
    if (this.speed < .12) {
      this.breakSnowContact();
      return;
    }
    if (!scraping) this.trackEnds[0].addScaledVector(axis, trailing * .78);
    this.tracks?.addStep(this.trackEnds[0], this.trackEnds[1], time, this.powder, {
      heading: this.heading, carve, brake, surface: this.surfaceType,
      compression, axes: [axis, axis], planted: [true, false],
      widthScale: lerp(width / .112, 1.08, lean) * (scraping ? .88 : 1),
      stop: Math.max(scraping ? this.stopEdge : 0, this.boardSlip * .58), velocity: this.vel,
    });
  }

  updateModel(dt, input, snap = false) {
    if (this.crash && this.ragdoll) {
      this.model.position.copy(this.pos);
      this.model.quaternion.identity();
      this.model.updateMatrix();
      this.rig.animateCrashPose(this.ragdoll);
      for (const shadow of this.bootShadows) shadow.visible = false;
      return;
    }
    const onSnow = this.grounded && !this.crash;
    // Slow skis sink under the rider's weight; speed spreads the load
    // along the running surface. Landing briefly compresses the soft layer.
    const planing = smoothstep(1.2, 19, this.speed);
    const compressible = onSnow && !this.footMode && this.surfaceType !== 'ice';
    const float = this.boarding ? boardFloat(this.snowboardModel) : this.skiResponse.float;
    const depth = compressible ? this.powder ** 1.45 * (.102 - .058 * planing
      + .018 * Math.abs(this.steer) * planing + .034 * this.landingLoad) / float : 0;
    this.snowSink = snap || (onSnow && !compressible) ? depth : damp(this.snowSink, depth, 12, dt);
    const upVec = this.footMode ? _up : _stanceUp.copy(_up).lerp(onSnow ? _normal : this.airNormal, .58).normalize();
    const bracing = onSnow && !this.footMode ? this.stopEdge : 0;
    const torsoYaw = !this.boarding && bracing > .002
      ? this.heading + shortestAngle(this.heading, this.stopApproach) * bracing * .43 : this.heading;
    _fwd.set(Math.sin(torsoYaw), 0, Math.cos(torsoYaw));
    _fwd.addScaledVector(upVec, -_fwd.dot(upVec));
    if (_fwd.lengthSq() < 0.001) _fwd.set(0, 0, 1);
    _fwd.normalize();
    _right.crossVectors(upVec, _fwd).normalize();
    _basis.makeBasis(_right, upVec, _fwd);
    _qBase.setFromRotationMatrix(_basis);
    _qSpin.setFromAxisAngle(_axisY, onSnow ? 0 : this.spin);
    _qFlip.setFromAxisAngle(_axisX, onSnow ? 0 : this.flip);
    _qTarget.copy(_qBase).multiply(_qSpin).multiply(_qFlip);

    const lambda = onSnow ? 19 : 12;
    this.model.quaternion.slerp(_qTarget, snap ? 1 : 1 - Math.exp(-lambda * dt));
    this.model.position.copy(this.pos);
    this.model.position.y -= this.snowSink;
    if (!onSnow) {
      // Rotate tricks around the torso in the takeoff stance. An inclined
      // stance already has a horizontal offset when the skis leave the snow.
      this.model.position.add(_pivot.set(0, .76, 0).applyQuaternion(_qBase))
        .sub(_pivot.set(0, .76, 0).applyQuaternion(this.model.quaternion));
    }
    this.model.updateMatrix();

    this.rig.animate(dt, {
      speed: this.speed,
      footMode: this.footMode,
      walk: this.walkAmount,
      walkStride: this.walkStride,
      walkDirection: this.walkDirection,
      stairTreadAt: this.footMode ? this.sampleTread : null,
      switchStance: this.switchStance,
      switchSide: this.switchLookSide,
      boardEdge: this.boardEdge,
      boardOneFoot: this.boardOneFoot,
      boardGroundSink: this.ground.skiSnowDepthAt ? this.snowSink : Math.min(.007, this.snowSink),
      powder: this.powder,
      landingLoad: this.landingLoad,
      snowSink: this.snowSink,
      steer: this.steer,
      stop: bracing,
      stopSign: this.stopDirection || 1,
      skiYaw: shortestAngle(torsoYaw, this.heading),
      poleSwing: this.poleSwing > 0 ? 1 - this.poleSwing / .54 : -1,
      poleSide: this.poleSide ?? 1,
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
    const deposition = onSnow && !this.footMode && !this.boarding && !this.riding && this.surfaceType !== 'ice'
      ? this.powder * (.39 + .36 * Math.abs(Math.sin(this.pos.x * .034 + this.pos.z * .083)))
        * (1 - .78 * planing) : 0;
    this.skiSnow = damp(this.skiSnow, deposition, deposition > this.skiSnow ? .19 : .46, dt);
    this.rig.setSkiSnow(this.skiSnow);
    if (onSnow && this.footMode) _inverseModel.copy(this.model.matrix).invert();
    for(const [i,shadow] of this.bootShadows.entries()){
      shadow.visible=onSnow && this.footMode;
      if(!shadow.visible)continue;
      const sole=this.rig.contactPoints[i],forward=this.rig.skiAxes[i];
      const yaw=Math.atan2(forward.x,forward.z),sin=Math.sin(yaw),cos=Math.cos(yaw);
      const ground=this.sampleTread(sole.x,sole.z) ?? this.groundHeight(sole.x,sole.z);
      shadow.material.uniforms.load.value=1-smoothstep(.015,.16,sole.y-ground);
      const geometry=shadow.geometry, position=geometry.attributes.position, uv=geometry.attributes.uv;
      for(let k=0;k<4;k++){
        const u=(uv.getX(k)-.5)*.51,v=(.5-uv.getY(k))*.72;
        const x=sole.x+cos*u+sin*v,z=sole.z-sin*u+cos*v;
        const y=this.sampleTread(x,z) ?? this.groundHeight(x,z);
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

  swingPole() {
    if (this.discipline === 'snowboard' || this.riding || this.crash || !this.grounded || this.poleSwing > 0 || this.speed > 12) return false;
    const { x, y, z } = this.pos;
    const yaw = this.travelHeading + this.lookYaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    let nearest = 2.1;
    this.poleSide = 1;
    this.poleSwing = .54;
    this.poleTap = null;
    for (const object of this.env?.queryColliders(x, z, 2.7) ?? []) {
      const dx = object.x - x, dz = object.z - z;
      const distance = Math.hypot(dx, dz);
      if (distance > nearest + (object.r ?? .14) || distance < .05 ||
          dx * fx + dz * fz < -.32 || y + 1.15 < (object.minY ?? -Infinity) ||
          y + .35 > (object.maxY ?? Infinity)) continue;
      nearest = distance - (object.r ?? .14);
      this.poleSide = Math.sign(dx * fz - dz * fx) || 1;
      this.poleTap = { isTree: object.type === 'tree', tree: object.tree, point: new THREE.Vector3(object.x, y + .95, object.z) };
    }
    return true;
  }

  followBoardCamera(dt, snap, response) {
    // The board can switch leading feet while the rider is almost stationary.
    // Follow the nearer end of its axis until movement supplies a reliable course.
    const forward = this.heading;
    const axis = Math.abs(shortestAngle(this.camYaw, forward)) < Math.PI * .5 ? forward : forward + Math.PI;
    const courseWeight = smoothstep(2.4, 6.8, this.speed);
    const course = Math.atan2(this.vel.x, this.vel.z);
    let target = axis + shortestAngle(axis, course) * courseWeight;
    if (this.stopEdge > 0) target += shortestAngle(target, this.stopApproach) * this.stopEdge;
    const turn = shortestAngle(this.camYaw, target) * (1 - Math.exp(-response * dt));
    const step = lerp(1.6, 2.85, courseWeight) * dt;
    this.camYaw = wrapAngle(snap ? target : this.camYaw + clamp(turn, -step, step));
    return this.camYaw;
  }

  updateHelmetCamera(dt, snap) {
    const walking = this.footMode;
    const board = this.boarding;
    const yaw = board ? this.followBoardCamera(dt, snap, 7.5) : this.stopEdge > .12
      ? this.travelHeading + shortestAngle(this.travelHeading, this.stopApproach) * this.stopEdge : this.travelHeading;
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    // Hold the takeoff view across a gap. The cliff face under a flying
    // skier supplies neither the eye position nor the rider's pitch.
    if (walking) this.helmetSlope = 0;
    else if (snap || !this.airborne) {
      const normal = this.airborne ? this.airNormal : this.groundNormal(this.pos.x, this.pos.z, _normal);
      const slope = Math.atan2(-(normal.x * sin + normal.z * cos), normal.y);
      const turn = damp(this.helmetSlope, slope, 10, dt) - this.helmetSlope;
      this.helmetSlope = snap ? slope : this.helmetSlope + clamp(turn, -2 * dt, 2 * dt);
    }
    if (board) {
      // Stabilize head motion relative to the board. The camera still moves
      // with the rider as they travel, without lagging behind on the slope.
      const offset = _boardEyeOffset.copy(this.rig.boardEyes).sub(this.pos);
      this.boardEyeOffset ??= offset.clone();
      this.boardEyeOffset.lerp(offset, snap ? 1 : 1 - Math.exp(-10.5 * dt));
      const { x, y, z } = this.camera.position.copy(this.pos).add(this.boardEyeOffset);
      this.camera.position.set(x, Math.max(y, this.groundHeight(x, z) + .25), z);
    } else {
      this.boardEyeOffset = null;
      const rear = walking ? 0 : .20;
      const horizontal = rear * Math.cos(this.helmetSlope);
      const x = this.pos.x - sin * horizontal, z = this.pos.z - cos * horizontal;
      const eyeHeight = walking ? 1.65 - Math.cos(this.stridePhase * 2) * this.walkAmount * .016
        : 1.52 - this.tuckAmount * .31 - this.snowSink;
      const eyeY = this.pos.y - SNOW_CLEARANCE + eyeHeight - rear * Math.sin(this.helmetSlope);
      this.camera.position.set(x, Math.max(eyeY, this.groundHeight(x, z) + .25), z);
    }
    this.camPos.copy(this.camera.position);
    this.cameraArmFraction = 1;
    if (!board) this.camYaw = snap ? yaw : wrapAngle(this.camYaw + shortestAngle(this.camYaw, yaw) * (1 - Math.exp(-23 * dt)));
    const viewYaw = this.camYaw + this.lookYaw;
    const pitch = clamp(this.helmetSlope - (walking ? .035 : .26) - this.lookPitch, -1.43, .93);
    this.camLook.copy(this.camera.position).add(_tourLook.set(
      Math.sin(viewYaw)*Math.cos(pitch), Math.sin(pitch), Math.cos(viewYaw)*Math.cos(pitch)));
    this.camera.up.copy(_up);
    this.camera.lookAt(this.camLook);
    this.camera.fov = walking ? 72 : 86;
    this.camera.updateProjectionMatrix();
  }

  setBoardHelmetClip(active) {
    if (active && this.boardHelmetNear === null) {
      this.boardHelmetNear = this.camera.near;
      this.camera.near = Math.min(.065, this.camera.near);
    } else if (!active && this.boardHelmetNear !== null) {
      if (this.camera.near === .065) this.camera.near = this.boardHelmetNear;
      this.boardHelmetNear = null;
    }
  }

  updateCamera(dt, snap = false) {
    const speed = clamp(this.speed / 34, 0, 1);
    const indoors = this.footMode && !!this.env?.interiorAt?.(this.pos.x, this.pos.z, this.pos.y);
    const helmet = (this.cameraMode === 2 || indoors) && !this.riding && !this.crash;
    this.setBoardHelmetClip(helmet && this.boarding);
    this.rig.group.visible = !this.riding;
    this.rig.showHelmetGear(helmet, this);
    if (helmet) {
      this.walkCameraTight = false;
      this.updateHelmetCamera(dt, snap);
      return;
    }
    this.boardEyeOffset = null;
    const wide = this.cameraMode === 1;
    const walking = this.footMode;
    const board = this.boarding && !this.riding && !this.crash;
    if (board) {
      this.followBoardCamera(dt, snap, 4.4);
    } else {
      let yaw = this.stopEdge > .12
        ? this.travelHeading + shortestAngle(this.travelHeading, this.stopApproach) * this.stopEdge : this.travelHeading;
      // Follow the skier's path through a spin and when the ski tips point uphill.
      // At walking speeds the skier still steers the camera by facing a new way.
      if (!walking && !this.riding) {
        yaw += shortestAngle(yaw, Math.atan2(this.vel.x, this.vel.z)) * smoothstep(1.3, 5.5, this.speed);
      }
      this.camYaw = snap ? yaw
        : wrapAngle(this.camYaw + shortestAngle(this.camYaw, yaw) * (1 - Math.exp(-4.4 * dt)));
    }
    const fx = Math.sin(this.camYaw+this.lookYaw), fz = Math.cos(this.camYaw+this.lookYaw);
    const distance = (walking ? (wide ? 6.1 : 4.35) : wide ? 9.5 : board ? 5.15 + speed * 1.45 :
      this.holdAtUnload ? 6.9 : 4.5 + speed * 1.65)
      * Math.sqrt(Math.max(1, this.camera.aspect / 2.65));
    const height = (wide ? 3.4 : 1.95 + speed * .35) + this.lookPitch*distance*.65;
    const lookAhead = wide ? 13 : 8 + speed * 4;
    const px = this.pos.x - fx * distance, pz = this.pos.z - fz * distance;
    // Keep the boom attached to the moving rider. Spring the yaw and height
    // independently so their lag cannot move the eye across the skier.
    const riderBase = this.pos.y - SNOW_CLEARANCE;
    const boomHeight = Math.max(this.groundHeight(px, pz) - riderBase + height * .84, height);
    this.camHeight = snap || this.camHeight === null ? boomHeight : damp(this.camHeight, boomHeight, 9.2, dt);
    this.camPos.set(px, this.pos.y + this.camHeight, pz);
    const lx = this.pos.x + fx * lookAhead, lz = this.pos.z + fz * lookAhead;
    const forwardGround = walking ? riderBase : this.groundHeight(lx, lz);
    _tourLook.set(lx, this.pos.y + (forwardGround - riderBase) * .71 + .99 - this.lookPitch*2.7, lz);

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
    _cameraBranches.fraction = 1;
    _cameraBranches.walking = walking;
    const allowed = this.env?.clipCameraArm?.(_cameraAnchor.x, _cameraAnchor.y, _cameraAnchor.z, this.camera.position, _cameraBranches) ?? length;
    const fraction = clamp(allowed / Math.max(.001, length), 0, 1);
    const walkingRoom = 2.45 * Math.max(1, this.camera.aspect / 2.65);
    const releaseRoom = walkingRoom + .45;
    const branchLimit = walking ? Math.max(_cameraBranches.fraction, (releaseRoom + .1) / distance) : _cameraBranches.fraction;
    const target = Math.min(fraction, branchLimit);
    // Walls stop the boom immediately. Trees slide the camera over the
    // shoulder at a bounded speed so gaps between branches cannot whip it.
    const movingIn = target < this.cameraArmFraction;
    const next = damp(this.cameraArmFraction, target, movingIn ? 8 : 2.7, dt);
    const maxStep = (movingIn ? 16 : 8) * dt / Math.max(.001, length);
    this.cameraArmFraction = snap ? target : Math.min(fraction,
      this.cameraArmFraction + clamp(next - this.cameraArmFraction, -maxStep, maxStep));
    this.walkCameraTight = walking && !this.crash && this.cameraArmFraction * distance < (this.walkCameraTight ? releaseRoom : walkingRoom);
    if (this.walkCameraTight) {
      // Use eye height when a solid obstacle leaves too little room to frame
      // the walker. Wait for enough room to back out past the carried gear.
      this.rig.showHelmetGear(true, this);
      this.updateHelmetCamera(dt, snap);
      // Retain the original boom so backing out of the corridor doesn't jump.
      this.camPos.copy(_cameraArm);
      this.cameraArmFraction = target;
      return;
    }
    this.camera.position.copy(_cameraAnchor).lerp(_cameraArm, this.cameraArmFraction);
    const verticalFov = walking ? (wide ? 55 : 59) : wide ? 51 : 54 + speed * 7;
    // Preserve the chase framing without stretching the view on a wide display.
    const maxVertical = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(53)) / this.camera.aspect));
    this.camera.fov = snap ? Math.min(verticalFov, maxVertical)
      : damp(this.camera.fov, Math.min(verticalFov, maxVertical), 7, dt);
    if (this.riding) {
      this.camLook.copy(_tourLook);
    } else {
      const eye = this.camera.position;
      if (walking || board) {
        // Strides and edge transfers move the pose, not the aim point.
        _cameraTorso.set(this.pos.x, this.pos.y + 1.08, this.pos.z);
      } else {
        this.rig.torso.updateWorldMatrix(true, false);
        _cameraTorso.set(0, .19, .025).applyMatrix4(this.rig.torso.matrixWorld);
      }
      const dx = _cameraTorso.x - eye.x, dz = _cameraTorso.z - eye.z;
      const riderDistance = Math.hypot(dx, dz);
      const riderPitch = Math.atan2(_cameraTorso.y - eye.y, riderDistance);
      const desiredPitch = Math.atan2(_tourLook.y - eye.y, Math.hypot(lx - eye.x, lz - eye.z));
      const halfFov = THREE.MathUtils.degToRad(this.camera.fov * .5);
      // Reserve space for the skier's skis and head before including the slope
      // ahead. This still allows orbiting and pitching the boom with the mouse.
      const pitchRoom = Math.max(0, halfFov - Math.atan2(1.16, riderDistance) - .035);
      const minOffset = -Math.min(pitchRoom, halfFov * .40);
      const maxOffset = Math.min(pitchRoom, halfFov * .46);
      const pitchOffset = clamp(desiredPitch - riderPitch, minOffset, maxOffset);
      this.camPitchOffset = snap ? pitchOffset
        : clamp(damp(this.camPitchOffset, pitchOffset, 8, dt), minOffset, maxOffset);
      const yaw = riderDistance > .15 ? Math.atan2(dx, dz) : this.camYaw + this.lookYaw;
      const pitch = clamp(riderPitch + this.camPitchOffset, -1.53, 1.53);
      this.camLook.copy(eye).add(_tourLook.set(
        Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)));
    }
    this.camera.up.copy(_up);
    this.camera.lookAt(this.camLook);
    this.camera.updateProjectionMatrix();
  }
}

function trickLabel(spin, flips, backflip, grabPoints) {
  const bits = [];
  if (spin) bits.push(`${spin}° spin`);
  if (flips) bits.push(flipLabel(flips, backflip));
  if (grabPoints) bits.push('Mute grab');
  return bits.join(' + ') || 'Clean air';
}
