async () => {
  const alpine = window.__alpine;
  const { scene, env } = alpine;
  const { heightAt } = await import('/src/terrain.js');
  const { buildingData } = await import('/data/osm-whistler.js');
  const { stationSite } = await import('/src/station-sites.js');
  const THREE = await import('three');
  const vec = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const round = value => Number(value.toFixed(3));
  const ray = new THREE.Raycaster();
  const up = vec(0, 1, 0), down = vec(0, -1, 0);
  const invalid = [];
  const checked = new WeakSet();
  scene.updateMatrixWorld(true);
  scene.traverse(object => {
    const positions = object.geometry?.attributes.position?.array;
    if (!positions || checked.has(object.geometry)) return;
    checked.add(object.geometry);
    const index = positions.findIndex(value => !Number.isFinite(value));
    if (index >= 0) invalid.push({ object: object.name, group: object.parent.name, index, count: positions.length / 3 });
  });

  const mapped = scene.children.find(group => group.name.includes('mapped building footprints'));
  const roofMeshes = mapped.children.filter(mesh => mesh.name.endsWith(' roof'));
  const foundationMeshes = mapped.children.filter(mesh => mesh.name.endsWith(' foundations'));
  for (const mesh of mapped.children) mesh.geometry.computeBoundingBox();
  const walls = new Map();
  for (const wall of env.grid.boxes.filter(box => box.buildingId)) {
    walls.set(wall.buildingId, (walls.get(wall.buildingId) ?? []).concat(wall));
  }
  const roofGaps = [], foundationGaps = [], missingWalls = [];
  const authored = [];
  let footprintSamples = 0, foundationSamples = 0;
  for (const building of env.grid.buildings) {
    const { id, points, roofAt, upperGround, generic, model } = building;
    const expected = points.filter(([x, z], i) => Math.hypot(x - points[(i + 1) % points.length][0],
      z - points[(i + 1) % points.length][1]) >= .2);
    if (walls.get(id)?.length !== expected.length) missingWalls.push(id);
    const authoredCoverage = { id, name: model?.name, roofSamples: 0, roofMisses: [], foundationSamples: 0, foundationMisses: [] };
    if (!generic) authored.push(authoredCoverage);
    if (!generic && !model) continue;
    const triangles = THREE.ShapeUtils.triangulateShape(points.map(([x, z]) => new THREE.Vector2(x, z)), []);
    for (const entries of triangles) {
      const x = entries.reduce((sum, k) => sum + points[k][0] / 3, 0);
      const z = entries.reduce((sum, k) => sum + points[k][1] / 3, 0);
      const y = roofAt(x, z);
      if (model) {
        ray.set(vec(x, y + 8, z), down);
        ray.far = y + 8 - upperGround - 1.5;
        authoredCoverage.roofSamples++;
        if (!ray.intersectObject(model, true).length) authoredCoverage.roofMisses.push([round(x), round(z)]);
        continue;
      }
      footprintSamples++;
      ray.set(vec(x, y + .065, z), down);
      ray.far = .135;
      if (!ray.intersectObjects(roofMeshes, false).length) roofGaps.push({ id, x: round(x), z: round(z), expectedY: round(y) });
    }
    for (const [i, a] of points.entries()) {
      const b = points[(i + 1) % points.length], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < .2) continue;
      const count = Math.ceil(length / 2);
      const n = vec(-(b[1] - a[1]) / length, 0, (b[0] - a[0]) / length);
      for (let j = 0; j < count; j++) {
        const t = (j + .5) / count, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
        const y = heightAt(x, z) + .05;
        if (model) {
          authoredCoverage.foundationSamples++;
          ray.set(vec(x, y, z).addScaledVector(n, -.32), n);
          ray.far = .64;
          if (!ray.intersectObject(model, true).length) {
            ray.set(vec(x, y, z).addScaledVector(n, .32), n.clone().negate());
            if (!ray.intersectObject(model, true).length) authoredCoverage.foundationMisses.push([round(x), round(z)]);
          }
          continue;
        }
        const foundationY = Math.min(upperGround + .43, y);
        foundationSamples++;
        ray.set(vec(x, foundationY, z).addScaledVector(n, -.08), n);
        ray.far = .16;
        if (!ray.intersectObjects(foundationMeshes, false).length) {
          foundationGaps.push({ id, x: round(x), z: round(z), expectedY: round(foundationY) });
        }
      }
    }
  }

  const architecture = scene.children.filter(group => group.isGroup && /terminal|fitzsimmons (bottom|top)|upper unload|express.* · base|roundhouse lodge|rendezvous lodge|fairmont|creekside ·|olympic plaza|walkable interior|skiers plaza/i.test(group.name));
  const solids = architecture.map(group => {
    const meshes = [];
    group.traverse(object => {
      if (object.isMesh && !object.isInstancedMesh && object.visible && object.geometry?.attributes.position) meshes.push(object);
    });
    return { name: group.name, meshes, bounds: new THREE.Box3().setFromObject(group) };
  });
  const rides = [];
  const crossings = new Map(), cableCells = new Map(), foundCrossings = new Set();
  for (const lift of env.lifts.lifts) {
    const { def } = lift;
    const liftResult = {
      id: def.id, name: def.name, type: def.surfaceType ?? def.type, access: def.access,
      towerCount: lift.supports?.filter(node => !node.terminal && !node.virtual).length ?? env.grid.circles.filter(c => c.liftId === def.id).length,
      pathChecks: 0, turnChecks: 0, groundClearance: Infinity, lowest: null, buildingContacts: [], modelContacts: [],
      boarding: [stationSite(def, 0), ...(def.type === 'p2p' ? [stationSite(def, def.points.length - 1)] : [])],
    };
    rides.push(liftResult);
    const contactKeys = new Set();
    const carrier = lift.passenger;
    const carrierBounds=new THREE.Box3();
    if(carrier){
      carrier.updateWorldMatrix(true,true);
      const inverse=carrier.matrixWorld.clone().invert(),local=new THREE.Matrix4();
      carrier.traverse(part=>{
        if(!part.isMesh)return;
        part.geometry.computeBoundingBox();
        local.multiplyMatrices(inverse,part.matrixWorld);
        carrierBounds.union(part.geometry.boundingBox.clone().applyMatrix4(local));
      });
    }
    const lower = def.aerial ? carrierBounds.min.y : 0;
    const half = def.aerial ? Math.max(-carrierBounds.min.x,carrierBounds.max.x) : .28;
    const sample = vec(), tangent = vec();
    function inspect(p, tangent, turn = false) {
      const side = vec(tangent.z, 0, -tangent.x).normalize();
      const positions = [-.9, 0, .9].map(offset => p.clone().addScaledVector(side, offset * half));
      if (turn) liftResult.turnChecks++;
      else liftResult.pathChecks++;
      for (const at of positions) {
        const ground = at.y + lower - heightAt(at.x, at.z);
        if (ground < liftResult.groundClearance) {
          liftResult.groundClearance = ground;
          liftResult.lowest = at.toArray().map(round);
        }
        if (!def.aerial) continue;
        for (const building of env.grid.buildingsAt(at.x, at.z)) {
          if (building.roofAt(at.x, at.z) < at.y + lower) continue;
          const key = 'mapped/' + building.id;
          if (!contactKeys.has(key)) liftResult.buildingContacts.push({ id: building.id, at: at.toArray().map(round), roof: round(building.roofAt(at.x, at.z)) });
          contactKeys.add(key);
        }
        ray.set(vec(at.x, at.y + lower + .045, at.z), up);
        ray.far = -lower - .38;
        for (const model of solids) {
          if (at.x < model.bounds.min.x || at.x > model.bounds.max.x || at.z < model.bounds.min.z || at.z > model.bounds.max.z ||
            at.y < model.bounds.min.y || at.y + lower > model.bounds.max.y || contactKeys.has(model.name)) continue;
          const hit = ray.intersectObjects(model.meshes, false)[0];
          if (!hit) continue;
          liftResult.modelContacts.push({ group: model.name, mesh: hit.object.name, at: hit.point.toArray().map(round), penetration: round(ray.far - hit.distance) });
          contactKeys.add(model.name);
        }
      }
    }
    for (const [direction, sampler] of lift.samplers.entries()) {
      const count = Math.ceil(sampler.total / (def.aerial ? 1.75 : 1.2));
      for (let i = 0; i <= count; i++) {
        sampler.at(i / count, sample, tangent);
        inspect(sample, tangent);
      }
      if (!def.aerial) continue;
      const points = sampler.points;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        const record = { a, b, def, direction, i, lower };
        for (let x = Math.floor(Math.min(a.x, b.x) / 24); x <= Math.floor(Math.max(a.x, b.x) / 24); x++) {
          for (let z = Math.floor(Math.min(a.z, b.z) / 24); z <= Math.floor(Math.max(a.z, b.z) / 24); z++) {
            const key = `${x}/${z}`;
            if (!cableCells.has(key)) cableCells.set(key, []);
            cableCells.get(key).push(record);
          }
        }
      }
    }
    for (const turn of lift.circulation?.turns ?? []) {
      for (let i = 0; i <= 60; i++) inspect(turn.getPointAt(i / 60), turn.getTangentAt(i / 60), true);
    }
    liftResult.groundClearance = round(liftResult.groundClearance);
  }
  for (const segments of cableCells.values()) {
    for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i], b = segments[j];
      if (a.def === b.def) continue;
      const id = `${a.def.id}/${a.direction}/${a.i}/${b.def.id}/${b.direction}/${b.i}`;
      if (foundCrossings.has(id)) continue;
      const u = vec().subVectors(a.b, a.a), v = vec().subVectors(b.b, b.a), w = vec().subVectors(b.a, a.a);
      const determinant = u.x * v.z - u.z * v.x;
      if (Math.abs(determinant) < .0001) continue;
      const f = (w.x * v.z - w.z * v.x) / determinant, g = (w.x * u.z - w.z * u.x) / determinant;
      if (f < 0 || f >= 1 || g < 0 || g >= 1) continue;
      foundCrossings.add(id);
      const ay = a.a.y + f * u.y, by = b.a.y + g * v.y;
      const gap = ay > by ? ay + a.lower - by : by + b.lower - ay;
      const pair = a.def.id + '/' + b.def.id;
      if (!crossings.has(pair) || crossings.get(pair).gap > gap) {
        crossings.set(pair, { names: [a.def.name, b.def.name], ids: [a.def.id, b.def.id], gap: round(gap),
          at: [round(a.a.x + f * u.x), round(a.a.z + f * u.z)], upper: ay > by ? a.def.id : b.def.id });
      }
    }
  }
  const modeled = new Set(env.grid.buildings.filter(b => b.generic).map(b => b.id));
  const testWall = env.grid.boxes.find(c => c.buildingId && c.hw > 2.5);
  let camera = null;
  if (testWall && env.clipCameraArm) {
    const x = testWall.x, z = testWall.z;
    const nx = -Math.sin(testWall.rot), nz = Math.cos(testWall.rot);
    const ax = x - 3 * nx, az = z - 3 * nz, y = heightAt(x, z) + 1.5;
    const desired = vec(x + 3 * nx, y, z + 3 * nz);
    const expected = desired.distanceTo(vec(ax, y, az));
    const actual = env.clipCameraArm(ax, y, az, desired);
    const clear = env.clipCameraArm(ax, y + 120, az, vec(x + 3 * nx, y + 120, z + 3 * nz));
    camera = { wall: testWall.buildingId, expected, actual: round(actual), clear: round(clear),
      blockedBeforeWall: actual < expected / 2, untouchedAboveRoof: Math.abs(clear - expected) < .001 };
  }
  return {
    mapped: { total: buildingData.length, modeled: modeled.size, measured: env.grid.buildings.filter(b => b.generic && b.measured).length,
      replaced: buildingData.filter(b => !modeled.has(b.id)).map(b => b.id), footprintSamples, foundationSamples,
      roofGaps, foundationGaps, missingWalls, authored },
    geometry: { invalid, inspectedModels: solids.map(model => model.name) },
    camera,
    lifts: rides,
    crossings: [...crossings.values()].sort((a, b) => a.gap - b.gap),
  };
}
