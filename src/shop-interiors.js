import * as THREE from 'three';
import { box, mergedMesh, part } from './scenery.js';
import { createSkier } from './skier.js';
import { buildSnowShoe, SNOW_SHOES } from './snow-shoes.js';
import { skiDeck, snowboardDeck } from './skier-equipment.js';
import { addWoolCarpet } from './interior-floors.js';
import { buildSkiGoggles, GOGGLES } from './ski-goggles.js';

const brass = '#c5a078', walnut = '#72513b', steel = '#323f42';

function displaySkier(group, appearance, x, y, z, yaw) {
  const stand = new THREE.Group();
  const { group: rig, setAppearance, animate } = createSkier();
  stand.add(rig);
  setAppearance(appearance);
  animate(.4, { speed: 0, steer: 0, tuck: 0, brake: 0, grab: 0, footMode: true, display: true }, null);
  stand.updateMatrixWorld(true);
  // Each finish keeps the rig's actual fabric maps, seams and pose.
  const batches = new Map();
  rig.traverseVisible(mesh => {
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    if (!batches.has(mesh.material)) batches.set(mesh.material, []);
    batches.get(mesh.material).push(geometry);
  });
  stand.remove(rig);
  for (const [material, geometries] of batches) {
    const geometry = new THREE.BufferGeometry();
    const count = geometries.reduce((sum, geo) => sum + geo.attributes.position.count, 0);
    for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2], ['color', 3]]) {
      if (!geometries.some(geo => geo.hasAttribute(name))) continue;
      const values = new Float32Array(count * size);
      let offset = 0;
      for (const geo of geometries) {
        const attr = geo.getAttribute(name), vertices = geo.attributes.position.count;
        if (attr?.normalized) {
          for (let i = 0; i < vertices; i++) {
            values[offset + i * size] = attr.getX(i);
            values[offset + i * size + 1] = attr.getY(i);
            if (size === 3) values[offset + i * size + 2] = attr.getZ(i);
          }
        } else if (attr) values.set(attr.array, offset);
        else if (name === 'color') values.fill(1, offset, offset + vertices * size);
        offset += vertices * size;
      }
      geometry.setAttribute(name, new THREE.BufferAttribute(values, size));
    }
    for (const geo of geometries) geo.dispose();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;
    stand.add(mesh);
  }
  stand.position.set(x, y, z);
  stand.rotation.y = yaw;
  stand.name = 'Wearable outerwear on display';
  group.add(stand);
}

export function furnishShop(room, group, collide, label) {
  const { w, d, h, kind } = room, barber = kind === 'barber', hw = w / 2, hd = d / 2;
  const timber = [], metal = [], glow = [];
  addWoolCarpet(group, {
    w: barber ? w - 1.3 : 3.1, d: barber ? 2.38 : d - 4.5, z: barber ? -.40 : .55,
    palette: barber ? ['#493534','#835746','#daba88'] : ['#2c4146','#466167','#bbad82'],
  });

  const plinth = (x, z, width, depth, height) => {
    timber.push(box(width, height, depth, walnut, [x, height / 2, z]));
    metal.push(box(width + .045, .026, depth + .045, brass, [x, height + .013, z]));
    collide(x, z, width, depth);
  };
  const shelf = (x, y, z, width, depth) => {
    timber.push(box(width, .085, depth, walnut, [x, y, z]));
    metal.push(box(width, .025, .020, brass, [x, y+.014, z+depth/2]));
  };

  if (barber) {
    const z = -hd + .56;
    plinth(0, z, w - .64, .83, .9);
    const mirror = new THREE.Mesh(new THREE.PlaneGeometry(2.02, 1.49), new THREE.MeshStandardMaterial({
      color: '#86a8b0', metalness: .58, roughness: .22, emissive: '#647f85', emissiveIntensity: .20,
    }));
    mirror.position.set(0, 1.80, -hd + .38);
    group.add(mirror);
    for (const side of [-1, 1]) {
      metal.push(box(.025, 1.55, .045, brass, [side * 1.04, 1.80, -hd + .39]));
      glow.push(box(.053, 1.44, .053, '#ffdfab', [side * 1.20, 1.79, -hd + .37]));
      timber.push(box(.38, .09, .28, '#c2beb1', [side * 1.63, 1.0, z + .01]));
      for (let i = 0; i < 4; i++) metal.push(part(new THREE.CylinderGeometry(.042,.047,.14,12),
        i % 2 ? '#5d6960' : '#485160', [side * (1.42 + .115 * i), 1.085, z - .17]));
    }
    for (const y of [1.042, 2.56]) metal.push(box(2.1, .042, .047, brass, [0, y, -hd + .39]));
    const chairZ = z + 1.45;
    const cylinder = new THREE.CylinderGeometry(1, 1, 1, 28);
    metal.push(part(cylinder, steel, [0,.065,chairZ], [0,0,0], [.50,.13,.50]),
      part(cylinder, brass, [0,.37,chairZ], [0,0,0], [.12,.58,.12]));
    const burgundy = '#793f38';
    timber.push(box(.69,.16,.55,burgundy,[0,.72,chairZ]),box(.65,.61,.16,burgundy,[0,1.04,chairZ+.265],[-.11,0,0]),
      box(.33,.15,.17,burgundy,[0,1.41,chairZ+.315]));
    for(const x of [-.405,.405]) {
      metal.push(box(.04,.34,.042,brass,[x,.82,chairZ-.02]));
      timber.push(box(.128,.065,.48,'#603631',[x,1.01,chairZ]));
    }
    metal.push(box(.49,.068,.21,'#626c6b',[0,.34,chairZ-.457]));
    for(let i=-2;i<=2;i++) metal.push(box(.029,.023,.16,brass,[i*.077,.381,chairZ-.457]));
    collide(0, chairZ, .96, 1.05);
    label(group, 'VILLAGE BARBER', 'CUTS & COLOR', 0, 3.08, -hd + .27, 2.8);
    for (const y of [.0,.12,.24,.36,.48]) glow.push(part(cylinder, y === .12 || y === .36 ? '#b55149' : '#e1dece',
      [-hw + .24, 2.18 + y, hd + .22], [0,0,0], [.116,.136,.116]));
  } else {
    const wallZ = -hd + 1.21;
    const fits = [
      { x:-2.35, label:'SUMMIT SHELL', appearance:{ jacket:'#4a676c', pants:'#a89a81', helmet:'#d6d6d1', backpack:'#694e42', apparel:'summit-shell' } },
      { x:0, label:'OCHRE / NAVY', appearance:{ jacket:'#ce933e', pants:'#24364a', helmet:'#333a40', backpack:'#363d40', footwear:'traverse' } },
      { x:2.35, label:'CLAY / SLATE', appearance:{ jacket:'#ad4939', pants:'#323e48', helmet:'#d6d6d1', backpack:'#bc8340' } },
    ];
    for (const { x, label: title, appearance } of fits) {
      plinth(x, wallZ, 1.72, 1.45, .28);
      displaySkier(group, appearance, x, .30, wallZ, -x * .13);
      label(group, title, '', x, .169, wallZ + .734, 1.45);
      glow.push(box(1.36,.055,.17,'#ffeac5',[x,2.74,wallZ+.04]));
      timber.push(box(1.72, 2.57, .10, '#4f645f', [x, 1.28, wallZ - .66]));
    }
    label(group, 'OUTFITTERS', 'OUTERWEAR  ·  BOOT FITTING', 0, 3.10, -hd + .28, 4.75);
    const boothX = hw - 1.68;
    plinth(boothX, -.42, 2.42, 1.13, .97);
    label(group, SNOW_SHOES.name.toUpperCase(), `${SNOW_SHOES.price} COINS`, boothX, .63, .152, 2.20);
    for (const side of [-1,1]) {
      const shoe = buildSnowShoe(side);
      shoe.position.set(boothX + .13 + side * .137, .995, -.26);
      shoe.rotation.y = side * .17 - .30;
      shoe.scale.setScalar(1.42);
      group.add(shoe);
    }
    const goggleShelfY = 1.54, goggleShelfZ = -.57;
    shelf(boothX, goggleShelfY, goggleShelfZ, 2.42, .60);
    timber.push(box(2.42, .85, .10, '#4f645f', [boothX, 1.66, goggleShelfZ - .29]));
    glow.push(box(2.29, .032, .043, '#ffeac5', [boothX, 2.03, goggleShelfZ + .20]));
    label(group, 'SMITH × SUPREME', '', boothX, 1.93, goggleShelfZ - .227, 1.57);
    for (const [i, [id, finish]] of Object.entries(GOGGLES).entries()) {
      const { group: goggles } = buildSkiGoggles(id);
      const x = boothX + (i - 1) * .73;
      goggles.position.set(x, goggleShelfY - .076, goggleShelfZ + .015);
      goggles.scale.setScalar(1.44);
      goggles.rotation.y = -.56 + i * .16;
      group.add(goggles);
      label(group, finish.name.toUpperCase(), '', x, goggleShelfY - .01, goggleShelfZ + .307, .60);
    }
    const rackX = -hw + 1.10;
    const displayDecks = [skiDeck('powder'), skiDeck('carver'), skiDeck('park'),
      snowboardDeck('burton-custom-camber'), snowboardDeck('jones-flagship')];
    for (const [i, deck] of displayDecks.entries()) {
      const pair = deck.model.kind === 'ski';
      for (const dx of pair ? [-.077,.077] : [0]) {
        const item = new THREE.Mesh(deck.geometry, deck.materials);
        item.name = deck.model.name;
        item.position.set(rackX - .14 + .34 * i + dx, .31 + deck.model.lengthCm * .005, wallZ + 1.05);
        item.rotation.x = -1.43;
        group.add(item);
      }
    }
    shelf(rackX + .54,.28,wallZ+1,1.7,.47);
    shelf(rackX + .54,1.76,wallZ+.96,1.7,.31);
    collide(rackX + .54,wallZ+1,1.8,.74);
    const benchZ = hd - 2.15;
    timber.push(box(2.8,.11,.59,walnut,[-hw+1.8,.52,benchZ]));
    for (const x of [-hw+.65,-hw+2.95]) metal.push(box(.094,.50,.46,steel,[x,.25,benchZ]));
    collide(-hw+1.8,benchZ,2.8,.62);
  }

  const railWidth = w - .5;
  for (const z of [-hd + 1.3, hd - 1.3]) {
    timber.push(box(railWidth,.15,.19,'#574537',[0,h-.16,z]));
    glow.push(box(Math.min(2.85, railWidth-.30),.037,.13,'#ffe2ac',[0,h-.249,z]));
  }
  group.add(mergedMesh(timber), mergedMesh(metal, { roughness: .53, metalness: .27 }));
  const lights = mergedMesh(glow, { emissive: true });
  lights.castShadow = false;
  group.add(lights);
}
