import * as THREE from 'three';
import { mix, mulberry32, smoothstep } from './math.js';
import { rampHeight, RAMP_LENGTH } from './sled-course.js';
import { SledMeshBuilder, tintedMaterial } from './sled-biome-mesh.js';

const white = new THREE.Color(0xffffff);
const snow = new THREE.Color('#d7e9f3');
const granite = new THREE.Color('#456679');

function waterMaterial(mode) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    seconds: { value: 0 }, mode: { value: mode }, crestFoam: { value: -300 },
  }]);
  return new THREE.ShaderMaterial({
    uniforms, fog: true, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec2 flowLine;
      varying vec3 worldPosition;
      void main() {
        flowLine = uv;
        worldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform float seconds;
      uniform float mode;
      uniform float crestFoam;
      varying vec2 flowLine;
      varying vec3 worldPosition;

      float wave(vec2 at) {
        return sin(at.x * 1.42 + at.y * .83) * .51
          + sin(at.x * 2.33 - at.y * 1.61) * .30
          + cos(at.x * 3.21 + at.y * 2.14) * .19;
      }

      void main() {
        float u = flowLine.x;
        float v = flowLine.y;
        float flow = v - seconds * 7.3;
        vec3 color;
        if (mode == 2.0) {
          float sheets = wave(vec2(u * 96.0, flow * .27));
          float glints = wave(vec2(u * 144.0 + sheets * 2.4, flow * .76));
          float streak = smoothstep(-.34, .82, sheets * .8 + glints * .46);
          color = mix(vec3(.051,.265,.386), vec3(.74,.906,.94), streak);
          color = mix(color, vec3(.90,.96,.97), smoothstep(15.0,23.0,v) * .66);
        } else {
          vec2 at = vec2(u * 28.0 + sin(flow * .12) * 1.4, flow * .29);
          if (mode == 1.0) at = vec2(u * 23.0, v * .55 - seconds * .58);
          float breakup = wave(at);
          float bright = smoothstep(.21,.86,breakup);
          float silver = smoothstep(.59,.87,wave(vec2(u * 15.0, flow * .52)) + breakup * .41);
          float rippled = .05 * sin(v * 2.5 - seconds * 10.0 + u * 46.0);
          float edge = pow(abs(2.0 * u - 1.0), 5.5);
          vec3 deep = mode == 1.0 ? vec3(.035,.16,.256) : vec3(.039,.225,.333);
          vec3 shallow = mode == 1.0 ? vec3(.30,.65,.72) : vec3(.135,.514,.605);
          color = mix(deep,shallow,clamp(edge*.84 + bright*.36 + rippled,0.0,1.0));
          float foam = smoothstep(.37,.92,bright + silver*.43) * edge;
          float pool = mode == 1.0 ? 1.0-smoothstep(4.0,17.0,abs(v-crestFoam)) : 0.0;
          float fresnel = pow(1.0 - abs(normalize(cameraPosition - worldPosition).y), 5.0);
          color = mix(color,vec3(.46,.72,.82),fresnel*.35 + silver*.22);
          color = mix(color,vec3(.86,.96,1.0),min(.92, foam*.59 + pool*bright*.69));
        }
        gl_FragColor = vec4(color,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

function surfaces(group, section, pointAt, gaps, river, lake, bank) {
  const { waterStart: start, waterEnd: end, halfWidth } = section;
  const entry = gaps.find(({ kind }) => kind === 'riverEntry');
  const falls = gaps.find(({ kind }) => kind === 'waterfall');
  const widthAt = d => halfWidth + .55 * Math.sin(d * .048) + .21 * Math.sin(d * .13);
  const lakeWidth = d => widthAt(d) + 5.3 * smoothstep(falls.end, falls.end + 16, d) * (1 - smoothstep(end - 35, end, d));
  const lakeCenter = d => (lakeWidth(d) - widthAt(d)) * .26;
  const reach = x => .18 + .39 * smoothstep(11.3, 17.8, Math.abs(x));
  const entryDepth = (t, x) => reach(x) - (.7 + 3.65 * Math.sin(t * Math.PI)) * (1 - smoothstep(.57, 1, t));
  const lakeAt = (u, d) => {
    const x = u * lakeWidth(d) + lakeCenter(d);
    return pointAt(x, d, reach(x));
  };
  const bright = new THREE.Color();

  function patch(name, a, b, divisions, material, shape) {
    if (!(b > a)) return;
    const strip = new SledMeshBuilder();
    const rows = Math.max(4, Math.ceil((b - a) / 2.0));
    const stride = divisions + 1;
    for (let row = 0; row <= rows; row++) {
      const d = mix(a, b, row / rows);
      for (let col = 0; col <= divisions; col++) {
        const u = col / divisions;
        const p = shape(2 * u - 1, d);
        const i = strip.vertex(p, white, u, d - start);
        if (row && col) strip.quad(i - stride - 1, i - stride, i, i - 1);
      }
    }
    strip.add(group, name, material);
  }

  if (entry) {
    patch('Snow lip into the river', entry.start - RAMP_LENGTH, entry.start, 14, bank,
      (u, d) => pointAt(u * widthAt(d), d, rampHeight(u * widthAt(d), Math.min(d, entry.start - .0001), gaps) + .04));
    patch('River below the entry lip', entry.start, entry.end, 22, river, (u, d) => {
      const x = u * widthAt(d);
      const t = (d - entry.start) / (entry.end - entry.start);
      return pointAt(x, d, entryDepth(t, x));
    });
  }

  patch('Flowing glacial river', entry?.end ?? start, falls?.start ?? end, 24, river, (u, d) => {
    const x = u * widthAt(d);
    const rise = falls ? rampHeight(x, Math.min(d, falls.start - .0001), gaps) : 0;
    return pointAt(x, d, rise + reach(x));
  });

  if (falls) {
    patch('Churning pool below Glacier Falls', falls.start + 2, falls.end, 26, lake, (u, d) => {
      const t = 1 - smoothstep(falls.start + 10, falls.end, d);
      const p = pointAt(u * (lakeWidth(falls.end) + t * 1.6), d);
      p.y = lakeAt(u, falls.end).y;
      return p;
    });
    patch('Glacier Falls lake', falls.end, end, 26, lake, lakeAt);
    lake.uniforms.crestFoam.value = falls.start - start + 6;
  }

  for (const gap of [entry, falls]) {
    if (!gap) continue;
    const sides = new SledMeshBuilder();
    const depth = gap === entry ? 6.3 : pointAt(0, gap.start).y - pointAt(0, gap.end).y + 4.1;
    for (const edge of [gap.start, gap.end]) {
      const forward = edge === gap.start ? 1 : -1;
      const ledges = [0, .16, .42, .76, 1];
      for (let col = 0; col <= 32; col++) {
        const x = (col / 16 - 1) * 38;
        for (let row = 0; row < ledges.length; row++) {
          const t = ledges[row];
          const d = edge + forward * (t * 2.8 + Math.sin(x * .93) * .62 * t);
          const offset = edge === gap.start ? rampHeight(x, edge - .0001, gaps) : 0;
          const p = pointAt(x + Math.sin(x * .45 + row * .74) * .49 * t, d, offset - depth * t);
          bright.copy(snow).lerp(granite, Math.min(1, t * 1.44)).multiplyScalar(.80 + .19 * Math.cos(x * .81 - t * 13.3));
          const i = sides.vertex(p, bright);
          if (row && col) sides.quad(i - ledges.length - 1, i - 1, i, i - ledges.length);
        }
      }
    }
    for (const sign of [-1, 1]) {
      const columns = [-.50, .67, 2.7, 5.1, 8.3, 12, 17, 23, 32, 46, 64, 86, 105];
      const rows = 21;
      for (let row = 0; row <= rows; row++) {
        const d = mix(gap.start, gap.end, row / rows);
        const extent = gap === entry ? widthAt(d) : lakeWidth(gap.end) + 1.6 * (1 - smoothstep(gap.start + 10, gap.end, d));
        const edge = gap === entry ? pointAt(sign * extent, d, entryDepth(row / rows, sign * extent)).y : lakeAt(sign, gap.end).y;
        for (let col = 0; col < columns.length; col++) {
          const x = sign * Math.min(120, extent + columns[col]);
          const p = pointAt(x, d);
          const shoulder = smoothstep(-.25, 12, columns[col]);
          p.y = mix(edge - .32, p.y, shoulder);
          bright.copy(granite).lerp(snow, shoulder);
          const i = sides.vertex(p, bright);
          if (row && col) sides.quad(i - columns.length - 1, i - columns.length, i, i - 1);
        }
      }
    }
    sides.add(group, gap === entry ? 'Snow ledges at the river entrance' : 'Exposed blue stone in the waterfall gorge', bank);
  }
  return falls;
}

function waterfall(group, section, gap, pointAt, material) {
  const curtain = new SledMeshBuilder();
  const sheetWidth = section.halfWidth;
  const bottom = pointAt(0, gap.end, .14).y;
  const cols = 34, rows = 17;
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    for (let col = 0; col <= cols; col++) {
      const u = col / cols;
      const x = (u * 2 - 1) * (sheetWidth + t * 1.1);
      const d = gap.start + .09 + t * 5.55 + Math.sin(u * 16 + t * 7) * .58 * t;
      const crest = pointAt(x, gap.start, (gap.rise ?? 3.65) + .12).y;
      const p = pointAt(x, d);
      p.y = mix(crest, bottom, t ** 1.26);
      const i = curtain.vertex(p, white, u, t * 25);
      if (row && col) curtain.quad(i - cols - 2, i - cols - 1, i, i - 1);
    }
  }
  curtain.add(group, 'Glacier Falls water curtain', material);
}

function spray(group, section, gap, pointAt) {
  const random = mulberry32((section.start ^ 419) >>> 0);
  const particles = new Float32Array(3 * 138);
  const center = pointAt(0, gap.start + 6.0);
  center.y = pointAt(0, gap.end, .30).y;
  for (let i = 0; i < particles.length; i++) particles[i] = random();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(particles, 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 42);
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { seconds: { value: 0 } }]);
  const material = new THREE.ShaderMaterial({
    uniforms, fog: true, transparent: true, depthWrite: false,
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      uniform float seconds;
      varying float fade;
      void main() {
        float age = fract(position.y + seconds * (.24 + .09 * position.z));
        vec3 p = vec3((position.x - .5) * (34.0 + age * 16.0), 2.4 + 15.0 * age - 10.0 * age * age,
          -position.z * 8.0 - age * (8.0 + 7.0 * position.x));
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp((90.0 + 500.0 * age) / max(1.0, -mvPosition.z), 1.0, 36.0);
        fade = smoothstep(0.0,.13,age) * (1.0 - smoothstep(.42,1.0,age));
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      varying float fade;
      void main() {
        float soft = 1.0 - smoothstep(.02,.50,length(gl_PointCoord - .5));
        gl_FragColor = vec4(.70,.90,.96,fade * soft * soft * .38);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  const plume = new THREE.Points(geometry, material);
  plume.position.copy(center);
  plume.name = 'Glacier Falls spray';
  group.add(plume);
  return material;
}

export function buildRiverArt(group, section, gaps, pointAt) {
  const river = waterMaterial(0), lake = waterMaterial(1);
  const bank = tintedMaterial({ color: '#d8e6eb', side: THREE.DoubleSide });
  const falls = surfaces(group, section, pointAt, gaps, river, lake, bank);
  const moving = [river];
  if (falls) {
    const curtain = waterMaterial(2);
    waterfall(group, section, falls, pointAt, curtain);
    moving.push(lake, curtain, spray(group, section, falls, pointAt));
  } else {
    lake.dispose();
  }
  return elapsed => {
    for (const material of moving) material.uniforms.seconds.value = elapsed;
  };
}
