import * as THREE from 'three';

// Resort scenes have one shadow-casting sun and a skylight fill. Use the
// fill's otherwise unused shadow slot for a tight, independently updated
// rider map. Its lighting direction and colour still belong to the sky.
let installed = false;
function installShadowSampling() {
  if (installed) return;
  installed = true;
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const line = chunk.split('\n').find(line => line.includes('getShadow( directionalShadowMap[ i ]'));
  THREE.ShaderChunk.lights_fragment_begin = chunk.replace(line, `
    #if NUM_DIR_LIGHT_SHADOWS == 2
      if (directionalLightShadows[1].shadowRadius < 0.0) {
      #if UNROLLED_LOOP_INDEX == 0
        if (directLight.visible && receiveShadow) {
          float shade = getShadow(directionalShadowMap[0], directionalLightShadow.shadowMapSize,
            directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[0]);
          vec4 riderCoord = vDirectionalShadowCoord[1];
          if (shade > 0.0 && all(greaterThan(riderCoord.xyz, vec3(0.0))) && all(lessThan(riderCoord.xyz, vec3(1.0)))) {
            DirectionalLightShadow rider = directionalLightShadows[1];
            shade = min(shade, getShadow(directionalShadowMap[1], rider.shadowMapSize,
              rider.shadowBias, -rider.shadowRadius, riderCoord));
          }
          directLight.color *= shade;
        }
      #endif
      } else {
        ${line}
      }
    #else
      ${line}
    #endif`);
}

export function createRiderShadow(renderer, lighting, player) {
  installShadowSampling();
  const { fill } = lighting;
  const lamp = new THREE.DirectionalLight();
  lamp.shadow = fill.shadow;
  fill.castShadow = true;
  const shadow = fill.shadow;
  shadow.autoUpdate = false;
  shadow.mapSize.set(192, 192);
  Object.assign(shadow.camera, { left:-2.15, right:2.15, top:2.15, bottom:-2.15, near:.1, far:180 });
  shadow.normalBias = .016;
  shadow.bias = -.00008;
  // Opt this scene into the paired shadow lookup. Other scenes can still
  // use two ordinary shadow-casting lights.
  shadow.radius = -1;
  shadow.camera.updateProjectionMatrix();

  shadow.map = new THREE.WebGLRenderTarget(192, 192, {
    minFilter:THREE.NearestFilter, magFilter:THREE.NearestFilter,
  });
  shadow.map.texture.name = 'Moving rider depth';
  const casters = new THREE.Scene();
  casters.background = new THREE.Color(0xffffff);
  casters.matrixWorldAutoUpdate = false;
  const pose = player.rig.shadowPose;
  player.rig.group.userData.liveShadow = true;
  const material = new THREE.MeshDepthMaterial({
    depthPacking:THREE.RGBADepthPacking, side:THREE.DoubleSide, blending:THREE.NoBlending,
  });
  // Sleeves and trouser legs share the deforming render geometry. A single
  // batch represents the rigid pieces; buckles, embroidery and seams are
  // smaller than a shadow texel and never enter this pass.
  const rigid = [];
  const local = new THREE.Object3D();
  function ellipsoid(anchor, x, y, z, rx, ry, rz, visible) {
    if (!anchor) return;
    local.position.set(x,y,z);
    local.scale.set(rx,ry,rz);
    local.updateMatrix();
    rigid.push({ anchor, offset:local.matrix.clone(), visible });
  }
  ellipsoid(pose.head,0,.13,0,.115,.14,.125);
  ellipsoid(pose.pack,0,.005,.035,.14,.25,.105);
  for (const { elbow, pole } of pose.arms) {
    ellipsoid(elbow,0,-.315,.015,.05,.067,.049);
    ellipsoid(pole,0,-.51,0,.008,.61,.008,() => pole.visible);
  }
  for (const { ski } of pose.legs) ellipsoid(ski,0,.11,-.025,.074,.14,.175);
  const batch = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), material, rigid.length);
  batch.castShadow = true;
  batch.frustumCulled = false;
  batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  casters.add(batch);

  const parts = [];
  function addMesh(source, visible) {
    const mesh = new THREE.Mesh(source.geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.morphTargetInfluences = source.morphTargetInfluences;
    casters.add(mesh);
    parts.push({ source, mesh, visible });
  }
  addMesh(pose.jacketMesh);
  for (const leg of pose.legs) addMesh(leg.trousers.mesh);
  for (const arm of pose.arms) addMesh(arm.sleeve.mesh);
  for (const deck of pose.decks) {
    const carried = deck.parent.parent === pose.carriedSkis;
    addMesh(deck, () => carried ? pose.carriedSkis.visible : deck.parent.visible);
  }
  let hasBoard = false;
  const joints = new Set();
  function trackParents(node) {
    if (!node || node === player.model || joints.has(node)) return;
    trackParents(node.parent);
    joints.add(node);
  }
  function equipmentChanged() {
    if (!hasBoard && pose.boardMesh) {
      addMesh(pose.boardMesh, () => pose.board.visible);
      hasBoard = true;
    }
    // New boots, jackets and accessories may be constructed when equipped.
    // The wide mountain map must never retain an old rider silhouette.
    player.model.traverse(node => { node.castShadow = false; });
    joints.clear();
    for (const { source } of parts) trackParents(source);
    for (const { anchor } of rigid) trackParents(anchor);
  }
  equipmentChanged();

  const matrix = new THREE.Matrix4();
  let empty = false;
  function update(active, direction) {
    active = !!(active && player.model.visible && !player.riding);
    if (!active && empty) return;
    empty = !active;
    batch.visible = active;
    if (active) {
      // Update only these parent chains before the main scene render takes
      // care of the remaining hardware, decals, zippers and helmet-view rig.
      player.model.updateWorldMatrix(true, false);
      for (const joint of joints) joint.updateWorldMatrix(false, false);
      for (const { source, mesh, visible } of parts) {
        mesh.visible = !visible || visible();
        mesh.geometry = source.geometry;
        mesh.matrixWorld.copy(source.matrixWorld);
      }
      batch.count = 0;
      for (const { anchor, offset, visible } of rigid) {
        if (visible && !visible()) continue;
        batch.setMatrixAt(batch.count++, matrix.multiplyMatrices(anchor.matrixWorld, offset));
      }
      batch.instanceMatrix.needsUpdate = true;
      lamp.target.position.copy(player.pos);
      lamp.target.position.y += .85;
      lamp.position.copy(lamp.target.position).addScaledVector(direction, 24);
      lamp.updateMatrixWorld();
      lamp.target.updateMatrixWorld();
      shadow.updateMatrices(lamp);
    } else {
      for (const { mesh } of parts) mesh.visible = false;
    }
    const target = renderer.getRenderTarget();
    const cubeFace = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    try {
      renderer.setRenderTarget(shadow.map);
      renderer.render(casters, shadow.camera);
    } finally {
      renderer.setRenderTarget(target, cubeFace, mip);
    }
  }
  return { update, equipmentChanged };
}
