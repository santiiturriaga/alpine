import * as THREE from 'three';
import {
  makeCanvas, canvasTexture, makeRadialTexture, mulberry32,
} from './util.js';
import {
  RUNS, CRYSTALS, FINISHES, runPointAt, runFromSource,
} from './worlddata.js';
import { heightAt } from './terrain.js';

/* ═══════════════════════════════════════════════════════════════
   COLLECTIBLES
   Gold coin trails down every named run, coins strung through the
   air over every kicker, and five crystals hidden in the glades.
   ═══════════════════════════════════════════════════════════════ */

const GOLD = new THREE.Color(1.0, 0.73, 0.23);
const CRYSTAL_COLORS = {
  0: 0x8caeff,
  1: 0x8fe7ff,
  2: 0xffc36a,
  3: 0x7dffb0,
  4: 0xffd9a1,
};
const COIN_CELL_SIZE = 96;
// At this distance a coin is about a pixel tall in the chase view at 1080p.
const COIN_RENDER_RADIUS = 420;
const COIN_RENDER_RADIUS_SQ = COIN_RENDER_RADIUS ** 2;
const AIR_COIN_REACH = 2.5;

const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _axisY = new THREE.Vector3(0, 1, 0);
const _cameraPos = new THREE.Vector3();
const _viewProjection = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _bounds = new THREE.Sphere();
const _glintMatrix = new THREE.Matrix4().makeRotationX(-Math.PI / 2)
  .scale(new THREE.Vector3(1.25, 1.25, 1));

function uploadCoinMatrices(attribute, count) {
  if (!count) return;
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(0, count * attribute.itemSize);
  attribute.needsUpdate = true;
}

export class Collectibles {
  constructor(scene, fx, pack=null) {
    this.scene = scene;
    this.fx = fx;
    this.runs=pack?.runs??RUNS;
    this.stashes=pack?.crystals??CRYSTALS;
    this.coinStep=Math.max(1,Math.round(pack?.coinStep??26));
    this.finishes=pack?.finishes??(pack?[]:FINISHES);
    this.forestCoins = pack?.forestCoins ?? [];
    this.heightAt=pack?.heightAt??heightAt;
    this.rand = mulberry32(442291);
    this.coins = [];
    this.coinCells = new Map();
    this.coinTime = 0;
    this.crystals = [];
    this.coinCount = 0;
    this.crystalCount = 0;
    this.totalCoins = 0;
    this.totalCrystals = this.stashes.length;
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
    for (const run of this.runs) {
      const samples = run.samples;
      if (!run.named || !samples?.length || run.length < 430) continue;
      const step = this.coinStep;
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
        const gy = this.heightAt(x, z);
        this.coins.push({
          x, y: gy + 0.95 + (n % 4 === 0 ? 0.22 : 0), z, groundY: gy,
          run: run.id, hidden: !!run.hidden, air: false,
          collected: false, phase: rand() * Math.PI * 2,
          value: run.hidden ? 15 : 10,
        });
      }
    }

    for (const finish of this.finishes) {
      const p = runPointAt(this.runs.find(r=>r.id===finish.run)??runFromSource(finish.run), 0.955);
      if (!p) continue;
      for (let i = -1; i <= 1; i++) {
        const x = p.x + p.nx * i * 3;
        const z = p.z + p.nz * i * 3;
        const gy = this.heightAt(x, z);
        this.coins.push({
          x, y: gy + 1.05, z, groundY: gy,
          collected: false, phase: rand() * Math.PI * 2, value: 15,
        });
      }
    }

    for (const { x, z, y, run, air } of this.forestCoins) {
      const groundY = this.heightAt(x, z);
      this.coins.push({ x, y: y ?? groundY + 1.02, z, groundY, run, air: !!air,
        hidden: true, collected: false, phase: rand() * Math.PI * 2, value: 15 });
    }
    this.totalCoins = this.coins.length;
    for (let i = 0; i < this.coins.length; i++) {
      const coin = this.coins[i];
      const x = Math.floor(coin.x / COIN_CELL_SIZE);
      const z = Math.floor(coin.z / COIN_CELL_SIZE);
      if (!this.coinCells.has(x)) this.coinCells.set(x, new Map());
      const column = this.coinCells.get(x);
      if (!column.has(z)) column.set(z, []);
      column.get(z).push(i);
    }
  }

  *coinCellsInRange(x, z, radius) {
    const minZ = Math.floor((z - radius) / COIN_CELL_SIZE);
    const maxZ = Math.floor((z + radius) / COIN_CELL_SIZE);
    const maxX = Math.floor((x + radius) / COIN_CELL_SIZE);
    for (let cx = Math.floor((x - radius) / COIN_CELL_SIZE); cx <= maxX; cx++) {
      const column = this.coinCells.get(cx);
      if (!column) continue;
      for (let cz = minZ; cz <= maxZ; cz++) {
        const cell = column.get(cz);
        if (cell) yield cell;
      }
    }
  }

  buildCrystals() {
    for (const spec of this.stashes) {
      const p = runPointAt(this.runs.find(r=>r.id===spec.run), spec.t);
      if (!p) continue;
      const x = p.x + p.nx * 0.5;
      const z = p.z + p.nz * 0.5;
      const gy = this.heightAt(x, z);
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
    this.rimMesh = new THREE.InstancedMesh(rimGeo, rimMat, 0);
    this.coinMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rimMesh.instanceMatrix = this.coinMesh.instanceMatrix;
    this.coinMesh.count = 0;
    this.coinMesh.name = 'coins';
    this.rimMesh.name = 'coin-rims';
    this.coinMesh.frustumCulled = false;
    this.rimMesh.frustumCulled = false;
    this.coinMesh.castShadow = false;
    this.scene.add(this.coinMesh, this.rimMesh);

    // tiny ground glints under the first 900 placed coins
    this.glintLimit = Math.min(this.coins.length, 900);
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
    this.glints = new THREE.InstancedMesh(glintGeo, glintMat, this.glintLimit);
    this.glints.name = 'coin-glints';
    this.glints.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.glints.count = 0;
    this.glints.frustumCulled = false;
    this.glints.renderOrder = 1;
    this.scene.add(this.glints);

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
      light.visible=false;
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

  prepareRender(camera) {
    camera.getWorldPosition(_cameraPos);
    _viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_viewProjection, camera.coordinateSystem);
    const { x, z } = _cameraPos;
    const time = this.coinTime;
    let coinCount = 0;
    let glintCount = 0;
    // Keep the full coin silhouette within the frustum test, including its bob.
    for (const cell of this.coinCellsInRange(x, z, COIN_RENDER_RADIUS)) {
      for (const i of cell) {
        const coin = this.coins[i];
        if (coin.collected) continue;
        _bounds.center.set(coin.x, coin.y, coin.z);
        _bounds.radius = 0.5;
        if (_cameraPos.distanceToSquared(_bounds.center) <= COIN_RENDER_RADIUS_SQ && _frustum.intersectsSphere(_bounds)) {
          const bob = Math.sin(time * 2.1 + coin.phase) * 0.12;
          _pos.set(coin.x, coin.y + bob, coin.z);
          _quat.setFromAxisAngle(_axisY, time * 2.4 + coin.phase);
          this.coinMesh.setMatrixAt(coinCount++, _mat.compose(_pos, _quat, _scale));
        }
        if (i < this.glintLimit) {
          _bounds.center.y = coin.groundY + 0.08;
          _bounds.radius = 0.89;
          if (_cameraPos.distanceToSquared(_bounds.center) <= COIN_RENDER_RADIUS_SQ && _frustum.intersectsSphere(_bounds)) {
            this.glints.setMatrixAt(glintCount++, _glintMatrix.setPosition(_bounds.center));
          }
        }
      }
    }
    this.coinMesh.count = this.rimMesh.count = coinCount;
    this.glints.count = glintCount;
    uploadCoinMatrices(this.coinMesh.instanceMatrix, coinCount);
    uploadCoinMatrices(this.glints.instanceMatrix, glintCount);
  }

  update(dt, time, player) {
    this.coinTime = time;
    const pickups = [];
    const { x, y, z } = player.pos;
    for (const cell of this.coinCellsInRange(x, z, AIR_COIN_REACH)) {
      for (const i of cell) {
        const coin = this.coins[i];
        if (coin.collected) continue;
        const dx = x - coin.x;
        const dz = z - coin.z;
        const dy = y + 0.9 - coin.y;
        const reach = coin.air ? AIR_COIN_REACH : 2.15;
        if (dx * dx + dz * dz < reach * reach && Math.abs(dy) < (coin.air ? 3.0 : 2.2)) pickups.push(i);
      }
    }
    // Preserve placement order when pickups overlap across cell boundaries.
    if (pickups.length > 1) pickups.sort((a, b) => a - b);
    for (const i of pickups) {
      const c = this.coins[i];
      if (c.collected) continue;
      c.collected = true;
      this.coinCount++;
      this.lastCoin = c;
      this.fx?.burst({ x: c.x, y: c.y, z: c.z }, 'gold', 18);
      this.fx?.spark.spawn(c.x, c.y, c.z, 0, 4.5, 0, 1.6, 0.8, GOLD);
      this.onCoin?.(c);
    }

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
    for (const coin of this.coins) coin.collected = false;
    this.coinTime = 0;
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
