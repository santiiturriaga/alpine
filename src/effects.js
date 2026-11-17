import * as THREE from 'three';
import {
  clamp, lerp, mulberry32, makeCanvas, canvasTexture, makeRadialTexture,
  noise2, smoothstep,
} from './util.js';
import { heightAt } from './terrain.js';

export const SUN_DIR = new THREE.Vector3(-0.56, 0.415, 0.715).normalize();

/* ═══════════════════════════════════════════════════════════════
   LIGHT + SKY
   ═══════════════════════════════════════════════════════════════ */

export function createLighting(scene) {
  const hemi = new THREE.HemisphereLight(0xb8d9ee, 0x3a4b52, 0.8);
  hemi.name = 'hemisphere';
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffd6ac, 2.8);
  sun.name = 'sun';
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 2600;
  sun.shadow.camera.left = -185;
  sun.shadow.camera.right = 185;
  sun.shadow.camera.top = 185;
  sun.shadow.camera.bottom = -185;
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.55;
  sun.target.position.set(0, 0, 0);
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight(0x9dc4db, 0.32);
  fill.position.set(0.5, 0.35, -0.7);
  scene.add(fill);

  return { sun, hemi, fill };
}

export function createSky(scene) {
  const skyGeo = new THREE.SphereGeometry(11000, 48, 24);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSun: { value: SUN_DIR.clone() },
      uZenith: { value: new THREE.Color(0x2c5a86) },
      uMid: { value: new THREE.Color(0x8fb9d2) },
      uHorizon: { value: new THREE.Color(0xf3d8bd) },
      uSunColor: { value: new THREE.Color(0xffe6c2) },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_Position.z = gl_Position.w;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      uniform vec3 uSun;
      uniform vec3 uZenith;
      uniform vec3 uMid;
      uniform vec3 uHorizon;
      uniform vec3 uSunColor;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        float horizon = pow(1.0 - h, 2.65);
        vec3 col = mix(uZenith, uMid, smoothstep(0.05, 0.62, h));
        col = mix(col, uHorizon, horizon * 0.94);
        // warm band just above the ridgeline
        float band = exp(-pow((d.y - 0.035) * 7.5, 2.0));
        col = mix(col, vec3(1.0, 0.77, 0.55), band * 0.22);
        // sun
        float sd = max(dot(d, normalize(uSun)), 0.0);
        col += uSunColor * pow(sd, 420.0) * 4.0;
        col += vec3(1.0, 0.69, 0.4) * pow(sd, 12.0) * 0.34;
        col += vec3(1.0, 0.82, 0.57) * pow(sd, 2.5) * 0.07;
        // below the horizon fade into haze
        col = mix(col, vec3(0.76, 0.83, 0.86), smoothstep(0.0, -0.16, d.y));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.name = 'sky';
  sky.frustumCulled = false;
  scene.add(sky);

  // Sun disc + halo
  const sunTex = makeRadialTexture(256, [
    [0, 'rgba(255,255,246,1)'],
    [0.08, 'rgba(255,245,219,1)'],
    [0.19, 'rgba(255,216,160,.8)'],
    [0.48, 'rgba(255,184,111,.24)'],
    [1, 'rgba(255,170,90,0)'],
  ]);
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sunTex, color: 0xffe9c8, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
  }));
  sunSprite.scale.setScalar(3000);
  sunSprite.name = 'sunSprite';
  scene.add(sunSprite);

  const glowTex = makeRadialTexture(256, [
    [0, 'rgba(255,220,175,.32)'],
    [0.4, 'rgba(255,188,120,.12)'],
    [1, 'rgba(255,160,90,0)'],
  ]);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffc894, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
  }));
  sunGlow.scale.setScalar(9000);
  scene.add(sunGlow);

  // High, thin clouds
  const cloudCanvas = makeCanvas(512, 256);
  const c = cloudCanvas.ctx;
  const rand = mulberry32(90210);
  c.clearRect(0, 0, 512, 256);
  for (let i = 0; i < 90; i++) {
    const x = 40 + rand() * 430;
    const y = 110 + rand() * 70;
    const rx = 25 + rand() * 80;
    const ry = 5 + rand() * 16;
    const g = c.createRadialGradient(x, y, 0, x, y, rx);
    g.addColorStop(0, `rgba(255,247,240,${0.05 + rand() * 0.09})`);
    g.addColorStop(1, 'rgba(255,240,230,0)');
    c.fillStyle = g;
    c.save(); c.translate(x, y); c.scale(1, ry / rx); c.translate(-x, -y);
    c.beginPath(); c.arc(x, y, rx, 0, Math.PI * 2); c.fill(); c.restore();
  }
  const cloudTex = canvasTexture(cloudCanvas.canvas);
  const clouds = [];
  for (let i = 0; i < 9; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: cloudTex, transparent: true, depthWrite: false, opacity: 0.24 + rand() * 0.22,
      color: 0xfff2e5, fog: true,
    }));
    const ang = rand() * Math.PI * 2;
    const r = 2600 + rand() * 4800;
    s.position.set(Math.cos(ang) * r, 2300 + rand() * 1500, Math.sin(ang) * r - 300);
    s.scale.set(1500 + rand() * 2600, 360 + rand() * 700, 1);
    s.userData.drift = 0.9 + rand() * 1.5;
    scene.add(s);
    clouds.push(s);
  }

  return {
    sky, sunSprite, sunGlow, clouds,
    update(dt, camera) {
      sky.position.copy(camera.position);
      sunSprite.position.copy(camera.position).addScaledVector(SUN_DIR, 9500);
      sunGlow.position.copy(camera.position).addScaledVector(SUN_DIR, 10000);
      for (const cl of clouds) {
        cl.position.x += cl.userData.drift * dt;
        if (cl.position.x > 7600) cl.position.x = -7600;
      }
    },
  };
}

/* ── Distant Coast Mountain ranges ─────────────────────────────── */

export function createDistantRanges(scene) {
  const rand = mulberry32(711);
  const group = new THREE.Group();
  group.name = 'distant-ranges';
  const rings = [
    { radius: 3900, segments: 190, base: 850, amp: 1400, color: [0.48, 0.6, 0.67], haze: 0.18, seed: 5 },
    { radius: 6200, segments: 160, base: 1400, amp: 2100, color: [0.62, 0.72, 0.78], haze: 0.32, seed: 19 },
    { radius: 9000, segments: 140, base: 1900, amp: 2500, color: [0.73, 0.81, 0.85], haze: 0.48, seed: 37 },
  ];

  for (const spec of rings) {
    const positions = [];
    const colors = [];
    const indices = [];
    const seg = spec.segments;
    const baseY = -300;
    const tops = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const nx = Math.cos(a), nz = Math.sin(a);
      const n = noise2.fbm(Math.cos(a) * 2.6 + spec.seed * 11, Math.sin(a) * 2.6 - spec.seed * 7, 5);
      const n2 = noise2.ridged(Math.cos(a) * 5.8 + spec.seed, Math.sin(a) * 5.8, 3);
      const ridge = spec.base + (0.35 + n * 0.5 + n2 * 0.55) * spec.amp;
      tops.push(ridge);
      // base vertex
      positions.push(nx * spec.radius, baseY, nz * spec.radius);
      colors.push(...spec.color.map(c => c * 0.72));
      // jagged top: twin top vertices for a little serration
      const peakOffset = (hash(i, spec.seed) - 0.5) * spec.radius * 0.002;
      positions.push(nx * (spec.radius + peakOffset), ridge, nz * (spec.radius + peakOffset));
      const lit = clamp(0.5 + n * 0.5 + Math.max(0, nx * SUN_DIR.x + nz * SUN_DIR.z) * 0.25, 0, 1);
      colors.push(
        clamp(spec.color[0] + 0.2 * lit, 0, 1),
        clamp(spec.color[1] + 0.15 * lit, 0, 1),
        clamp(spec.color[2] + 0.1 * lit, 0, 1),
      );
      if (i < seg) {
        const b0 = i * 2, t0 = b0 + 1, b1 = b0 + 2, t1 = b0 + 3;
        indices.push(b0, b1, t0, b1, t1, t0);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, fog: true, depthWrite: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -2;
    group.add(mesh);
  }
  scene.add(group);
  return group;
}

function hash(n, seed) {
  const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/* ═══════════════════════════════════════════════════════════════
   PARTICLES
   ═══════════════════════════════════════════════════════════════ */

const softTexture = makeRadialTexture(64, [
  [0, 'rgba(255,255,255,1)'],
  [0.28, 'rgba(255,255,255,.85)'],
  [1, 'rgba(255,255,255,0)'],
]);

class ParticlePool {
  constructor(scene, count, { additive = false, sizeScale = 1 } = {}) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.size = new Float32Array(count);
    this.alpha = new Float32Array(count);
    this.color = new Float32Array(count * 3);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3));
    geo.setDrawRange(0, count);

    this.material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uMap: { value: softTexture },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 1.75) },
      },
      vertexShader: /* glsl */`
        attribute float aSize;
        attribute float aAlpha;
        attribute vec3 aColor;
        varying float vAlpha;
        varying vec3 vColor;
        uniform float uPixelRatio;
        void main() {
          vAlpha = aAlpha;
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(30.0, aSize * uPixelRatio * (160.0 / max(2.0, -mv.z)));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vec4 tex = texture2D(uMap, gl_PointCoord);
          if (tex.a < 0.015 || vAlpha < 0.004) discard;
          gl_FragColor = vec4(vColor, tex.a * min(0.32, vAlpha));
        }
      `,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    scene.add(this.points);
    this.geo = geo;
  }

  spawn(x, y, z, vx, vy, vz, size, life, color) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size;
    this.alpha[i] = 0;
    this.color[i * 3] = color.r; this.color[i * 3 + 1] = color.g; this.color[i * 3 + 2] = color.b;
    this.birthAlpha = 0.85;
  }

  update(dt, gravity = -2.2, drag = 1.4) {
    const lifeArr = this.life;
    const alphaArr = this.alpha;
    const pos = this.pos, vel = this.vel;
    for (let i = 0; i < this.count; i++) {
      if (lifeArr[i] <= 0) { alphaArr[i] = 0; continue; }
      lifeArr[i] -= dt;
      const k = Math.max(0, lifeArr[i] / this.maxLife[i]);
      const d = Math.exp(-drag * dt);
      vel[i * 3] *= d; vel[i * 3 + 2] *= d;
      vel[i * 3 + 1] += gravity * dt;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      const age = 1 - k;
      alphaArr[i] = (age < 0.12 ? age / 0.12 : 1) * Math.pow(k, 0.72) * 0.62;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}

export class Snowstorm {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.count = 1400;
    const rand = mulberry32(5511);
    this.rand = rand;
    this.pos = new Float32Array(this.count * 3);
    this.vel = new Float32Array(this.count * 3);
    this.size = new Float32Array(this.count);
    this.phase = new Float32Array(this.count);
    this.box = 170;
    this.center = new THREE.Vector3();
    for (let i = 0; i < this.count; i++) {
      this.pos[i * 3] = (rand() - 0.5) * this.box;
      this.pos[i * 3 + 1] = rand() * 70 - 10;
      this.pos[i * 3 + 2] = (rand() - 0.5) * this.box;
      this.vel[i * 3] = -0.4 - rand() * 0.9;
      this.vel[i * 3 + 1] = -0.6 - rand() * 1.2;
      this.vel[i * 3 + 2] = 0.3 + rand() * 0.7;
      this.size[i] = 0.3 + rand() * 0.62;
      this.phase[i] = rand() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.NormalBlending, fog: false,
      uniforms: { uMap: { value: softTexture }, uPixelRatio: { value: Math.min(window.devicePixelRatio, 1.75) } },
      vertexShader: /* glsl */`
        attribute float aSize;
        varying float vA;
        uniform float uPixelRatio;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(8.0, aSize * uPixelRatio * (235.0 / max(2.5, -mv.z)));
          gl_Position = projectionMatrix * mv;
          vA = smoothstep(0.5, 4.0, -mv.z);
        }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap;
        varying float vA;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          if (t.a < 0.03) discard;
          gl_FragColor = vec4(vec3(0.94,0.97,1.0), t.a * vA * 0.3);
        }
      `,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
    this.geo = geo;
    this.t = 0;
  }

  update(dt, playerPos) {
    this.t += dt;
    const B = this.box, half = B / 2;
    const cx = playerPos.x, cy = playerPos.y, cz = playerPos.z;
    for (let i = 0; i < this.count; i++) {
      const p = i * 3;
      this.pos[p] += (this.vel[p] + Math.sin(this.t * 0.8 + this.phase[i]) * 0.45) * dt;
      this.pos[p + 1] += this.vel[p + 1] * dt;
      this.pos[p + 2] += (this.vel[p + 2] + Math.cos(this.t * 0.6 + this.phase[i]) * 0.3) * dt;
      // wrap around player
      let dx = this.pos[p] - cx, dy = this.pos[p + 1] - (cy + 30), dz = this.pos[p + 2] - cz;
      if (dx > half) this.pos[p] -= B; else if (dx < -half) this.pos[p] += B;
      if (dz > half) this.pos[p + 2] -= B; else if (dz < -half) this.pos[p + 2] += B;
      if (dy > 42) this.pos[p + 1] -= 66; else if (dy < -30) this.pos[p + 1] += 66;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

export function createGlitter(scene) {
  const count = 260;
  const rand = mulberry32(613);
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    size[i] = 0.3 + rand() * 0.65;
    phase[i] = rand() * Math.PI * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uMap: { value: softTexture }, uTime: { value: 0 }, uPixelRatio: { value: Math.min(window.devicePixelRatio, 1.75) } },
    vertexShader: /* glsl */`
      attribute float aSize;
      attribute float aPhase;
      varying float vTwinkle;
      uniform float uTime;
      uniform float uPixelRatio;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float tw = pow(max(0.0, sin(uTime * (1.3 + aPhase * 0.15) + aPhase * 7.0)), 7.0);
        vTwinkle = tw;
        gl_PointSize = min(9.0, aSize * uPixelRatio * (tw * 0.9 + 0.25) * (220.0 / max(4.0, -mv.z)));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap;
      varying float vTwinkle;
      void main() {
        vec4 t = texture2D(uMap, gl_PointCoord);
        if (t.a < 0.05 || vTwinkle < 0.04) discard;
        gl_FragColor = vec4(vec3(1.0,0.96,0.85), t.a * vTwinkle * 0.55);
      }
    `,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 5;
  scene.add(points);
  let timer = 0;
  const rand2 = mulberry32(777);
  return {
    update(dt, playerPos, time) {
      mat.uniforms.uTime.value = time;
      timer -= dt;
      if (timer <= 0) {
        timer = 0.22;
        for (let i = 0; i < count; i++) {
          const ang = rand2() * Math.PI * 2;
          const r = 2 + Math.sqrt(rand2()) * 26;
          const x = playerPos.x + Math.cos(ang) * r;
          const z = playerPos.z + Math.sin(ang) * r;
          pos[i * 3] = x;
          pos[i * 3 + 1] = heightAt(x, z) + 0.08 + rand2() * 0.12;
          pos[i * 3 + 2] = z;
        }
        geo.attributes.position.needsUpdate = true;
      }
    },
  };
}

/* ── Spray & sparkle particles ─────────────────────────────────── */

const white = new THREE.Color(0.94, 0.97, 1.0);
const powder = new THREE.Color(0.99, 0.995, 1.0);
const gold = new THREE.Color(1.0, 0.78, 0.33);
const cyan = new THREE.Color(0.5, 0.92, 1.0);

export class ParticleFX {
  constructor(scene) {
    this.spray = new ParticlePool(scene, 1200);
    this.spark = new ParticlePool(scene, 420, { additive: true });
    this.rand = mulberry32(1773);
  }

  carve(point, side, speed, powderAmount, dt) {
    const rand = this.rand;
    const n = Math.round((3 + speed * 0.45) * clamp(dt * 60, 0.2, 2) * (0.7 + powderAmount * 0.7));
    const sp = Math.min(speed, 32);
    for (let i = 0; i < n; i++) {
      const spread = 0.3 + rand();
      const color = powderAmount > 0.5 ? powder : white;
      this.spray.spawn(
        point.x + (rand() - 0.5) * 0.7,
        point.y + 0.05 + rand() * 0.25,
        point.z + (rand() - 0.5) * 0.7,
        side.x * (1.2 + rand() * 2.4) * spread * (0.35 + speed / 24) + (rand() - 0.5) * 1.3,
        1.1 + rand() * 2.2 + sp * 0.025,
        side.z * (1.2 + rand() * 2.4) * spread * (0.35 + speed / 24) + (rand() - 0.5) * 1.3,
        0.42 + rand() * 0.8 + powderAmount * 0.6,
        0.55 + rand() * 0.75,
        color,
      );
    }
  }

  skiSpray(point, velocity, intensity = 1) {
    const rand = this.rand;
    const n = Math.round(5 * intensity);
    for (let i = 0; i < n; i++) {
      this.spray.spawn(
        point.x + (rand() - 0.5) * 1.2,
        point.y + 0.08,
        point.z + (rand() - 0.5) * 1.2,
        (rand() - 0.5) * 2 + velocity.x * 0.08,
        0.4 + rand() * 1.8,
        (rand() - 0.5) * 2 + velocity.z * 0.08,
        0.5 + rand() * 1.3, 0.5 + rand() * 0.7, white,
      );
    }
  }

  burst(point, kind = 'snow', count = 24) {
    const rand = this.rand;
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const r = 1 + rand() * 4.5;
      const up = 1.4 + rand() * 4;
      let col = white;
      if (kind === 'gold') col = gold;
      if (kind === 'cyan') col = cyan;
      const pool = kind === 'snow' ? this.spray : this.spark;
      pool.spawn(
        point.x + (rand() - 0.5) * 0.8,
        point.y + 0.35,
        point.z + (rand() - 0.5) * 0.8,
        Math.cos(a) * r, up, Math.sin(a) * r,
        kind === 'snow' ? 0.8 + rand() * 1.4 : 0.35 + rand() * 0.6,
        kind === 'snow' ? 0.9 + rand() * 0.8 : 0.6 + rand() * 0.8,
        col,
      );
    }
  }

  update(dt) {
    this.spray.update(dt, -4.2, 1.9);
    this.spark.update(dt, -1.5, 2.6);
  }

  clear() {
    this.spray.clear();
    this.spark.clear();
  }
}

/* ═══════════════════════════════════════════════════════════════
   SKI TRACKS
   ═══════════════════════════════════════════════════════════════ */

export class SkiTracks {
  constructor(scene) {
    this.maxSegments = 900;
    this.steps = [];
    this.last = null;
    this.distance = 0;
    this.mesh = null;
    this.scene = scene;
    this.build();
    this.dirty = false;
  }

  build() {
    const max = this.maxSegments;
    const verts = max * 8; // two ribbons * 4 verts per segment
    const pos = new Float32Array(verts * 3);
    const birth = new Float32Array(verts);
    const edge = new Float32Array(verts);
    const idx = new Uint32Array(max * 12);
    for (let s = 0; s < max; s++) {
      const base = s * 8;
      for (let k = 0; k < 12; k++) {
        const tri = [[0,1,2],[1,3,2],[4,5,6],[5,7,6]][Math.floor(k / 3)];
        idx[s * 12 + k] = base + tri[k % 3];
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aBirth', new THREE.BufferAttribute(birth, 1));
    geo.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */`
        attribute float aBirth;
        attribute float aEdge;
        varying float vAlpha;
        varying float vEdge;
        uniform float uTime;
        void main() {
          float age = uTime - aBirth;
          float fade = 1.0 - smoothstep(55.0, 95.0, age);
          vAlpha = fade * (0.14 + 0.12 * (1.0 - aEdge));
          vEdge = aEdge;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        varying float vAlpha;
        varying float vEdge;
        void main() {
          vec3 col = mix(vec3(0.42,0.52,0.58), vec3(0.66,0.76,0.82), vEdge);
          gl_FragColor = vec4(col, vAlpha);
        }
      `,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.scene.add(this.mesh);
    this.geo = geo;
    this.posAttr = geo.attributes.position;
    this.birthAttr = geo.attributes.aBirth;
    this.edgeAttr = geo.attributes.aEdge;
    this.initialized = false;
  }

  addStep(left, right, heading, time, snowDepth = 0) {
    // left/right are the ski contact points at the snow surface
    const dirx = Math.sin(heading), dirz = Math.cos(heading);
    const nx = -dirz, nz = dirx;
    const w = 0.075;
    const pts = [
      { x: left.x, y: left.y + 0.055, z: left.z },
      { x: right.x, y: right.y + 0.055, z: right.z },
    ];
    if (!this.last) {
      this.last = pts;
      return;
    }
    for (let s = 0; s < 2; s++) {
      const a = this.last[s], b = pts[s];
      const cx = (a.x + b.x) * 0.5, cz = (a.z + b.z) * 0.5;
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const px = -dz / len * w, pz = dx / len * w;
      const i = this.steps.length % this.maxSegments;
      const base = i * 8 + s * 4;
      const P = this.posAttr.array;
      P[base * 3] = a.x + px; P[base * 3 + 1] = a.y; P[base * 3 + 2] = a.z + pz;
      P[(base + 1) * 3] = a.x - px; P[(base + 1) * 3 + 1] = a.y; P[(base + 1) * 3 + 2] = a.z - pz;
      P[(base + 2) * 3] = b.x + px; P[(base + 2) * 3 + 1] = b.y; P[(base + 2) * 3 + 2] = b.z + pz;
      P[(base + 3) * 3] = b.x - px; P[(base + 3) * 3 + 1] = b.y; P[(base + 3) * 3 + 2] = b.z - pz;
      const B = this.birthAttr.array;
      const E = this.edgeAttr.array;
      for (let k = 0; k < 4; k++) { B[base + k] = time; E[base + k] = k < 2 ? 0 : 1; }
    }
    this.last = pts;
    this.posAttr.needsUpdate = true;
    this.birthAttr.needsUpdate = true;
    this.edgeAttr.needsUpdate = true;
    this.steps.push({ time });
    if (this.steps.length > this.maxSegments) this.steps.shift();
    this.geo.setDrawRange(0, Math.min(this.maxSegments, this.steps.length) * 12);
    this.geo.attributes.position.updateRanges?.length;
  }

  breakTrack() {
    this.last = null;
  }

  clear() {
    this.last = null;
    this.steps.length = 0;
    this.geo.setDrawRange(0, 0);
    this.birthAttr.array.fill(0);
    this.birthAttr.needsUpdate = true;
  }

  update(time) {
    this.mesh.material.uniforms.uTime.value = time;
  }
}

/* ── Flags (used at summits / finish) ─────────────────────────── */

export function createFlag(color = 0xff6336, size = 1.3) {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.05, 4.2, 6),
    new THREE.MeshStandardMaterial({ color: 0x7e8b90, roughness: 0.5, metalness: 0.35 })
  );
  pole.position.y = 2.1;
  pole.castShadow = true;
  group.add(pole);
  const geo = new THREE.PlaneGeometry(size * 1.8, size, 16, 6);
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: 0.82, side: THREE.DoubleSide,
    emissive: new THREE.Color(color).multiplyScalar(0.08),
  });
  const flag = new THREE.Mesh(geo, mat);
  flag.position.set(size * 0.9, 3.55, 0);
  flag.castShadow = true;
  flag.userData.base = geo.attributes.position.array.slice();
  group.add(flag);
  group.userData.flag = flag;
  group.userData.t = Math.random() * 100;
  return group;
}
