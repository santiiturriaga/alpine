import { clamp } from './math.js';

export const SNOW_CLEARANCE = .035;
const GRAVITY = 9.81;

// A runner can push against the snow, but cannot pull itself down onto it.
// Test the local departure and the ground ahead to ignore shallow mesh seams.
export function departure(from, to, nextHeight, heightAt, dt) {
  if (!(dt > 0)) return null;
  const dx = to.x - from.x, dz = to.z - from.z;
  const step = Math.hypot(dx, dz);
  const speed = step / dt;
  if (!(speed >= 5.5)) return null;
  const dirX = dx / step, dirZ = dz / step;
  const span = clamp(speed * .043, .31, 1.25);
  const origin = heightAt(from.x, from.z);
  const behind = heightAt(from.x - dirX * span, from.z - dirZ * span);
  const tipRise = (origin - behind) / span;
  const gravityDrop = .5 * GRAVITY * dt * dt;
  if (origin + tipRise * step - gravityDrop - nextHeight < .0018) return null;
  // The last contact can be the uphill wall of a small hollow. Use the
  // approach across the full running length to bound its takeoff velocity.
  const fullSpan = 2 * span;
  const approach = heightAt(from.x - dirX * fullSpan, from.z - dirZ * fullSpan);
  const rise = Math.min(tipRise, (origin - approach) / fullSpan);
  const vertical = clamp(rise * speed, -speed * 1.2, speed * 1.2);
  const y = origin + vertical * dt - gravityDrop;
  if (y - nextHeight < .0018) return null;
  const groundAhead = heightAt(to.x + dirX * span, to.z + dirZ * span);
  const time = dt + span / speed;
  const recovery = origin + vertical * time - .5 * GRAVITY * time * time - groundAhead;
  if (recovery < .026) return null;
  // Knees and ankles can extend through small hollows without changing to
  // a flight pose. A genuine roller or drop keeps falling away beyond the tip.
  const extension = .10 * Math.hypot(1, rise);
  if (recovery < extension) {
    const extensionTime = .19;
    const distance = speed * extensionTime;
    const fallLine = heightAt(from.x + dirX * distance, from.z + dirZ * distance);
    const clearance = origin + vertical * extensionTime - .5 * GRAVITY * extensionTime ** 2 - fallLine;
    if (clearance < extension) return null;
  }
  return { y: y + SNOW_CLEARANCE, vy: vertical - GRAVITY * dt };
}

export function landingLimits({ board, powder, impact }) {
  const normal = (board ? 11.7 : 12.7) + 2.8 * powder;
  const load = clamp(impact / normal, 0, 1);
  return { normal, lean: 1.03 - .25 * load, yaw: (board ? 1.01 : 1.12) - .18 * load };
}
