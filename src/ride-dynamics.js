import { clamp, damp, lerp, shortestAngle, smoothstep, wrapAngle } from './util.js';

export const GRAVITY = 9.81;

// Dimensions are catalog measurements. The following response and friction
// coefficients are gameplay estimates, not manufacturer performance data.
export function skiResponse(model, baseline) {
  if (!model || !baseline || model === baseline) return { turn: 1, float: 1, switch: 1, stability: 1, grip: 1 };
  const { handling: actual } = model;
  const { handling: reference } = baseline;
  const widthRatio = baseline.waistMm / model.waistMm;
  const turn = (baseline.radiusM / model.radiusM) ** .53 * (baseline.lengthCm / model.lengthCm) ** .57 * widthRatio ** .15;
  const support = (model.waistMm * model.lengthCm) / (baseline.waistMm * baseline.lengthCm);
  return {
    turn: clamp(turn, .68, 1.4),
    float: clamp(support ** .8 * (actual.float / reference.float) ** .4, .67, 1.45),
    switch: actual.switch / reference.switch,
    stability: actual.stability / reference.stability,
    grip: widthRatio ** .28,
  };
}

export function resetBoardMotion(rider) {
  rider.boardEdge = 0;
  rider.boardOneFoot = 0;
  rider.boardSlip = 0;
}

export const frontBindingSide = (stance) => stance === 'goofy' ? -1 : 1;

export const boardFloat = (model) => model.handling.float * (model.waistMm / 253) ** .5 * (model.lengthCm / 158) ** .42;

export function boardContact(rider, dt, input, normal, speed) {
  const model = rider.snowboardModel;
  const setup = model.handling;
  const { vel, surface } = rider;
  const steer = clamp(input.steer || 0, -1, 1);
  const braking = !!input.brake;
  const switchSign = rider.switchStance ? -1 : 1;
  const preferredBrake = frontBindingSide(rider.stance);
  const pathYaw = speed > .4 ? Math.atan2(vel.x, vel.z) : rider.travelHeading;

  if (braking && !rider.stopDirection && speed > 1.35) {
    rider.stopApproach = pathYaw;
    rider.stopDirection = Math.abs(steer) > .18 ? -Math.sign(steer) : preferredBrake * switchSign;
  } else if (!braking) rider.stopDirection = 0;

  const stopping = rider.stopDirection !== 0;
  rider.stopEdge = damp(rider.stopEdge, Number(stopping), stopping ? 10 : 8, dt);
  const oneFoot = input.tuck && !braking && switchSign > 0
    ? 1 - smoothstep(1.0, 3.1, speed) : 0;
  rider.boardOneFoot = damp(rider.boardOneFoot, oneFoot, 9, dt);
  rider.strideAmount = 0;
  rider.stridePhase += dt * (5 + speed * .6);
  rider.tuckAmount = damp(rider.tuckAmount, input.tuck && !braking ? smoothstep(4.5, 11, speed) : 0, 7, dt);

  const edgeTarget = stopping ? -rider.stopDirection * switchSign * .67
    : steer * switchSign * lerp(.25, .81, smoothstep(.7, 13, speed)) * (1 - .62 * rider.boardOneFoot);
  // Transferring from heel to toe passes through a moment with the base flat.
  const edgeChange = edgeTarget * rider.boardEdge < 0;
  rider.boardEdge = damp(rider.boardEdge, edgeTarget, edgeChange ? 5.5 : 8 / setup.stability, dt);
  const bite = Math.abs(Math.sin(rider.boardEdge));

  const ny = Math.max(.15, normal.y);
  vel.x += GRAVITY * ny * normal.x * 1.13 * dt;
  vel.z += GRAVITY * ny * normal.z * 1.13 * dt;
  const grip = surface.grip * setup.grip * (rider.switchStance ? setup.switch : 1);

  if (stopping) {
    const across = rider.stopApproach + (switchSign < 0 ? Math.PI : 0) + rider.stopDirection * Math.PI * .48;
    rider.heading += shortestAngle(rider.heading, across) * (1 - Math.exp(-7.2 * dt));
  } else {
    const engagement = clamp(.43 + grip * bite * .95, .29, 1);
    const radius = model.radiusM * setup.stability * (1 - .24 * bite);
    const curve = clamp(speed / radius * bite * engagement, 0, 1.44);
    const pivot = .76 * (1 - smoothstep(2, 12, speed)) + .16;
    const turn = (-steer * pivot - rider.boardEdge * switchSign * curve / Math.max(.12, Math.abs(rider.boardEdge))) * dt;

    // Move along the edged sidecut while allowing a flat or overloaded board to pivot and skid.
    rider.heading += turn;
    const yaw = (turn + steer * pivot * dt) * clamp(bite * grip * 1.12, 0, .92);
    const oldX = vel.x;
    vel.x = Math.cos(yaw) * oldX + Math.sin(yaw) * vel.z;
    vel.z = Math.cos(yaw) * vel.z - Math.sin(yaw) * oldX;
  }
  rider.heading = wrapAngle(rider.heading);

  const fx = Math.sin(rider.heading), fz = Math.cos(rider.heading);
  const cross = vel.x * fz - vel.z * fx;
  const along = vel.x * fx + vel.z * fz;
  const float = boardFloat(model);
  const powderDrag = surface.powder * (.68 - .40 * smoothstep(2, 15, speed)) / float;
  const glide = GRAVITY * ny * .039 * surface.drag + powderDrag;
  const drag = lerp(.0038, .00245, rider.tuckAmount) * surface.drag * setup.drag;
  const alongAfter = resist(along, (glide + drag * along * along + (braking ? 3.7 * grip : 0)) * dt);
  // Edge shear dissipates the cross-board speed. When braking, less of the
  // remaining motion is redirected across the hill by the rotating board.
  const edgeFriction = glide + grip * (2.3 + 10.1 * bite + (stopping ? 11.6 * rider.stopEdge : 0));
  const crossAfter = resist(cross, (edgeFriction + Math.abs(cross) * (.85 + bite * grip * 2.7)) * dt);
  const step = Math.max(0, Math.sin(rider.stridePhase)) * .28 + .72;
  const push = oneFoot * step * 4.8 * lerp(.67, 1, surface.grip) * dt;
  vel.x = fx * (alongAfter + push) + fz * crossAfter;
  vel.z = fz * (alongAfter + push) - fx * crossAfter;
  rider.boardSlip = Math.abs(crossAfter) / Math.max(1, Math.hypot(vel.x, vel.z));
}

function resist(value, by) {
  return Math.sign(value) * Math.max(0, Math.abs(value) - by);
}
