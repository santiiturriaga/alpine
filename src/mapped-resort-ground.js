import * as THREE from 'three';
import { bindSnowTraffic, compressSnow, snowTrafficGLSL } from './snow-traffic.js';
import { STEVENS_OVERPASS_OSM, stevensHeightDetails } from './stevens-pass-terrain.js';
import { climateUniforms } from './climate-state.js';
import { loadForestSurvey } from './forest-survey.js';
import { bindSnowCrystals } from './snow-crystals.js';
import { terrainHorizon, bindTerrainHorizon } from './terrain-horizon.js';
import { nightRunsFor } from './slope-fixtures.js';
import { internationalLandmarkSite } from './international-landmark-sites.js';
import { summitTerrainMaterial } from './international-landmark-materials.js';
import { createMappedTerrainDetail } from './mapped-terrain-detail.js';
import { createBackcountry, createSurveyTerrain, insideTerrain } from './backcountry.js';
import { compactDevice } from './device-budget.js';
import { clamp, lerp, smoothstep } from './util.js';
import { softenShadowBoundary } from './forest-shadows.js';

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
  const elevation = new Float32Array(cols * rows);
  for (let i = 0; i < elevation.length; i++) {
    elevation[i] = descriptor.offset + input.getUint16(i * 2, true) * descriptor.scale;
  }
  return elevation;
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
      const len = Math.sqrt(x * x + 1 + z * z);
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
    if (normal && exact) {
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
  const spanX = bounds.maxX - bounds.minX, spanZ = bounds.maxZ - bounds.minZ;
  const spacing = Math.max(4, Math.max(spanX, spanZ) / 3072);
  const width = Math.ceil(spanX / spacing);
  const height = Math.ceil(spanZ / spacing);
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
  // Scan polygon edges once per raster row and fill each covered pixel span.
  function paintPolygon(points, callback) {
    const zs = points.map(([, z]) => z);
    const firstRow = clamp(Math.ceil((Math.min(...zs) - bounds.minZ) / sz - .5), 0, height);
    const endRow = clamp(Math.ceil((Math.max(...zs) - bounds.minZ) / sz - .5), 0, height);
    const crossings = [];
    for (let row = firstRow; row < endRow; row++) {
      const z = bounds.minZ + (row + .5) * sz;
      crossings.length = 0;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [ax, az] = points[i], [bx, bz] = points[j];
        if ((az > z) !== (bz > z)) crossings.push(ax + (bx - ax) * (z - az) / (bz - az));
      }
      crossings.sort((a, b) => a - b);
      for (let i = 1; i < crossings.length; i += 2) {
        const from = clamp(Math.ceil((crossings[i - 1] - bounds.minX) / sx - .5), 0, width);
        const to = clamp(Math.ceil((crossings[i] - bounds.minX) / sx - .5), 0, width);
        for (let col = from; col < to; col++) callback((row * width + col) * 4);
      }
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
    const spread = road.halfWidth ?? (/motorway|trunk|primary/i.test(road.kind) ? 8.5 : /^D\s?90\b/.test(road.ref ?? '') ? 7.2 : 4.5);
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
    const groomed = runStyle(area).groomed;
    paintPolygon(area.points, (index) => {
      raw[index] = Math.max(raw[index], groomed ? 232 : 67);
      raw[index + 1] *= .55;
      raw[index + 3] = 0;
    });
  }
  for (const { points } of parking) {
    paintPolygon(points, (index) => {
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
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float resortNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f*f*(3. - 2.*f);
    // The eight corners share the same two fractional values on each axis.
    const vec3 hashScale = vec3(.1031,.1030,.0973);
    vec3 lo = fract(i * hashScale), hi = fract((i + 1.) * hashScale);
    return mix(
      mix(mix(resortHash(lo),resortHash(vec3(hi.x,lo.yz)),f.x),
          mix(resortHash(vec3(lo.x,hi.y,lo.z)),resortHash(vec3(hi.xy,lo.z)),f.x),f.y),
      mix(mix(resortHash(vec3(lo.xy,hi.z)),resortHash(vec3(hi.x,lo.y,hi.z)),f.x),
          mix(resortHash(vec3(lo.x,hi.yz)),resortHash(hi),f.x),f.y),f.z);
  }
`;

function snowMaterial(bounds, field, regional = false, nightLight = null) {
  const material = new THREE.MeshStandardMaterial({ roughness: .91, metalness: 0 });
  const summerTrails = !regional && !!field.summerTexture;
  const forest = regional ? field.survey?.region : field.survey?.local;
  const regionalForest = field.survey?.region;
  const cascade = field.cascade;
  const village = field.village;
  const regionalColor = /* glsl */ `
    vec3 surveyColor(vec3 p, float up, float mountainside, float flutes, float cliffBed, float cliff, float weather) {
      float surveySnow = max(weather, snowpack);
      ${regionalForest ? `
        vec4 surveyedStand = texture2D(regionalStand, (p.xz-regionalStandBounds.xy)/regionalStandBounds.zw) * 2.55;
        float forests = surveyedStand.r;
        surveySnow = max(surveyedStand.b, max(snowpack, weather * smoothstep(.0,.60,snowpack)));
      ` : 'float forests = (1.-smoothstep(1330.,1860.+(mountainside-.5)*320.,p.y)) * smoothstep(.56,.87,up);'}
      float canopy = forests > 0. ? resortNoise(p * vec3(.055,.041,.055)) : .5;
      vec3 spruce = mix(vec3(.018,.027,.029),vec3(.112,.160,.163),canopy*.7+mountainside*.3);
      vec3 alpine = mix(vec3(.49,.58,.66),vec3(.85,.91,.95),.55*flutes+.45*mountainside);
      vec3 stone = vec3(.11,.134,.15) * (.54+.70*cliffBed);
      ${cascade ? `
        float rockLayers = resortNoise(vec3(p.x*.021-p.y*.037,p.y*.142,p.z*.023+p.y*.044));
        float rockFlank = smoothstep(.08,.65,1.-up) * smoothstep(1000.,1630.,p.y);
        cliff = max(cliff,.52*rockFlank*(.62+.38*flutes));
        stone = mix(vec3(.084,.105,.123),vec3(.295,.288,.252),rockLayers*.56+cliffBed*.44);
        alpine = mix(alpine*.81,alpine*1.08,mountainside*.6+rockLayers*.4);
        spruce *= .77 + canopy*.37;
        forests = smoothstep(.12,.74,forests)*(1.-rockFlank*.60);
      ` : ''}
      ${regionalForest ? `
        vec3 grove = mix(vec3(.105,.184,.075),vec3(.33,.197,.064),standAutumn);
        vec3 bareGrove = mix(vec3(.077,.073,.071),vec3(.35,.365,.372),mountainside);
        grove = mix(grove, bareGrove, smoothstep(.24,.83,snowpack));
        spruce = mix(spruce,grove*(.84+.23*canopy),surveyedStand.g);
        stone = mix(stone,vec3(.16,.21,.095)*(.73+.45*cliffBed),surveyedStand.a*(1.-cliff));
      ` : ''}
      return mix(mix(stone,alpine,(1.-cliff)*surveySnow),spruce,forests*.96);
    }
  `;
  material.customProgramCacheKey = () => `mapped-resort-snow-${regional}-${summerTrails}-${!!nightLight}-${!!forest}-${!!regionalForest}-${!!cascade}-${!!village}`;
  material.onBeforeCompile = (shader) => {
    softenShadowBoundary(shader);
    shader.uniforms.resortField = { value: field.texture };
    if (forest && !regional) {
      shader.uniforms.standMap = { value: forest.texture };
      shader.uniforms.standBounds = { value: forest.limits };
    }
    if (regionalForest) {
      shader.uniforms.regionalStand = { value: regionalForest.texture };
      shader.uniforms.regionalStandBounds = { value: regionalForest.limits };
    }
    if (forest || regionalForest) shader.uniforms.standAutumn = climateUniforms.autumn;
    if (summerTrails) shader.uniforms.summerField = { value: field.summerTexture };
    shader.uniforms.snowpack = climateUniforms.snowpack;
    shader.uniforms.realism = climateUniforms.realism;
    if (!regional) bindSnowTraffic(shader);
    shader.uniforms.snowline = climateUniforms.snowline;
    if (nightLight) {
      shader.uniforms.pisteFloodlight = nightLight.texture;
      shader.uniforms.pisteFloodlightLimits = nightLight.limits;
      shader.uniforms.pisteFloodlightStrength = nightLight.strength;
    }
    shader.uniforms.resortLimits = { value: new THREE.Vector4(bounds.minX, bounds.minZ,
      bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 resortPoint;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nresortPoint = (modelMatrix * vec4(position, 1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      ${materialSource}
      uniform sampler2D resortField;
      ${forest && !regional ? 'uniform sampler2D standMap; uniform vec4 standBounds;' : ''}
      ${regionalForest ? 'uniform sampler2D regionalStand; uniform vec4 regionalStandBounds;' : ''}
      ${forest || regionalForest ? 'uniform float standAutumn;' : ''}
      ${summerTrails ? 'uniform sampler2D summerField;' : ''}
      uniform vec4 resortLimits;
      uniform float snowpack;
      uniform float snowline;
      uniform float realism;
      ${regionalColor}
      ${nightLight ? 'uniform sampler2D pisteFloodlight; uniform vec4 pisteFloodlightLimits; uniform float pisteFloodlightStrength;' : ''}
      ${regional ? '' : snowTrafficGLSL}
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
      float naturalCliff = smoothstep(.35,.76,steep + (mountainside-.44)*.39 + (flutes-.48)*.43) * (.63+.37*cliffBed);
      float cliff = naturalCliff * (1. - groom * .94);
      float weather = smoothstep(snowline-165.,snowline+280.,p.y);
      float snow = max(weather, snowpack);
      ${forest && !regional ? `
        vec4 stand = texture2D(standMap, (p.xz-standBounds.xy)/standBounds.zw) * 2.55;
        // Keep observed permanent snow through summer. Seasonal snow retreats to those cells.
        snow = max(stand.b, max(snowpack, weather * smoothstep(.0,.60,snowpack)));
        vec3 grove = mix(vec3(.105,.184,.075),vec3(.33,.197,.064),standAutumn);
        // A leafless stand reveals the snow between branches.
        vec3 bareGrove = mix(vec3(.077,.073,.071),vec3(.35,.365,.372),mountainside);
        grove = mix(grove, bareGrove, smoothstep(.24,.83,snowpack));
      ` : ''}
      ${regional ? `
        diffuseColor.rgb *= surveyColor(p,up,mountainside,flutes,cliffBed,naturalCliff,weather);
      ` : `
        // Match the survey shading at the join and bring in marked terrain smoothly.
        vec2 edge = min(p.xz-resortLimits.xy, resortLimits.xy+resortLimits.zw-p.xz);
        float edgeDistance = min(edge.x,edge.y);
        ${summerTrails ? 'float path = texture2D(summerField,(p.xz-resortLimits.xy)/resortLimits.zw).r;' : ''}
        float marks = max(max(groom,ice),road);
        ${summerTrails ? 'marks = max(marks, smoothstep(.07,.61,path));' : ''}
        float localWeight = max(smoothstep(0.,${cascade ? '420.' : '190.'},edgeDistance),smoothstep(0.,35.,edgeDistance)*marks);
        float nearDetail = 1. - smoothstep(28.,140.,eye);
        float traffic = ice < 1. ? trackPressure(p.xz) * (1.0-ice) : 0.;
        float drift = resortNoise(p * vec3(.45,.14,.72)+flutes*.55);
        float shallow = resortNoise(p * vec3(1.66,.53,1.66));
        vec3 finePoint = p * vec3(24.,7.,24.);
        float coverage = 1. - smoothstep(.52,1.4,length(fwidth(finePoint)));
        float grains = nearDetail > .01 && coverage > 0. ? resortNoise(finePoint) : .5;
        float angle = surface.b * 3.14159265;
        float along = dot(p.xz,vec2(sin(angle),cos(angle)));
        float tracks = groom * nearDetail * (1.-ice) * (1.-smoothstep(.75,1.8,fwidth(along)*37.3));
        float ripple = tracks > 0. ? .5 + .5*sin(along*37.3 + drift*.64) : .5;
        float snowShape = mix(.88+.146*drift+.065*shallow,.96+.043*ripple*tracks,groom);
        float crust = max(0.,grains-.57)*coverage*nearDetail;
        vec3 powder = vec3(.831,.890,.956) * (snowShape+crust*.13) * (.935+.106*mountainside);
        vec3 packed = vec3(.847,.908,.973) * (snowShape+crust*.08);
        vec3 blueIce = vec3(.591,.725,.833) * (.91+.104*drift+.03*shallow);
        vec3 snowColor = mix(mix(powder,packed,max(groom,traffic*.76)),blueIce,ice*.75);
        snowColor *= 1.0 - traffic * .073;
        snowColor += vec3(.15,.20,.26)*smoothstep(.74,.91,grains)*coverage*nearDetail*realism*(1.0-ice*.72);
        vec3 granite = mix(vec3(.073,.083,.098),vec3(.245,.244,.228),cliffBed*.72+flutes*.28);
        granite *= .78 + .3 * cliffBed;
        float underTrees = smoothstep(.17,.81,surface.a);
        float canopy = underTrees > 0. ? resortNoise(p * vec3(.085,.041,.085)) : .5;
        vec3 spruce = mix(vec3(.042,.066,.066),vec3(.215,.302,.329),.76*canopy+.24*drift);
        ${forest ? 'spruce = mix(spruce,grove*(.84+.23*canopy),stand.g);' : ''}
        snowColor *= 1. - underTrees * (.055+.22*(1.-canopy)) * (1.-groom);
        snowColor = mix(snowColor,spruce,underTrees * smoothstep(740.,1720.,eye)*.94);
        snowColor = mix(snowColor,vec3(.207,.25,.279)*(.7+.3*drift),road*.75);
        ${summerTrails || forest ? `
          float grass = ${forest ? 'max(stand.a,underTrees*.47)*(1.-road)' : '1.'} * smoothstep(.55,.86,up) * (1. - cliff);
          vec3 meadow = mix(vec3(.095,.127,.055),vec3(.261,.305,.106),mountainside*.55+drift*.45);
          ${forest ? 'meadow = mix(meadow,vec3(.29,.22,.105)*(.72+.52*drift),standAutumn*.8);' : ''}
          granite = mix(granite,meadow,grass*(1.-snow));
          ${forest ? 'granite = mix(granite,spruce,underTrees*smoothstep(740.,1720.,eye)*(1.-snow));' : ''}
        ` : ''}
        ${summerTrails ? `
          float bare = 1.-snow;
          vec3 dirt = mix(vec3(.16,.094,.053),vec3(.30,.211,.115),.56*drift+.44*shallow);
          granite = mix(granite,dirt,smoothstep(.07,.61,path)*bare*.94);
        ` : ''}
        vec3 surfaceColor = mix(granite,snowColor,(1.-cliff)*snow);
        float distantWeight = ${cascade ? 'smoothstep(1950.,4400.,eye)*(1.-marks)*.78' : '0.'};
        if (localWeight < 1. || distantWeight > 0.) {
          vec3 survey = surveyColor(p,up,mountainside,flutes,cliffBed,naturalCliff,weather);
          surfaceColor = mix(survey,surfaceColor,localWeight);
          surfaceColor = mix(surfaceColor,survey,distantWeight);
        }
        diffuseColor.rgb *= surfaceColor;
        float resortRelief = nearDetail * (.021 * drift + .008 * shallow + .0014 * grains * coverage
          + .0018 * ripple * tracks) * (1. - ice*.77) * localWeight;
      `}
    `).replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor *= 1. - ice*(.47+.20*realism)${regional ? '' : '*localWeight'};
    `).replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      ${regional ? '' : `
        vec3 dx = dFdx(vViewPosition), dz = dFdy(vViewPosition);
        vec3 rx = cross(dz,normal), rz = cross(normal,dx);
        float area = dot(dx,rx);
        vec3 gradient = sign(area) * (dFdx(resortRelief)*rx + dFdy(resortRelief)*rz);
        normal = normalize(max(abs(area),1e-9)*normal + gradient);
      `}
    `);
    if (!regional) {
      bindSnowCrystals(shader);
      bindTerrainHorizon(shader, field.horizon);
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `
        #include <lights_fragment_end>
        vec2 horizonLight = vec2(1.);
        if (realism > .5) {
          horizonLight = mix(vec2(1.), terrainLight((p.xz-resortLimits.xy)/resortLimits.zw), localWeight);
          reflectedLight.directDiffuse *= mix(.08, 1., horizonLight.x);
          reflectedLight.directSpecular *= horizonLight.x;
          reflectedLight.indirectDiffuse *= horizonLight.y;
        }`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', /* glsl */ `
        float flash = snowCrystalFlash(p, vNormal, eye, (1.0-cliff)*snow*(1.0-underTrees*.56)*(1.0-ice*.72));
        outgoingLight += vec3(.73,.88,1.0) * flash * mix(1.35,2.3,realism) * horizonLight.x * localWeight;
        if (realism > .5) {
          outgoingLight = mix(outgoingLight, shadeWinterSurface(outgoingLight, normal, vViewPosition,
            (1.-cliff)*snow*(1.-road)*(1.-underTrees*.65), ice, (1.-groom)*(1.-traffic)), localWeight);
        }
        ${nightLight ? `
          vec2 lightUV = (p.xz-pisteFloodlightLimits.xy)/max(pisteFloodlightLimits.zw,vec2(1.));
          if (pisteFloodlightStrength > .006 && all(greaterThan(lightUV,vec2(0.))) && all(lessThan(lightUV,vec2(1.)))) {
            vec2 pools = texture2D(pisteFloodlight,lightUV).rg;
            vec3 irradiance = pools.r*${village ? 'vec3(1.0,.51,.18)' : 'vec3(1.0,.70,.35)'} + pools.g*vec3(.77,.89,1.0);
            outgoingLight += diffuseColor.rgb * irradiance * pisteFloodlightStrength * 1.25 * localWeight;
          }
        ` : ''}
        #include <opaque_fragment>
      `);
    }
  };
  return material;
}

function meshTerrain(group, grid, mat, detail = null, patches = []) {
  for (let j = 0; j < grid.rows - 1; j += TILE) for (let i = 0; i < grid.cols - 1; i += TILE) {
    const w = Math.min(grid.cols - i, TILE + 1), h = Math.min(grid.rows - j, TILE + 1);
    const overlapping = patches.filter(({ meshGrid: { bounds } }) =>
      grid.xAt(i) <= bounds.maxX && grid.xAt(i + w - 1) >= bounds.minX &&
      grid.zAt(j) <= bounds.maxZ && grid.zAt(j + h - 1) >= bounds.minZ);
    if (detail && w > 2 && h > 2 && !overlapping.length) {
      detail.add(i, j, w, h, () => terrainTileGeometry(grid, i, j, w, h), mat, group);
      continue;
    }
    const hole = overlapping.length ? (ax, az, bx, bz) => overlapping.some(patch => patch.inside(ax, az, bx, bz)) : null;
    const geometry = terrainTileGeometry(grid, i, j, w, h, hole);
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
}

function terrainTileGeometry(grid, i, j, w, h, hole = null) {
  const { cols, xAt, zAt, values, normals } = grid;
  const positions = new Float32Array(w * h * 3);
  const shading = new Float32Array(w * h * 3);
  const indices = new Uint16Array((w - 1) * (h - 1) * 6);
  let used = 0;
  for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
    const src = (j + v) * cols + i + u, dst = (v * w + u) * 3;
    const x = xAt(i + u), z = zAt(j + v);
    positions[dst] = x;
    positions[dst + 1] = values[src];
    positions[dst + 2] = z;
    shading[dst] = normals[src * 3];
    shading[dst + 1] = normals[src * 3 + 1];
    shading[dst + 2] = normals[src * 3 + 2];
    if (u === w - 1 || v === h - 1 || hole?.(x, z, xAt(i + u + 1), zAt(j + v + 1))) continue;
    const a = v * w + u, b = a + 1, c = a + w, d = c + 1;
    indices[used++] = a;
    indices[used++] = c;
    indices[used++] = b;
    indices[used++] = b;
    indices[used++] = c;
    indices[used++] = d;
  }
  if (!used) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(shading, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices.subarray(0, used), 1));
  geometry.computeBoundingSphere();
  return geometry;
}

export async function loadMappedGround(scene, config, baseURL, { quality = 'BALANCED' } = {}) {
  const { bounds, terrain, backdrop, forest, runs, runAreas = [], roads = [], parking = [], summerRoutes = [] } = config;
  const detail = internationalLandmarkSite(config.id)?.terrain;
  const [dem, regionalDem, cover, detailDem, survey] = await Promise.all([
    loadResortRaster(baseURL, terrain, 2), loadResortRaster(baseURL, backdrop, 2),
    loadResortRaster(baseURL, forest, 1),
    detail ? loadResortRaster(baseURL, detail, 2) : null,
    loadForestSurvey(baseURL, config).catch(error => { console.warn('Using base forest data.', error); return null; }),
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
  if (detailDem) {
    const { minX, maxX, minZ, maxZ } = detail.bounds;
    const dx = (maxX - minX) / (detail.cols - 1), dz = (maxZ - minZ) / (detail.rows - 1);
    for (let j = 0; j < detail.rows; j++) for (let i = 0; i < detail.cols; i++) {
      const x = minX + i * dx, z = minZ + j * dz, index = j * detail.cols + i;
      const edge = Math.min(x - minX, maxX - x, z - minZ, maxZ - z);
      if (detail.rockRidge) for (let k = 1; k < detail.rockRidge.length; k++) {
        const [ax, az, ay] = detail.rockRidge[k - 1], [bx, bz, by] = detail.rockRidge[k];
        const rx = bx - ax, rz = bz - az;
        const t = clamp(((x - ax) * rx + (z - az) * rz) / (rx * rx + rz * rz), 0, 1);
        const d = Math.hypot(x - lerp(ax, bx, t), z - lerp(az, bz, t));
        if (d > 21) continue;
        const rock = lerp(ay, by, t) - d * (.74 + d * .12) + Math.sin(x * .65) * Math.cos(z * .52) * 2;
        detailDem[index] = Math.max(detailDem[index], rock);
      }
      detailDem[index] = lerp(grid.sample(x, z), detailDem[index], smoothstep(0, detail.blend, edge));
    }
    localPatches.push({ meshGrid: rasterGrid(detailDem, detail, detail.bounds), granite: true,
      inside: (ax, az, bx = ax, bz = az) => ax >= minX && az >= minZ && bx <= maxX && bz <= maxZ });
  }
  const surfaceGrid = (x, z) => localPatches.find(patch => patch.inside(x, z))?.meshGrid ?? grid;
  const regional = rasterGrid(regionalDem, backdrop, backdrop.bounds);
  const localForestAt = forestSampler(cover, forest, forest.bounds || bounds);
  const regionBounds = backdrop.bounds;
  const landscapeSample = [0, 0, 0];
  const forestAt = (x, z) => {
    if (insideTerrain(bounds, x, z)) return localForestAt(x, z);
    if (!survey || !insideTerrain(regionBounds, x, z)) return 0;
    return survey.region.sample(x, z, landscapeSample)[0] / 100;
  };
  const surfaceRoads = config.id === 'stevens-pass'
    ? roads.filter(road => road.osmId !== STEVENS_OVERPASS_OSM) : roads;
  const field = makeSurfaceField(bounds, grid, forestAt, runs, runAreas, surfaceRoads, parking, summerRoutes);
  field.survey = survey;
  field.cascade = config.id === 'snoqualmie';
  field.village = config.id === 'les-3-vallees';
  field.horizon = terrainHorizon(dem, terrain.cols, terrain.rows, bounds);
  const nightLight = (field.village || nightRunsFor(config).length)
    ? { texture: { value: null }, limits: { value: new THREE.Vector4() }, strength: { value: 0 } } : null;
  const localMaterial = snowMaterial(bounds, field, false, nightLight);
  const horizonMaterial = snowMaterial(bounds, field, true);
  const group = new THREE.Group();
  group.name = `${config.name} · mapped elevation`;
  const surveyTerrain = createSurveyTerrain({
    regional, insets: [{ ...grid, normalAt(x, z, out) { grid.sample(x, z, out); return out; } }],
    material: horizonMaterial, name: 'Regional elevation survey',
  });
  let seed = 0;
  for (const letter of config.id) seed = Math.imul(seed, 31) + letter.charCodeAt(0);
  const backcountry = createBackcountry({
    survey: surveyTerrain, material: snowMaterial(bounds, { texture: field.texture, cascade: field.cascade }, true), seed,
    compact: compactDevice, viewDistance: config.viewDistance ?? 19000,
  });
  const heightAt = (x, z, normal, exact) => insideTerrain(bounds, x, z)
    ? surfaceGrid(x, z).sample(x, z, normal, exact) : backcountry.sample(x, z, normal);
  function fieldAt(x, z, out = {}) {
    if (insideTerrain(bounds, x, z)) return field.at(x, z, out);
    out.groomed = 0;
    out.ice = 0;
    out.canopy = forestAt(x, z);
    return out;
  }
  group.add(surveyTerrain.group, backcountry.group, backcountry.horizon);
  const detailLOD = createMappedTerrainDetail(grid, quality);
  meshTerrain(group, grid, localMaterial, detailLOD, localPatches);
  for (const patch of localPatches) {
    const material = patch.granite ? summitTerrainMaterial(localMaterial, patch.meshGrid.bounds) : localMaterial;
    meshTerrain(group, patch.meshGrid, material);
  }
  scene.add(group);

  const fieldSample = {};
  const liftBases = config.lifts.map(lift => lift.bottomElevation).filter(Number.isFinite);
  const snowColor = new THREE.Color(), packed = new THREE.Color().setRGB(.847, .908, .973);
  const powder = new THREE.Color().setRGB(.831, .890, .956), iceColor = new THREE.Color().setRGB(.591, .725, .833);
  const ground = {
    mesh: group, bounds, regionalBounds: regionBounds, snowMaterial: localMaterial,
    streamBackcountry: backcountry.stream,
    setDetailQuality: detailLOD.setQuality,
    updateDetail: detailLOD.update,
    snowlineOffset: survey && liftBases.length ? Math.min(...liftBases) - 630 : 0,
    forestAt, sampleStand: survey?.local.sample,
    fieldAt,
    heightAt,
    setNightLightField({ texture, limits }) {
      if (!nightLight) return null;
      nightLight.texture.value = texture;
      nightLight.limits.value.copy(limits);
      return nightLight.strength;
    },
    normalAt(x, z, out = new THREE.Vector3()) { heightAt(x, z, out, true); return out; },
    surfaceAt(x, z, out = {}) {
      const pack = climateUniforms.snowpack.value;
      let cover = 1;
      if (pack <= .98) {
        const weather = smoothstep(-165, 280, heightAt(x, z) - climateUniforms.snowline.value);
        const known = insideTerrain(bounds, x, z) ? survey?.local
          : insideTerrain(regionBounds, x, z) ? survey?.region : null;
        cover = known ? Math.max(known.sample(x, z, landscapeSample)[2] / 100, pack,
          weather * smoothstep(0,.60,pack)) : Math.max(pack, weather);
      }
      if (cover < .28) {
        out.id = 'ground';
        out.grip = 1;
        out.drag = 3;
        out.powder = 0;
        return out;
      }
      const { groomed, ice, canopy } = fieldAt(x, z, fieldSample);
      const powder = (1 - groomed) * (1 - ice) * (.76 + .23 * canopy);
      out.id = ice > .53 ? 'ice' : powder > .46 ? 'powder' : 'packed';
      out.grip = 1 - .61 * ice - .28 * powder;
      out.drag = 1 - .32 * ice + .54 * powder;
      out.powder = (.11 + .89 * powder) * (1 - ice) * cover;
      return compressSnow(x, z, out);
    },
    sampleSnowSurface(x, z, color, normal) {
      const { groomed, ice } = fieldAt(x, z, fieldSample);
      if (color) color.copy(snowColor.copy(powder).lerp(packed, groomed).lerp(iceColor, ice * .75));
      return heightAt(x, z, normal);
    },
  };
  return ground;
}
