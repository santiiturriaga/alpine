import * as THREE from 'three';
import {
  clamp, makeCanvas, canvasTexture, makeRadialTexture, mulberry32,
} from './util.js';
import {
  RUNS, CRYSTALS, KICKERS, SECRETS, runPointAt,
} from './worlddata.js';
import { heightAt, normalAt } from './terrain.js';

/* ═══════════════════════════════════════════════════════════════
   COLLECTIBLES
   Gold coin trails down every named run, coins strung through the
   air over every kicker, and five crystals hidden in the glades.
   ═══════════════════════════════════════════════════════════════ */

const GOLD = new THREE.Color(1.0, 0.73, 0.23);
const CRYSTAL_COLORS = {
  wildcard: 0x8caeff,
  crystal: 0x8fe7ff,
  bearhollow: 0xffc36a,
  bushrat: 0x7dffb0,
  dusty: 0xffd9a1,
};

const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _zero = new THREE.Vector3(0, 0, 0);
const _axisY = new THREE.Vector3(0, 1, 0);
const _axisX = new THREE.Vector3(1, 0, 0);

export class Collectibles {
  constructor(scene, fx) {
    this.scene = scene;
    this.fx = fx;
    this.rand = mulberry32(442291);
    this.coins = [];
    this.crystals = [];
    this.coinCount = 0;
    this.crystalCount = 0;
    this.totalCoins = 0;
    this.totalCrystals = CRYSTALS.length;
    this.onCoin = null;
    this.onCrystal = null;
    this.lastCoin = null;

    this.buildCoins();
    this.buildCrystals();
    this.buildMeshes();
  }

  /* ── placement ─────────────────────────────────────────────── */

  buildCoins() {
    const rand = this.rand;
    for (const run of RUNS) {
      const samples = run.samples;
      if (!samples?.length) continue;
      const step = run.hidden ? 5 : 10;
      const coinsOnRun = Math.floor((samples.length - 12) / step);
      if (coinsOnRun < 2) continue;
      for (let n = 0; n < coinsOnRun; n++) {
        const i = 8 + n * step + (n % 3);
        if (i >= samples.length - 3) break;
        const p = samples[i];
        const lateral = (((n % 2) ? 1 : -1) * run.width * (0.18 + (n % 3) * 0.03))
          + (rand() - 0.5) * 1.8;
        const x = p.x + p.nx * lateral;
        const z = p.z + p.nz * lateral;
        const gy = heightAt(x, z);
        this.coins.push({
          x, y: gy + 0.95 + (n % 4 === 0 ? 0.22 : 0), z, groundY: gy,
          run: run.id, hidden: !!run.hidden, air: false,
          collected: false, phase: rand() * Math.PI * 2,
          value: run.hidden ? 15 : 10,
        });
      }
    }

    // Air coins over each kicker, strung along the natural jump arc.
    for (const k of KICKERS) {
      const p = runPointAt(k.run, k.t);
      if (!p) continue;
      const run = RUNS.find(r => r.id === k.run);
      const lateral = (rand() - 0.5) * (k.width * 0.24);
      for (let i = 0; i < 7; i++) {
        const d = 4 + i * 4.6;
        const x = p.x + p.tx * d + p.nx * lateral;
        const z = p.z + p.tz * d + p.nz * lateral;
        const gy = heightAt(x, z);
        const arc = Math.sin((i + 1) / 8 * Math.PI) * (4.4 + k.height * 1.25);
        this.coins.push({
          x, y: gy + 1.1 + arc, z, groundY: gy,
          run: run?.id || k.run, hidden: false, air: true,
          collected: false, phase: rand() * Math.PI * 2,
          value: 25,
        });
      }
    }

    // A few celebratory coins at the two finish arches.
    for (const id of ['franz', 'catskinner']) {
      const p = runPointAt(id, 0.955);
      if (!p) continue;
      for (let i = -1; i <= 1; i++) {
        const x = p.x + p.nx * i * 3.0;
        const z = p.z + p.nz * i * 3.0;
        const gy = heightAt(x, z);
        this.coins.push({
          x, y: gy + 1.05, z, groundY: gy,
          run: id, hidden: false, air: false,
          collected: false, phase: rand() * Math.PI * 2, value: 15,
        });
      }
    }

    this.totalCoins = this.coins.length;
  }

  buildCrystals() {
    for (const spec of CRYSTALS) {
      const p = runPointAt(spec.run, spec.t);
      if (!p) continue;
      const run = RUNS.find(r => r.id === spec.run);
      const x = p.x + p.nx * 0.5;
      const z = p.z + p.nz * 0.5;
      const gy = heightAt(x, z);
      const color = CRYSTAL_COLORS[spec.id] || 0x8fe7ff;
      this.crystals.push({
        ...spec,
        x, z, y: gy + 1.55,
        color,
        collected: false,
        phase: this.rand() * Math.PI * 2,
        group: null,
        light: null,
      });
    }
  }

  /* ── meshes ────────────────────────────────────────────────── */

  buildMeshes() {
    const coinGeo = new THREE.CylinderGeometry(0.31, 0.31, 0.075, 18);
    coinGeo.rotateX(Math.PI / 2);
    const rimGeo = new THREE.TorusGeometry(0.32, 0.052, 6, 18);
    const faceMat = new THREE.MeshStandardMaterial({
      color: 0xffcf68, emissive: 0xb87813, emissiveIntensity: 0.36,
      metalness: 0.85, roughness: 0.22,
    });
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xffe6a4, emissive: 0x8d5b0e, emissiveIntensity: 0.3,
      metalness: 0.92, roughness: 0.16,
    });

    this.coinMesh = new THREE.InstancedMesh(coinGeo, faceMat, this.coins.length);
    this.rimMesh = new THREE.InstancedMesh(rimGeo, rimMat, this.coins.length);
    this.coinMesh.name = 'coins';
    this.rimMesh.name = 'coin-rims';
    this.coinMesh.frustumCulled = false;
    this.rimMesh.frustumCulled = false;
    this.coinMesh.castShadow = false;
    this.scene.add(this.coinMesh, this.rimMesh);

    // tiny ground glints under each coin
    const glintCount = Math.min(this.coins.length, 900);
    const glintGeo = new THREE.PlaneGeometry(1, 1);
    const glintTex = makeRadialTexture(32, [
      [0, 'rgba(255,219,132,.65)'],
      [0.5, 'rgba(255,190,77,.2)'],
      [1, 'rgba(255,180,60,0)'],
    ]);
    const glintMat = new THREE.MeshBasicMaterial({
      map: glintTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      color: 0xffd073,
    });
    this.glints = new THREE.InstancedMesh(glintGeo, glintMat, glintCount);
    this.glints.frustumCulled = false;
    this.glints.renderOrder = 1;
    this.scene.add(this.glints);

    for (let i = 0; i < this.coins.length; i++) this.updateCoinMatrix(i, 0, true);

    const beamCanvas = makeCanvas(64, 256);
    const bctx = beamCanvas.ctx;
    const grad = bctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.55, 'rgba(255,255,255,.14)');
    grad.addColorStop(0.92, 'rgba(255,255,255,.34)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    bctx.fillStyle = grad;
    bctx.fillRect(0, 0, 64, 256);
    const beamTex = canvasTexture(beamCanvas.canvas);
    const haloTexture = makeRadialTexture(128, [
      [0, 'rgba(255,255,255,.9)'],
      [0.25, 'rgba(255,255,255,.45)'],
      [0.65, 'rgba(255,255,255,.1)'],
      [1, 'rgba(255,255,255,0)'],
    ]);

    for (const c of this.crystals) {
      const group = new THREE.Group();
      group.position.set(c.x, c.y, c.z);
      group.name = `crystal-${c.id}`;

      const geo = new THREE.OctahedronGeometry(0.54, 0);
      const mat = new THREE.MeshStandardMaterial({
        color: c.color, emissive: c.color, emissiveIntensity: 0.85,
        metalness: 0.32, roughness: 0.08, transparent: true, opacity: 0.94,
      });
      const shard = new THREE.Mesh(geo, mat);
      shard.scale.set(1, 1.55, 1);
      shard.castShadow = true;
      group.add(shard);

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.78, 0.025, 4, 32),
        new THREE.MeshBasicMaterial({ color: c.color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      ring.rotation.x = Math.PI / 2;
      group.add(ring);

      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: haloTexture, color: c.color, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      halo.scale.setScalar(4.2);
      group.add(halo);

      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 1.8, 11, 10, 1, true),
        new THREE.MeshBasicMaterial({
          map: beamTex, color: c.color, transparent: true, opacity: 0.32,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        }),
      );
      beam.position.y = 4.7;
      group.add(beam);

      const light = new THREE.PointLight(c.color, 2.4, 26, 2);
      light.position.y = 1.2;
      group.add(light);

      c.group = group;
      c.light = light;
      c.shard = shard;
      c.ring = ring;
      c.halo = halo;
      c.beam = beam;
      this.scene.add(group);
    }
  }

  updateCoinMatrix(i, time, staticOnly = false) {
    const c = this.coins[i];
    if (c.collected) {
      _mat.compose(_pos.set(c.x, c.y, c.z), _quat.identity(), _scale.set(0, 0, 0));
      this.coinMesh.setMatrixAt(i, _mat);
      if (i < this.glints.count) this.glints.setMatrixAt(i, _mat);
      return;
    }
    const bob = Math.sin(time * 2.1 + c.phase) * 0.12;
    _pos.set(c.x, c.y + bob, c.z);
    _quat.setFromAxisAngle(_axisY, time * 2.4 + c.phase);
    _scale.set(1, 1, 1);
    _mat.compose(_pos, _quat, _scale);
    this.coinMesh.setMatrixAt(i, _mat);
    this.rimMesh.setMatrixAt(i, _mat);
    if (i < this.glints.count) {
      const gy = c.groundY ?? heightAt(c.x, c.z);
      _quat.setFromAxisAngle(_axisX, -Math.PI / 2);
      _pos.set(c.x, gy + 0.08, c.z);
      _scale.set(1.25, 1.25, 1);
      _mat.compose(_pos, _quat, _scale);
      this.glints.setMatrixAt(i, _mat);
      _scale.set(1, 1, 1);
    }
  }

  update(dt, time, player, camera) {
    // coin visuals + pickups
    const replaced = [];
    for (let i = 0; i < this.coins.length; i++) {
      const c = this.coins[i];
      if (c.collected) continue;
      this.updateCoinMatrix(i, time);
      const dx = player.pos.x - c.x;
      const dz = player.pos.z - c.z;
      const dy = player.pos.y + 0.9 - c.y;
      const reach = c.air ? 2.5 : 2.15;
      if (dx * dx + dz * dz < reach * reach && Math.abs(dy) < (c.air ? 3.0 : 2.2)) {
        c.collected = true;
        this.coinCount++;
        this.lastCoin = c;
        const point = { x: c.x, y: c.y, z: c.z };
        this.fx?.burst(point, c.air ? 'gold' : 'gold', 18);
        this.fx?.spark.spawn(c.x, c.y, c.z, 0, 4.5, 0, 1.6, 0.8, GOLD);
        this.updateCoinMatrix(i, time);
        this.onCoin?.(c);
      }
      if (Math.random() < 0.0008) replaced.push(i);
    }
    this.coinMesh.instanceMatrix.needsUpdate = true;
    this.rimMesh.instanceMatrix.needsUpdate = true;
    this.glints.instanceMatrix.needsUpdate = true;

    // crystals
    for (const c of this.crystals) {
      if (c.collected || !c.group) continue;
      c.group.position.y = c.y + Math.sin(time * 1.2 + c.phase) * 0.2;
      c.shard.rotation.y = time * 0.85 + c.phase;
      c.shard.rotation.z = Math.sin(time * 0.7 + c.phase) * 0.14;
      c.ring.rotation.z = time * 0.6 + c.phase;
      c.ring.scale.setScalar(1 + Math.sin(time * 2.0 + c.phase) * 0.06);
      c.halo.material.opacity = 0.38 + Math.sin(time * 1.8 + c.phase) * 0.12;
      c.beam.material.opacity = 0.2 + Math.sin(time * 1.35 + c.phase) * 0.07;
      const dist = Math.hypot(player.pos.x - c.x, player.pos.z - c.z);
      if (c.light) c.light.visible = dist < 90;

      if (dist < 85 && Math.random() < dt * 2.2) {
        const ang = Math.random() * Math.PI * 2;
        const rad = 0.5 + Math.random() * 1.2;
        this.fx?.spark.spawn(
          c.x + Math.cos(ang) * rad, c.group.position.y + (Math.random() - 0.5) * 1.6, c.z + Math.sin(ang) * rad,
          Math.cos(ang) * 0.35, 0.7 + Math.random() * 0.8, Math.sin(ang) * 0.35,
          0.3 + Math.random() * 0.4, 0.8 + Math.random() * 0.8,
          new THREE.Color(c.color),
        );
      }

      if (dist < 3.1 && Math.abs(player.pos.y + 1.0 - c.group.position.y) < 4.0) {
        c.collected = true;
        this.crystalCount++;
        c.group.visible = false;
        this.fx?.burst({ x: c.x, y: c.group.position.y, z: c.z }, 'cyan', 60);
        this.fx?.burst({ x: c.x, y: c.group.position.y, z: c.z }, 'gold', 24);
        this.onCrystal?.(c);
      }
    }
  }

  reset() {
    for (let i = 0; i < this.coins.length; i++) {
      this.coins[i].collected = false;
      this.updateCoinMatrix(i, 0);
    }
    this.coinMesh.instanceMatrix.needsUpdate = true;
    this.rimMesh.instanceMatrix.needsUpdate = true;
    this.glints.instanceMatrix.needsUpdate = true;
    for (const c of this.crystals) {
      c.collected = false;
      if (c.group) c.group.visible = true;
    }
    this.coinCount = 0;
    this.crystalCount = 0;
    this.lastCoin = null;
  }

  getCrystal(id) {
    return this.crystals.find(c => c.id === id);
  }
}
