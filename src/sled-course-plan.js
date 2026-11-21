import { clamp, mulberry32, smoothstep } from './math.js';

export const SLED_SEGMENT_LENGTH = 720;
export const LANE = 8.6;
const LANES = [-1, 0, 1];
const BIOMES = ['forest', 'cave', 'river', 'village'];
const DEBRIS = ['fallingIce', 'fallingSnow', 'fallingRock'];
const RIVER_HAZARDS = ['iceChunk', 'bankLimb', 'rockIsland', 'polarBear'];

export const sectionAt = (course, d) => course.sections?.find(s => d >= s.start && d <= s.end);

// At top tuck speed, reserve time to notice the cue, reverse steering and then
// traverse the requested horizontal distance at less than full ground speed.
export function sledDifficulty(d) {
  const level = 1 - Math.exp(-Math.max(0, d) / 4700);
  const speedGain = 5.5 * level;
  return { level, speedGain, maxSpeed: 49.8 + speedGain, reactionTime: .36, steeringLag: .23,
    lateralSpeed: 14, rowSpacing: 110 - 25 * level, doubleChance: .12 + .64 * level };
}

export function steeringDistance(difficulty, dx) {
  return difficulty.maxSpeed * (difficulty.reactionTime + difficulty.steeringLag + Math.abs(dx) / difficulty.lateralSpeed);
}

export function caveRoofHeight(section, x, d) {
  const crown = 18.8 - 2 * Math.min(1, (x / section.halfWidth) ** 2);
  return crown * smoothstep(section.pickupD, section.tunnelStart - 5, d)
    * (1 - smoothstep(section.tunnelEnd, section.tunnelEnd + 72, d));
}

export function featureX(f, elapsed) {
  if (f.kind === 'polarBear') return f.x + .82 * Math.sin(elapsed * .68 + f.phase);
  if (f.kind === 'iceChunk') return f.x + .34 * Math.sin(elapsed * .76 + f.phase);
  return f.x;
}

export function featureRaise(f, elapsed) {
  return f.kind === 'iceChunk' ? .07 * Math.sin(elapsed * 1.55 + f.phase) : 0;
}

export function fallState(f, elapsed) {
  const time = (elapsed + f.phase) % f.period;
  if (time < 1.12) return { phase: 'warning', height: 10.6, progress: time / 1.12 };
  if (time < 1.94) {
    const progress = (time - 1.12) / .82;
    return { phase: 'falling', height: 10.6 * (1 - progress * progress), progress };
  }
  if (time < 2.86) return { phase: 'impact', height: 0, progress: (time - 1.94) / .92 };
  return { phase: 'idle', height: 10.6, progress: (time - 2.86) / (f.period - 2.86) };
}

export function houseRampHeight(f, x, d) {
  if (f.kind !== 'roofRamp' || Math.abs(x - f.x) > f.halfWidth || d < f.rampStart || d > f.d + f.halfDepth) return 0;
  return f.height * clamp((d - f.rampStart) / (f.d - f.halfDepth - f.rampStart), 0, 1);
}

const dimensions = {
  fallingIce: [1.35, 1.3, 2.5], fallingSnow: [1.85, 1.75, 2], fallingRock: [1.55, 1.5, 2.2],
  iceChunk: [2.15, 2.6, 1.1], bankLimb: [3.25, 1.45, 1], rockIsland: [2.65, 3.7, 1.8],
  polarBear: [1.35, 2, 1.9], openHouse: [3.8, 6, 5.35], closedHouse: [3.85, 5.9, 5.4],
  roofRamp: [3.45, 6.6, 4.6], flightPickup: [1.8, 1.5, 1.15],
};

function makeSection(kind, start, end) {
  const section = { kind, start, end };
  if (kind === 'cave') Object.assign(section, {
    pickupD: start + 46, tunnelStart: start + 138, tunnelEnd: end - 118,
    centerX: 0, halfWidth: 18.4, ceilingHeight: 14.5,
  });
  if (kind === 'river') Object.assign(section, { waterStart: start + 20, waterEnd: end - 20, halfWidth: 16.8 });
  return section;
}

export function buildSledSegment(index, seed, length = Infinity) {
  const start = index * SLED_SEGMENT_LENGTH, end = Math.min(start + SLED_SEGMENT_LENGTH, length);
  const random = mulberry32(seed ^ Math.imul(index + 1, 0x9e3779b9));
  const pick = list => list[Math.floor(random() * list.length)];
  // The opening presents one of each environment. Later groups keep a forest
  // breather and shuffle the three specialties without adjacent duplicates.
  const cycle = Math.floor(index / BIOMES.length);
  const order = [...BIOMES];
  if (cycle) {
    const shuffle = mulberry32(seed ^ Math.imul(cycle, 0x85ebca6b));
    for (let i = order.length - 1; i > 1; i--) {
      const j = 1 + Math.floor(shuffle() * i);
      [order[i], order[j]] = [order[j], order[i]];
    }
  }
  const kind = order[index % order.length];
  const section = makeSection(kind, start, end);
  const course = { start, end, length, sections: [section], features: [], rows: [], gaps: [],
    treeRows: [], balls: [], logs: [], tokens: [], line: [{ d: start, x: 0 }] };
  const feature = (name, d, lane, more) => {
    const [halfWidth, halfDepth, height] = dimensions[name];
    const f = { kind: name, d, x: lane * LANE, halfWidth, halfDepth, height, ...more };
    course.features.push(f);
    return f;
  };
  const tree = (d, lane) => course.treeRows.push({ d, x: lane * LANE + (random() - .5) * .65,
    h: 23 + random() * 13, hit: 1.02 + random() * .24 });
  const token = (d, x, height = 1.05, route) => course.tokens.push({ d, x, height, ...(route ? { route } : {}) });

  for (const offset of [7, 23, 37]) if (start + offset < end) token(start + offset, 0);
  const hasRoof = kind === 'cave' && section.tunnelStart < section.tunnelEnd;
  const preferredWing = hasRoof ? pick([-1, 1]) : 0;
  if (kind === 'river' && section.waterStart + 14 < end) {
    token(section.waterStart + 35, 0);
    course.gaps.push({ kind: 'riverEntry', start: section.waterStart, end: section.waterStart + 14,
      lanes: [...LANES], name: 'Glacier River entry', rise: 1.15 });
  }
  const full = end - start > 430;
  const gapStart = end - 126 - Math.floor(random() * 18);
  const obstacleEnd = full ? gapStart - (kind === 'cave' ? 132 : 102) : end - 74;
  let d = start + (kind === 'cave' ? 165 : 84) + random() * 12;
  let lane = 0, turns = 0, tight = 0;
  const variant = Math.floor(random() * 12);
  for (let row = 0; d < obstacleEnd; row++) {
    const difficulty = sledDifficulty(d);
    const previousLane = lane;
    const change = random() < .42 + .40 * difficulty.level && turns < 2 && !(kind === 'river' && row === 0);
    if (change) lane = pick(LANES.filter(n => Math.abs(n - lane) === 1));
    turns = change ? turns + 1 : 0;
    const blocked = LANES.filter(n => n !== lane);
    if (random() < .5) blocked.reverse();
    const double = !(index === 0 && row < 2) && tight < 2 && random() < difficulty.doubleChance;
    tight = double ? tight + 1 : 0;
    const occupied = double ? blocked : blocked.slice(0, 1);
    const x = lane * LANE;
    course.rows.push({ d, lane, previousLane, blockedLanes: occupied, kind });
    course.line.push({ d: d - 12, x }, { d: d + 12, x });
    for (const offset of [-16, 0, 12]) token(d + offset, x);
    for (const [n, blockedLane] of occupied.entries()) {
      if (kind === 'forest') {
        const type = (row + n) % 3;
        if (type === 0) tree(d, blockedLane);
        if (type === 1) course.logs.push({ d, x: blockedLane * LANE, halfWidth: 3.2, radius: .45 });
        if (type === 2) course.balls.push([d - 10, blockedLane * LANE, 5 + random(), 1.5 + random() * .45]);
      } else if (kind === 'cave') {
        feature(DEBRIS[(row + n + variant) % 3], d, blockedLane, { phase: random() * 4, period: 4.2 + random() * 1.3 });
      } else if (kind === 'river') {
        const name = RIVER_HAZARDS[(row + variant + n) % 4];
        feature(name, d, blockedLane, { phase: random() * Math.PI * 2 });
      } else if (n === 0 && row % 3 === 1) {
        const roof = feature('roofRamp', d, blockedLane, { rampStart: d - 27 });
        for (const offset of [-20, -8, 3]) token(d + offset, roof.x, 1.05 + houseRampHeight(roof, roof.x, d + offset), 'roof');
      } else feature('closedHouse', d, blockedLane);
    }
    if (kind === 'village' && row % 3 !== 1) feature('openHouse', d, lane, { doorHalfWidth: 2.55, doorHeight: 3.65 });
    // Twelve metres of clear lane on both sides of a row cover moving bodies
    // and building interiors. Never ask for a second lane change in that span.
    d += Math.max(difficulty.rowSpacing + random() * 8, 24 + steeringDistance(difficulty, LANE));
  }
  if (hasRoof) {
    for (const offset of [53, 74, 94]) token(start + offset, 0);
    const wingLane = lane ? -lane : preferredWing;
    section.roofExitSide = wingLane;
    section.exitHalfWidth = 3.8;
    feature('flightPickup', section.pickupD, wingLane);
    for (let d = section.pickupD + 14; d <= section.tunnelEnd + 60; d += 19) {
      const crest = smoothstep(section.tunnelStart, section.tunnelStart + 100, d)
        * (1 - smoothstep(section.tunnelEnd - 130, section.tunnelEnd - 30, d));
      const x = wingLane * LANE * (1 - .47 * crest);
      token(d, x, caveRoofHeight(section, x, d) + 1.05, 'upper');
    }
  }

  if (full) {
    // The optional snow chute never occupies the guided lower landing.
    if (hasRoof) lane = -section.roofExitSide;
    const waterfall = kind === 'river';
    const width = waterfall ? 30 : 19 + random() * 4;
    const gap = { start: gapStart, end: gapStart + width, lanes: waterfall ? [...LANES] : [lane],
      name: waterfall ? 'Glacier Falls' : kind === 'cave' ? 'Crystal chasm' : kind === 'village' ? 'Mill creek' : 'Creek crossing',
      ...(waterfall ? { kind: 'waterfall', rise: 1.85 } : {}) };
    course.gaps.push(gap);
    const x = lane * LANE;
    course.line.push({ d: gap.start - 48, x }, { d: gap.end + 24, x });
    for (const offset of [-48, -34, -20, -9, -1]) token(gap.start + offset, x);
    for (const offset of [5, 22]) token(gap.end + offset, x);
  }
  if (end - start > 80) token(end - 10, 0);
  course.line.push({ d: end, x: 0 });
  course.tokens.sort((a, b) => a.d - b.d);
  return course;
}
