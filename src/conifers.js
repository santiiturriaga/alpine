import * as THREE from 'three';
import { attachChaseFoliage } from './chase-foliage.js';
import { mulberry32 } from './util.js';
import { climateUniforms } from './climate-state.js';
import { coniferBarkMap } from './conifer-bark.js';
import { attachForestFade, forestQuality, forestDetailTiers } from './forest-lod.js';

const TAU = Math.PI * 2, ATLAS_SIZE = 2048, TILE = ATLAS_SIZE / 2, BARK_X = ATLAS_SIZE / 2 - 16;
const species = {
  fir: { seed: 1731, spread: .222, skirt: .075, taper: .82, color: 0xb0bbaa,
    drop: .16, fan: .34, pendant: .24, bend: .015 },
  spruce: { seed: 9811, spread: .182, skirt: .060, taper: .88, color: 0x9daea7,
    drop: .25, fan: .30, pendant: .32, bend: .010 },
  hemlock: { seed: 5431, spread: .248, skirt: .095, taper: .75, color: 0xb3bda8,
    drop: .28, fan: .38, pendant: .44, bend: .058 },
};
let needleAtlas, closeNeedleAtlas;

// Draw real branching twigs and their individual tapered needles once. The
// resulting atlas is completely generated from a seed, with no bitmap input.
// Texture alpha follows the needles and wood. At arm's length the same branch
// structure carries a separate illustration of its young growth and bare twigs.
function getNeedleAtlas() {
  if (needleAtlas) return needleAtlas;
  const pixels = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
  const detail = new Uint8Array(pixels.length);
  for (let i = 0; i < pixels.length; i += 4) {
    detail[i] = pixels[i] = 47;
    detail[i + 1] = pixels[i + 1] = 74;
    detail[i + 2] = pixels[i + 2] = 60;
  }
  function line(ax, ay, bx, by, radius, shade, opacity = 1, tipShade = shade, target = pixels) {
    const dx = bx - ax, dy = by - ay, ll = dx * dx + dy * dy || 1;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - radius - 1));
    const x1 = Math.min(ATLAS_SIZE - 1, Math.ceil(Math.max(ax, bx) + radius + 1));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - radius - 1));
    const y1 = Math.min(ATLAS_SIZE - 1, Math.ceil(Math.max(ay, by) + radius + 1));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / ll));
      const ox = x - ax - dx * t, oy = y - ay - dy * t;
      const extent = radius * (1 - t * .63) + (target === pixels ? .7 : .43);
      // Reject pixels outside the stroke before calculating exact coverage.
      const padded = extent + 1e-7;
      if (ox * ox + oy * oy > padded * padded) continue;
      const alpha = Math.max(0, Math.min(1, extent - Math.hypot(ox, oy))) * opacity;
      if (alpha <= 0) continue;
      const i = (y * ATLAS_SIZE + x) * 4, previous = target[i + 3] / 255;
      const combined = alpha + previous * (1 - alpha);
      for (let channel = 0; channel < 3; channel++) {
        const startColor = shade[channel], endColor = tipShade[channel];
        const color = startColor + (endColor - startColor) * t;
        target[i + channel] = (color * alpha + target[i + channel] * previous * (1 - alpha)) / combined;
      }
      target[i + 3] = combined * 255;
    }
  }
  for (let tile = 0; tile < 4; tile++) {
    const rand = mulberry32(81731 + tile * 1637), ox = tile % 2 * TILE, oy = Math.floor(tile / 2) * TILE;
    const closeRand = mulberry32(67291 + tile * 2971);
    function closeSpray(ax, ay, bx, by, depth, width) {
      const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy);
      if (length < 1) return;
      const ux = dx / length, uy = dy / length;
      const spread = (.45 + closeRand() * .85) * (tile % 2 ? 1.04 : .86);
      for (let d = depth === 2 ? 22 : 5; d < length - 1; d += 4 + closeRand() * 11) {
        const leaves = 2 + Math.floor(closeRand() * 4);
        const tuft = .63 + closeRand() * .72;
        const frosted = tile >= 2 && closeRand() < .09;
        for (let i = 0; i < leaves; i++) {
          const along = Math.min(length - .4, d + (closeRand() - .5) * 6);
          const side = closeRand() < .5 ? -1 : 1;
          const opening = (.36 + closeRand() * .74) * spread;
          const reach = (5 + closeRand() * 8) * tuft * (1 - .34 * (along / length) ** 4);
          const up = (closeRand() * .98 - .18) * reach, out = side * opening * reach;
          const x = ax + ux * along, y = ay + uy * along;
          const mx = x + ux * up * .42 - uy * out * .58, my = y + uy * up * .42 + ux * out * .58;
          const endX = x + ux * (up + reach * .14) - uy * out, endY = y + uy * (up + reach * .14) + ux * out;
          const tint = closeRand() * 37, needleWidth = .40 + closeRand() * .35;
          const base = [21 + tint, 44 + tint, 25 + tint * .80];
          const middle = [35 + tint, 65 + tint, 34 + tint * .80];
          const tip = frosted ? [136, 153, 139] : [50 + tint, 80 + tint, 38 + tint * .80];
          line(x, y, mx, my, needleWidth, base, 1, middle, detail);
          line(mx, my, endX, endY, needleWidth * .81, middle, 1, tip, detail);
        }
        if (depth === 0 && d > length * .24 && closeRand() < .21) {
          const side = closeRand() < .5 ? -1 : 1, reach = 9 + closeRand() * 16;
          const x = ax + ux * d, y = ay + uy * d;
          closeSpray(x, y, x + (ux * .65 - uy * side * .72) * reach,
            y + (uy * .65 + ux * side * .72) * reach, -1, width * .57);
        }
      }
      line(ax, ay, bx, by, Math.max(.45, width * .55), [76, 63, 42], 1, [115, 107, 67], detail);
    }
    function branch(ax, ay, bx, by, depth, width) {
      const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy), ux = dx / length, uy = dy / length;
      const needleCount = Math.ceil(length / 1.05);
      for (let i = 1; i < needleCount; i++) {
        const t = (i + rand() * .65) / needleCount;
        for (const side of [-1, 1]) {
          const reach = (4 + rand() * 6) * (depth === 0 ? 1 : .88) * (1 - .44 * t ** 4);
          const forward = .20 + rand() * .34, spread = .73 + rand() * .24;
          const x = ax + dx * t, y = ay + dy * t;
          const variation = rand() * 20 + Math.sin(t * 21 + tile * 5) * 7;
          line(x, y, x + (ux * forward - uy * side * spread) * reach,
            y + (uy * forward + ux * side * spread) * reach, 1.20 + rand() * .64,
            [27 + variation, 49 + variation, 38 + variation], 1,
            [46 + variation, 76 + variation, 58 + variation]);
        }
      }
      const count = depth === 2 ? 13 : 5;
      if (depth > 0) for (let i = 0; i < count; i++) {
        for (const side of [-1, 1]) {
          const t = .10 + i / count * .82 + rand() * (.35 / count);
          if (rand() < (depth === 2 ? .11 : .20)) continue;
          const reach = length * (depth === 2 ? .51 : .41) * Math.pow(1 - t, .65) * (.75 + rand() * .44);
          const forward = .47 + rand() * .20, spread = .73 + rand() * .15;
          const x = ax + dx * t, y = ay + dy * t;
          branch(x, y, x + (ux * forward - uy * side * spread) * reach,
            y + (uy * forward + ux * side * spread) * reach, depth - 1, width * .54);
        }
      }
      line(ax, ay, bx, by, width, [82, 69, 49], 1, [76, 88, 58]);
      closeSpray(ax, ay, bx, by, depth, width);
    }
    branch(ox + TILE * .50, oy + TILE * .94, ox + TILE * (.46 + rand() * .07), oy + TILE * .075, 2, 3.2);
  }
  // Narrow bark strip and white snow swatch sit outside all foliage UVs.
  for (let y = 0; y < ATLAS_SIZE; y++) for (let x = 0; x < 32; x++) {
    const i = (y * ATLAS_SIZE + BARK_X + x) * 4;
    const grain = Math.sin(x * 1.71 + Math.sin(y * .021 + x) * .65) * 12
      + Math.sin(x * 7.11 + y * .12) * 5 + Math.sin(y * .73 + x * 1.7) * 6
      - Math.pow(Math.max(0, Math.sin(x * 1.71 + Math.sin(y * .021 + x) * .65)), 10) * 34;
    pixels[i] = 147 + grain; pixels[i + 1] = 133 + grain; pixels[i + 2] = 114 + grain;
    pixels[i + 3] = 255;
  }
  for (let y = 0; y < 16; y++) for (let x = ATLAS_SIZE - 64; x < ATLAS_SIZE; x++) {
    const i = (y * ATLAS_SIZE + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = pixels[i + 3] = 255;
  }
  needleAtlas = foliageTexture(pixels);
  closeNeedleAtlas = foliageTexture(detail);
  return needleAtlas;
}

function foliageTexture(pixels) {
  const atlas = new THREE.DataTexture(pixels, ATLAS_SIZE, ATLAS_SIZE, THREE.RGBAFormat);
  // Alpha-weighted RGB avoids white/black transparent texels contaminating
  // distant needles. Ordinary box-filtered color mips made whole mountains
  // glitter pale even where the actual branch texels were dark green.
  const mipmaps = [{ data: pixels, width: ATLAS_SIZE, height: ATLAS_SIZE }];
  let previous = pixels, previousSize = ATLAS_SIZE;
  while (previousSize > 1) {
    const size = previousSize / 2, data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let alpha = 0, red = 0, green = 0, blue = 0;
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
        const k = ((y * 2 + j) * previousSize + x * 2 + i) * 4, a = previous[k + 3];
        alpha += a;
        red += previous[k] * a;
        green += previous[k + 1] * a;
        blue += previous[k + 2] * a;
      }
      const k = (y * size + x) * 4;
      data[k] = alpha ? red / alpha : 47;
      data[k + 1] = alpha ? green / alpha : 74;
      data[k + 2] = alpha ? blue / alpha : 60;
      data[k + 3] = alpha / 4;
    }
    mipmaps.push({ data, width: size, height: size }); previous = data; previousSize = size;
  }
  atlas.mipmaps = mipmaps;
  atlas.generateMipmaps = false;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  atlas.magFilter = THREE.LinearFilter;
  atlas.anisotropy = 8;
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.needsUpdate = true;
  return atlas;
}

// -2 is the closed distant silhouette; -1 is the permanent regional parent;
// -.5 adds only its base crown detail.
// 0 combines those for standalone trees. 1 and 2 are further additive tiers.
// Use the same variant on every tier to preserve all branch attachments.
const treeTemplates = new Map();

export function coniferGeometry(kind, detail = 0, variant = 0) {
  // Trees of this species, detail level and seed have identical mesh data.
  // Each stand keeps its own placement, colour and visibility.
  const key = `${kind}/${detail}/${variant}`;
  if (!treeTemplates.has(key)) treeTemplates.set(key, buildConifer(kind, detail, variant));
  return treeTemplates.get(key);
}

function buildConifer(kind, detail, variant) {
  const spec = species[kind] || species.fir, rand = mulberry32(spec.seed + variant * 7919);
  const positions = [], normals = [], colors = [], anchors = [], uvs = [], deposits = [], indices = [];
  const vertices = new WeakMap();
  let snowCenter = null;
  const terminalShoots = [];
  const green = new THREE.Color(spec.color), snow = new THREE.Color(0xe8eff0);
  const snowShade = new THREE.Color(0xb5cbd4), bark = new THREE.Color(0xc1b49e);
  const normalize = (v) => { const d = Math.hypot(...v) || 1; return v.map((x) => x / d); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const trunk = (y) => [spec.bend * Math.pow(y, 3.7) * Math.sin(y * 2.1), y,
    spec.bend * .42 * y * y * Math.sin(y * 4.5)];
  function vertex(p, n, c, uv = [.993, .007], anchor) {
    const existing = vertices.get(p);
    if (existing !== undefined) { indices.push(existing); return; }
    const index = positions.length / 3;
    vertices.set(p,index);
    indices.push(index);
    positions.push(...p); normals.push(...n); colors.push(c.r, c.g, c.b);
    anchors.push(...(anchor || p)); uvs.push(...uv);
    deposits.push(...(snowCenter || [0,0,0]));
  }
  function tri(a, b, c, na, nb, nc, ca, cb = ca, cc = ca, ua, ub, uc, anchor) {
    vertex(a, na, ca, ua, anchor); vertex(b, nb, cb, ub, anchor); vertex(c, nc, cc, uc, anchor);
  }
  function barkUV(fraction, height) {
    return [(BARK_X + 2 + fraction * 28) / ATLAS_SIZE, .02 + height * .96];
  }
  function tube(a, b, radius, anchor, sides = 3, color = bark, endRadius = radius * .28, cap = false) {
    const axis = normalize(b.map((v, i) => v - a[i]));
    let across = normalize(cross(axis, [0, 1, 0]));
    if (Math.hypot(...across) < .1) across = [1, 0, 0];
    const up = normalize(cross(axis, across));
    const length = Math.hypot(...b.map((v,i)=>v-a[i]));
    const ring = Array.from({length:sides+1}, (_, i) => {
      const angle = i/sides*TAU, cos = Math.cos(angle), sin = Math.sin(angle);
      const n = across.map((v,j)=>v*cos + up[j]*sin);
      return { n, a: a.map((v,j)=>v+n[j]*radius), b: b.map((v,j)=>v+n[j]*endRadius) };
    });
    const end = cap ? [...b] : null;
    const heart = cap ? new THREE.Color(0xe0b47d) : null;
    const endUV = i => {
      const angle = i/sides*TAU;
      return [barkUV(.5 + Math.cos(angle)*.45,0)[0], 1.55 + Math.sin(angle)*.45];
    };
    for (let i = 0; i < sides; i++) {
      const p = ring[i], q = ring[i+1];
      const ua = barkUV(i/sides,a[1]), va = barkUV((i+1)/sides,a[1]);
      const ub = barkUV(i/sides,a[1]+length), vb = barkUV((i+1)/sides,a[1]+length);
      tri(p.a, q.a, p.b, p.n, q.n, p.n, color, color, color, ua, va, ub, anchor);
      tri(q.a, q.b, p.b, q.n, q.n, p.n, color, color, color, va, vb, ub, anchor);
      if (cap) tri(end,[...p.b],[...q.b],axis,axis,axis,heart,color,color,[barkUV(.5,0)[0],1.55],
        endUV(i),endUV(i+1),anchor);
    }
  }

  function oldGrowthTrunk(anchor) {
    const heights = [-.042,-.013,-.003,.008,.019,.037,.061,.092,.17,.30,.46,.65,.82,1];
    const sides = 22;
    const roots = [.06,1.29,2.71,4.04,5.29].map((a, i) => ({
      angle: a + variant * .41 + spec.seed * .001,
      spread: .20 + .06 * Math.sin(i * 2.9 + spec.seed),
      length: .010 + .021 * (.5 + .5 * Math.sin(i * 4.1 + variant * 1.8 + spec.seed)),
    }));
    function trunkPoint(y, a) {
      const center = trunk(Math.max(0, y));
      const barkEdge = .94 + .062 * Math.sin(5*a + variant) + .065 * Math.sin(9*a + y*22);
      const radius = .0089 * (1 - Math.min(y, 1)) ** .76 + .00043;
      const rootGrowth = Math.exp(-Math.max(y, -.014) * 76);
      let flare = .0012 * rootGrowth;
      if (y < .085) for (const root of roots) {
        const sweep = .35 * Math.sin(root.angle) * (1 - Math.exp(-Math.max(0, .025 - y) * 31));
        const delta = 1 - Math.cos(a - root.angle - sweep);
        flare += root.length * .56 * Math.exp(-delta / (root.spread ** 2)) * rootGrowth;
      }
      const r = radius * barkEdge + flare;
      return [center[0] + Math.cos(a) * r,y,center[2] + Math.sin(a) * r];
    }
    const rings = heights.map(y => {
      return Array.from({length:sides+1},(_,i)=>{
        const a = i/sides*TAU;
        const p = trunkPoint(y, a);
        const previous = trunkPoint(y, a - .045), below = trunkPoint(y - .001, a);
        const around = trunkPoint(y, a + .045).map((v,j)=>v - previous[j]);
        const up = trunkPoint(y + .001, a).map((v,j)=>v - below[j]);
        const n = normalize(cross(up, around));
        return { p,n,
          color:bark.clone().multiplyScalar(.70 + y*.18 + .058*Math.sin(a*3 + y*18)),
          uv:barkUV(i/sides,y) };
      });
    });
    for (let row = 0; row < heights.length-1; row++) for (let i = 0; i < sides; i++) {
      const a = rings[row][i], b = rings[row][i+1], c = rings[row+1][i], d = rings[row+1][i+1];
      tri(a.p,c.p,b.p,a.n,c.n,b.n,a.color,c.color,b.color,a.uv,c.uv,b.uv,anchor);
      tri(b.p,c.p,d.p,b.n,c.n,d.n,b.color,c.color,d.color,b.uv,c.uv,d.uv,anchor);
    }
    for (let i=0; i<5; i++) {
      const angle = i*2.39996 + variant*1.31;
      const y = .033 + i*.016 + .013*Math.sin(angle*7);
      const a = trunk(y), reach = .012 + .005*Math.cos(angle*9);
      const b = [a[0]+Math.cos(angle)*reach,y+.003+reach*.18,a[2]+Math.sin(angle)*reach];
      tube(a,b,.0031,anchor,7,bark,.0019,true);
    }
  }

  // Branch patches bend lengthwise and fold across their axis. Their roll and
  // hanging endpoints give the canopy volume in every viewing direction.
  function foliage(root, yaw, length, width, drop, roll, phase, anchor, coarse = false) {
    const ux = Math.cos(yaw), uz = Math.sin(yaw), vx = -uz, vz = ux;
    const tile = Math.abs(Math.floor(phase * 3.7)) % 4;
    const rows = coarse ? 1 : 2, cols = coarse ? 1 : 2;
    const grid = [];
    for (let row = 0; row <= rows; row++) {
      const t = row / rows, line = [];
      for (let col = 0; col <= cols; col++) {
        const s = col / cols * 2 - 1;
        const bow = Math.sin(t * Math.PI), rollSin = Math.sin(roll), rollCos = Math.cos(roll);
        const lateral = width * s * (.80 + .22 * bow - .32 * t * t);
        const sag = -drop * t * t + length * (.098 * bow + .039 * t ** 6);
        const fold = s * s * width * .21;
        const p = [root[0] + ux * length * t + vx * lateral * Math.cos(roll),
          root[1] + sag + lateral * Math.sin(roll) - fold,
          root[2] + uz * length * t + vz * lateral * Math.cos(roll)];
        const pitch = 2 * drop / Math.max(length, .001) * t - .308 * Math.cos(t * Math.PI) - .234 * t ** 5;
        const sideSlope = -rollSin + rollCos * s * .32;
        const n = normalize([vx * sideSlope + ux * pitch, rollCos, vz * sideSlope + uz * pitch]);
        const uv = [(tile % 2 + .50 + s * .43) * .5, (Math.floor(tile / 2) + .94 - t * .87) * .5];
        const color = green.clone().multiplyScalar(.64 + .27 * t + Math.sin(phase) * .09);
        line.push({ p, n, uv, color });
      }
      grid.push(line);
    }
    if (!coarse) {
      const center = grid[1][1];
      const corners = [grid[0][0], grid[0][2], grid[2][2], grid[2][0]];
      for (let i = 0; i < 4; i++) {
        const a = corners[i], b = corners[(i + 1) % 4];
        tri(center.p, a.p, b.p, center.n, a.n, b.n, center.color, a.color, b.color,
          center.uv, a.uv, b.uv, anchor);
      }
    } else for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const a = grid[row][col], b = grid[row + 1][col], c = grid[row][col + 1], d = grid[row + 1][col + 1];
      tri(a.p, c.p, b.p, a.n, c.n, b.n, a.color, c.color, b.color, a.uv, c.uv, b.uv, anchor);
      tri(c.p, d.p, b.p, c.n, d.n, b.n, c.color, d.color, b.color, c.uv, d.uv, b.uv, anchor);
    }
  }
  function pillow(center, yaw, length, width, phase, anchor, coarse = false) {
    const ux=Math.cos(yaw),uz=Math.sin(yaw),vx=-uz,vz=ux;
    // A deposit follows the loaded bough: a long narrow cap, with a compact
    // hanging lip rather than a round white block over the fine twig work.
    length*=1.02; width*=.62;
    const near = detail === -.5 || detail === 0;
    const sides = coarse ? (near ? 7 : 5) : 9;
    const segments = coarse ? (near ? 5 : 3) : 7;
    anchor=anchor||center;
    snowCenter=center;
    const rings=[];
    // Rounded hanging capsules follow the bough. Several unequal lobes and a
    // rolled lip keep their silhouette soft even against a bright snowfield.
    for(let k=0;k<=segments;k++) {
      const t=k/segments*2-1,profile=Math.sqrt(Math.max(0,1-t*t))*(1-.21*t);
      const bulge=.91+.16*Math.sin(t*4.3+phase)+.12*Math.sin(t*9.7-phase);
      const sweep = width * .22 * Math.sin(t*3.3+phase);
      const ring=[];
      for(let i=0;i<sides;i++) {
        const a=i/sides*TAU,side=Math.cos(a),up=Math.sin(a);
        const scallop = .91 + .09*Math.cos(a*3 + t*3.4+phase);
        const height = width * (up>0 ? .66 : .26);
        const lateral = side*width*profile*bulge*scallop + sweep;
        const lift = profile * (up*height*bulge*scallop + side*width*.12*Math.sin(t*4.7+phase));
        const p=[center[0]+ux*t*length+vx*lateral,
          center[1]-t*length*.22+lift+width*.14*Math.sin(t*5.5+phase),
          center[2]+uz*t*length+vz*lateral];
        const n=normalize([ux*t*width/Math.max(length,.0001)+vx*side,
          up*(up>0?1.20:1.8),uz*t*width/Math.max(length,.0001)+vz*side]);
        const c=snow.clone().lerp(snowShade,.06 + Math.max(0,-up)*.85+.04*(1-side));
        ring.push({p,n,c});
      }
      rings.push(ring);
    }
    for(let k=0;k<segments;k++)for(let i=0;i<sides;i++) {
      const j=(i+1)%sides,a=rings[k][i],b=rings[k][j],c=rings[k+1][i],d=rings[k+1][j];
      if(k>0) tri(a.p,c.p,b.p,a.n,c.n,b.n,a.c,c.c,b.c,undefined,undefined,undefined,anchor);
      if(k<segments-1) tri(b.p,c.p,d.p,b.n,c.n,d.n,b.c,c.c,d.c,undefined,undefined,undefined,anchor);
    }
    snowCenter=null;
  }

  function finish() {
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(indices);
    for (const [name, values, size] of [['position',positions,3],['normal',normals,3],
      ['color',colors,3],['uv',uvs,2],['branchAnchor',anchors,3],['snowCenter',deposits,3]]) {
      geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, size));
    }
    geometry.computeBoundingSphere();
    geometry.userData.coniferTier = detail;
    geometry.userData.terminalShoots = terminalShoots;
    return geometry;
  }

  // Only the distant fallback uses a closed crown. At branch-viewing range,
  // all foliage is cut out along actual sprays and the trunk remains exposed.
  if (detail === -2) {
    const levels = 4, radial = 2;
    const coreGreen = green.clone().multiplyScalar(.17);
    const solid = [.971,.004];
    for (let k=0;k<levels;k++) for(let j=0;j<radial;j++) {
      const phase = k*2.39996+j*2.17+variant*3.7;
      const t=(k+.22+.19*Math.sin(phase*1.7))/levels;
      const y=spec.skirt+(1-Math.pow(1-t,1.15))*(.995-spec.skirt);
      const root=trunk(y), yaw=j/radial*TAU+k*2.39996+Math.sin(phase)*.31;
      const ux=Math.cos(yaw),uz=Math.sin(yaw),vx=-uz,vz=ux;
      const length=spec.spread*Math.pow(1-y,spec.taper)*(.89+.14*Math.sin(phase*2.1));
      const width=length*(.36+.10*Math.cos(phase*1.4));
      const drop=length*(.22+spec.pendant*.49+.08*Math.sin(phase*1.3));
      const point=(along,across,lift)=>[root[0]+ux*length*along+vx*width*across,
        root[1]+length*lift,root[2]+uz*length*along+vz*width*across];
      const p=[point(-.09,0,.04),point(.46,-1,-.12),point(1,0,-drop/length),point(.51,1,-.07),
        point(.40,0,.095),point(.51,0,-.22)];
      const n=[normalize([-ux*.5,.3,-uz*.5]),normalize([-vx,.24,-vz]),
        normalize([ux,-.24,uz]),normalize([vx,.26,vz]),[0,1,0],[0,-1,0]];
      const c=p.map((_,i)=>coreGreen.clone().multiplyScalar([.72,.87,.67,1.05,1.12,.55][i]
        +Math.sin(phase)*.13));
      // Eight outward faces make an asymmetric, rounded-looking hanging bough
      // under smooth normals, rather than another transverse canopy slice.
      const center=p[0].map((_,i)=>p.reduce((s,v)=>s+v[i],0)/p.length);
      for(let [a,b,d] of [[0,1,4],[0,4,3],[0,3,5],[0,5,1],[2,4,1],[2,3,4],[2,5,3],[2,1,5]]) {
        const faceNormal=cross(p[b].map((v,i)=>v-p[a][i]),p[d].map((v,i)=>v-p[a][i]));
        if(faceNormal.reduce((s,v,i)=>s+v*(p[a][i]-center[i]),0)<0)[b,d]=[d,b];
        tri(p[a],p[b],p[d],n[a],n[b],n[d],c[a],c[b],c[d],solid,solid,solid);
      }
    }
    const rings=[];
    for(let k=0;k<=6;k++) {
      const y=spec.skirt+.01+(k/6)*(.985-spec.skirt),root=trunk(y),ring=[];
      for(let j=0;j<4;j++) {
        const a=j/4*TAU+.15*Math.sin(k*1.9+variant);
        const r=spec.spread*Math.pow(1-y,spec.taper)*(.36+.13*Math.sin(k*2.7+j*1.9+variant));
        ring.push({p:[root[0]+Math.cos(a)*r,y+Math.sin(k*2+j*1.7)*r*.5,root[2]+Math.sin(a)*r],
          n:normalize([Math.cos(a),.22,Math.sin(a)])});
      }
      rings.push(ring);
    }
    const heart=coreGreen.clone().multiplyScalar(.66);
    for(let k=0;k<6;k++)for(let j=0;j<4;j++) {
      const a=rings[k][j],b=rings[k][(j+1)%4],c=rings[k+1][j],d=rings[k+1][(j+1)%4];
      tri(a.p,c.p,b.p,a.n,c.n,b.n,heart,heart,heart,solid,solid,solid);
      tri(b.p,c.p,d.p,b.n,c.n,d.n,heart,heart,heart,solid,solid,solid);
    }
    tube([0,-.095,0], trunk(spec.skirt+.085), .0087, null, 4, bark, .0046);
    return finish();
  }

  if (detail === -1 || detail === 0) {
    const segments = 3;
    for (let i = 0; i < segments; i++) {
      const y = i / segments;
      tube(i === 0 ? [0,-.095,0] : trunk(y), trunk((i + 1) / segments), .008 * (1 - y) + .0004, null, 3,
        bark.clone().multiplyScalar(.65 + y * .33), .008 * (1 - (i + 1) / segments) + .0004);
    }
  }
  if (detail === -.5 || detail === 0) oldGrowthTrunk(detail === -.5 ? trunk(.5) : null);
  // More, irregularly interleaved levels give continuous vertical coverage.
  const branches = [];
  for (let tier = 0; tier < 18; tier++) {
    const t = tier / 18;
    const y = spec.skirt + (1 - Math.pow(1 - t, 1.37)) * (.992 - spec.skirt);
    for (let radial = 0; radial < 5; radial++) {
      const yaw = radial / 5 * TAU + tier * 2.39996 + (rand() - .5) * .43;
      const root = trunk(y + (rand() - .5) * .032);
      const length = spec.spread * Math.pow(1 - y, spec.taper) * (.86 + rand() * .29);
      const drop = length * spec.drop * (.78 + rand() * .60), phase = rand() * TAU;
      const at = (f) => [root[0] + Math.cos(yaw) * length * f,
        root[1] + length * .04 * Math.sin(f * Math.PI) - drop * f * f,
        root[2] + Math.sin(yaw) * length * f];
      branches.push({ tier, radial, yaw, root, length, drop, phase, at });
    }
  }
  for (const { tier, radial, yaw, root, length, drop, phase, at } of branches) {
    const permanent = tier % 2 === 0 && radial < 4 && !(tier % 6 === 4 && radial === 3);
    const innerSpray = !permanent && (tier + 2 * radial) % 3 === 0;
    if ((permanent || innerSpray) && (detail === -1 || detail === 0)) {
      const reach = length * (permanent ? 1 : .74);
      foliage(root, yaw, reach, reach * spec.fan * 1.06, drop + reach * .10,
        Math.sin(phase) * .95, phase, null, true);
      foliage(at(.25), yaw + .13, reach * .66, reach * .25, reach * .44,
        1.15 + Math.sin(phase) * .2, phase + 1.3, null, true);
      if (permanent && (tier + radial) % 3 === 0) {
        const p = at(.43); p[1] += length*.035;
        pillow(p,yaw,length*(.32+.06*Math.sin(phase)),length*(.145+.045*Math.cos(phase)),phase,null,true);
      }
    }
    if (detail === -1) continue;
    if (detail === 0 || detail === -.5) {
      const anchor = detail === -.5 ? root : null;
      tube(root, at(.88), length * .007, anchor, 3);
      foliage(permanent ? at(.10) : root, yaw + (permanent ? Math.sin(phase) * .24 : 0),
        length * (permanent ? .86 : 1), length * spec.fan, drop + length * .08,
        Math.sin(phase) * .95, phase + (permanent ? 2.4 : 0), anchor);
      // Hanging curtains overlap the next level and obscure the inner trunk.
      foliage(at(.24), yaw + Math.sin(phase) * .28, length * .71, length * .24,
        length * spec.pendant, 1.12 + Math.sin(phase + 1) * .24, phase + 1.7, anchor);
      if ((tier + radial) % 3 === 0 || Math.sin(phase*1.7)>.77) {
        const p = at(.45 + .11 * Math.sin(phase));
        p[1] += length * .037;
        pillow(p, yaw, length * (.29 + Math.sin(phase) * .065), length * (.16 + Math.cos(phase * 1.7) * .045), phase, anchor, detail===-.5);
        if (tier>8 && radial%2===0) {
          const q=at(.21); q[1]+=length*.05;
          pillow(q,yaw+.35,length*.24,length*.14,phase+1.6,anchor,detail===-.5);
        }
      }
    }
    if (detail === 1) for (let j = 0; j < 2; j++) {
      const f = .27 + j * .29, side = (radial + j) % 2 ? -1 : 1;
      const origin = at(f), bearing = yaw + side * (.65 + Math.sin(phase + j) * .18);
      const reach = length * (.51 - j * .11), pendant = reach * (.30 + spec.pendant);
      const tip = [origin[0] + Math.cos(bearing) * reach, origin[1] - pendant,
        origin[2] + Math.sin(bearing) * reach];
      tube(origin, tip, length * .0035, origin, 3);
      foliage(origin, bearing, reach, reach * .34, pendant,
        side * (.42 + Math.sin(phase) * .27), phase + j * 2.9, origin);
    }
    if (detail === 2) for (let j = 0; j < 4; j++) {
      const f = .22 + j * .17, side = (radial + j) % 2 ? -1 : 1;
      const origin = at(f), bearing = yaw + side * (.73 + Math.sin(phase + j) * .24);
      const reach = length * (.34 - j * .035), pendant = reach * (.45 + spec.pendant);
      const tip = [origin[0] + Math.cos(bearing) * reach, origin[1] - pendant,
        origin[2] + Math.sin(bearing) * reach];
      tube(origin, tip, length * .0019, origin, 3);
      terminalShoots.push({ start: mix(origin, tip, .61), end: [...tip] });
      if ((tier + radial + j) % 2 === 0) {
        const fork = mix(origin,tip,.81);
        const lateralReach = reach*.18;
        const forkBearing = bearing + side*(.73 + .18*Math.sin(phase));
        terminalShoots.push({start:fork, end:[
          fork[0] + Math.cos(forkBearing)*lateralReach,
          fork[1] - lateralReach*.23,
          fork[2] + Math.sin(forkBearing)*lateralReach,
        ]});
      }
      for (let k = 0; k < 2; k++) {
        const f = .29 + k * .27 + .11 * Math.sin(phase*2 + k*4 + j);
        const fork = mix(origin,tip,f);
        const shortSide = k === 0 ? -side : side;
        const bearingOffset = shortSide * (.43 + .30 * Math.sin(phase + 1.6*j + k*3));
        const shortReach = reach*(.17 + .07*Math.sin(phase - j*2 + k*4));
        terminalShoots.push({start:fork, inner:true, end:[
          fork[0] + Math.cos(bearing+bearingOffset)*shortReach,
          fork[1] - shortReach*(.07 + .22*Math.sin(phase+k*3)),
          fork[2] + Math.sin(bearing+bearingOffset)*shortReach,
        ]});
      }
      foliage(origin, bearing, reach, reach * .30, pendant, side * .71, phase + j * 2.1, origin);
      foliage(mix(origin, tip, .34), bearing + side * .36, reach * .71, reach * .20,
        reach * .33, -side * .64, phase + j * 2.1 + 1.4, origin);
    }
  }
  return finish();
}

const snowDeposition = (regional = false) => `
  float snowVertex = step(.988, uv.x);
  float deposition = smoothstep(snowline-180.0, snowline+410.0, forestOrigin.y)
    * snowpack * (.78+.22*sin(forestOrigin.x*.037+forestOrigin.z*.021));
  float crownRime = deposition*smoothstep(${regional ? '1110.0,1580.0' : '1370.0,1820.0'},forestOrigin.y);
  float stormTree = smoothstep(.31,.94,.5+.5*sin(forestOrigin.x*.057 + forestOrigin.z*.033));
  float snowLoad = deposition * mix(.44,.83 + .16*stormTree,crownRime);
  transformed = mix(transformed, snowCenter + (transformed-snowCenter)*snowLoad, snowVertex);
`;

export function coniferDepthMaterial() {
  const material = new THREE.MeshDepthMaterial({
    map: getNeedleAtlas(), depthPacking: THREE.RGBADepthPacking,
    alphaTest: .18, side: THREE.DoubleSide,
  });
  material.onBeforeCompile = shader => {
    shader.uniforms.snowline = climateUniforms.snowline;
    shader.uniforms.snowpack = climateUniforms.snowpack;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute vec3 snowCenter;
      uniform float snowline;
      uniform float snowpack;
    `).replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 forestOrigin = modelMatrix * instanceMatrix * vec4(0.,0.,0.,1.);
      ${snowDeposition()}
    `);
  };
  material.customProgramCacheKey = () => 'conifer-cutout-depth';
  return material;
}

export function coniferMaterial(level = 0, region = null) {
  const detailTier = forestDetailTiers[level];
  const material = level === -2
    ? new THREE.MeshLambertMaterial({ vertexColors: true, map: getNeedleAtlas() })
    : new THREE.MeshStandardMaterial({ vertexColors: true, map: getNeedleAtlas(),
    side: THREE.DoubleSide, roughness: .99, alphaTest: .12, alphaToCoverage: true,
    emissive: 0x1b2a21, emissiveIntensity: .11, envMapIntensity: .58 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.snowpack = climateUniforms.snowpack;
    shader.uniforms.snowline = climateUniforms.snowline;
    shader.uniforms.forestDetail = forestQuality.detail;
    if (level !== -2) {
      shader.uniforms.barkRelief = { value: coniferBarkMap() };
      shader.uniforms.closeNeedles = { value: closeNeedleAtlas };
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        float patchDistance = length(vViewPosition);
        vec2 du = dFdx(vMapUv), dv = dFdy(vMapUv);
        float closeCoverage = 0.0;
        vec4 foliage = vec4(1.);
        if (vMapUv.x < .988) {
          foliage = textureGrad(map,vMapUv,du,dv);
          closeCoverage = 1.0 - smoothstep(1.8,6.0,patchDistance);
          if (closeCoverage > 0.0 && abs(vMapUv.x - .5) >= .017) {
            vec4 individualNeedles = textureGrad(closeNeedles,vMapUv,du,dv);
            float coverage = mix(foliage.a,individualNeedles.a,closeCoverage);
            foliage.rgb = mix(foliage.rgb*foliage.a,individualNeedles.rgb*individualNeedles.a,closeCoverage)
              / max(coverage,.001);
            foliage.a = coverage;
          }
        }
        diffuseColor *= foliage;
      `);
    }
    // Retain green needle detail under boughs, including in overcast light.
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying float crownDistance;
      varying float crownSnow;
      varying vec4 crownShape;
      ${level === -2 ? '' : `uniform sampler2D barkRelief;
        uniform sampler2D closeNeedles;
        uniform float snowpack;
        uniform float snowline;
        varying float crownBaseAltitude;`}
    `).replace('#include <color_fragment>', `#include <color_fragment>
      float barkSurface = 1.0 - step(.017, abs(vMapUv.x - .5));
      ${level === -2 ? '' : `
      vec2 woodSlope = vec2(0.);
      float snowCrust = 0.0;
      if (barkSurface > .5) {
        float barkU = (vMapUv.x - ${(BARK_X + 2) / ATLAS_SIZE}) * ${ATLAS_SIZE / 28};
        if (vMapUv.y > 1.0) {
          vec2 p = vec2(barkU - .47,vMapUv.y - 1.58);
          float grain = length(p) + sin(p.x*19. + p.y*24.)*.013;
          float ring = smoothstep(.61,.96,.5+.5*sin(grain*114.));
          diffuseColor.rgb *= mix(vec3(1.22,.87,.53),vec3(.70,.44,.23),ring);
        } else {
          vec2 barkUV = vec2(barkU,vMapUv.y * 36.0 + crownShape.w);
          vec3 sampleBark = texture2D(barkRelief,barkUV).rgb;
          float plate = smoothstep(.17,.69,sampleBark.r);
          vec3 wood = mix(vec3(.16,.115,.087),vec3(.87,.72,.59),plate);
          woodSlope = sampleBark.gb * 2. - 1.;
          float closeWood = 1.0 - smoothstep(9.0,26.0,patchDistance);
          if (closeWood > 0.) {
            vec2 grainScale = vec2(3.37,4.71);
            vec2 grainUV = barkUV*grainScale+vec2(.27,.61);
            vec2 barkGradient = vec2(${ATLAS_SIZE / 28},36.)*grainScale;
            vec3 fibre = textureGrad(barkRelief,grainUV,du*barkGradient,dv*barkGradient).rgb;
            vec3 wornBark = mix(vec3(.19,.175,.16),vec3(.71,.71,.67),plate);
            wornBark *= .58+.79*fibre.r;
            wood = mix(wood,wornBark,closeWood*.9);
            woodSlope = mix(woodSlope,woodSlope*.48 + (fibre.gb*2.0-1.0)*.65,closeWood);
            diffuseColor.rgb *= mix(vec3(1.),vec3(.87,1.0,1.17),closeWood);
            float edge = crownShape.y + (fibre.r-.43)*.009
              + sin(barkU*37.7+crownShape.w)*.003;
            float ground = 1.0 - smoothstep(-.008,.009,edge);
            float flakes = smoothstep(.42,.69,fibre.r*.69+sampleBark.r*.42+ground*.21);
            float settled = smoothstep(snowline-210.,snowline+55.,crownBaseAltitude)*snowpack;
            snowCrust = ground*flakes*settled*closeWood*.74;
            wood *= 1.0 - ground*.22*closeWood;
          }
          float crownShade = smoothstep(.065,.20,crownShape.y)
            * (1.0 - smoothstep(.86,.99,crownShape.y));
          diffuseColor.rgb *= wood * (1.72 - .45*crownShade);
          diffuseColor.rgb = mix(diffuseColor.rgb,vec3(.58,.66,.70),snowCrust*.87);
        }
      }
      `}
      float canopyTint = 1.0 - barkSurface;
      float snowPad = step(.988, vMapUv.x);
      float needleSurface = ${level === -2 ? '0.0' : 'canopyTint * (1.0 - snowPad)'};
      ${level === -2 ? '' : `
      diffuseColor.a *= mix(1.0,smoothstep(.48,1.53,patchDistance),needleSurface);
      `}
      float upperBough = max(0.0,dot(normalize(vNormal),mat3(viewMatrix)*vec3(0,1,0)));
      upperBough *= gl_FrontFacing ? 1.0 : 0.0;
      float frostPocket = sin(crownShape.y*68.0 + crownShape.x*18.0 - crownShape.z*24.0
        + sin(crownShape.z*35.0+crownShape.w) + crownShape.w);
      float rime = crownSnow * smoothstep(.42,.95,upperBough)
        * smoothstep(.16,.92,frostPocket) * canopyTint * (1.0-snowPad);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.47,.56,.60),rime*.37);
      float distantCanopy = smoothstep(210.0, 1000.0, crownDistance) * .34 * (1.0-snowPad);
      diffuseColor.rgb *= 1.0 - distantCanopy * canopyTint;
    `).replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      vec3 needleSky = normalize(mat3(viewMatrix) * vec3(0.0, 1.0, 0.0));
      normal = normalize(mix(normal, normalize(normal + needleSky * 2.0), needleSurface
        * ${level === -2 ? '.62' : 'mix(.62,.31,closeCoverage)'}));
      ${level === -2 ? '' : `
      if (barkSurface > .5) {
        vec3 acrossWood = cross(needleSky,normal);
        vec3 alongWood = cross(normal,acrossWood);
        normal = normalize(normal + (acrossWood * woodSlope.x * 1.82 + alongWood * woodSlope.y * 2.25)
          * (1. - smoothstep(60.,140.,crownDistance))*(1.0-snowCrust*.67));
      }
      `}
    `).replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      reflectedLight.indirectDiffuse += diffuseColor.rgb * ${level === -2 ? '.14' : '(.16 + .23 * needleSurface + .07 * barkSurface)'};
    `);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute vec3 branchAnchor;
      attribute vec3 snowCenter;
      varying float crownDistance;
      varying float crownSnow;
      varying vec4 crownShape;
      ${level === -2 ? '' : 'varying float crownBaseAltitude;'}
      uniform float snowpack;
      uniform float snowline;
      uniform float forestDetail;
    `).replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 forestOrigin = vec4(0.0, 0.0, 0.0, 1.0);
      vec4 forestTop = vec4(0.0, 1.0, 0.0, 1.0);
      #ifdef USE_INSTANCING
        forestOrigin = instanceMatrix * forestOrigin;
        forestTop = instanceMatrix * forestTop;
      #endif
      forestOrigin = modelMatrix * forestOrigin;
      forestTop = modelMatrix * forestTop;
      if (position.y < -.07) transformed.y -= 1.55 / max(.2, distance(forestOrigin.xyz,forestTop.xyz));
      ${level === -2 ? '' : 'crownBaseAltitude = forestOrigin.y;'}
      float crownAltitude = max(0.0, max(forestOrigin.y - cameraPosition.y, cameraPosition.y - forestTop.y));
      float forestDistance = length(vec3(cameraPosition.xz - forestOrigin.xz, crownAltitude));
      crownDistance = forestDistance;
      float crownPhase = forestOrigin.x*.037 + forestOrigin.z*.021;
      crownShape = vec4(position,crownPhase);
      ${snowDeposition(region === 'regional')}
      crownSnow = crownRime;
      ${detailTier ? `float branchGrowth = 1.0 - smoothstep(${detailTier[0]}.0 * forestDetail, ${detailTier[1]}.0 * forestDetail, forestDistance);
      transformed = mix(branchAnchor, transformed, branchGrowth);` : ''}
    `);
    if (region) attachForestFade(shader,region,level !== -2);
    if (level !== -2) attachChaseFoliage(shader);
  };
  material.customProgramCacheKey = () => `conifer-needle-branches-${level}-${region}-v23`;
  return material;
}
