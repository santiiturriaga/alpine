export const ROUNDHOUSE_SITE = { x: 481.59, z: 4793.35 };
export const ROUNDHOUSE_OLYMPIC_SITE = { x: 451.94, z: 4818.97, yaw: Math.PI / 2 };

// The pavilion's façade is drawn relative to the mapped main building.
export const LODGE_FRAME = { x: 483.5, z: 4799.5, yaw: .075, datumX: 482, datumZ: 4829 };
export const LODGE_CAFE = { x: -5.8, front: 27.35, floor: .71, width: 7.65, steps: 4, tread: .30 };
export const LODGE_TERRACE = { floor: 3.845, stairX: 25.5, stairTop: 30.35, stairBottom: 38.8,
  stairWidth: 3.45, steps: 18 };
export const LODGE_ANNEX = { x: -21.6, z: 11, width: 13.1, depth: 24.8,
  floor: .41, upperFloor: 3.59, doorX: -23.8, doorWidth: 3.1 };

export const WHISTLER_PEAK_TERMINAL = { x: 539.6, z: 4823.7, width: 27.5, depth: 45,
  deck: 3.77, datumOffset: -.75, entryX: 1.3, entryWidth: 5.15, canopyDepth: 3.6 };
export const BLACKCOMB_PEAK_TERMINAL = { width: 22, depth: 36, centerZ: -5,
  track: 7.5, deck: 3.98, entryZ: 1.8, entryWidth: 3.8, rampLength: 10.8 };

export function whistlerPeakTerminalSite(lift) {
  const [[ax, az], [bx, bz]] = lift.points;
  return { ...WHISTLER_PEAK_TERMINAL, yaw: Math.atan2(ax - bx, az - bz), surveyX: ax, surveyZ: az };
}

export function blackcombPeakTerminalSite(lift) {
  const [x, z] = lift.points.at(-1), [px, pz] = lift.points.at(-2);
  return { ...BLACKCOMB_PEAK_TERMINAL, x, z, yaw: Math.atan2(px - x, pz - z) };
}

export function terraceStairHeight(x, z, stepped = false) {
  const { stairX, stairWidth, stairTop, stairBottom, floor, steps } = LODGE_TERRACE;
  if (Math.abs(x - stairX) > stairWidth / 2 || z < 29.7 || z > stairBottom) return null;
  const progress = Math.min(1, (stairBottom - z) / (stairBottom - stairTop));
  const level = stepped ? Math.min(1, (Math.floor(progress * steps) + 1) / steps) : progress;
  return level * floor;
}

export function lodgePoint(x, z) {
  const { x: east, z: south, yaw } = LODGE_FRAME;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: east + x * c + z * s, z: south - x * s + z * c };
}
