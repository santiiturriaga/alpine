import * as THREE from 'three';
import { beam, box, cacheStaticTransforms, mergedMesh } from './scenery.js';

// Walkable ledges checked against the local elevation grids. The expedition
// equipment is scenery, and the mapped landmarks keep their original positions.
const sites = {
  denali: [-8252.3, 12162.5],
  eiger: [-3832.2, -1433.7],
  everest: [-7924.6, -1548.3],
  k2: [189.8, 15554.9],
  matterhorn: [3469.7, -1275.4],
  'mont-blanc': [1552.5, -5169.3],
  'mount-rainier': [1684, 6682],
};

const fabric = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: .90 });

function tentCanopy(width, length, height, color) {
  const position = [], colors = [], indices = [];
  const span = 12, arcs = 8;
  const panels = [-.5, -.43, -.32, -.18, 0, .18, .32, .43, .5];
  const shades = Array.from({ length: 3 }, (_, i) => new THREE.Color(color).multiplyScalar(.79 + i * .13));
  for (let j = 0; j <= arcs; ++j) {
    const z = panels[j] * length;
    const shoulder = Math.sin((j / arcs) * Math.PI) ** .45;
    for (let i = 0; i <= span; ++i) {
      const theta = i * Math.PI / span;
      const x = Math.cos(theta) * width * .5 * (.66 + .34 * shoulder);
      const y = Math.sin(theta) ** .89 * height * (.40 + .60 * shoulder);
      position.push(x, y + .045, z);
      colors.push(...shades[(j + (i % 4 === 0 ? 1 : 0)) % 3].toArray());
      const a = j * (span + 1) + i;
      if (i < span && j < arcs) indices.push(a, a+1, a+span+1, a+1, a+span+2, a+span+1);
    }
  }
  for (const j of [0, arcs]) {
    const center = position.length / 3;
    position.push(0, .04, length * panels[j]);
    colors.push(...shades[0].toArray());
    for (let i = 0; i < span; ++i) indices.push(center, j*(span+1)+i, j*(span+1)+i+1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, fabric);
  mesh.castShadow = true;
  return mesh;
}

export function buildExpeditionCamp(scene, config, ground, env) {
  if (!config.terrainOnly || !config.startPoint) return null;
  const [x, z] = sites[config.id] ?? config.startPoint;
  const peak = config.landmarks?.find(spot => spot.kind === 'peak')?.point ?? [x,z+1];
  const heading = Math.atan2(peak[0]-x, peak[1]-z);
  const sin = Math.sin(heading), cos = Math.cos(heading);
  const world = (u, v) => [x + u*cos + v*sin, z - u*sin + v*cos];
  const camp = new THREE.Group();
  camp.name = 'Expedition camp';

  for (const [u, v, width, length, height, color] of [
    [-5.2, 2.3, 4.3, 5.6, 2.05, '#c98229'], [4.7, -4.5, 3.1, 4.1, 1.52, '#953f36'],
    [-3.4, -7.0, 2.7, 3.6, 1.43, '#c9ab44'],
  ]) {
    const [tx, tz] = world(u,v);
    const y = ground.heightAt(tx,tz);
    const shelter = new THREE.Group();
    shelter.position.set(tx, y-.06, tz);
    shelter.rotation.y = heading;
    shelter.add(tentCanopy(width, length, height, color));
    const gear = [box(width*.54,.26,.034,'#54473d',[0,.17,length*.5+.012]),
      beam([0,.08,length*.5+.044],[0,height*.39,length*.5+.025],.033,.035,'#3d3933')];
    for (const side of [-1, 1]) for (const end of [-1, 1]) {
      const pegU = side*width*.84, pegV = end*length*.54;
      const [gx,gz] = world(u+pegU,v+pegV);
      const stake = ground.heightAt(gx,gz)-y+.14;
      gear.push(beam([side*width*.34,height*.71,end*length*.32], [pegU,stake,pegV], .022,.022,'#eadac1'),
        beam([pegU,stake-.25,pegV], [pegU+side*.11,stake+.05,pegV], .03,.031,'#bb542b'));
    }
    shelter.add(mergedMesh(gear));
    env.addBox(tx,tz,width*.5,length*.5,-heading,'expedition-tent',{ minY:y-.5,maxY:y+height });
    camp.add(shelter);
  }

  const [gx,gz] = world(3.45,3.0);
  const supplies = new THREE.Group();
  supplies.position.set(gx, ground.heightAt(gx,gz), gz);
  supplies.rotation.y = heading;
  const gear = [box(1.03,.45,.67,'#324c5d',[0,.18,0]), box(1.09,.09,.73,'#566771',[0,.42,0]),
    box(.74,.32,.56,'#87583a',[1.03,.13,-.40]), box(.83,.09,.62,'#aa7b51',[1.03,.32,-.40])];
  for (const dx of [-.36,.36]) {
    gear.push(box(.07,.49,.70,'#a5a795',[dx,.20,0]), box(.09,.09,.05,'#252e32',[dx,.28,.36]));
  }
  for (const dx of [-.24,.24]) {
    gear.push(beam([dx,.05,.94],[dx,.12,2.6],.06,.09,'#68777b'),
      beam([dx,.12,2.6],[dx,.28,2.79],.06,.07,'#68777b'));
  }
  gear.push(box(.46,.115,1.40,'#784837',[0,.17,1.74]));
  supplies.add(mergedMesh(gear));
  camp.add(supplies);
  env.addBox(gx,gz,.68,.59,-heading,'expedition-supplies',{ minY:supplies.position.y-.25,maxY:supplies.position.y+.55 });

  scene.add(camp);
  cacheStaticTransforms(camp);
  const clearing = { points: [world(-12,-12),world(12,-12),world(12,10),world(-12,10)] };
  return { x, z, heading, footMode: true, runName: 'Expedition camp', clearing };
}
