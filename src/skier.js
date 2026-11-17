import * as THREE from 'three';
import { clamp, lerp, damp } from './util.js';

/* ═══════════════════════════════════════════════════════════════
   THE SKIER
   A small, highly-articulated rider built from primitives.
   Faces local +Z. Feet rest at local y = 0.
   ═══════════════════════════════════════════════════════════════ */

export function createSkier() {
  const group = new THREE.Group();
  group.name = 'skier';

  const mats = {
    jacket: new THREE.MeshStandardMaterial({ color: 0xd8532c, roughness: 0.72, metalness: 0.02 }),
    jacketDark: new THREE.MeshStandardMaterial({ color: 0xa53a1e, roughness: 0.78 }),
    pants: new THREE.MeshStandardMaterial({ color: 0x192b3b, roughness: 0.82 }),
    pantsLight: new THREE.MeshStandardMaterial({ color: 0x273d50, roughness: 0.82 }),
    cream: new THREE.MeshStandardMaterial({ color: 0xece6d6, roughness: 0.62 }),
    black: new THREE.MeshStandardMaterial({ color: 0x151b20, roughness: 0.6 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0b0f12, roughness: 0.9 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xb9c3c8, roughness: 0.3, metalness: 0.75 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xc08a68, roughness: 0.8 }),
    goggles: new THREE.MeshStandardMaterial({ color: 0x121a20, roughness: 0.2, metalness: 0.25 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x65b9d2, roughness: 0.06, metalness: 0.72, emissive: 0x163d4d, emissiveIntensity: 0.35 }),
    skiTop: new THREE.MeshStandardMaterial({ color: 0xf2a43a, roughness: 0.34, metalness: 0.1 }),
    skiBase: new THREE.MeshStandardMaterial({ color: 0x242d32, roughness: 0.28, metalness: 0.35 }),
    pack: new THREE.MeshStandardMaterial({ color: 0x24322c, roughness: 0.86 }),
    strap: new THREE.MeshStandardMaterial({ color: 0xd7c9a5, roughness: 0.8 }),
    pole: new THREE.MeshStandardMaterial({ color: 0xbfc8cc, roughness: 0.35, metalness: 0.65 }),
  };

  const skis = new THREE.Group();
  group.add(skis);
  const skiMeshes = [];
  for (const side of [-1, 1]) {
    const ski = new THREE.Group();
    ski.position.set(side * 0.21, 0.035, 0.03);

    const base = new THREE.Mesh(new THREE.BoxGeometry(0.112, 0.028, 1.6), mats.skiBase);
    base.position.y = 0.014;
    base.castShadow = true;
    ski.add(base);

    const top = new THREE.Mesh(new THREE.BoxGeometry(0.098, 0.014, 1.52), mats.skiTop);
    top.position.set(0, 0.035, -0.01);
    top.castShadow = true;
    ski.add(top);

    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.018, 0.36), mats.skiTop);
    tip.position.set(0, 0.055, 0.91);
    tip.rotation.x = -0.28;
    tip.castShadow = true;
    ski.add(tip);

    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.018, 0.16), mats.skiBase);
    tail.position.set(0, 0.038, -0.77);
    tail.rotation.x = 0.18;
    ski.add(tail);

    // binding
    const binding = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.24), mats.black);
    binding.position.set(0, 0.068, -0.05);
    binding.castShadow = true;
    ski.add(binding);

    skis.add(ski);
    skiMeshes.push(ski);
  }

  // ── body hierarchy ────────────────────────────────────────────
  const body = new THREE.Group();
  body.position.y = 0.92;
  group.add(body);

  const torso = new THREE.Group();
  body.add(torso);

  const jacket = new THREE.Mesh(new THREE.CapsuleGeometry(0.235, 0.34, 5, 10), mats.jacket);
  jacket.scale.set(1.05, 1.0, 0.72);
  jacket.position.set(0, 0.3, 0.01);
  jacket.rotation.x = 0.04;
  jacket.castShadow = true;
  torso.add(jacket);

  // shoulder yoke / darker panel
  const yoke = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.34, 3, 8), mats.jacketDark);
  yoke.rotation.z = Math.PI / 2;
  yoke.scale.set(1, 1, 0.8);
  yoke.position.set(0, 0.47, -0.06);
  yoke.castShadow = true;
  torso.add(yoke);

  // zipper
  const zipper = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.36, 0.012), mats.cream);
  zipper.position.set(0, 0.3, 0.178);
  torso.add(zipper);

  // hood
  const hood = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.048, 6, 12, Math.PI * 1.35), mats.jacketDark);
  hood.position.set(0, 0.5, -0.11);
  hood.rotation.x = Math.PI / 2 - 0.2;
  hood.castShadow = true;
  torso.add(hood);

  // backpack
  const pack = new THREE.Mesh(new THREE.CapsuleGeometry(0.145, 0.2, 4, 8), mats.pack);
  pack.scale.set(1.1, 1.0, 0.58);
  pack.position.set(0, 0.3, -0.235);
  pack.castShadow = true;
  torso.add(pack);

  const packTop = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.09, 0.11), mats.strap);
  packTop.position.set(0, 0.47, -0.235);
  packTop.rotation.x = -0.15;
  torso.add(packTop);
  for (const side of [-1, 1]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.34, 0.02), mats.strap);
    strap.position.set(side * 0.13, 0.34, 0.16);
    strap.rotation.z = side * -0.1;
    torso.add(strap);
  }

  // head & helmet
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.64, 0.02);
  torso.add(headPivot);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.1, 8), mats.skin);
  neck.position.y = 0.02;
  headPivot.add(neck);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.118, 12, 10), mats.skin);
  face.scale.set(1, 1.1, 0.95);
  face.position.set(0, 0.15, 0.015);
  face.castShadow = true;
  headPivot.add(face);
  const gaiter = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.105, 0.11, 10), mats.black);
  gaiter.position.set(0, 0.06, 0.035);
  headPivot.add(gaiter);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), mats.cream);
  helmet.scale.set(1.08, 0.9, 1.12);
  helmet.position.set(0, 0.22, -0.005);
  helmet.rotation.x = 0.08;
  helmet.castShadow = true;
  headPivot.add(helmet);
  const goggleBand = new THREE.Mesh(new THREE.TorusGeometry(0.118, 0.026, 5, 14), mats.goggles);
  goggleBand.position.set(0, 0.165, 0.045);
  goggleBand.rotation.x = Math.PI / 2 - 0.06;
  headPivot.add(goggleBand);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.4), mats.lens);
  lens.scale.set(1.02, 0.55, 1.02);
  lens.position.set(0, 0.17, 0.05);
  lens.rotation.x = Math.PI * 0.5;
  headPivot.add(lens);

  // arms
  const arms = {};
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.24, 0.45, 0);
    torso.add(shoulder);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.22, 3, 8), mats.jacket);
    upper.position.set(side * 0.03, -0.14, 0.02);
    upper.rotation.z = side * 0.2;
    upper.rotation.x = -0.25;
    upper.castShadow = true;
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.set(side * 0.075, -0.28, 0.04);
    shoulder.add(elbow);
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.22, 3, 8), mats.jacketDark);
    fore.position.set(0, -0.12, 0);
    fore.castShadow = true;
    elbow.add(fore);
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.062, 8, 6), mats.black);
    glove.scale.set(0.9, 1.05, 0.9);
    glove.position.set(0, -0.26, 0.015);
    glove.castShadow = true;
    elbow.add(glove);

    // pole
    const pole = new THREE.Group();
    pole.position.set(0, -0.26, 0.02);
    elbow.add(pole);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.007, 1.22, 5), mats.pole);
    shaft.position.set(0, -0.5, 0);
    shaft.rotation.x = 0.18;
    pole.add(shaft);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.014, 0.13, 6), mats.black);
    grip.position.set(0, 0.09, -0.02);
    pole.add(grip);
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.012, 10), mats.black);
    basket.position.set(0, -1.08, 0.11);
    basket.rotation.x = 0.18;
    pole.add(basket);

    arms[side] = { shoulder, elbow, pole };
  }

  // legs
  const legs = {};
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.13, 0.02, 0);
    body.add(hip);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.3, 3, 8), mats.pants);
    thigh.position.set(0, -0.18, 0.02);
    thigh.rotation.x = -0.42;
    thigh.castShadow = true;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.set(0, -0.35, 0.1);
    hip.add(knee);
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.28, 3, 8), mats.pantsLight);
    shin.position.set(0, -0.16, 0);
    shin.rotation.x = 0.5;
    shin.castShadow = true;
    knee.add(shin);

    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.19, 0.3), mats.black);
    boot.position.set(0, -0.34, -0.02);
    boot.castShadow = true;
    knee.add(boot);

    legs[side] = { hip, knee, boot };
  }

  // tiny ski patrol cross on the sleeve for local flavour
  const crossMat = new THREE.MeshStandardMaterial({ color: 0xf3efe2, roughness: 0.5 });
  const cross = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(i === 0 ? 0.04 : 0.012, i === 0 ? 0.012 : 0.04, 0.006), crossMat);
    cross.add(bar);
  }
  cross.position.set(-0.23, 0.34, 0.168);
  torso.add(cross);

  group.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; }
  });

  const state = {
    lean: 0, crouch: 0, brake: 0, air: 0, grab: 0,
    armSwing: 0, tuck: 0, lastSteer: 0, phase: 0,
  };

  function animate(dt, params) {
    const {
      speed = 0, steer = 0, tuck = 0, brake = 0, airborne = false,
      airTime = 0, grab = 0, crash = false, crashTime = 0, grounded = true,
    } = params;

    const sf = clamp(speed / 34, 0, 1);
    state.lean = damp(state.lean, steer * (0.1 + 0.2 * clamp(speed / 20, 0, 1)), 7, dt);
    const crouchTarget = airborne ? 0.5 : (tuck > 0.5 ? 1 : brake > 0.5 ? 0.35 : 0.18 + sf * 0.2);
    state.crouch = damp(state.crouch, crouchTarget, 7, dt);
    state.brake = damp(state.brake, brake, 8, dt);
    state.air = damp(state.air, airborne ? 1 : 0, 8, dt);
    state.grab = damp(state.grab, grab, 9, dt);
    state.phase += dt * (3 + sf * 8);

    const c = state.crouch;
    const lean = state.lean;

    body.position.y = 0.92 - c * 0.2 + Math.sin(state.phase * 2.1) * 0.008 * sf;
    torso.rotation.x = 0.06 + c * 0.36 + (airborne ? 0.08 : 0);
    torso.rotation.z = -lean * 0.42;
    torso.rotation.y = -steer * 0.08;
    headPivot.rotation.y = steer * 0.2;
    headPivot.rotation.z = -lean * 0.25;

    for (const side of [-1, 1]) {
      const arm = arms[side];
      // pole-plant rhythm: the outside hand swings forward
      const swing = Math.sin(state.phase + (side === 1 ? 0 : Math.PI)) * (0.06 + sf * 0.12);
      arm.shoulder.rotation.x = -0.34 - c * 0.4 + swing * (side === Math.sign(steer) ? 1.8 : 0.6);
      arm.shoulder.rotation.z = side * (0.19 + state.air * 0.55) - lean * 0.2;
      arm.shoulder.rotation.y = side * -0.12;
      arm.elbow.rotation.x = 0.48 + c * 0.4 + state.air * 0.3;
      arm.pole.rotation.x = 0.12 + Math.sin(state.phase * 0.9 + side) * 0.05 - c * 0.12;
      arm.pole.rotation.z = side * 0.04 + lean * 0.12;
    }

    // Air: spread arms, tuck skis, grab if asked
    if (state.air > 0.01) {
      for (const side of [-1, 1]) {
        const arm = arms[side];
        arm.shoulder.rotation.z = lerp(arm.shoulder.rotation.z, side * 0.85, state.air);
        arm.elbow.rotation.x = lerp(arm.elbow.rotation.x, 0.55, state.air);
      }
      if (state.grab > 0.05) {
        for (const side of [-1, 1]) {
          const arm = arms[side];
          arm.shoulder.rotation.z = lerp(arm.shoulder.rotation.z, side * 0.34, state.grab);
          arm.shoulder.rotation.x = lerp(arm.shoulder.rotation.x, -0.85, state.grab);
          arm.elbow.rotation.x = lerp(arm.elbow.rotation.x, 1.05, state.grab);
        }
        torso.rotation.x += state.grab * 0.3;
        body.position.y -= state.grab * 0.08;
      }
    }

    for (const side of [-1, 1]) {
      const leg = legs[side];
      const skid = brake * 0.35;
      leg.hip.rotation.x = -0.42 - c * 0.4 + (airborne ? 0.3 : 0);
      leg.hip.rotation.z = skid * side * 0.25 - lean * 0.28;
      leg.knee.rotation.x = 0.58 + c * 0.55 + (airborne ? 0.5 : 0);
      leg.knee.rotation.z = skid * side * 0.1;
    }

    // skis: edge angle, snowplow, and air tuck
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const ski = skiMeshes[i];
      ski.rotation.z = -lean * 0.5;
      ski.rotation.y = brake * -side * 0.24 + steer * 0.015;
      ski.position.y = 0.035 + (airborne ? 0.02 : 0);
      ski.position.x = side * (0.21 + brake * 0.06);
    }

    if (crash) {
      const t = clamp(crashTime * 1.8, 0, 1);
      body.rotation.x = Math.sin(crashTime * 12) * 0.5 * t + 0.4 * t;
      body.rotation.z = Math.sin(crashTime * 9 + 1.7) * 0.8 * t;
      body.position.y = Math.max(0.32, 0.92 - t * 0.55 + Math.sin(crashTime * 14) * 0.04);
      for (const side of [-1, 1]) {
        arms[side].shoulder.rotation.x = -1.4;
        arms[side].shoulder.rotation.z = side * 1.1;
        legs[side].knee.rotation.x = 1.2;
      }
      for (const ski of skiMeshes) { ski.rotation.z += Math.sin(crashTime * 10) * 0.3; }
    } else {
      body.rotation.x = damp(body.rotation.x, 0, 10, dt);
      body.rotation.z = damp(body.rotation.z, 0, 10, dt);
    }
  }

  return { group, skiMeshes, animate, materials: mats, body, torso, headPivot, arms, legs };
}
