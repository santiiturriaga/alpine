import * as THREE from 'three';
import { stevensHeightDetails } from './stevens-pass-terrain.js';
import { climateUniforms } from './climate-state.js';
import { clamp, lerp, smoothstep } from './util.js';

const TILE = 48;
const detailNormal = new THREE.Vector3();

export async function loadResortRaster(baseURL, descriptor, wordSize) {
  const { file, cols, rows } = descriptor;
  const url = new URL(file, baseURL);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${file} returned HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== cols * rows * wordSize) throw new Error(`Invalid dimensions for ${file}`);
  if (wordSize === 1) return new Uint8Array(buffer);
  const input = new DataView(buffer);
  return Float32Array.from({ length: cols * rows }, (_, i) =>
    descriptor.offset + input.getUint16(i * 2, true) * descriptor.scale);
}

export function rasterGrid(values, { cols, rows }, bounds) {
  const dx = (bounds.maxX - bounds.minX) / (cols - 1);
  const dz = (bounds.maxZ - bounds.minZ) / (rows - 1);
  const normals = new Float32Array(cols * rows * 3);
  const xAt = (i) => bounds.minX + i * dx;
  const zAt = (i) => bounds.minZ + i * dz;
  function fillNormals() {
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = Math.max(0, i - 1), b = Math.min(cols - 1, i + 1);
      const c = Math.max(0, j - 1), d = Math.min(rows - 1, j + 1);
      const x = (values[j * cols + a] - values[j * cols + b]) / ((b - a) * dx);
      const z = (values[c * cols + i] - values[d * cols + i]) / ((d - c) * dz);
      const len = Math.hypot(x, 1, z);
      const index = (j * cols + i) * 3;
      normals[index] = x / len;
      normals[index + 1] = 1 / len;
      normals[index + 2] = z / len;
    }
  }
  fillNormals();

  function sample(x, z, normal, exact = false) {
    const gx = clamp((x - bounds.minX) / dx, 0, cols - 1);
    const gz = clamp((z - bounds.minZ) / dz, 0, rows - 1);
    const i = Math.min(cols - 2, Math.floor(gx));
    const j = Math.min(rows - 2, Math.floor(gz));
    const tx = gx - i, tz = gz - j, index = j * cols + i;
    const first = tx + tz <= 1;
    const a = first ? index : index + cols + 1;
    const b = index + 1, c = index + cols;
    const wa = first ? 1 - tx - tz : tx + tz - 1;
    const wb = first ? tx : 1 - tz, wc = first ? tz : 1 - tx;
    if (exact) {
      if (first) normal.set((values[a] - values[b]) / dx, 1, (values[a] - values[c]) / dz);
      else normal.set((values[c] - values[a]) / dx, 1, (values[b] - values[a]) / dz);
      normal.normalize();
    } else if (normal) {
      normal.set(
        normals[3 * a] * wa + normals[3 * b] * wb + normals[3 * c] * wc,
        normals[3 * a + 1] * wa + normals[3 * b + 1] * wb + normals[3 * c + 1] * wc,
        normals[3 * a + 2] * wa + normals[3 * b + 2] * wb + normals[3 * c + 2] * wc
      ).normalize();
    }
    return values[a] * wa + values[b] * wb + values[c] * wc;
  }
  return { values, cols, rows, bounds, normals, xAt, zAt, sample };
}

export function forestSampler(values, descriptor, bounds) {
  const { cols, rows } = descriptor;
  const dx = (bounds.maxX - bounds.minX) / (cols - 1);
  const dz = (bounds.maxZ - bounds.minZ) / (rows - 1);
  return (x, z) => {
    const gx = clamp((x - bounds.minX) / dx, 0, cols - 1);
    const gz = clamp((z - bounds.minZ) / dz, 0, rows - 1);
    const i = Math.min(cols - 2, Math.floor(gx)), j = Math.min(rows - 2, Math.floor(gz));
    const tx = gx - i, tz = gz - j, index = j * cols + i;
    return lerp(lerp(values[index], values[index + 1], tx),
      lerp(values[index + cols], values[index + cols + 1], tx), tz) / 255;
  };
}

export function pointInPolygon(x, z, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [a, b] = points[i], [c, d] = points[j];
    if ((b > z) !== (d > z) && x < (c - a) * (z - b) / (d - b) + a) inside = !inside;
  }
  return inside;
}

export function segmentDistance(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

export function runStyle(run) {
  const rating = String(run.difficulty || '').toLowerCase();
  const expert = /expert|black|advanced|double|freeride|extreme/.test(rating);
  const easy = /easy|green|novice|beginner/.test(rating);
  const natural = ['powder', 'ungroomed', 'mogul', 'natural', 'backcountry'].some(word =>
    String(run.surface ?? run.grooming ?? '').toLowerCase().includes(word));
  const groomed = run.groomed ?? (!natural && (!expert || /main|skid|roller/i.test(run.name)));
  const width = run.halfWidth ?? (run.width ? run.width * .5 : easy ? 14 : expert ? 11 : 17);
  return { expert, easy, groomed, width };
}

function makeSurfaceField(bounds, grid, forestAt, runs, runAreas, roads, parking, summerRoutes) {
  const width = Math.ceil((bounds.maxX - bounds.minX) / 4);
  const height = Math.ceil((bounds.maxZ - bounds.minZ) / 4);
  const sx = (bounds.maxX - bounds.minX) / width, sz = (bounds.maxZ - bounds.minZ) / height;
  const raw = new Uint8Array(width * height * 4);
  function paint(minX, maxX, minZ, maxZ, callback) {
    const i0 = clamp(Math.floor((minX - bounds.minX) / sx), 0, width - 1);
    const i1 = clamp(Math.ceil((maxX - bounds.minX) / sx), 0, width - 1);
    const j0 = clamp(Math.floor((minZ - bounds.minZ) / sz), 0, height - 1);
    const j1 = clamp(Math.ceil((maxZ - bounds.minZ) / sz), 0, height - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = bounds.minX + (i + .5) * sx, z = bounds.minZ + (j + .5) * sz;
      callback(x, z, (j * width + i) * 4);
    }
  }

  // The snow surface and friction sampler read the same field. Mark nearby
  // grooming and heading, firm snow, and the mapped canopy fraction.
  paint(bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ, (x, z, i) => {
    const cover = forestAt(x, z);
    const y = grid.sample(x, z, detailNormal);
    const exposed = smoothstep(.12, .39, 1 - detailNormal.y) * (1 - cover);
    const wind = .53 + .29 * Math.sin(x * .013 + z * .009) + .18 * Math.sin(x * .041 - z * .021);
    raw[i + 1] = clamp(exposed * (.32 + .62 * wind) * smoothstep(1330, 1800, y), 0, 1) * 228;
    raw[i + 3] = cover * 255;
  });
  for (const run of runs) {
    const style = runStyle(run);
    const width = style.width;
    for (let i = 1; i < run.points.length; i++) {
      const [ax, az] = run.points[i - 1], [bx, bz] = run.points[i];
      const direction = ((Math.atan2(bx - ax, bz - az) / Math.PI) % 1 + 1) % 1;
      paint(Math.min(ax, bx) - width, Math.max(ax, bx) + width,
        Math.min(az, bz) - width, Math.max(az, bz) + width, (x, z, index) => {
          const distance = segmentDistance(x, z, ax, az, bx, bz);
          const edge = 1 - smoothstep(width * .59, width, distance);
          const compactness = edge * (style.groomed ? 255 : 66);
          if (compactness > raw[index]) {
            raw[index] = compactness;
            raw[index + 2] = direction * 255;
          }
          raw[index + 3] = Math.min(raw[index + 3], (1 - edge) * 255);
          if (style.groomed) raw[index + 1] *= 1 - edge * (style.expert ? .58 : .90);
        });
    }
  }
  for (const road of roads) {
    const spread = road.halfWidth ?? (/motorway|trunk|primary/i.test(road.kind) ? 8.5 : 4.5);
    for (let i = 1; i < road.points.length; i++) {
      const [ax, az] = road.points[i - 1], [bx, bz] = road.points[i];
      paint(Math.min(ax, bx) - spread, Math.max(ax, bx) + spread,
        Math.min(az, bz) - spread, Math.max(az, bz) + spread, (x, z, index) => {
          const edge = 1 - smoothstep(spread * .75, spread, segmentDistance(x, z, ax, az, bx, bz));
          if (edge > .3) {
            raw[index] = Math.max(raw[index], edge * 190);
            raw[index + 1] = Math.max(raw[index + 1], edge * 210);
            raw[index + 3] = Math.min(raw[index + 3], (1 - edge) * 255);
          }
        });
    }
  }
  for (const area of runAreas) {
    const { points } = area;
    const x = points.map(p => p[0]), z = points.map(p => p[1]);
    const groomed = runStyle(area).groomed;
    paint(Math.min(...x), Math.max(...x), Math.min(...z), Math.max(...z), (x, z, index) => {
      if (!pointInPolygon(x, z, points)) return;
      raw[index] = Math.max(raw[index], groomed ? 232 : 67);
      raw[index + 1] *= .55;
      raw[index + 3] = 0;
    });
  }
  for (const { points } of parking) {
    const x = points.map(p => p[0]), z = points.map(p => p[1]);
    paint(Math.min(...x), Math.max(...x), Math.min(...z), Math.max(...z), (x, z, index) => {
      if (!pointInPolygon(x, z, points)) return;
      raw[index] = 182;
      raw[index + 1] = 123;
      raw[index + 3] = 0;
    });
  }

  const texture = new THREE.DataTexture(raw, width, height, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  let summerTexture;
  if (summerRoutes.length) {
    const summer = new Uint8Array(width * height);
    for (const { points, kind } of summerRoutes) {
      const reach = kind === 'bike' ? 4.4 : 3.7;
      for (let i = 1; i < points.length; i++) {
        const [ax, az] = points[i - 1], [bx, bz] = points[i];
        paint(Math.min(ax, bx) - reach, Math.max(ax, bx) + reach,
          Math.min(az, bz) - reach, Math.max(az, bz) + reach, (x, z, index) => {
            const distance = segmentDistance(x, z, ax, az, bx, bz);
            const edge = 1 - smoothstep(1.1, reach, distance);
            summer[index / 4] = Math.max(summer[index / 4], edge * 255);
          });
      }
    }
    summerTexture = new THREE.DataTexture(summer, width, height, THREE.RedFormat);
    summerTexture.minFilter = summerTexture.magFilter = THREE.LinearFilter;
    summerTexture.needsUpdate = true;
  }
  function at(x, z, out) {
    const gx = clamp((x - bounds.minX) / sx - .5, 0, width - 1);
    const gz = clamp((z - bounds.minZ) / sz - .5, 0, height - 1);
    const i = Math.min(width - 2, Math.floor(gx)), j = Math.min(height - 2, Math.floor(gz));
    const a = (j * width + i) * 4, row = width * 4;
    const tx = gx - i, tz = gz - j;
    const channel = (c) => lerp(lerp(raw[a + c], raw[a + 4 + c], tx),
      lerp(raw[a + row + c], raw[a + row + 4 + c], tx), tz) / 255;
    out.groomed = smoothstep(.34, .82, channel(0));
    out.ice = smoothstep(.21, .68, channel(1));
    out.canopy = channel(3);
    return out;
  }
  return { texture, summerTexture, at };
}

const materialSource = /* glsl */ `
  varying vec3 resortPoint;
  float resortHash(vec3 p) {
    p = fract(p * vec3(.1031,.1030,.0973));
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float resortNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f*f*(3. - 2.*f);
    return mix(
      mix(mix(resortHash(i), resortHash(i+vec3(1,0,0)),f.x),
          mix(resortHash(i+vec3(0,1,0)),resortHash(i+vec3(1,1,0)),f.x),f.y),
      mix(mix(resortHash(i+vec3(0,0,1)),resortHash(i+vec3(1,0,1)),f.x),
          mix(resortHash(i+vec3(0,1,1)),resortHash(i+vec3(1,1,1)),f.x),f.y),f.z);
  }
`;

function snowMaterial(bounds, field, regional = false) {
  const material = new THREE.MeshStandardMaterial({ roughness: .91, metalness: 0 });
  const summerTrails = !regional && !!field.summerTexture;
  material.customProgramCacheKey = () => `mapped-resort-snow-${regional}-${summerTrails}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.resortField = { value: field.texture };
    if (summerTrails) shader.uniforms.summerField = { value: field.summerTexture };
    shader.uniforms.snowpack = climateUniforms.snowpack;
    shader.uniforms.snowline = climateUniforms.snowline;
    shader.uniforms.resortLimits = { value: new THREE.Vector4(bounds.minX, bounds.minZ,
      bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 resortPoint;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nresortPoint = (modelMatrix * vec4(position, 1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      ${materialSource}
      uniform sampler2D resortField;
      ${summerTrails ? 'uniform sampler2D summerField;' : ''}
      uniform vec4 resortLimits;
      uniform float snowpack;
      uniform float snowline;
    `).replace('#include <color_fragment>', `#include <color_fragment>
      vec3 p = resortPoint;
      float eye = length(vViewPosition);
      float up = clamp(dot(normalize(vNormal), mat3(viewMatrix) * vec3(0,1,0)), 0., 1.);
      vec4 surface = ${regional ? 'vec4(0.)' : 'texture2D(resortField,(p.xz-resortLimits.xy)/resortLimits.zw)'};
      float groom = smoothstep(.34,.82,surface.r);
      float ice = smoothstep(.21,.68,surface.g);
      float road = smoothstep(.66,.79,surface.g) * smoothstep(.45,.66,surface.r) * (1. - smoothstep(.76,.92,surface.r));
      float mountainside = resortNoise(p * vec3(.017,.023,.018));
      float flutes = resortNoise(p * vec3(.11,.027,.088) + mountainside*.44);
      float cliffBed = resortNoise(p * vec3(.085,.335,.086));
      float steep = smoothstep(.20,.57,1. - up);
      float cliff = smoothstep(.35,.76,steep + (mountainside-.44)*.39 + (flutes-.48)*.43)
        * (1. - groom * .94) * (.63+.37*cliffBed);
      float weather = smoothstep(snowline-165.,snowline+280.,p.y);
      float snow = max(weather, snowpack);
      ${regional ? `
        float forests = (1.-smoothstep(1330.,1860.+(mountainside-.5)*320.,p.y))
          * smoothstep(.56,.87,up);
        float canopy = resortNoise(p * vec3(.055,.041,.055));
        vec3 spruce = mix(vec3(.018,.027,.029),vec3(.112,.160,.163),canopy*.7+mountainside*.3);
        vec3 alpine = mix(vec3(.49,.58,.66),vec3(.85,.91,.95),.55*flutes+.45*mountainside);
        vec3 stone = vec3(.11,.134,.15) * (.54+.70*cliffBed);
        diffuseColor.rgb *= mix(mix(stone,alpine,(1.-cliff)*snow),spruce,forests*.96);
      ` : `
        float nearDetail = 1. - smoothstep(28.,140.,eye);
        float drift = resortNoise(p * vec3(.45,.14,.72)+flutes*.55);
        float shallow = resortNoise(p * vec3(1.66,.53,1.66));
        vec3 finePoint = p * vec3(24.,7.,24.);
        float coverage = 1. - smoothstep(.52,1.4,length(fwidth(finePoint)));
        float grains = nearDetail > .01 ? resortNoise(finePoint) : .5;
        float angle = surface.b * 3.14159265;
        float along = dot(p.xz,vec2(sin(angle),cos(angle)));
        float ripple = .5 + .5*sin(along*37.3 + drift*.64);
        float tracks = groom * nearDetail * (1.-ice) * (1.-smoothstep(.75,1.8,fwidth(along)*37.3));
        float snowShape = mix(.88+.146*drift+.065*shallow,.96+.043*ripple*tracks,groom);
        float crust = max(0.,grains-.57)*coverage*nearDetail;
        vec3 powder = vec3(.831,.890,.956) * (snowShape+crust*.13) * (.935+.106*mountainside);
        vec3 packed = vec3(.847,.908,.973) * (snowShape+crust*.08);
        vec3 blueIce = vec3(.591,.725,.833) * (.91+.104*drift+.03*shallow);
        vec3 snowColor = mix(mix(powder,packed,groom),blueIce,ice*.75);
        vec3 granite = mix(vec3(.073,.083,.098),vec3(.245,.244,.228),cliffBed*.72+flutes*.28);
        granite *= .78 + .3 * cliffBed;
        float canopy = resortNoise(p * vec3(.085,.041,.085));
        float underTrees = smoothstep(.17,.81,surface.a);
        vec3 spruce = mix(vec3(.042,.066,.066),vec3(.215,.302,.329),.76*canopy+.24*drift);
        snowColor *= 1. - underTrees * (.055+.22*(1.-canopy)) * (1.-groom);
        snowColor = mix(snowColor,spruce,underTrees * smoothstep(740.,1720.,eye)*.94);
        snowColor = mix(snowColor,vec3(.207,.25,.279)*(.7+.3*drift),road*.75);
        ${summerTrails ? `
          float bare = (1. - smoothstep(.04,.25,snowpack)) * (1. - weather);
          float grass = smoothstep(.55,.86,up) * (1. - cliff) * bare;
          vec3 meadow = mix(vec3(.095,.127,.055),vec3(.261,.305,.106),mountainside*.55+drift*.45);
          granite = mix(granite,meadow,grass*.83);
          float path = texture2D(summerField,(p.xz-resortLimits.xy)/resortLimits.zw).r;
          vec3 dirt = mix(vec3(.16,.094,.053),vec3(.30,.211,.115),.56*drift+.44*shallow);
          granite = mix(granite,dirt,smoothstep(.07,.61,path)*bare*.94);
        ` : ''}
        diffuseColor.rgb *= mix(granite,snowColor,(1.-cliff)*snow);
        float resortRelief = nearDetail * (.021 * drift + .008 * shallow + .0014 * grains * coverage
          + .0018 * ripple * tracks) * (1. - ice*.77);
      `}
    `).replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor *= 1. - ice*.47;
    `).replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      ${regional ? '' : `
        vec3 dx = dFdx(vViewPosition), dz = dFdy(vViewPosition);
        vec3 rx = cross(dz,normal), rz = cross(normal,dx);
        float area = dot(dx,rx);
        vec3 gradient = sign(area) * (dFdx(resortRelief)*rx + dFdy(resortRelief)*rz);
        normal = normalize(max(abs(area),1e-9)*normal + gradient);
      `}
    `);
  };
  return material;
}

function meshTerrain(group, grid, mat, hole = null) {
  const { cols, rows, xAt, zAt, values, normals } = grid;
  for (let j = 0; j < rows - 1; j += TILE) for (let i = 0; i < cols - 1; i += TILE) {
    const w = Math.min(cols - i, TILE + 1), h = Math.min(rows - j, TILE + 1);
    const positions = new Float32Array(w * h * 3);
    const shading = new Float32Array(w * h * 3);
    const indices = [];
    for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
      const src = (j + v) * cols + i + u, dst = (v * w + u) * 3;
      const x = xAt(i + u), z = zAt(j + v);
      const y = hole && hole.border(x, z) ? hole.sample(x, z, detailNormal) : values[src];
      positions[dst] = x;
      positions[dst + 1] = y;
      positions[dst + 2] = z;
      if (hole && hole.border(x, z)) detailNormal.toArray(shading, dst);
      else {
        shading[dst] = normals[src * 3];
        shading[dst + 1] = normals[src * 3 + 1];
        shading[dst + 2] = normals[src * 3 + 2];
      }
      if (u === w - 1 || v === h - 1 || hole?.inside(x, z, xAt(i + u + 1), zAt(j + v + 1))) continue;
      const a = v * w + u, b = a + 1, c = a + w, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
    if (indices.length === 0) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(shading, 3));
    geometry.setIndex(new THREE.Uint16BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.receiveShadow = !hole || !!hole.receiveShadow;
    group.add(mesh);
  }
}

function backdropPatch(regional, main) {
  // Insert the playable-region boundary in the regional grid. The close
  // elevations replace the outside DEM along that line and taper into it.
  const b = main.bounds;
  const x = Array.from({ length: regional.cols }, (_, i) => regional.xAt(i));
  const z = Array.from({ length: regional.rows }, (_, j) => regional.zAt(j));
  for (const [axis, lower, upper] of [[x, b.minX, b.maxX], [z, b.minZ, b.maxZ]]) {
    for (const coordinate of [lower, upper]) if (!axis.includes(coordinate)) axis.push(coordinate);
    axis.sort((a, b) => a - b);
  }
  const values = new Float32Array(x.length * z.length);
  const normals = new Float32Array(values.length * 3);
  const sample = (x, z) => {
    const edgeX = clamp(x, b.minX, b.maxX), edgeZ = clamp(z, b.minZ, b.maxZ);
    const dist = Math.hypot(x - edgeX, z - edgeZ);
    const y = regional.sample(x, z);
    if (dist > 185) return y;
    return y + (main.sample(edgeX, edgeZ) - regional.sample(edgeX, edgeZ)) * (1 - smoothstep(0, 185, dist));
  };
  for (let j = 0; j < z.length; j++) for (let i = 0; i < x.length; i++) {
    const ix = j * x.length + i;
    const px = x[i], pz = z[j];
    values[ix] = sample(px, pz);
    const normal = detailNormal.set(sample(px - 13, pz) - sample(px + 13, pz), 26,
      sample(px, pz - 13) - sample(px, pz + 13)).normalize();
    normal.toArray(normals, ix * 3);
  }
  return { cols: x.length, rows: z.length, values, normals, xAt: i => x[i], zAt: j => z[j] };
}

function sealTerrainEdge(group, main, regional, material) {
  const b = main.bounds;
  const vertices = [];
  const append = (count, getPoint) => {
    for (let i = 1; i < count; i++) {
      const [ax, az] = getPoint(i - 1), [bx, bz] = getPoint(i);
      const a = main.sample(ax, az), c = main.sample(bx, bz);
      const b = Math.min(a, regional.sample(ax, az)) - 26, d = Math.min(c, regional.sample(bx, bz)) - 26;
      vertices.push(ax,a,az,bx,c,bz,ax,b,az, bx,c,bz,bx,d,bz,ax,b,az);
    }
  };
  append(main.cols, i => [main.xAt(i), b.minZ]);
  append(main.cols, i => [main.xAt(main.cols - 1 - i), b.maxZ]);
  append(main.rows, i => [b.minX, main.zAt(main.rows - 1 - i)]);
  append(main.rows, i => [b.maxX, main.zAt(i)]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  group.add(new THREE.Mesh(geometry, material));
}

export async function loadMappedGround(scene, config, baseURL) {
  const { bounds, terrain, backdrop, forest, runs, runAreas = [], roads = [], parking = [], summerRoutes = [] } = config;
  const [dem, regionalDem, cover] = await Promise.all([
    loadResortRaster(baseURL, terrain, 2), loadResortRaster(baseURL, backdrop, 2),
    loadResortRaster(baseURL, forest, 1),
  ]);
  const grid = rasterGrid(dem, terrain, bounds);
  const localPatches = config.id === 'stevens-pass' ? stevensHeightDetails().map((detail) => {
    const { minX, maxX, minZ, maxZ, spacing, adjust } = detail;
    const cols = (maxX - minX) / spacing + 1, rows = (maxZ - minZ) / spacing + 1;
    const values = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x = minX + i * spacing, z = minZ + j * spacing;
      const edge = Math.min(x - minX, maxX - x, z - minZ, maxZ - z);
      values[j * cols + i] = grid.sample(x, z) + smoothstep(0, 6, edge) * adjust(x, z, grid.sample);
    }
    return { meshGrid: rasterGrid(values, { cols, rows }, detail),
      inside: (ax, az, bx = ax, bz = az) => ax >= minX && az >= minZ && bx <= maxX && bz <= maxZ };
  }) : [];
  const surfaceGrid = (x, z) => localPatches.find(patch => patch.inside(x, z))?.meshGrid ?? grid;
  const heightAt = (x, z, normal, exact) => surfaceGrid(x, z).sample(x, z, normal, exact);
  const regional = rasterGrid(regionalDem, backdrop, backdrop.bounds);
  const forestAt = forestSampler(cover, forest, forest.bounds || bounds);
  const field = makeSurfaceField(bounds, grid, forestAt, runs, runAreas, roads, parking, summerRoutes);
  const localMaterial = snowMaterial(bounds, field);
  const horizonMaterial = snowMaterial(bounds, field, true);
  const group = new THREE.Group();
  group.name = `${config.name} · mapped elevation`;
  const horizon = backdropPatch(regional, grid);
  const inside = (ax, az, bx, bz) => ax >= bounds.minX && bx <= bounds.maxX && az >= bounds.minZ && bz <= bounds.maxZ;
  const border = (x, z) => inside(x, z, x, z)
    && (x === bounds.minX || x === bounds.maxX || z === bounds.minZ || z === bounds.maxZ);
  meshTerrain(group, horizon, horizonMaterial, { inside, border, sample: grid.sample });
  sealTerrainEdge(group, grid, regional, horizonMaterial);
  const terrainHole = localPatches.length ? { border: () => false,
    inside: (ax, az, bx, bz) => localPatches.some(patch => patch.inside(ax, az, bx, bz)), receiveShadow: true } : null;
  meshTerrain(group, grid, localMaterial, terrainHole);
  for (const patch of localPatches) meshTerrain(group, patch.meshGrid, localMaterial);
  scene.add(group);

  const fieldSample = {};
  const snowColor = new THREE.Color(), packed = new THREE.Color().setRGB(.847, .908, .973);
  const powder = new THREE.Color().setRGB(.831, .890, .956), iceColor = new THREE.Color().setRGB(.591, .725, .833);
  const ground = {
    mesh: group, bounds, snowMaterial: localMaterial,
    forestAt, fieldAt(x, z, out = {}) { return field.at(x, z, out); },
    heightAt,
    normalAt(x, z, out = new THREE.Vector3()) { heightAt(x, z, out, true); return out; },
    surfaceAt(x, z, out = {}) {
      const pack = climateUniforms.snowpack.value;
      const cover = pack > .98 ? 1 : Math.max(pack, smoothstep(-165, 280,
        heightAt(x, z) - climateUniforms.snowline.value));
      if (cover < .28) {
        out.id = 'ground';
        out.grip = 1;
        out.drag = 3;
        out.powder = 0;
        return out;
      }
      const { groomed, ice, canopy } = field.at(x, z, fieldSample);
      const powder = (1 - groomed) * (1 - ice) * (.76 + .23 * canopy);
      out.id = ice > .53 ? 'ice' : powder > .46 ? 'powder' : 'packed';
      out.grip = 1 - .61 * ice - .28 * powder;
      out.drag = 1 - .32 * ice + .54 * powder;
      out.powder = (.11 + .89 * powder) * (1 - ice) * cover;
      return out;
    },
    sampleSnowSurface(x, z, color, normal) {
      const { groomed, ice } = field.at(x, z, fieldSample);
      if (color) color.copy(snowColor.copy(powder).lerp(packed, groomed).lerp(iceColor, ice * .75));
      return heightAt(x, z, normal);
    },
    regionalHeightAt: regional.sample,
  };
  return ground;
}
