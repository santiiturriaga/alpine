// Clip the entire camera arm against the same cylinders and oriented boxes
// used for skier collisions. Fractions are measured from the rider to the eye.
const clearance = .18;
const interval = { enter: 0, exit: 0 };

function slab(origin, step, low, high) {
  if (Math.abs(step) < 1e-9) return origin >= low && origin <= high;
  const a = (low - origin) / step, b = (high - origin) / step;
  interval.enter = Math.max(interval.enter, Math.min(a, b));
  interval.exit = Math.min(interval.exit, Math.max(a, b));
  return interval.enter <= interval.exit;
}

function contact(c, x, y, z, dx, dy, dz) {
  const bottom = c.minY ?? -Infinity, top = c.maxY ?? Infinity;
  interval.enter = -Infinity;
  interval.exit = 1;
  if (!slab(y, dy, bottom - clearance, top + clearance) || interval.exit < 0) return 1;

  const ox = x - c.x, oz = z - c.z;
  let outward = (y - Math.max(bottom, Math.min(top, y))) * dy;
  if (c.r) {
    const radius = c.r + clearance;
    const a = dx * dx + dz * dz, b = ox * dx + oz * dz;
    const squared = ox * ox + oz * oz;
    if (a < 1e-12) {
      if (squared > radius * radius) return 1;
    } else {
      const discriminant = b * b - a * (squared - radius * radius);
      if (discriminant < 0) return 1;
      const root = Math.sqrt(discriminant);
      interval.enter = Math.max(interval.enter, (-b - root) / a);
      interval.exit = Math.min(interval.exit, (-b + root) / a);
    }
    if (squared > c.r * c.r) outward += b * (1 - c.r / Math.sqrt(squared));
  } else {
    const cos = Math.cos(c.rot), sin = Math.sin(c.rot);
    const lx = ox * cos + oz * sin, lz = oz * cos - ox * sin;
    const vx = dx * cos + dz * sin, vz = dz * cos - dx * sin;
    if (!slab(lx, vx, -c.hw - clearance, c.hw + clearance) ||
        !slab(lz, vz, -c.hd - clearance, c.hd + clearance)) return 1;
    outward += (lx - Math.max(-c.hw, Math.min(c.hw, lx))) * vx +
      (lz - Math.max(-c.hd, Math.min(c.hd, lz))) * vz;
  }
  if (interval.exit < 0 || interval.enter > interval.exit) return 1;
  // The rider can already be inside a station envelope. Let the camera
  // leave it, while blocking a camera that turns into a nearby wall.
  if (interval.enter <= 0) return outward < -1e-9 ? 0 : 1;
  return interval.enter;
}

// Move in over the shoulder when a chase camera would pass through the
// lower branches. A grazing bough shortens the arm progressively.
function canopyFraction(tree, x, y, z, dx, dy, dz, length, walking) {
  const ox = tree.x - x, oz = tree.z - z;
  const horizontal = dx * dx + dz * dz;
  if (horizontal < .01 || length < 1.4) return 1;
  const t = (ox * dx + oz * dz) / horizontal;
  const onArm = Math.max(0, Math.min(1, t));
  const height = tree.apex ?? tree.height;
  // Evergreen and broadleaf stands store the horizontal crown scale separately.
  const width = tree.stretch ?? tree.spread ?? tree.width;
  if (!(height > 0 && width > 0) || !Number.isFinite(tree.y)) return 1;
  const level = (y + onArm * dy - tree.y) / height;
  // Mature conifers and broadleaf trees have exposed trunks under the crown.
  // Numeric variants 3–5 are young conifers with branches closer to the snow.
  const crownBase = !walking ? -.03 : tree.kind === 'deciduous' ? .22 : tree.kind >= 3 ? .035 : .145;
  if (level < crownBase || level >= .98) return 1;
  const radius = height * width * .23 * (1 - Math.max(0, level)) ** .85;
  const distance = Math.hypot(ox - onArm * dx, oz - onArm * dz);
  if (distance >= radius) return 1;
  const sideSq = (ox - t * dx) ** 2 + (oz - t * dz) ** 2;
  const entry = t - Math.sqrt(Math.max(0, radius ** 2 - sideSq) / horizontal);
  const entrance = walking ? Math.min(1, (level - crownBase) / .075) : 1;
  const overlap = Math.min(1, (radius - distance) / Math.max(.4, radius * .45)) * entrance;
  const weight = overlap * overlap * (3 - 2 * overlap);
  return 1 - weight * (1 - Math.min(1, Math.max(1.4 / length, entry)));
}

export function cameraClipper(query, types) {
  return (x, y, z, eye, branches) => {
    const dx = eye.x - x, dy = eye.y - y, dz = eye.z - z;
    const length = Math.hypot(dx, dy, dz);
    const nearby = query(x + dx * .5, z + dz * .5, Math.hypot(dx, dz) * .5 + (branches ? 17 : clearance));
    let nearest = 1;
    if (branches) branches.fraction = 1;
    for (const c of nearby) {
      if (branches && c.tree) {
        const trunk = contact(c, x, y, z, dx, dy, dz);
        if (branches.walking) nearest = Math.min(nearest, trunk);
        branches.fraction = Math.min(branches.fraction, canopyFraction(c.tree, x, y, z, dx, dy, dz, length, branches.walking),
          branches.walking ? 1 : trunk);
        continue;
      }
      if (!types || types.has(c.type) || (branches?.walking && c.type === 'landmark-tree')) {
        nearest = Math.min(nearest, contact(c, x, y, z, dx, dy, dz));
      }
    }
    if (nearest < 1) eye.set(x + dx * nearest, y + dy * nearest, z + dz * nearest);
    return nearest * length;
  };
}
