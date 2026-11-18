async () => {
  const THREE = await import('three');
  const { createSkiPatrol } = await import('./src/ski-patrol.js');
  const { createSkier } = await import('./src/skier.js');
  const { heightAt } = await import('./src/terrain.js');
  const { Expeditions } = await import('./src/expeditions.js');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const pos = new THREE.Vector3(460.8, heightAt(460.8, 4858.3), 4858.3);
  camera.position.copy(pos);
  const patrol = createSkiPatrol(scene, __alpine.env);
  const group = scene.getObjectByName('Whistler ski patrol');
  const report = { trail: null, phases: {}, mounts: {}, failures: [] };
  const check = (ok, message) => { if (!ok) report.failures.push(message); };
  const boot = new THREE.Vector3(), extent = new THREE.Vector3();
  const unrotated = new THREE.Quaternion();

  function inspectSkier(frame) {
    const boots = [], trousers = [], skis = [];
    frame.traverse(node => {
      if (node.name === 'Molded ski boot lower shell') {
        node.getWorldPosition(boot);
        const groundOffset = boot.y - heightAt(boot.x, boot.z);
        boots.push({ local: frame.worldToLocal(boot).toArray(), groundOffset });
      }
      if (node.name === 'Continuous articulated trouser shell') {
        node.geometry.computeBoundingBox();
        trousers.push(node.geometry.boundingBox.getSize(extent).length());
      }
      if (node.name === 'Ski equipment') skis.push(node.visible);
    });
    check(boots.length === 2 && trousers.length === 2 && skis.length === 2, `${frame.name} is missing leg geometry`);
    check(trousers.every(length => length > .25 && length < 1.25), `${frame.name} trouser spans ${trousers}`);
    return { boots, trousers, skis };
  }

  const random = Math.random;
  try {
    // Pick a nearby on-trail incident and advance its actual animation from Fisheye.
    Math.random = () => .92;
    patrol.update(4.1, { pos }, camera, 'winter');
  } finally {
    Math.random = random;
  }
  report.trail = patrol.debug().trail;
  check(patrol.debug().active, 'No patrol incident was found near Fisheye');
  const phases = ['responding', 'approaching', 'assessing guest', 'securing toboggan', 'towing'];
  for (let tick = 0; tick < 1500 && patrol.debug().active; tick++) {
    patrol.update(1 / 30, { pos }, camera, 'winter');
    const { phase, visible } = patrol.debug();
    if (!visible || !phases.includes(phase) || report.phases[phase]) continue;
    const patrollers = group.children.filter(child => child.name.startsWith('Ski patrol ·'));
    check(patrollers.length === 2, `${phase} is missing patrollers`);
    const expectSkis = phase === 'responding' || phase === 'towing';
    const geometry = patrollers.map(frame => {
      const entry = inspectSkier(frame);
      check(frame.position.length() > 1000 && frame.quaternion.angleTo(unrotated) > .1,
        `${phase} ${frame.name} lacks a translated, rotated test frame`);
      check(entry.boots[0]?.local[0] < 0 && entry.boots[1]?.local[0] > 0 && entry.boots.every(({ local, groundOffset }) =>
        Math.hypot(...local) < .65 && Math.abs(groundOffset) < .65), `${phase} ${frame.name} boots ${JSON.stringify(entry.boots)}`);
      check(entry.skis.every(visible => visible === expectSkis), `${phase} ${frame.name} ski visibility ${entry.skis}`);
      return entry;
    });
    const bars = group.children.filter(child => child.visible && child.geometry?.type === 'CylinderGeometry').map(child => child.scale.y);
    const expectedBars = phase === 'towing' ? 3 : phase === 'responding' ? 2 : 0;
    check(bars.length === expectedBars && bars.every(length => length > .1 && length < 4), `${phase} tow links ${bars}`);
    report.phases[phase] = { geometry, bars };
    if (phase === 'towing') {
      const patient = inspectSkier(group.getObjectByName('Guest receiving ski patrol assistance'));
      check(patient.skis.every(visible => visible === false), `Patient ski visibility ${patient.skis}`);
      break;
    }
  }
  check(phases.every(phase => report.phases[phase]), `Incomplete patrol replay: ${Object.keys(report.phases)}`);

  // Board both seat types with the real assets and pass through placeMountedRider.
  const expeditions = new Expeditions(scene, null, {
    bikes: [{ id: 'audit-bike', pose: { x: pos.x, z: pos.z, heading: .8 } }], season: () => 'summer',
  });
  for (const id of ['snowmobile', 'bike']) {
    const vehicle = expeditions.fleet.find(entry => entry.id === id);
    const model = new THREE.Group();
    model.name = `${id} rider`;
    const rig = createSkier({});
    model.add(rig.group);
    const player = { model, rig, pos: new THREE.Vector3(), setRiding() {}, bootShadows: [] };
    expeditions.board(vehicle, player);
    const entry = inspectSkier(model);
    check(model.parent === vehicle.model && vehicle.model.position.length() > 1000 && vehicle.model.visible &&
      entry.skis.every(visible => !visible) && entry.boots.every(({ local }, i) =>
        boot.fromArray(local).distanceTo(vehicle.asset.mount.feet[i]) < .001), `${id} rider feet do not match the mount`);
    report.mounts[id] = entry;
  }
  return report;
}
