const peerId = /^[a-f0-9]{16}$/;
export const pilotStages = ['board', 'tree', 'ledge', 'done'];
export const WINCH_LEASE = 5500;
export const MAX_CABLE = 45;

const bounded = (value, max) => Number.isFinite(value) && Math.abs(value) <= max;
const isCounter = value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000;

export function readWinchPacket(bytes) {
  let packet;
  try { packet = JSON.parse(bytes.toString()); } catch { return null; }
  if (!Array.isArray(packet)) return null;
  // Pilot: [0, stage, crewId, x, y, z, yaw, cableMetres, phase, attachedRequest].
  if (packet[0] === 0 && packet.length === 10 && pilotStages.includes(packet[1]) &&
      typeof packet[2] === 'string' && (!packet[2] || peerId.test(packet[2])) &&
      packet.slice(3, 6).every(value => bounded(value, 80000)) && bounded(packet[6], Math.PI + .001) &&
      bounded(packet[7], MAX_CABLE) && packet[7] >= 0 && [0, 1, 2].includes(packet[8]) && isCounter(packet[9])) return packet;
  // Crew: [1, pilotId, winch direction, attach request]. Repeat intent until the next update.
  if (packet[0] === 1 && packet.length === 4 && typeof packet[1] === 'string' && peerId.test(packet[1]) &&
      [-1, 0, 1].includes(packet[2]) && isCounter(packet[3])) return packet;
  return null;
}

export function freshWinchPeer(peer) {
  return peer?.winch && performance.now() - peer.winchAt < WINCH_LEASE ? peer.winch : null;
}

export function invitedPilot() {
  const id = new URLSearchParams(location.search).get('patrol');
  return id && peerId.test(id) ? id : '';
}
