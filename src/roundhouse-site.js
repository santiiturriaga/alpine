export const ROUNDHOUSE_SITE = { x: 481.59, z: 4793.35 };
export const ROUNDHOUSE_OLYMPIC_SITE = { x: 451.94, z: 4818.97, yaw: Math.PI / 2 };

// The pavilion's façade is drawn relative to the mapped main building.
export const LODGE_FRAME = { x: 483.5, z: 4799.5, yaw: .075, datumX: 482, datumZ: 4829 };
export const LODGE_CAFE = { x: -5.8, front: 27.35, floor: .71, width: 7.65, steps: 4, tread: .30 };
export const LODGE_TERRACE = { floor: 3.845, stairX: 25.5, stairTop: 30.35, stairBottom: 38.8,
  stairWidth: 3.45, steps: 18 };

export function lodgePoint(x, z) {
  const { x: east, z: south, yaw } = LODGE_FRAME;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: east + x * c + z * s, z: south - x * s + z * c };
}
