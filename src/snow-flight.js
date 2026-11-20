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
  const rise = (origin - behind) / span;
  const vertical = clamp(rise * speed, -speed * 1.2, speed * 1.2);
  const y = origin + vertical * dt - .5 * GRAVITY * dt * dt;
  if (y - nextHeight < .0018) return null;
  const groundAhead = heightAt(to.x + dirX * span, to.z + dirZ * span);
  const time = dt + span / speed;
  const recovery = origin + vertical * time - .5 * GRAVITY * time * time - groundAhead;
  if (recovery < .026) return null;
  return { y: y + SNOW_CLEARANCE, vy: vertical - GRAVITY * dt };
}

export function landingLimits({ board, powder, impact }) {
  const normal = (board ? 11.7 : 12.7) + 2.8 * powder;
  const load = clamp(impact / normal, 0, 1);
  return { normal, lean: 1.03 - .25 * load, yaw: (board ? 1.01 : 1.12) - .18 * load };
}
