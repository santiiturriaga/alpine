import * as THREE from 'three';
import { embroideredMaterial } from './garment-marks.js';
import { batchRigidParts } from './skier-hardware.js';
import { canvasTexture, makeCanvas } from './util.js';
import { BACKPACK_MODELS, DEFAULT_BACKPACK_MODEL, isBackpackModel } from './backpack-catalog.js';

export { BACKPACK_MODELS, DEFAULT_BACKPACK_MODEL, isBackpackModel } from './backpack-catalog.js';

let ospreyWordmark;
function ospreyPatch() {
  if (!ospreyWordmark) {
    const { canvas, ctx } = makeCanvas(256, 64);
    ctx.font = '800 49px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ede7d8';
    ctx.fillText('OSPREY', 128, 48);
    ospreyWordmark = new THREE.MeshBasicMaterial({
      map: canvasTexture(canvas), transparent: true, alphaTest: .25, depthWrite: false,
    });
  }
  return ospreyWordmark;
}

export function buildSkierBackpack(torso, {
  color, model, textile, material, shell, put, piping, rounded, jacketFront, seamThread, black, bootShell, accent, decalShapes,
}) {
  const group = new THREE.Group();
  group.position.set(0, .264, -.251);
  torso.add(group);
  const harness = new THREE.Group();
  harness.position.copy(group.position).negate();
  group.add(harness);
  const bag = textile(color, .002);
  const bagPanel = textile(bag.color.clone().multiplyScalar(.72));
  const decalMaterial = material(0xe8e2d6, .87);
  const builds = new Map();

  for (const side of [-1, 1]) {
    piping(harness, bagPanel, [[side*.075,.438,-.159],[side*.094,.481,-.113],
      [side*.103,.535,-.074],[side*.107,.577,-.002],[side*.105,.542,.07],
      ...jacketFront([[side*.107,.491],[side*.127,.406],[side*.133,.277],[side*.139,.175]], .0056)], .0102);
    piping(harness, seamThread, jacketFront([[side*.102,.467],[side*.123,.395],[side*.13,.277]], .0147), .0011);
    rounded(harness, black, .024, .026, .010, ...jacketFront([[side*.135,.231],[side*.135,.23]], .015)[0], .0026);
  }
  piping(harness, black, jacketFront([[-.132,.326],[-.056,.325],[0,.324],[.066,.325],[.132,.326]], .012), .006);
  rounded(harness, bootShell, .032, .016, .010, .018, .325, .141, .002);
  batchRigidParts(harness);

  function build(id) {
    const pack = new THREE.Group();
    pack.name = BACKPACK_MODELS[id].name;
    pack.position.copy(group.position).negate();
    group.add(pack);
    let applyMark;
    let decalY, decalZ;
    if (id === DEFAULT_BACKPACK_MODEL) {
      put(pack, shell([[.035,.050,.028,-.157],[.065,.090,.043,-.166],[.14,.125,.071,-.174],
        [.232,.131,.076,-.177],[.317,.133,.070,-.165],[.39,.121,.061,-.157],
        [.457,.107,.052,-.147],[.493,.078,.028,-.141],[.502,.039,.011,-.137]], .023), bag);
      const mark = embroideredMaterial(bagPanel, 'fossil', 0, .31, .138, true);
      const face = put(pack, shell([[.081,.053,.018,-.205],[.132,.092,.040,-.215],[.22,.106,.047,-.215],
        [.298,.106,.046,-.211],[.363,.099,.036,-.196],[.405,.065,.024,-.187],[.436,.034,.010,-.172]], .022), mark);
      for (const side of [-1, 1]) {
        piping(pack, black, [[side*.075,.127,-.240],[side*.101,.222,-.247],[side*.102,.315,-.232],
          [side*.082,.380,-.221],[side*.052,.412,-.202]], .0032);
        piping(pack, black, [[side*.106,.132,-.237],[side*.137,.165,-.177],[side*.141,.173,-.102]], .0063);
      }
      piping(pack, accent, [[.035,.404,-.214],[.049,.391,-.226],[.057,.378,-.229]], .003);
      applyMark = (show) => { face.material = show ? mark : bagPanel; };
      decalY = .31;
      decalZ = -.264;
    } else {
      put(pack, shell([[.008,.070,.035,-.174],[.039,.116,.074,-.190],[.10,.139,.102,-.202],
        [.182,.143,.116,-.210],[.277,.140,.118,-.208],[.35,.138,.111,-.203],
        [.426,.133,.100,-.187],[.490,.117,.082,-.166],[.523,.087,.056,-.145],
        [.531,.047,.028,-.143]], .018, 40), bag);
      put(pack, shell([[.073,.089,.022,-.268],[.115,.121,.044,-.279],[.19,.127,.049,-.291],
        [.265,.123,.045,-.293],[.32,.119,.039,-.287],[.38,.102,.031,-.279],[.417,.063,.018,-.267]], .013), bagPanel);
      piping(pack, black, [[-.101,.329,-.304],[-.103,.275,-.319],[-.102,.165,-.324],
        [-.090,.115,-.313],[-.042,.094,-.304],[.038,.094,-.302],[.078,.123,-.311]], .004);
      piping(pack, black, [[-.085,.448,-.251],[-.052,.464,-.267],[0,.468,-.271],
        [.052,.464,-.267],[.093,.447,-.246]], .003);
      piping(pack, accent, [[-.104,.304,-.319],[-.111,.331,-.319],[-.104,.348,-.304]], .0034);
      for (const side of [-1, 1]) {
        piping(pack, black, [[side*.109,.115,-.276],[side*.149,.143,-.233],[side*.143,.161,-.163]], .0095);
        piping(pack, black, [[side*.112,.347,-.264],[side*.150,.358,-.216],[side*.129,.361,-.152]], .0085);
        rounded(pack, bootShell, .020, .021, .035, side*.133, .151, -.246, .003).rotation.y = side*.45;
        piping(pack, accent, [[side*.104,.411,-.264],[side*.112,.429,-.267],[side*.125,.435,-.244]], .0026);
      }
      const logo = put(pack, new THREE.PlaneGeometry(.109, .027), ospreyPatch(), 0, .369, -.320);
      logo.rotation.y = Math.PI;
      applyMark = (show) => { logo.visible = show; };
      decalY = .369;
      decalZ = -.324;
    }

    const decal = new THREE.Group();
    decal.position.set(0, decalY, decalZ);
    decal.rotation.y = Math.PI;
    decal.scale.setScalar(.032);
    pack.add(decal);
    const decals = decalShapes(decal, decalMaterial);
    for (const part of [pack, ...Object.values(decals)]) batchRigidParts(part);
    const result = { pack, applyMark, decals, labelPoint: new THREE.Vector3(0, decalY, decalZ).sub(group.position) };
    builds.set(id, result);
    return result;
  }

  let current, sticker = 'none';
  function setAppearance({ color, model, decal }) {
    if (current === undefined || (isBackpackModel(model) && model !== current)) {
      if (current) builds.get(current).pack.visible = false;
      current = isBackpackModel(model) ? model : DEFAULT_BACKPACK_MODEL;
      const next = builds.get(current) ?? build(current);
      next.pack.visible = true;
      group.name = next.pack.name;
      group.userData.labelPoint = next.labelPoint;
    }
    if (color !== undefined) {
      bag.color.set(color);
      bagPanel.color.copy(bag.color).multiplyScalar(.72);
      const { r, g, b } = bagPanel.color;
      decalMaterial.color.set(.2126 * r + .7152 * g + .0722 * b > .35 ? 0x364048 : 0xe8e2d6);
    }
    if (decal !== undefined) sticker = decal;
    const { applyMark, decals } = builds.get(current);
    applyMark(sticker === 'none');
    for (const [name, part] of Object.entries(decals)) part.visible = sticker === name;
  }
  setAppearance({ model });
  return { group, setAppearance };
}
