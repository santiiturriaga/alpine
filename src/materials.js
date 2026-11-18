import * as THREE from 'three';
import { WORLD } from './worlddata.js';
import { climateUniforms } from './climate-state.js';

const noise = /* glsl */ `
  varying vec3 surfacePoint;

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
      if (all(lessThan(abs(roomLocal),roomCutout.zw))) discard;
      float distanceToEye = length(vViewPosition);
      vec4 snowMix = texture2D(pisteCoverage, (p.xz - pisteLimits.xy) / pisteLimits.zw);
      float sunFromTerrain = mix(.24, 1.0, texture2D(mountainShade,
        (p.xz - pisteLimits.xy) / pisteLimits.zw).r);
      float groomed = smoothstep(.21,.63,snowMix.r);
      float ice = smoothstep(.22,.53,snowMix.b);
      float loose = smoothstep(.23,.77,snowMix.g)*(1.0-ice);
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
      float drift = surfaceNoise(vec3(p.x * .29, p.y * .14, p.z * .84));
      float scoured = surfaceNoise(p * vec3(.044, .095, .037) + drift * .27);
      float forestExtent = smoothstep(.29,.84,snowMix.a);
      float forestDistance = smoothstep(130.0,430.0,distanceToEye);
      float canopy = smoothstep(.19,.81,surfaceNoise(p*vec3(.29,.12,.29))*.52 + .48*scoured);
      // At kilometre range the land-cover mask represents the crowns,
      // including winter rime, rather than only the dark ground below.
      // Sheltered low valley woods stay dark; broken higher stands carry
      // uneven pale upper boughs. Piste coverage still cuts through them.
      float forestWeather = surfaceNoise(p*vec3(.0037,.0015,.0043));
      float forestRime = smoothstep(1020.0,1780.0,p.y) * climateSnowpack
        * (.28 + .72*smoothstep(.19,.79,canopy*.72+forestWeather*.28));
      vec3 forestFloor = mix(vec3(.023,.039,.037),vec3(.091,.136,.143),canopy);
      vec3 rimedCrowns = mix(vec3(.19,.259,.309),vec3(.43,.51,.57),canopy);
      forestFloor=mix(forestFloor,rimedCrowns,forestRime*.77);
      diffuseColor.rgb = mix(diffuseColor.rgb, forestFloor, forestExtent * forestDistance * .94);
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
      float exposed = (1.0 - groomed) * (1.-apron*.96) * smoothstep(1330.0, 1820.0, p.y)
        * smoothstep(.23, .52, 1.0 - up + .27 * (scoured - .41) + .14 * (drift - .5));
      float fracture = surfaceNoise(p * vec3(1.05,5.85,1.12) + scoured);
      vec3 shale = mix(vec3(.021,.026,.032),vec3(.133,.122,.107),smoothstep(.20,.88,.62*fracture+.38*scoured));
      float rimed = smoothstep(.67,.83,drift+.12*scoured);
      diffuseColor.rgb = mix(diffuseColor.rgb, mix(shale,diffuseColor.rgb,rimed*.33), exposed * .92);
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
      float relief = mix(dune * vicinity + detailNormals * detail, .016 * drift, polished)
        + exposed * (.11*fracture+.09*drift) - .023*marks
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
      diffuseColor.rgb *= 1.0 - marks * .14;
      diffuseColor.rgb *= 1.0 - max(0.0, .68 - drift) * .21
        - max(0.0, .77 - crust) * .095 * detail + (scoured - .5) * .10;
      diffuseColor.rgb *= mix(vec3(.93,.966,1.0),vec3(1.0),groomed);
      diffuseColor.rgb *= mix(vec3(1.0),vec3(.68,.84,.96), polished * .55);
      // Melt follows elevation and broken patches instead of globally tinting
      // white snow green. Existing piste coverage preserves a skiable ribbon.
      float seasonalLine = climateSnowline + (scoured-.5)*160.0 + (drift-.5)*74.0;
      float alpineSnow = smoothstep(seasonalLine-145.0,seasonalLine+115.0,p.y);
      float oldSnow = max(climateSnowpack,alpineSnow);
      float pisteSnow = groomed * mix(.90,.95,climateSpring);
      float cover = max(pisteSnow, smoothstep(.25,.79,oldSnow+scoured*.28-.12));
      vec3 summerFloor = mix(vec3(.075,.112,.035),vec3(.18,.225,.075),scoured);
      vec3 fallFloor = mix(vec3(.14,.079,.024),vec3(.29,.19,.062),scoured);
      vec3 meadow = mix(summerFloor,fallFloor,climateAutumn);
      meadow = mix(meadow,vec3(.075,.077,.072),smoothstep(1580.0,2000.0,p.y)*.69);
      meadow = mix(meadow,vec3(.026,.056,.026),forestExtent*.76);
      meadow *= 1.0 - climateWetness*.15;
      diffuseColor.rgb = mix(meadow,diffuseColor.rgb,cover);
      relief = mix(.022*crust+.009*grain*microCoverage,relief,cover);
    `,
    normal: 'normal = surfaceNormal(-vViewPosition, normal, relief * smoothstep(.055,.27,abs(dot(normal, normalize(vViewPosition)))));',
    roughness: 'roughnessFactor = mix(mix(.94,.68,groomed*.80 + crust*.16*detail), .21, polished*.88);',
  },
  mountain: {
    color: /* glsl */ `
      vec3 p = surfacePoint;
      float strata = surfaceNoise(p * vec3(.014,.029,.017));
      float crown = surfaceNoise(p * vec3(.096,.18,.092));
      #ifdef USE_COLOR
        float treeCover = smoothstep(.012,.041, vColor.g-vColor.r)
          * (1.0-smoothstep(1730.0,1920.0,p.y));
      #else
        float treeCover = 0.0;
      #endif
      float forestGrain = surfaceNoise(p*vec3(.5,.17,.41));
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
  material.customProgramCacheKey = () => `${kind}${skiSnow ? `-ski-snow-${skiSnow.mode}` : ''}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.climateSnowpack = climateUniforms.snowpack;
    shader.uniforms.climateSnowline = climateUniforms.snowline;
    shader.uniforms.climateAutumn = climateUniforms.autumn;
    shader.uniforms.climateSpring = climateUniforms.spring;
    shader.uniforms.climateWetness = climateUniforms.wetness;
    const pisteUniforms = kind === 'snow' ? 'uniform sampler2D pisteCoverage; uniform sampler2D mountainShade; uniform vec4 pisteLimits; uniform sampler2D plazaSnow; uniform vec3 plazaLimits; uniform sampler2D bowlSnow; uniform vec3 bowlLimits; uniform sampler2D villageSnow; uniform vec3 villageLimits; uniform vec4 roomCutout; uniform vec2 roomYaw;\n' : '';
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
      shader.uniforms.pisteCoverage = { value: snowMaps.pisteMap };
      shader.uniforms.mountainShade = { value: snowMaps.mountainShade };
      shader.uniforms.roomCutout = { value: snowMaps.roomCutout };
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
      .replace('#include <common>', '#include <common>\nuniform float climateSnowpack; uniform float climateSnowline; uniform float climateAutumn; uniform float climateSpring; uniform float climateWetness;\n' + noise + pisteUniforms + skiUniforms)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + (skiSnow
        ? skiSnow.mode === 0
          ? 'if (inSkiSnow(surfacePoint.xz, skiSnowFeet[0], skiSnowScale[0]) || inSkiSnow(surfacePoint.xz, skiSnowFeet[1], skiSnowScale[1])) discard;\n'
          : skiSnow.mode === 2
            ? 'if (inSkiSnow(surfacePoint.xz, skiSnowFeet[0], skiSnowScale[0])) discard;\n' : ''
        : '') + surface.color)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + surface.normal)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + surface.roughness);
    if (kind === 'snow') {
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `
        #include <lights_fragment_end>
        reflectedLight.directDiffuse *= sunFromTerrain;
        reflectedLight.directSpecular *= sunFromTerrain;
      `);
    }
  };
  return material;
}
