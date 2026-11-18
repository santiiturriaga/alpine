import * as THREE from 'three';
import { climateUniforms } from './climate-state.js';
import { heightAt } from './terrain.js';
import { canvasTexture, lerp, makeCanvas, makeNoise, mulberry32 } from './util.js';

const snowBanks = [
  // Piles against planter rims, fence runs and the snow-side lift apron.
  [-38.4, -93.1, 3.4, 1.24, -.40, .39],
  [-36.95, -93.13, 1.4, .85, -.84, .24],
  [-51.2, -83.1, 2.05, .95, -.30, .24],
  [-54.1, -84.12, 3.0, .93, -.30, .30],
  [-58.1, -85.25, 2.3, 1.08, .58, .34],
  [-65.24, -87.1, 3.7, 1.00, -.39, .36],
  [-72.1, -89.7, 3.45, 1.26, -.43, .36],
  [-18.2, -84.0, 2.9, 1.12, .36, .40],
  [-17.1, -83.3, 1.6, .89, .52, .26],
  [20.6, -83.42, 3.0, 1.24, -.18, .42],
  [-94.8, -24.1, 3.3, 1.27, -.61, .43],
  [-61.8, -4.0, 4.7, 1.25, -.74, .41],
];

function snowAndTrafficMap() {
  // Red holds accumulation, green holds wet wear and blue holds boot impressions.
  // The texture is sampled directly on the paving in metres.
  const { canvas, ctx } = makeCanvas(2048, 2048);
  const rand = mulberry32(6108);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(canvas.width / 168, 0, 0, canvas.height / 152, canvas.width * 128 / 168, canvas.height * 128 / 152);
  ctx.globalCompositeOperation = 'screen';

  function deposit(x, z, long, width, angle, amount) {
    ctx.save();
    ctx.translate(x, z); ctx.rotate(angle); ctx.scale(long, width);
    const stain = ctx.createRadialGradient(0, 0, .10, 0, 0, 1);
    for (const [r, density] of [[0, 1], [.52, .85], [.75, .46], [1, 0]]) {
      stain.addColorStop(r, `rgba(255,0,0,${amount * density})`);
    }
    ctx.fillStyle = stain;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }
  for (const [x, z, length, width, angle] of snowBanks) deposit(x, z, length * .88, width * 1.3, angle, .94);
  // Push residual snow out toward the patios and buildings, with wet stone
  // across the through-route and a few broken streaks where the paths meet.
  const edges = [
    [[-89,-104],[-80,-98],[-68,-91],[-61,-86],[-51,-83]],
    [[-51,-94],[-45,-92],[-39,-93],[-39,-99],[-36,-107]],
    [[-22,-91],[-19,-85],[-13,-85],[-5,-88],[9,-91],[21,-87]],
    [[-44,-81],[-41,-80],[-38,-80.4],[-35.6,-79.5]],
    [[-32.2,-77.2],[-29.8,-79.4],[-25.7,-79.3],[-22.8,-80.7]],
    [[-49,-71],[-46,-66],[-47,-61],[-51,-55],[-48,-50]],
    [[-13,-43],[-32,-31],[-49,-22],[-62,-19]],
    [[-106,-24],[-98,-26],[-89,-29],[-83,-35]],
    [[-72,3],[-65,-2],[-60,-6],[-54,-13]],
    [[-98,1],[-104,0],[-114,7],[-117,14]],
  ];
  for (const points of edges) {
    const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    const samples = curve.getSpacedPoints(Math.ceil(curve.getLength() / .81));
    for (let i = 1; i < samples.length; i++) {
      const { x, z } = samples[i], last = samples[i - 1], r = rand();
      if (r < .13) continue;
      const px = x + (rand() - .5) * .58, pz = z + (rand() - .5) * .58;
      const long = .85 + rand() * 1.26, width = .43 + rand() * .90;
      const angle = Math.atan2(z - last.z, x - last.x);
      deposit(px, pz, long * 1.4, width * 1.65, angle, .23);
      deposit(px, pz, long, width, angle, .40 + r * .40);
    }
  }
  for (const [x, z, width, long, angle] of [
    [-35.3,-75.8,.70,2.3,-.45], [-35,-78.1,.37,.92,-.4], [-30.4,-76.4,.48,1.47,-.2],
    [-32.9,-81.4,.61,1.47,.15], [-42.7,-85.2,1.28,1.83,.81], [-29.3,-88.4,.92,2.57,.39],
    [-58.8,-77.2,.63,2.51,-.37], [-23.9,-82.4,.51,1.18,.67], [-42.6,-90.1,.58,1.17,.58],
  ]) {
    deposit(x, z, long * 1.26, width * 1.54, angle, .24);
    deposit(x, z, long, width, angle, .70);
  }

  const walks = [
    [[-53,-72],[-43,-76],[-35,-81],[-35,-88],[-34,-100]],
    [[-19,-77],[-28,-82],[-39,-85],[-50,-85.8],[-66,-82]],
    [[-34,-70],[-33,-78],[-28,-85],[-26,-89]],
    [[-48,-66],[-42,-72],[-45,-82],[-53,-86]],
    [[-61,-4],[-68,-8],[-73,-15],[-68,-21],[-53,-36]],
    [[-46,-81.7],[-43.3,-80.8],[-40.5,-80.25],[-38,-80.2],[-35.8,-79.7],[-34.7,-76.6]],
    [[-22,-79.3],[-26.2,-79.9],[-29.6,-79.65],[-31.4,-77.8],[-32.1,-75.8]],
  ];
  ctx.lineCap = 'round';
  for (const [index, points] of walks.entries()) {
    const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    const length = curve.getLength();
    let step = 0;
    for (let distance = rand(); distance < length; distance += .43 + rand() * .19) {
      const point = curve.getPointAt(distance / length), direction = curve.getTangentAt(distance / length);
      if (rand() < .12) continue;
      const { x, z } = point;
      const angle = Math.atan2(direction.z, direction.x);
      const wear = .21 + rand() * .27;
      const spread = Math.sin(distance * 1.1) * .24;
      if (index % 2 === 0) for (const side of [-1, 1]) {
        if (rand() < .14) continue;
        const track = side * (index === 0 ? .41 : .27) + spread;
        const tx = x - direction.z * track, tz = z + direction.x * track;
        ctx.strokeStyle = `rgba(0,255,0,${wear})`;
        ctx.lineWidth = .14 + rand() * .10;
        ctx.beginPath();
        ctx.moveTo(tx - direction.x * .25, tz - direction.z * .25);
        ctx.lineTo(tx + direction.x * .42, tz + direction.z * .42);
        ctx.stroke();
      }
      for (let pass = 0; pass < 3; pass++) {
        const width = (pass - 1) * .53 + (rand() - .5) * .28 + (step % 2 ? .12 : -.12);
        ctx.save();
        ctx.translate(x - direction.z * width, z + direction.x * width);
        ctx.rotate(angle + (rand() - .5) * .52);
        ctx.fillStyle = `rgba(0,0,255,${.28 + rand() * .58})`;
        ctx.beginPath();
        ctx.ellipse(-.097, .01, .081, .075, .04, 0, Math.PI * 2);
        ctx.moveTo(.183, .001);
        ctx.ellipse(.077, .001, .106, .079, -.10, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      step++;
    }
  }
  const texture = canvasTexture(canvas, { flipY: false, srgb: false });
  texture.anisotropy = 8;
  return texture;
}

const snowGrain = /* glsl */ `
  varying vec2 plazaGround;
  float snowHash(vec2 p) {
    vec3 h=fract(p.xyx*.1031);
    h+=dot(h,h.yzx+33.33);
    return fract((h.x+h.y)*h.z);
  }
  float snowNoise(vec2 p) {
    vec2 i=floor(p), f=fract(p);
    f=f*f*(3.-2.*f);
    return mix(mix(snowHash(i),snowHash(i+vec2(1,0)),f.x),
      mix(snowHash(i+vec2(0,1)),snowHash(i+vec2(1,1)),f.x),f.y);
  }
  vec3 snowRelief(vec3 n,float h) {
    vec3 x=dFdx(-vViewPosition),y=dFdy(-vViewPosition);
    vec3 a=cross(y,n),b=cross(n,x);
    float d=dot(x,a);
    return normalize(max(abs(d),1e-12)*n-sign(d)*(dFdx(h)*a+dFdy(h)*b));
  }
`;

function snowShader(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 plazaGround;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nplazaGround=position.xz;');
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + snowGrain);
}

export function applyPaverWeather(material) {
  const trafficMap = snowAndTrafficMap();
  material.customProgramCacheKey = () => 'skiers-plaza-paver-weather';
  material.onBeforeCompile = shader => {
    shader.uniforms.plazaTraffic = { value: trafficMap };
    shader.uniforms.plazaSnowpack = climateUniforms.snowpack;
    snowShader(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D plazaTraffic;\nuniform float plazaSnowpack;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float winter=smoothstep(.70,.99,plazaSnowpack);
        vec3 marks=texture2D(plazaTraffic,(plazaGround+128.)/vec2(168.,152.)).rgb;
        float coarse=snowNoise(plazaGround*vec2(1.9,1.45));
        float grit=snowNoise(plazaGround*24.);
        float salt=snowNoise(plazaGround*112.);
        float grainLimit=1.-smoothstep(.32,1.13,length(fwidth(plazaGround*112.)));
        float wear=clamp(marks.g*.76+marks.b*.86,0.,.94);
        float pack=marks.r*(.45+.39*coarse+.27*grit)*(1.-wear*.94);
        float icy=smoothstep(.035,.49,pack);
        float opaque=smoothstep(.25,.76,pack);
        float wet=clamp(icy*(1.-opaque)*.88+wear*.57+.34*coarse,0.,.92);
        vec3 paver=diffuseColor.rgb;
        // Let joints and warmer bricks read through the thinnest patches.
        vec3 slush=mix(paver*vec3(.63,.68,.73),vec3(.28,.32,.34),
          .38+icy*.35+(salt-.5)*grainLimit*.24);
        vec3 snow=vec3(.72,.78,.82)*(.69+.20*grit+.15*coarse+(salt-.5)*grainLimit*.22);
        vec3 winterColor=mix(paver*(1.-wet*.53),slush,icy*.86);
        winterColor=mix(winterColor,snow,opaque*.91);
        diffuseColor.rgb=mix(paver,winterColor,winter);
        float relief=winter*(.008*grit*icy+.0016*salt*grainLimit*icy-.013*marks.b*icy);
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor=mix(roughnessFactor,mix(.93,.43,wet*(1.-opaque)),winter);`)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal=snowRelief(normal,relief);');
  };
}

export function makeShoveledBanks() {
  const positions = [], colors = [], indices = [];
  const shape = makeNoise(4479);
  const steps = 14, across = 12;
  for (const [x, z, length, width, angle, depth] of snowBanks) {
    const start = positions.length / 3;
    const c = Math.cos(angle), s = Math.sin(angle);
    for (let i = 0; i <= steps; i++) for (let j = 0; j <= across; j++) {
      const u = i / steps, v = 2 * j / across - 1;
      const roll = shape.noise2(x + u * 5, z + v * 1.9);
      const lumps = .85 + .29 * shape.noise2(x + 6 * u, z + 4 * v) + .12 * Math.sin(20 * u + 4 * v);
      const t = (u - .5) * length;
      const offset = width * .5 * (v * (1 + .29 * roll) + .26 * Math.sin(u * 6 + x));
      const px = x + c * t - s * offset, pz = z + s * t + c * offset;
      const mound = Math.sin(Math.PI * u) ** .65 * Math.max(0, 1 - v * v) ** 1.45 * lumps;
      positions.push(px, heightAt(px, pz) + .067 + depth * mound, pz);
      const stain = lerp(.53, .90, Math.min(1, mound * 1.85)) + roll * .074;
      colors.push(stain * .91, stain * .95, stain);
      if (i === steps || j === across) continue;
      const p = start + i * (across + 1) + j, q = p + across + 1;
      indices.push(p, p + 1, q, q, p + 1, q + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .86 });
  material.customProgramCacheKey = () => 'skiers-plaza-shoveled-banks';
  material.onBeforeCompile = shader => {
    snowShader(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float grains=snowNoise(plazaGround*32.);
        float salt=snowNoise(plazaGround*119.);
        float resolved=1.-smoothstep(.34,1.16,length(fwidth(plazaGround*119.)));
        diffuseColor.rgb*=.90+.19*grains+(salt-.5)*resolved*.14;
        float relief=grains*.0066+salt*resolved*.0011;`)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal=snowRelief(normal,relief);');
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Skiers Plaza · shoveled snow beside fences and planter rims';
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
