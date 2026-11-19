import * as THREE from 'three';
import { WORLD } from './worlddata.js';
import { climateUniforms } from './climate-state.js';
import { bindSnowTraffic, snowTrafficGLSL } from './snow-traffic.js';
import { bindSnowCrystals } from './snow-crystals.js';
import { bindTerrainHorizon } from './terrain-horizon.js';

const terrainSurfaces = new Set();
let budgetSampling = false, noiseVolume;

// One shared 256 KiB lattice. Hardware interpolates the eight adjacent values
// per sample; the shader still controls each layer's scale and pixel footprint.
function terrainNoiseVolume() {
  if (noiseVolume) return noiseVolume;
  const size = 64, values = new Uint8Array(size ** 3);
  let seed = 49547;
  for (let i = 0; i < values.length; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    values[i] = seed >>> 24;
  }
  noiseVolume = new THREE.Data3DTexture(values, size, size, size);
  noiseVolume.name = 'Snow and rock noise lattice';
  noiseVolume.format = THREE.RedFormat;
  noiseVolume.minFilter = noiseVolume.magFilter = THREE.LinearFilter;
  noiseVolume.wrapR = noiseVolume.wrapT = noiseVolume.wrapS = THREE.RepeatWrapping;
  noiseVolume.needsUpdate = true;
  return noiseVolume;
}

export function setTerrainSamplingBudget(enabled) {
  if (enabled === budgetSampling) return;
  budgetSampling = enabled;
  for (const material of terrainSurfaces) material.needsUpdate = true;
}

const noise = /* glsl */ `
  varying vec3 surfacePoint;

  #ifdef TERRAIN_NOISE_VOLUME
  uniform highp sampler3D terrainNoise;
  float surfaceNoise(vec3 p) {
    vec3 f = fract(p);
    vec3 t = f*f*(3.0 - 2.0*f);
    return texture(terrainNoise, (floor(p) + t + .5) / 64.0).r;
  }
  #else
  float surfaceHash(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  float surfaceNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    vec3 t = f*f*(3.0 - 2.0*f);
    return mix(
      mix(mix(surfaceHash(i), surfaceHash(i+vec3(1,0,0)),t.x),
          mix(surfaceHash(i+vec3(0,1,0)),surfaceHash(i+vec3(1,1,0)),t.x),t.y),
      mix(mix(surfaceHash(i+vec3(0,0,1)),surfaceHash(i+vec3(1,0,1)),t.x),
          mix(surfaceHash(i+vec3(0,1,1)),surfaceHash(i+vec3(1,1,1)),t.x),t.y),t.z);
  }
  #endif

  float filteredSurfaceNoise(vec3 p) {
    float coverage = 1.0 - smoothstep(.37,1.12,max(length(dFdx(p)),length(dFdy(p))));
    if (coverage == 0.) return .5;
    return mix(.5,surfaceNoise(p),coverage);
  }

  vec3 surfaceNormal(vec3 surfPos, vec3 norm, float height) {
    vec3 dx = dFdx(surfPos);
    vec3 dy = dFdy(surfPos);
    vec3 r1 = cross(dy, norm);
    vec3 r2 = cross(norm, dx);
    float d = dot(dx, r1);
    vec3 gradient = sign(d) * (dFdx(height) * r1 + dFdy(height) * r2);
    return normalize(max(abs(d), 1e-12) * norm - gradient);
  }
`;

const surfaces = {
  snow: {
    color: /* glsl */ `
      vec3 p = surfacePoint;
      vec2 roomPoint = p.xz - roomCutout.xy;
      vec2 roomLocal = vec2(roomPoint.x*roomYaw.x-roomPoint.y*roomYaw.y,
        roomPoint.x*roomYaw.y+roomPoint.y*roomYaw.x);
      if (all(lessThan(abs(roomLocal),roomCutout.zw)) || all(lessThan(abs(roomLocal-annexCutout.xy),annexCutout.zw))) discard;
      float distanceToEye = length(vViewPosition);
      vec2 pisteUv = (p.xz - pisteLimits.xy) / pisteLimits.zw;
      vec4 snowMix = texture2D(pisteCoverage, pisteUv);
      float sunFromTerrain = mix(1.0, mix(.24, 1.0, texture2D(mountainShade,pisteUv).r), climateTerrainSun);
      float skyView = 1.;
      if (climateRealism > .5) {
        vec2 horizon = terrainLight(pisteUv);
        sunFromTerrain = mix(.08, 1., horizon.x);
        skyView = horizon.y;
      }
      float groomed = smoothstep(.21,.63,snowMix.r);
      float ice = smoothstep(.22,.53,snowMix.b);
      float traffic = trackPressure(p.xz) * (1.0-ice);
      float loose = smoothstep(.23,.77,snowMix.g)*(1.0-ice)*(1.0-.76*traffic);
      float detail = 1.0 - smoothstep(23.0, 125.0, distanceToEye);
      vec2 plazaUv = (p.xz - plazaLimits.xy) / plazaLimits.z;
      vec2 bowlUv = (p.xz - bowlLimits.xy) / bowlLimits.z;
      vec2 inPlaza = smoothstep(vec2(.004), vec2(.028), min(plazaUv, 1.0-plazaUv));
      vec2 inBowl = smoothstep(vec2(.004), vec2(.028), min(bowlUv, 1.0-bowlUv));
      float plazaTracks = texture2D(plazaSnow, vec2(plazaUv.x, 1.0-plazaUv.y)).r * inPlaza.x * inPlaza.y;
      float bowlTracks = texture2D(bowlSnow, vec2(bowlUv.x, 1.0-bowlUv.y)).r * inBowl.x * inBowl.y;
      float marks = max(plazaTracks, bowlTracks);
      vec2 villageUv = (p.xz - villageLimits.xy) / villageLimits.z;
      if(distanceToEye<95.0 && all(greaterThan(villageUv,vec2(0.))) && all(lessThan(villageUv,vec2(1.)))){
        marks=max(marks,texture2D(villageSnow,vec2(villageUv.x,1.-villageUv.y)).r);
      }
      float vicinity = 1.0 - smoothstep(125.0, 920.0, distanceToEye);
      vec2 wind = mat2(.82,-.57,.57,.82) * p.xz;
      float drift = filteredSurfaceNoise(vec3(wind.x*.115,p.y*.11,wind.y*.48));
      float scoured = filteredSurfaceNoise(vec3(wind.x*.032,p.y*.077,wind.y*.095) + drift * .27);
      float offPiste = 1.0 - smoothstep(.08,.44,snowMix.r);
      float canopy = smoothstep(.22,.78,filteredSurfaceNoise(p*vec3(.29,.12,.29))*.58 + scoured*.42);
      float forestEdge = smoothstep(.02,.32,snowMix.a);
      float forestExtent = smoothstep(.06,.88,snowMix.a + (canopy-.5)*.23*forestEdge) * offPiste;
      // Mapped trees stand above the snow. Ground tint remains slight beneath
      // sparse alpine stands and strengthens in dense woods at panorama range.
      float forestRime = smoothstep(1060.0,1790.0,p.y) * climateSnowpack;
      float understory = smoothstep(.34,.89,snowMix.a) * (1.0-smoothstep(1220.0,1690.0,p.y));
      float distantWoods = smoothstep(1050.0,3350.0,distanceToEye)
        * (1.0-smoothstep(1440.0,1830.0,p.y));
      diffuseColor.rgb *= 1.0 - forestExtent * (.095 + .10*(1.0-canopy)) * mix(1.0,.48,forestRime)
        - .19*offPiste*understory;
      vec3 distantGround = mix(vec3(.052,.071,.076),vec3(.20,.26,.29),canopy);
      diffuseColor.rgb = mix(diffuseColor.rgb,distantGround,forestExtent*distantWoods*.63);
      float crust = detail > .001 ? surfaceNoise(p * 2.35) : .5;
      float grain = detail > .001 ? surfaceNoise(p * 23.0) : .5;
      float microCoverage = 1.0 - smoothstep(.38, 1.20, length(fwidth(p * 23.0)));
      #ifdef FLAT_SHADED
        float up = 1.0;
      #else
        float up = clamp(dot(normalize(vNormal), mat3(viewMatrix) * vec3(0,1,0)),0.0,1.0);
      #endif
      // Persistent slide debris drapes the apron below the Cirque shoulder.
      vec2 cirque = mat2(-.8074,-.59,-.59,.8074)*(p.xz-vec2(-127.,5836.));
      float apron = (1.-smoothstep(62.,117.,abs(cirque.x)))
        * smoothstep(-132.,-70.,cirque.y) * (1.-smoothstep(14.,46.,cirque.y))
        * smoothstep(.39,.94,climateSnowpack);
      // Steep, exposed faces shed the snow between tilted rock beds.
      vec3 strata = vec3(wind.x*.056,p.y*.292 + wind.y*.052,wind.y*.063);
      float coarseFracture = filteredSurfaceNoise(strata + .56*scoured);
      float fineFracture = filteredSurfaceNoise(strata*vec3(10.5,8.0,13.0) + scoured);
      float fracture = smoothstep(.34,.67,coarseFracture + (fineFracture-.5)*(.25+.37*vicinity));
      float ledge = 1.0 - up + .15*(scoured-.5) + .09*(coarseFracture-.5);
      float exposed = offPiste * (1.0-apron*.96) * (1.0-.82*forestExtent) * smoothstep(1250.0,1840.0,p.y)
        * smoothstep(.225,.43,ledge);
      vec3 shale = mix(vec3(.025,.029,.033),vec3(.183,.168,.148),fracture);
      float rimed = smoothstep(.42,.77,.57*scoured+.43*drift + .16*(1.0-fracture));
      float dune = (.096 + .144 * loose) * drift * (1.0 - .66 * groomed);
      // Elongated, irregular ripples model wind slabs and compressed snow.
      vec3 ripplePosition = vec3(p.x*.69 + p.z*.28, p.y*.29, p.z*2.04 - p.x*.8);
      float ripple = detail > .001 ? surfaceNoise(ripplePosition + .22 * scoured) : .5;
      float rippleWeight = 1.0 - smoothstep(.33,.92,length(fwidth(ripplePosition)));
      float detailNormals = .018 * crust + .0011 * grain * microCoverage;
      float polished = ice * smoothstep(.23,.67,.85*scoured+.28*drift) * (1.0-.40*marks) * (1.0-exposed);
      float useZone = max(inPlaza.x*inPlaza.y, inBowl.x*inBowl.y);
      vec3 clumpPoint=vec3(p.x*3.1,p.y*1.1,p.z*2.4);
      float clump=detail > .001 && useZone > .01
        ? smoothstep(.29,.79,surfaceNoise(clumpPoint+scoured*.9)) : .5;
      float churn=useZone * detail * (1.0-smoothstep(.34,.95,length(fwidth(clumpPoint))))
        * (.32 + .68*smoothstep(.06,.36,marks)) * (1.0-.7*polished);
      float relief = mix(dune * vicinity + detailNormals * detail, .016 * drift, polished) - .023*marks
        + .045 * ripple * detail * rippleWeight * (1.0 - groomed*.66)
        + .049 * churn * clump;
      // Small settled pillows overlap the longer wind ripples. Keep this
      // relief on loose snow and filter it away as it becomes subpixel.
      if (loose * detail > .01) {
        vec3 pillowPoint = vec3(p.x * 2.9 - p.z * 1.6, p.y * 1.7, p.z * 5.2 + p.x * 1.8);
        float pillows = smoothstep(.24, .79, surfaceNoise(pillowPoint + 1.8 * ripple));
        float visiblePillows = loose * detail * (1.0 - smoothstep(.36,.99,length(fwidth(pillowPoint))));
        relief += .023 * visiblePillows * pillows;
        diffuseColor.rgb *= 1.0 - visiblePillows * (.039 * (1.0 - pillows) + .023 * (1.0 - grain));
      }
      diffuseColor.rgb *= 1.0 - marks * .14 - traffic * (.039 + .029*crust);
      diffuseColor.rgb *= 1.0 - (1.0-.72*groomed) * (max(0.0, .68 - drift) * .17
        + max(0.0, .77 - crust) * .095 * detail - (scoured - .5) * .08);
      diffuseColor.rgb *= mix(vec3(.93,.966,1.0),vec3(1.0),groomed);
      diffuseColor.rgb *= mix(vec3(1.0),vec3(.68,.84,.96), polished * .55);
      // Melt follows elevation and broken patches instead of globally tinting
      // white snow green. Groomed pistes retain a ribbon into the spring thaw.
      float seasonalLine = climateSnowline + (scoured-.5)*160.0 + (drift-.5)*74.0;
      float alpineSnow = smoothstep(seasonalLine-145.0,seasonalLine+115.0,p.y);
      float oldSnow = max(climateSnowpack,alpineSnow);
      float pisteSnow = groomed * mix(.90,.95,climateSpring) * smoothstep(.02,.35,climateSnowpack);
      float cover = max(pisteSnow, smoothstep(.25,.79,oldSnow+scoured*.28-.12));
      // Nine-centimetre groomer grooves follow the mapped trail centreline.
      // Fade before the grooves approach the pixel footprint at a grazing angle.
      float groomerPass = smoothstep(.39,.77,snowMix.r) * (1.0-smoothstep(5.0,23.0,distanceToEye))
        * smoothstep(.02,.45,cover);
      float groovePhase = 0.0;
      if (groomerPass > .0) {
        float across = textureLod(pisteGrooming,pisteUv,0.0).r;
        groovePhase = across / .094 + .28*(drift-.5) + .13*(crust-.5);
      }
      float visibleGrooves = groomerPass * (1.0-smoothstep(.12,.32,fwidth(groovePhase)))
        * (1.0-.84*ice) * (1.0-.64*loose) * (1.0-.68*smoothstep(.03,.35,marks))
        * (.48+.52*scoured);
      float groove = visibleGrooves > .001 ? .5+.5*cos(groovePhase*6.28318531) : .5;
      diffuseColor.rgb *= 1.0 - .091*visibleGrooves*groove*(1.0-.76*traffic);
      if (climateRealism > .5 && detail > .001) {
        float crystals = smoothstep(.735,.905,grain) * microCoverage * detail * cover;
        float flash = pow(smoothstep(.82,.99,abs(dot(normalize(vNormal),normalize(vViewPosition)))),3.0);
        diffuseColor.rgb += vec3(.17,.21,.27) * crystals * (.25 + .75*flash) * (1.0-.71*ice);
      }
      vec3 summerFloor = mix(vec3(.075,.112,.035),vec3(.18,.225,.075),scoured);
      vec3 fallFloor = mix(vec3(.14,.079,.024),vec3(.29,.19,.062),scoured);
      vec3 meadow = mix(summerFloor,fallFloor,climateAutumn);
      meadow = mix(meadow,vec3(.075,.077,.072),smoothstep(1580.0,2000.0,p.y)*.69);
      vec3 woodlandFloor = vec3(.064,.102,.047) * (.74+.35*canopy);
      meadow = mix(meadow,woodlandFloor,forestExtent*(.29+.29*understory));
      meadow *= 1.0 - climateWetness*.15;
      diffuseColor.rgb = mix(meadow,diffuseColor.rgb,cover);
      diffuseColor.rgb = mix(diffuseColor.rgb,shale,exposed*(1.0-.58*rimed*cover));
      relief = mix(.022*crust+.009*grain*microCoverage,relief-.0012*visibleGrooves*groove,cover)
        + exposed * (.11*fracture+.07*drift);
    `,
    normal: 'normal = surfaceNormal(-vViewPosition, normal, relief * smoothstep(.055,.27,abs(dot(normal, normalize(vViewPosition)))));',
    roughness: 'roughnessFactor = mix(mix(.94,.68,groomed*.80 + crust*.16*detail + traffic*.18), mix(.21,.115,climateRealism), polished*.88);',
  },
  mountain: {
    color: /* glsl */ `
      vec3 p = surfacePoint;
      float strata = surfaceNoise(p * vec3(.014,.029,.017));
      float crown = filteredSurfaceNoise(p * vec3(.096,.18,.092));
      #ifdef USE_COLOR
        float treeCover = smoothstep(.012,.041, vColor.g-vColor.r)
          * (1.0-smoothstep(1730.0,1920.0,p.y));
      #else
        float treeCover = 0.0;
      #endif
      float forestGrain = filteredSurfaceNoise(p*vec3(.5,.17,.41));
      float canopy = smoothstep(.08,.88,crown*.63+forestGrain*.37);
      float ridgeRime = smoothstep(1100.0,1800.0,p.y)*climateSnowpack
        * (.27+.73*smoothstep(.19,.78,canopy*.68+strata*.32));
      vec3 darkCrowns = diffuseColor.rgb*vec3(.43,.56,.63)*(.74+canopy*.46);
      vec3 frostedCrowns = mix(vec3(.17,.23,.28),vec3(.39,.46,.52),canopy);
      diffuseColor.rgb = mix(diffuseColor.rgb,
        mix(darkCrowns,frostedCrowns,ridgeRime*.73),treeCover*.92);
      float relief = strata * .85 + crown * .18;
      diffuseColor.rgb *= .76 + strata * .37 + crown * .16;
      float ridgeSnow = smoothstep(climateSnowline-180.0,climateSnowline+170.0,p.y+(strata-.5)*180.0);
      float ridgeMelt = (1.0-climateSnowpack)*(1.0-ridgeSnow);
      vec3 bareRidge = mix(vec3(.12,.135,.12),vec3(.23,.225,.19),strata);
      vec3 ridgeForest = mix(vec3(.022,.049,.024),vec3(.064,.10,.038),canopy);
      ridgeForest=mix(ridgeForest,ridgeForest*vec3(1.45,.96,.58),climateAutumn*.44);
      bareRidge=mix(bareRidge,ridgeForest,(1.0-smoothstep(1420.0,1830.0,p.y))*.93);
      diffuseColor.rgb=mix(diffuseColor.rgb,bareRidge,ridgeMelt);
    `,
    normal: 'normal = surfaceNormal(-vViewPosition, normal, relief);',
    roughness: '',
  },
  glass: {
    color: /* glsl */ `
      vec3 nWorld = normalize(transpose(mat3(viewMatrix)) * normalize(vNormal));
      vec3 origin = surfacePoint;
      vec3 toEye=normalize(cameraPosition-origin);
      vec3 reflection=reflect(-toEye,nWorld);
      float gradient=smoothstep(-.10,.37,reflection.y);
      vec2 rays=reflection.xz/max(.11,.19+reflection.y);
      float cloud=surfaceNoise(vec3(rays*1.7,16.0));
      float veil=smoothstep(.38,.77,cloud+.27*surfaceNoise(vec3(rays*3.9,4.8)));
      vec3 sky=mix(vec3(.63,.74,.83),vec3(.10,.28,.51),gradient);
      sky=mix(sky,vec3(.71,.79,.84),veil*(.24+gradient*.50));
      if (climateRealism > .5) {
        sky=mix(surfaceHorizon,surfaceZenith,gradient);
        sky=mix(sky,surfaceHorizon,veil*(.22+gradient*.42));
      }
      vec3 ground=mix(vec3(.038,.063,.067),vec3(.48,.54,.59),smoothstep(-.49,-.045,reflection.y));
      vec3 reflected=mix(ground,sky,smoothstep(-.068,.035,reflection.y));
      float fresnel=pow(1.0-abs(dot(nWorld,toEye)),3.4);
      float grain=surfaceNoise(vec3(origin.x*2.6,origin.y*.24,origin.z*2.6));
      vec3 interior=diffuseColor.rgb*(.23+.34*grain);
      diffuseColor.rgb=mix(interior,reflected,.27+.55*fresnel) * (1.0-.05*grain);
    `,
    normal: '',
    roughness: '',
  },
  timber: {
    color: /* glsl */ `
      vec3 p = surfacePoint;
      float grain = surfaceNoise(vec3(p.x * 1.7, p.y * 84.0, p.z * 1.7));
      float seam = smoothstep(.015,.075,fract(p.y * 4.2));
      float relief = .003 * grain + .008 * seam;
      diffuseColor.rgb *= .72 + grain * .24 + seam * .13;
    `,
    normal: 'normal = surfaceNormal(-vViewPosition, normal, relief);',
    roughness: '',
  },
  granite: {
    color: /* glsl */ `
      vec3 p = surfacePoint;
      float grain = surfaceNoise(p * vec3(98.0,117.0,102.0));
      float grainFade = 1.0-smoothstep(.35,1.26,length(fwidth(p*113.0)));
      float face = surfaceNoise(p * vec3(5.1,8.5,6.0));
      float mottling=surfaceNoise(p*2.2+face*.44);
      vec3 warped=p+.048*vec3(face,mottling,face-mottling);
      float mineralBoundary=surfaceNoise(warped*vec3(.71,1.24,.93)+vec3(8.4,3.2,17.6));
      float fissurePlane=abs(mineralBoundary-.47);
      float seam=(1.-smoothstep(.001,.005+fwidth(fissurePlane),fissurePlane))*smoothstep(.48,.73,mottling);
      float quartz=smoothstep(.54,.86,grain)*grainFade;
      float mica=(1.0-smoothstep(.26,.52,grain))*grainFade;
      float crystal=surfaceNoise(p*vec3(31.,26.,35.)+face*.81);
      float crystalFade=1.-smoothstep(.4,1.8,length(fwidth(p*31.)));
      float relief=.024*face+.019*mottling+.0058*crystal*crystalFade+.002*grain*grainFade-.004*seam;
      float weathering=surfaceNoise(p*.36+vec3(17.4,8.7,2.1));
      diffuseColor.rgb*=.55+.24*mottling+.18*face+.25*weathering;
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.033,.040,.043),mica*.65);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.41,.42,.40),quartz*(.13+.27*crystal));
      float inclusion=smoothstep(.76,.89,surfaceNoise(p*vec3(3.8,4.9,4.2)+mottling*.63))
        *smoothstep(.47,.71,weathering);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.33,.35,.32),inclusion*.29);
      float feldspar=smoothstep(.60,.84,crystal)*crystalFade;
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.32,.28,.235),feldspar*.23);
      diffuseColor.rgb*=1.-seam*.06;
      diffuseColor.rgb*=1.0-climateWetness*.24;
    `,
    normal: 'normal = surfaceNormal(-vViewPosition, normal, relief);',
    roughness: 'roughnessFactor=mix(.96-.17*quartz,.48,climateWetness*.64);',
  },
  stone: {
    color: /* glsl */ `
      vec3 p = surfacePoint;
      float coarse = surfaceNoise(p * 1.7);
      float grit = surfaceNoise(p * 18.0);
      float relief = .022 * coarse + .005 * grit;
      diffuseColor.rgb *= .75 + coarse * .34 + grit * .09;
    `,
    normal: 'normal = surfaceNormal(-vViewPosition, normal, relief);',
    roughness: '',
  },
};

export function surfaceMaterial(kind, options = {}, snowMaps) {
  const surface = surfaces[kind];
  const skiSnow = kind === 'snow' && snowMaps?.skiSnow;
  const material = new THREE.MeshStandardMaterial({ roughness: .9, ...options });
  const terrain = kind === 'snow' || kind === 'mountain';
  if (terrain) {
    terrainSurfaces.add(material);
    material.addEventListener('dispose', () => terrainSurfaces.delete(material));
  }
  material.customProgramCacheKey = () => `${kind}${skiSnow ? `-ski-snow-${skiSnow.mode}` : ''}${terrain && budgetSampling ? '-volume' : ''}`;
  material.onBeforeCompile = (shader) => {
    if (terrain && budgetSampling) {
      shader.fragmentShader = '#define TERRAIN_NOISE_VOLUME\n' + shader.fragmentShader;
      shader.uniforms.terrainNoise = { value: terrainNoiseVolume() };
    }
    shader.uniforms.climateSnowpack = climateUniforms.snowpack;
    shader.uniforms.climateSnowline = climateUniforms.snowline;
    shader.uniforms.climateAutumn = climateUniforms.autumn;
    shader.uniforms.climateSpring = climateUniforms.spring;
    shader.uniforms.climateWetness = climateUniforms.wetness;
    shader.uniforms.climateRealism = climateUniforms.realism;
    if (kind === 'glass') {
      shader.uniforms.surfaceHorizon = climateUniforms.reflectedHorizon;
      shader.uniforms.surfaceZenith = climateUniforms.reflectedZenith;
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
        '#include <common>\nuniform vec3 surfaceHorizon, surfaceZenith;');
    }
    shader.uniforms.climateTerrainSun = climateUniforms.terrainSun;
    const pisteUniforms = kind === 'snow' ? 'uniform sampler2D pisteCoverage; uniform sampler2D mountainShade; uniform sampler2D pisteGrooming; uniform vec4 pisteLimits; uniform sampler2D plazaSnow; uniform vec3 plazaLimits; uniform sampler2D bowlSnow; uniform vec3 bowlLimits; uniform sampler2D villageSnow; uniform vec3 villageLimits; uniform vec4 roomCutout, annexCutout; uniform vec2 roomYaw;\n' : '';
    // Only the few terrain tiles under the skier compile this cutout. The rest
    // of the mountain keeps its original shader and does no ski-footprint work.
    const skiUniforms = skiSnow ? /* glsl */ `
      uniform vec4 skiSnowFeet[2];
      uniform vec2 skiSnowScale[2];
      bool inSkiSnow(vec2 p, vec4 foot, vec2 scale) {
        vec2 delta = p - foot.xy;
        float along = dot(delta, foot.zw) * scale.x;
        float across = dot(delta, vec2(foot.w, -foot.z));
        // The replacement extends eight millimetres past this cut, covering
        // roundoff and terrain-triangle crossings at a grazing camera angle.
        return scale.y > .5 && along > -1.842 && along < 1.112 && abs(across) < .227;
      }
    ` : '';
    if (kind === 'snow') {
      bindSnowTraffic(shader);
      shader.uniforms.pisteCoverage = { value: snowMaps.pisteMap };
      shader.uniforms.mountainShade = { value: snowMaps.mountainShade };
      shader.uniforms.pisteGrooming = { value: snowMaps.groomingMap };
      shader.uniforms.roomCutout = { value: snowMaps.roomCutout };
      shader.uniforms.annexCutout = { value: snowMaps.annexCutout };
      shader.uniforms.roomYaw = { value: snowMaps.roomYaw };
      for (const [place, layer] of Object.entries(snowMaps.tracks)) {
        shader.uniforms[place + 'Snow'] = { value: layer.map };
        shader.uniforms[place + 'Limits'] = { value: new THREE.Vector3(layer.origin.x, layer.origin.y, layer.span) };
      }
      shader.uniforms.pisteLimits = { value: new THREE.Vector4(WORLD.minX, WORLD.minZ, WORLD.sizeX, WORLD.sizeZ) };
      if (skiSnow) {
        shader.uniforms.skiSnowFeet = { value: skiSnow.feet };
        shader.uniforms.skiSnowScale = { value: skiSnow.scale };
      }
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 surfacePoint;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 surfaceWorld=vec4(transformed,1.0);
        #ifdef USE_INSTANCING
          surfaceWorld=instanceMatrix*surfaceWorld;
        #endif
        surfacePoint=(modelMatrix*surfaceWorld).xyz;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float climateSnowpack; uniform float climateSnowline; uniform float climateAutumn; uniform float climateSpring; uniform float climateWetness; uniform float climateTerrainSun; uniform float climateRealism;\n' + noise + pisteUniforms + skiUniforms + (kind === 'snow' ? snowTrafficGLSL : ''))
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + (skiSnow
        ? skiSnow.mode === 0
          ? 'if (inSkiSnow(surfacePoint.xz, skiSnowFeet[0], skiSnowScale[0]) || inSkiSnow(surfacePoint.xz, skiSnowFeet[1], skiSnowScale[1])) discard;\n'
          : skiSnow.mode === 2
            ? 'if (inSkiSnow(surfacePoint.xz, skiSnowFeet[0], skiSnowScale[0])) discard;\n' : ''
        : '') + surface.color)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + surface.normal)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + surface.roughness);
    if (kind === 'snow') {
      bindSnowCrystals(shader);
      bindTerrainHorizon(shader, snowMaps.horizon);
      // The sun shadow follows the rider. Fade before its finite rectangular
      // extent so an aerial view does not see the edge across a hillside.
      const shadowChunk = THREE.ShaderChunk.shadowmap_pars_fragment.replace('return shadow;', `
        float shadowInset = min(min(shadowCoord.x, 1.0-shadowCoord.x), min(shadowCoord.y, 1.0-shadowCoord.y));
        return mix(1.0,shadow,smoothstep(0.002,0.205,shadowInset));`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', shadowChunk);
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `
        #include <lights_fragment_end>
        reflectedLight.directDiffuse *= sunFromTerrain;
        reflectedLight.directSpecular *= sunFromTerrain;
        reflectedLight.indirectDiffuse *= skyView;
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', /* glsl */ `
        float flash = snowCrystalFlash(p, vNormal, distanceToEye,
          cover*(1.0-exposed*.94)*(1.0-forestExtent*.55)*(1.0-ice*.71)*(1.0-traffic*.35));
        outgoingLight += vec3(.73,.88,1.0) * flash * sunFromTerrain * mix(1.35,2.3,climateRealism);
        if (climateRealism > .5) {
          outgoingLight = shadeWinterSurface(outgoingLight, normal, vViewPosition,
            cover*(1.-exposed)*(1.-forestExtent*distantWoods), polished, loose);
        }
        #include <opaque_fragment>
      `);
    }
  };
  return material;
}
