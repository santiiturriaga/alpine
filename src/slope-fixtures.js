import * as THREE from 'three';
import { box, mergeParts, part } from './scenery.js';
import { mulberry32, smoothstep } from './util.js';

const NIGHT_RUNS = {
  // Yellow night-operations lines on the bundled 2024–25 Stevens Pass trail map.
  'stevens-pass': [
    'skyline', 'barrier-ridge', 'marmot-meadows', 'broadway', 'waterfall', 'one-light',
    'easy-street', 'easy-street-2', 'blue-trail', 'rock-n-blue', 'rock-n-blue-2', 'hog-wild',
    'hog-heaven', 'hagen-hill', 'slow-poke', 'crest-trail', 'skid-road', 'skid-road-2', 'showcase',
  ],
  // Summit West and Central plus Alpental's lower mountain, inside the yellow map outlines.
  snoqualmie: [
    'alpine', 'broadway', 'short-cut', 'triple-60', 'triple-60-face', 'rip-cord', 'parachute',
    'gallery', 'holiday', 'sunrise', 'silver-fir', 'tanners-pass', 'wayback', 'wayback-2',
    'wildside', 'main-chute', 'thunderbird', 'thunderbolt', 'little-thunder', 'big-bill',
    'dodge-ridge', 'julies', 'julies-2', 'freeriders', '360-bowl', 'cascade-traverse',
    'debbies-gold', 'sessel', 'gala', 'st-bernard',
  ],
  // The resort's Discovery, Gold Hills and Quicksilver night lift zones.
  'crystal-mountain': ['discovery-meadow', 'gold-hills', 'quicksilver', 'tinkerbell', 'jump-hill', 'laubas-lane'],
  // Yellow night trails on the unified Niseko map and current Grand Hirafu plan.
  'niseko-united': [
    'family', 'sennoki', 'sennoki-2', 'sennoki-3', 'super', 'super-2', 'alpen', 'alpen-2',
    'green', 'green-2', 'king-area-access-pass', 'king-area-access-pass-2', 'kogen', 'kogen-2',
    'beginners-access', 'kokutai', 'kokutai-2', 'boyo', 'boyo-2', '2-ni-kabe', 'furiko',
    'paradise', 'family-2', 'family-3', 'junior', 'dynamic', 'dynamic-3',
    'banzai', 'ageimo', 'ageimo-2', 'ageimo-3', 'collys-folly', 'juicy-fruit',
  ],
};
// Representative machine placement along lower approaches and the early-season groomers.
const WHISTLER_SNOWMAKING = /^(Lower Olympic|Olympic Run|Gondola Way|Green Road|Dave Murray Downhill|Peak to Creek|Ego Bowl|Big Easy|Whisky Jack|Lower Whisky Jack|Upper Easy Out|Little Red Run|Enchanted Forest)$/i;

export function nightRunsFor(config) {
  return config.nightRuns ?? NIGHT_RUNS[config.id] ?? [];
}

function routeStations(points, spacing) {
  let travelled = 0, next = 20;
  const stations = [];
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1], [bx, bz] = points[i];
    const length = Math.hypot(bx - ax, bz - az);
    if (length < .1) continue;
    const tx = (bx - ax) / length, tz = (bz - az) / length;
    while (next <= travelled + length) {
      const distance = next - travelled;
      stations.push({ x: ax + distance * tx, z: az + distance * tz, tx, tz });
      next += spacing;
    }
    travelled += length;
  }
  return stations;
}

function placeFixtures(ground, runs, env, { spacing, separation, standOff, maxY = Infinity }) {
  const fixtures = [];
  function isOpen(x, y, z) {
    if (env.isOpen) return env.isOpen(x, y + .8, z, .55);
    return !env.queryColliders?.(x, z, 3).some(c =>
      y + 2.7 >= (c.minY ?? -Infinity) && y <= (c.maxY ?? Infinity)
      && (c.r ? Math.hypot(x - c.x, z - c.z) < c.r + .56 : env.pointInBox?.(x, z, c, .56, .56)));
  }
  for (const run of runs) {
    const width = run.halfWidth ?? (run.width ? run.width * .5 : run.difficulty === 'green' ? 14 : 17);
    for (const { x, z, tx, tz } of routeStations(run.points, spacing)) {
      const preferred = fixtures.length % 2 ? -1 : 1;
      for (const side of [preferred, -preferred]) {
        const offset = width + standOff;
        const px = x + tz * side * offset, pz = z - tx * side * offset;
        const y = ground.heightAt(px, pz);
        if (!Number.isFinite(y) || y > maxY || !isOpen(px, y, pz)) continue;
        if (fixtures.some(f => Math.hypot(f.x - px, f.z - pz) < separation)) continue;
        const downhill = ground.heightAt(x + tx * 11, z + tz * 11) < ground.heightAt(x - tx * 11, z - tz * 11) ? 1 : -1;
        const direction = new THREE.Vector2(x - px + tx * downhill * 12, z - pz + tz * downhill * 12).normalize();
        fixtures.push({ x: px, y, z: pz, dx: direction.x, dz: direction.y, width, run: run.name });
        break;
      }
    }
  }
  return fixtures;
}

function addInstanced(parent, geometry, material, fixtures, name) {
  const mesh = new THREE.InstancedMesh(geometry, material, fixtures.length);
  const dummy = new THREE.Object3D();
  fixtures.forEach(({x, y, z, dx, dz}, i) => {
    dummy.position.set(x,y,z);
    dummy.rotation.y = Math.atan2(dx,dz);
    dummy.updateMatrix();
    mesh.setMatrixAt(i,dummy.matrix);
  });
  mesh.name = name;
  mesh.computeBoundingSphere();
  parent.add(mesh);
  return mesh;
}

const poleHeight = 10.7;
const lightFront = .38;

function floodlightGeometry() {
  const housing = [
    part(new THREE.CylinderGeometry(.132,.21,poleHeight,9), '#6d7880', [0,poleHeight*.5,0]),
    part(new THREE.CylinderGeometry(.35,.43,.28,9), '#777e7c', [0,.04,0]),
    box(.30,1.25,.32,'#e2a645',[0,.66,0]),
    box(1.78,.13,.18,'#596871',[0,poleHeight-.33,0]),
    box(.22,.47,.15,'#4d555c',[0,poleHeight-.30,-.15]),
  ];
  const lenses = [];
  for (const x of [-.65,0,.65]) {
    const y = poleHeight - .08 + (x === 0 ? .13 : 0);
    const yaw = Math.sign(x) * .21, pitch = .43;
    housing.push(box(.12,.42,.12,'#65737d',[x,y-.18,0]));
    housing.push(box(.54,.35,.26,'#344150',[x,y,.16],[pitch,yaw,0]));
    housing.push(box(.53,.13,.20,'#344150',[x,y+.14,.30],[pitch,yaw,0]));
    lenses.push(box(.47,.257,.025,'#fff8df',[x+Math.sin(yaw)*.12,y-Math.sin(pitch)*.11,.287],[pitch,yaw,0]));
  }
  return { housing: mergeParts(housing), lenses: mergeParts(lenses) };
}

function bakeFloodlightField(fixtures) {
  const minX = Math.min(...fixtures.map(f => f.x)) - 88, maxX = Math.max(...fixtures.map(f => f.x)) + 88;
  const minZ = Math.min(...fixtures.map(f => f.z)) - 88, maxZ = Math.max(...fixtures.map(f => f.z)) + 88;
  const width = Math.ceil((maxX - minX) / 4), height = Math.ceil((maxZ - minZ) / 4);
  const sx = (maxX - minX) / width, sz = (maxZ - minZ) / height;
  const data = new Uint8Array(width * height * 4);
  for (const { x, z, dx, dz, width: piste, cool } of fixtures) {
    const originX = x + dx * (piste + 6), originZ = z + dz * (piste + 6);
    const lateral = Math.max(40,piste * 1.9);
    const range = Math.max(lateral,34);
    const minI = Math.max(0,Math.floor((originX - range - minX)/sx));
    const maxI = Math.min(width-1,Math.ceil((originX + range - minX)/sx));
    const minJ = Math.max(0,Math.floor((originZ - range - minZ)/sz));
    const maxJ = Math.min(height-1,Math.ceil((originZ + range - minZ)/sz));
    for (let j = minJ; j <= maxJ; j++) for (let i = minI; i <= maxI; i++) {
      const px = minX + (i + .5)*sx - originX, pz = minZ + (j + .5)*sz - originZ;
      const across = (px * dx + pz * dz) / Math.max(28,piste*1.32);
      const along = (px * dz - pz * dx) / lateral;
      const shape = across * across + along * along;
      const strength = (1 - smoothstep(.035, 1.4, shape)) ** 1.16;
      const index = (j * width + i)*4 + Number(cool);
      data[index] = Math.min(255,data[index] + Math.round(strength*(cool?110:148)));
    }
  }
  const texture = new THREE.DataTexture(data,width,height,THREE.RGBAFormat);
  texture.name = 'Slope floodlight irradiance';
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return { texture, limits: new THREE.Vector4(minX,minZ,maxX-minX,maxZ-minZ) };
}

function buildFloodlights(parent, ground, fixtures) {
  if (!fixtures.length) return;
  const shapes = floodlightGeometry();
  addInstanced(parent, shapes.housing, new THREE.MeshStandardMaterial({vertexColors:true,roughness:.69,metalness:.36}), fixtures, 'Galvanized slope floodlights');
  const lens = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .38, emissive: '#fff8ef', emissiveIntensity: 0 });
  lens.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vColor.rgb;');
  };
  const lamps = addInstanced(parent, shapes.lenses, lens, fixtures, 'Floodlight panels');
  const positions = [], colors = [];
  for (const [i,fixture] of fixtures.entries()) {
    const { x, y, z, dx, dz, cool } = fixture;
    const tint = new THREE.Color(cool ? '#b9ddff' : '#ffcf8e');
    lamps.setColorAt(i,tint);
    positions.push(x + dx*lightFront, y + poleHeight - .01, z + dz*lightFront);
    colors.push(tint.r,tint.g,tint.b);
  }
  const strength = ground.setNightLightField(bakeFloodlightField(fixtures)) ?? { value: 0 };
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('bulbColor',new THREE.Float32BufferAttribute(colors,3));
  const uniforms = { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), strength };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, fog:true,
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      attribute vec3 bulbColor;
      varying vec3 lampColor;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position,1.);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp(1700.0 / max(1.0,-mvPosition.z),4.0,58.0);
        lampColor = bulbColor;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      varying vec3 lampColor;
      uniform float strength;
      void main() {
        vec2 p = gl_PointCoord-.5;
        float r = length(p);
        float halo = exp(-r*r*22.)*(1.-smoothstep(.22,.5,r));
        float core = 1.-smoothstep(.014,.11,r);
        #if defined(USE_FOG) && defined(FOG_EXP2)
          float fog = exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
        #elif defined(USE_FOG)
          float fog = 1.-smoothstep(fogNear,fogFar,vFogDepth);
        #else
          float fog = 1.;
        #endif
        gl_FragColor = vec4(lampColor, (core*.91+halo*.24)*strength*fog);
        #include <colorspace_fragment>
      }
    `,
  });
  const glow = new THREE.Points(geometry,mat);
  glow.name = 'Floodlight halos';
  parent.add(glow);
  return ({night}) => {
    strength.value = smoothstep(.49,.98,night);
    lens.emissiveIntensity = strength.value*2.8;
    glow.visible = strength.value > .006;
  };
}

const fanY = 2.28, fanPitch = -.11;

function snowGunGeometry() {
  const body = [
    part(new THREE.CylinderGeometry(.32,.39,.20,10),'#62686c',[0,.08,0]),
    part(new THREE.CylinderGeometry(.15,.20,1.92,10),'#81939c',[0,1.02,0]),
    box(.48,.56,.35,'#496675',[.16,1.47,.02]),
    box(.38,.42,.038,'#ded9b3',[.19,1.47,.20]),
    box(.08,.58,.13,'#2a3436',[-.24,.76,.08],[0,0,-.12]),
    box(.11,.56,.24,'#60727c',[-.43,1.99,0],[0,0,-.19]),
    box(.11,.56,.24,'#60727c',[.43,1.99,0],[0,0,.19]),
    part(new THREE.CylinderGeometry(.128,.128,.98,10),'#3e5263',[0,fanY-.26,.02],[0,0,Math.PI/2]),
  ];
  const rotor = [];
  function barrel(geometry,color,x,y,z,rx = 0,ry = 0,rz = 0) {
    geometry.rotateX(rx).rotateY(ry).rotateZ(rz).translate(x,y,z).rotateX(fanPitch).translate(0,fanY,0);
    return part(geometry,color);
  }
  const drum = new THREE.CylinderGeometry(.50,.557,.98,18,1,true);
  body.push(barrel(drum,'#0f73a9',0,0,0,Math.PI/2));
  body.push(barrel(new THREE.CylinderGeometry(.485,.497,.91,18,1,true).scale(-1,1,1),'#26363c',0,0,0,Math.PI/2));
  // Duct, nozzle ring, perimeter jet tips and the recessed axial fan.
  for (const [z,r,wire,colour] of [[.50,.525,.049,'#b0c3cb'],[-.50,.512,.032,'#748c99'],[.477,.455,.023,'#687d87']]) {
    body.push(barrel(new THREE.TorusGeometry(r,wire,5,18),colour,0,0,z));
  }
  body.push(barrel(new THREE.CircleGeometry(.489,22),'#23323b',0,0,-.425));
  body.push(barrel(new THREE.SphereGeometry(.11,10,8),'#aabdc4',0,0,-.114));
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    body.push(barrel(new THREE.CylinderGeometry(.024,.035,.057,5),'#e7d79e',.525*Math.sin(a),.525*Math.cos(a),.543,Math.PI/2));
  }
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    rotor.push(box(.122,.29,.034,'#adbfc8',[-.26*Math.sin(a),.26*Math.cos(a),-.15],[.34,0,a+.25]));
  }
  return { body: mergeParts(body), rotor: mergeParts(rotor) };
}

function addSnowSpray(parent, units) {
  const count = 4, particles = 240;
  const positions = [], slots = [];
  const rand = mulberry32(44255);
  for (let i = 0; i < count; i++) for (let j = 0; j < particles; j++) {
    positions.push(rand(),rand(),rand());
    slots.push(i);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('slot',new THREE.Float32BufferAttribute(slots,1));
  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), seconds: {value:0}, night: {value:0}, wind: {value:0},
    emitters: {value:Array.from({length:count},() => new THREE.Vector3())},
    directions: {value:Array.from({length:count},() => new THREE.Vector3())},
  };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent:true, depthWrite:false, fog:true,
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      attribute float slot;
      uniform float seconds;
      uniform float wind;
      uniform vec3 emitters[4];
      uniform vec3 directions[4];
      varying float opacity;
      void main() {
        vec3 nozzle = emitters[int(slot)], flow = directions[int(slot)];
        if (flow.y < .5) {gl_Position=vec4(2.,2.,2.,1.);gl_PointSize=1.;return;}
        float age = fract(position.x + seconds*mix(.25,.52,position.z));
        float theta = position.y*6.283+age*.9;
        float spread = (.08+pow(age,1.3)*2.69)*sqrt(position.z);
        vec3 point = nozzle + vec3(flow.x,0.,flow.z)*age*(11.0+position.z*9.0);
        point.xz += vec2(flow.z,-flow.x)*cos(theta)*spread + vec2(-.32,.43)*wind*age*age;
        point.y += 1.9*age - 3.45*age*age + sin(theta)*spread*.67;
        vec4 mvPosition = modelViewMatrix*vec4(point,1.);
        gl_Position = projectionMatrix*mvPosition;
        gl_PointSize = clamp((65. + age*170.)/max(1.,-mvPosition.z),1.0,18.0);
        opacity = smoothstep(0.0,.07,age)*(1.-smoothstep(.61,1.,age)) * mix(.15,.43,position.z);
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform float night;
      varying float opacity;
      void main() {
        float shape = 1.0 - smoothstep(.14,.48,length(gl_PointCoord-.5));
        gl_FragColor = vec4(mix(vec3(.82,.93,1.0),vec3(.28,.51,.78),night),opacity*shape*shape);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  const spray = new THREE.Points(geometry,material);
  spray.frustumCulled = false;
  spray.name = 'Snowmaking plumes';
  parent.add(spray);
  let resample = 0;
  return (dt, seconds, weather, camera) => {
    const enabled = weather.season === 'winter' && weather.precipitation < .54;
    spray.visible = false;
    if (!enabled || !camera) { resample = 0; return false; }
    if (seconds >= resample) {
      resample = seconds + .32;
      const near = units.map((unit,i) => [unit,Math.hypot(unit.x-camera.position.x, unit.y-camera.position.y, unit.z-camera.position.z),i])
        .filter(([,distance,i]) => distance < 155 && i % 3 !== 2).sort((a,b) => a[1]-b[1]).slice(0,count);
      for (let i = 0; i < count; i++) {
        const unit = near[i]?.[0];
        uniforms.directions.value[i].y = unit ? 1 : 0;
        if (!unit) continue;
        const { x,y,z,dx,dz } = unit;
        uniforms.emitters.value[i].set(x+dx*.56,y+fanY+.052,z+dz*.56);
        uniforms.directions.value[i].set(dx,1,dz);
      }
    }
    spray.visible = uniforms.directions.value[0].y > .5;
    uniforms.seconds.value = seconds;
    uniforms.night.value = weather.night;
    uniforms.wind.value = weather.wind;
    return spray.visible;
  };
}

function buildSnowGuns(parent, fixtures) {
  if (!fixtures.length) return;
  const geometry = snowGunGeometry();
  const steel = new THREE.MeshStandardMaterial({vertexColors:true, roughness:.52, metalness:.18});
  addInstanced(parent,geometry.body,steel,fixtures,'Fan snow guns');
  const blades = steel.clone();
  const angle = { value:0 };
  geometry.rotor.setAttribute('motor', new THREE.InstancedBufferAttribute(
    Float32Array.from(fixtures, (_, i) => Number(i % 3 !== 2)), 1));
  blades.onBeforeCompile = shader => {
    shader.uniforms.rotorAngle = angle;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float rotorAngle; attribute float motor;')
      .replace('#include <beginnormal_vertex>', /* glsl */ `
        #include <beginnormal_vertex>
        float a = rotorAngle * motor;
        mat2 spin = mat2(cos(a),sin(a),-sin(a),cos(a));
        mat2 tilt = mat2(cos(${fanPitch}),sin(${fanPitch}),-sin(${fanPitch}),cos(${fanPitch}));
        objectNormal.xy = spin * objectNormal.xy;
        objectNormal.yz = tilt * objectNormal.yz;
      `)
      .replace('#include <begin_vertex>',/* glsl */`
        #include <begin_vertex>
        transformed.xy = spin * transformed.xy;
        transformed.yz = tilt * transformed.yz;
        transformed.y += ${fanY};
      `);
  };
  blades.customProgramCacheKey = () => 'snow-gun-axial-rotor';
  addInstanced(parent,geometry.rotor,blades,fixtures,'Recessed snow gun fans');
  const updateSpray = addSnowSpray(parent,fixtures);
  return (dt, seconds, weather, camera) => {
    if (updateSpray(dt,seconds,weather,camera)) angle.value = (angle.value + dt * 39) % (Math.PI * 2);
  };
}

function setupFixtures(scene, name, ground, env, lights, guns) {
  const group = new THREE.Group();
  group.name = `${name} · piste equipment`;
  for (const [i,fixture] of lights.entries()) {
    fixture.cool = i%5===1 || i%5===2;
    (env.grid ?? env).addCircle?.(fixture.x,fixture.z,.35,'floodlight',{minY:fixture.y,maxY:fixture.y+poleHeight});
  }
  for (const {x,y,z} of guns) (env.grid ?? env).addCircle?.(x,z,.42,'snow-gun',{minY:y,maxY:y+2.84});
  const updateLights = buildFloodlights(group,ground,lights);
  const updateGuns = buildSnowGuns(group,guns);
  group.userData.fixtures = { lights, guns };
  scene.add(group);
  return { group, update(dt,seconds,weather,camera) {
    updateLights?.(weather);
    updateGuns?.(dt,seconds,weather,camera);
  } };
}

export function buildMappedSlopeFixtures(scene, config, ground, env) {
  const nightRuns = nightRunsFor(config);
  const runs = nightRuns.map(id => config.runs.find(run => run.id === id)).filter(Boolean);
  const lights = placeFixtures(ground,runs,env,{spacing:66,separation:34,standOff:.75});
  const guns = placeFixtures(ground,runs,env,{spacing:155,separation:60,standOff:3.8,maxY:1740})
    .filter(gun => !lights.some(lamp => Math.hypot(lamp.x-gun.x,lamp.z-gun.z) < 2.8));
  return setupFixtures(scene,config.name,ground,env,lights,guns);
}

export function buildWhistlerSnowmaking(scene, ground, runs, env) {
  const selected = runs.filter(({name}) => WHISTLER_SNOWMAKING.test(name));
  const guns = placeFixtures(ground,selected,env,{spacing:145,separation:64,standOff:1.9,maxY:1980});
  return setupFixtures(scene,'Whistler Blackcomb',ground,env,[],guns);
}
