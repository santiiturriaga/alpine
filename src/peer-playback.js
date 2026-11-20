const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const timePrefix = 1_000_000_000_000;
export const movingInterval = 135;
const predictionLimit = 92;
const defaultDelay = 270;

function discontinuous(before, after, elapsed) {
  const seconds = Math.max(0, elapsed) / 1000;
  const speed = Math.max(Math.abs(before[7]), Math.abs(after[7]));
  return ((before[10] ^ after[10]) & 8) !== 0 ||
    Math.hypot(after[0] - before[0], after[2] - before[2]) > Math.max(3.1, speed * seconds * 1.42 + 1.6) ||
    Math.abs(after[1] - before[1]) > Math.max(3.6, 80 * seconds);
}

export function recordSnapshot(remote, pose, heard) {
  const clocked = pose[16] >= timePrefix;
  const at = clocked ? pose[16] - timePrefix : heard;
  const last = remote.history?.at(-1);
  const elapsed = last ? at - last.at : 0;
  const silence = heard - remote.heard;
  if (!last || clocked !== remote.clocked || elapsed > 2100 || silence > 2600 ||
      discontinuous(last.pose, pose, elapsed)) {
    remote.history = [];
    remote.segment = (remote.segment ?? 0) + 1;
    remote.cursor = undefined;
  }
  const offset = heard - at;
  // Favor the least delayed packets, allowing for gradual clock drift.
  remote.clockOffset = !remote.history.length ? offset : Math.min(offset,
    remote.clockOffset + Math.max(0, silence) * .003);
  if (clocked && remote.history.length && last.pose[7] >= .3 && pose[7] >= .3 &&
      elapsed >= movingInterval && elapsed <= movingInterval * 1.7) {
    // Measure actual send cadence without folding a dropped update into it.
    const previous = remote.motionInterval ?? elapsed;
    remote.motionInterval = previous + (elapsed - previous) * .12;
    remote.playbackDelay = clamp(2 * remote.motionInterval + 60 - predictionLimit, 235, 320);
  }
  remote.clocked = clocked;
  remote.pose = pose;
  remote.heard = heard;
  remote.history.push({ at, pose });
  if (remote.history.length > 12) remote.history.shift();
}

export function peerPlaybackTime(remote, time) {
  const latest = remote.history.at(-1);
  const desired = time - remote.clockOffset - (remote.playbackDelay ?? defaultDelay);
  const delta = time - (remote.playbackFrame ?? time);
  let at = desired;
  if (remote.cursor !== undefined && delta < 750) {
    // Correct the playout delay gradually when sequence timing or measured
    // network latency changes. Never skip ahead or stop for a clock update.
    const drift = desired - (remote.cursor + delta);
    at = remote.cursor + delta * clamp(1 + drift / 240, .75, 1.25);
  }
  remote.playbackFrame = time;
  remote.cursor = Math.min(latest.at + predictionLimit, at);
  return remote.cursor;
}
