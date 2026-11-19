import * as THREE from 'three';
import { box, mergedMesh, part } from './scenery.js';

export const SNOW_SHOES = {
  name: 'Traverse ski shoes', price: 8,
  speed: 1.34, climbPenalty: .52,
};

const toe = new THREE.SphereGeometry(1, 20, 14);
const loop = new THREE.TorusGeometry(.019, .005, 6, 12);

export function buildSnowShoe(side) {
  const parts = [
    part(toe, '#243539', [0, .046, -.023], [0, 0, 0], [.086, .026, .183]),
    part(toe, '#3f666b', [0, .086, -.017], [0, 0, 0], [.073, .064, .172]),
    part(toe, '#344b52', [0, .131, -.066], [0, 0, 0], [.071, .085, .107]),
    part(toe, '#e1ab65', [0, .194, -.062], [0, 0, 0], [.073, .022, .091]),
    part(toe, '#344b52', [0, .202, -.065], [0, 0, 0], [.061, .018, .079]),
    part(toe, '#516568', [0, .066, .11], [0, 0, 0], [.074, .034, .065]),
    part(loop, '#dc9752', [0, .206, -.143]),
    box(.029, .044, .009, '#b47345', [0, .186, -.153]),
  ];
  for (let i = 0; i < 8; i++) {
    const z = -.161 + i * .041, width = Math.abs(z + .02) > .12 ? .052 : .074;
    for (const edge of [-1, 1]) {
      const x = edge * width;
      parts.push(box(.031, .021, .031, '#292f30', [x, .031, z], [0, edge * .19, 0]));
      parts.push(box(.026, .008, .024, '#ba8049', [x, .045, z]));
    }
  }
  for (let i = 0; i < 5; i++) {
    const z = .08 - .026 * i, y = .116 + .017 * i;
    parts.push(box(.085, .007, .009, '#d0a365', [0, y, z], [0, (i % 2 ? 1 : -1) * .19, 0]));
    for (const edge of [-1, 1]) parts.push(part(loop, '#a7b2ab', [edge * .039, y, z], [.4, 0, 0], [.44, .44, .44]));
  }
  parts.push(box(.005, .019, .045, '#ead098', [side * .071, .100, -.072], [0, 0, side * .16]));
  const shoe = mergedMesh(parts, { roughness: .73, metalness: .06 });
  for (const { geo } of parts) if (geo !== toe && geo !== loop) geo.dispose();
  shoe.name = SNOW_SHOES.name;
  return shoe;
}
