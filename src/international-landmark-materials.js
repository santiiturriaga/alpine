import * as THREE from 'three';

const surfaceNoise = /* glsl */ `
  varying vec3 landmarkWorld;
  float landmarkHash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * .1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
  float landmarkNoise(vec2 p) {
    vec2 cell = floor(p), t = fract(p);
    t = t * t * (3. - 2. * t);
    return mix(mix(landmarkHash(cell), landmarkHash(cell + vec2(1,0)), t.x),
      mix(landmarkHash(cell + vec2(0,1)), landmarkHash(cell + vec2(1)), t.x), t.y);
  }
  vec3 landmarkStone(vec2 p) {
    float strata = landmarkNoise(p * .29) * .60 + landmarkNoise(p * .71) * .40;
    vec2 warp = vec2(landmarkNoise(p * 1.22 + 5.), landmarkNoise(p * 1.48 - 7.)) - .5;
    vec2 fracture = abs(fract((p + warp * .36) * vec2(.91, 1.56)) - .5);
    float seams = 1. - smoothstep(.018, .069, min(fracture.x, fracture.y));
    float grain = landmarkNoise(p * 10.7);
    float grainsVisible = 1. - smoothstep(.075,.24,length(fwidth(p)));
    float feldspar = smoothstep(.62, .88, grain) * grainsVisible;
    float mica = (1. - smoothstep(.14,.34,grain)) * grainsVisible;
    return vec3(strata * .81 + landmarkNoise(p * 2.7) * .19, seams, feldspar - mica * .77);
  }
  vec3 landmarkGranite(vec3 p, vec3 normal) {
    vec3 weight = pow(abs(normal), vec3(4.));
    weight /= max(dot(weight, vec3(1.)), .001);
    return landmarkStone(mat2(.82,.57,-.57,.82) * p.zy) * weight.x
      + landmarkStone(mat2(.71,-.70,.70,.71) * p.xz) * weight.y
      + landmarkStone(mat2(.92,.39,-.39,.92) * p.xy) * weight.z;
  }
  vec3 landmarkNormal(vec3 normal) {
    return transpose(mat3(viewMatrix)) * normalize(normal);
  }
`;

function installSurfaceVarying(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 landmarkWorld;')
    .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
      landmarkWorld = (modelMatrix * vec4(position, 1.)).xyz;
    `);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + surfaceNoise);
}

export function summitTerrainMaterial(base, bounds) {
  const material = base.clone();
  material.customProgramCacheKey = () => base.customProgramCacheKey() + '-landmark-granite';
  material.onBeforeCompile = (shader, renderer) => {
    base.onBeforeCompile(shader, renderer);
    installSurfaceVarying(shader);
    shader.uniforms.landmarkBounds = { value: new THREE.Vector4(bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ) };
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
      '#include <common>\nuniform vec4 landmarkBounds;')
      .replace('#include <roughnessmap_fragment>', /* glsl */ `
        #include <roughnessmap_fragment>
        vec3 summitN = landmarkNormal(vNormal);
        vec2 summitPos = landmarkWorld.xz;
        vec2 summitInside = min(summitPos - landmarkBounds.xy, landmarkBounds.zw - summitPos);
        float summitEdge = smoothstep(2.,38.,min(summitInside.x,summitInside.y));
        vec3 summitGranite = landmarkGranite(landmarkWorld, summitN);
        float summitSteep = 1. - clamp(summitN.y, 0., 1.);
        float summitExposure = summitEdge * smoothstep(.25,.66,summitSteep + (summitGranite.x - .48) * .24);
        vec3 summitRock = mix(vec3(.064,.064,.062), vec3(.194,.177,.156), summitGranite.x);
        summitRock *= 1. - summitGranite.y * .36;
        summitRock += vec3(.098,.105,.109) * summitGranite.z;
        diffuseColor.rgb = mix(diffuseColor.rgb, summitRock, summitExposure * .96);
        roughnessFactor = mix(roughnessFactor, .95, summitExposure);
      `)
      .replace('#include <normal_fragment_maps>', /* glsl */ `
        #include <normal_fragment_maps>
        vec3 summitDx = dFdx(vViewPosition), summitDz = dFdy(vViewPosition);
        vec3 summitRx = cross(summitDz, normal), summitRz = cross(normal, summitDx);
        float summitArea = dot(summitDx,summitRx);
        float summitRelief = summitExposure * (.032 * summitGranite.x - .011 * summitGranite.y + .005 * summitGranite.z);
        normal = normalize(max(abs(summitArea),1e-9) * normal +
          sign(summitArea) * (dFdx(summitRelief) * summitRx + dFdy(summitRelief) * summitRz));
      `);
  };
  return material;
}

export function finishLandmarkMaterial(material, finish) {
  if (!finish) return material;
  material.customProgramCacheKey = () => 'landmark-' + finish;
  material.onBeforeCompile = (shader) => {
    installSurfaceVarying(shader);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', /* glsl */ `
      #include <color_fragment>
      vec3 facadeNormal = landmarkNormal(vNormal);
      vec3 facadeGrain = landmarkGranite(landmarkWorld, facadeNormal);
      ${finish === 'masonry' ? `
        float course = landmarkWorld.y * 2.9;
        float stoneAlong = abs(facadeNormal.x) > abs(facadeNormal.z) ? landmarkWorld.z : landmarkWorld.x;
        float joints = min(abs(fract(course) - .5),
          abs(fract(stoneAlong * 1.56 + mod(floor(course + .5), 2.) * .42) - .5));
        float mortar = smoothstep(.021,.067,joints + (facadeGrain.x - .5) * .074);
        vec3 stone = diffuseColor.rgb * (.48 + facadeGrain.x * .89 - facadeGrain.y * .15 + facadeGrain.z * .17);
        diffuseColor.rgb = mix(vec3(.12,.12,.105), stone, mortar);
      ` : finish === 'glazing' ? `
        float skyGradient = .5 + .5 * dot(normalize(vViewPosition), vec3(0.,.8,.6));
        float streak = landmarkNoise(landmarkWorld.xz * vec2(.65, .42));
        diffuseColor.rgb *= .82 + skyGradient * .30 + streak * .075;
      ` : `
        vec2 wall = vec2(landmarkWorld.x + landmarkWorld.z * .73, landmarkWorld.y);
        float runoff = landmarkNoise(wall * vec2(1.6,.27));
        float pores = facadeGrain.z * .12 - facadeGrain.y * .08;
        diffuseColor.rgb *= .68 + facadeGrain.x * .43 + runoff * .18 + pores;
      `}
    `);
  };
  return material;
}
