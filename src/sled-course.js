import { clamp, damp, mulberry32, smoothstep } from './math.js';

export const LENGTH = 1560;
export const RACE_LENGTH = 6200;
export const SLED_SEGMENT_LENGTH = 720;
export const EDGE = 15;
export const LANE = 8.6;
export const STEP = 1 / 90;
export const RAMP_LENGTH = 19;
export const RAMP_HALF = 3.7;
export const RAMP_HEIGHT = 3.65;
export const GAPS = [
  { start: 310, end: 333, lanes: [0], name: 'Creek crossing' },
  { start: 603, end: 630, lanes: [-1, 1], name: 'Split Rock' },
  { start: 956, end: 987, lanes: [1], name: 'Icefall' },
  { start: 1281, end: 1313, lanes: [-1, 0], name: 'Lower gorge' },
];
export const SECTORS = [
  [0, 'Old-growth forest'], [342, 'Split Rock'], [689, 'Icefall traverse'], [1050, 'Lower gorge'], [1350, 'Cedar straight'],
];
export const center = d => 14 * Math.sin(d / 101) + 12 * Math.sin(d / 211);
export const altitude = d => -.286 * d + 6.3 * Math.sin(d / 66) + 3.2 * Math.sin(d / 26);
export const slope = d => -.286 + (6.3 / 66) * Math.cos(d / 66) + (3.2 / 26) * Math.cos(d / 26);
export const gapAt = (d, gaps = GAPS) => gaps.find(gap => d >= gap.start && d < gap.end);

export function snowHeight(x, d) {
  const offset = Math.abs(x);
  const drifts = 1.2 * Math.sin(offset * .53 + d * .091) + 1.05 * Math.sin(x * .16 - d * .129);
  const banks = smoothstep(9, 20, offset) * (.8 + drifts * .8);
  return altitude(d) + banks + Math.max(0, offset - EDGE) * (x > 0 ? .38 : .27) + smoothstep(18, 74, offset) * drifts * 3.2;
}

export function rampHeight(x, d, gaps = GAPS) {
  for (const gap of gaps) {
    if (d < gap.start - RAMP_LENGTH || d >= gap.start) continue;
    if (gap.lanes.some(line => Math.abs(x - line * LANE) < RAMP_HALF)) {
      return RAMP_HEIGHT * ((d - gap.start + RAMP_LENGTH) / RAMP_LENGTH) ** 1.8;
    }
  }
  return 0;
}
export const surfaceHeight = (x, d, gaps) => snowHeight(x, d) + rampHeight(x, d, gaps);

// Keep clear space on both sides of each crossing. Each obstacle row has a
// marked line that moves at most one lane from the previous row in its sector.
export function buildCourse(day = new Date().toISOString().slice(0, 10)) {
  const random = mulberry32(Number(day.replaceAll('-', '')) ^ 0x3d802b);
  const treeRows = [], balls = [], logs = [], tokens = [];
  const pick = list => list[Math.floor(random() * list.length)];
  const tree = (d, lane) => treeRows.push({ d, x: lane * LANE + random() * .8 - .4, h: 24 + random() * 13, hit: 1.05 + random() * .32 });
  const lanes = [-1, 0, 1];
  const sections = [[60, 240], [406, 520], [710, 874], [1060, 1195], [1388, 1519]];
  for (const [section, [start, end]] of sections.entries()) {
    let lane = 0;
    let row = 0;
    for (let d = start; d <= end; d += 53 + Math.round(random() * 7), row++) {
      lane = row === 0 && section === 0 ? pick([-1, 1]) : pick(lanes.filter(n => Math.abs(n - lane) === 1));
      const blocked = lanes.filter(n => n !== lane);
      const kind = (section + row) % 3;
      if (kind === 0) {
        tree(d, section === 0 && row === 0 ? 0 : blocked[0]);
        if (section > 0) tree(d + 1.4, blocked[1]);
      } else if (kind === 1) {
        // A hop earns the high marker. Both log ends leave a bypass.
        logs.push({ d, x: lane * LANE, halfWidth: 3 + random() * .7, radius: .38 + random() * .18 });
        tree(d - 1, pick(blocked));
      } else {
        const ballLane = pick(blocked);
        balls.push([d - 9, ballLane * LANE, 4.6 + random() * 2, 1.6 + random() * .6]);
        if (section > 1) tree(d + 2, blocked.find(n => n !== ballLane));
      }
      for (const offset of [-14, 0, 10]) {
        tokens.push({ d: d + offset, x: lane * LANE, height: kind === 1 && offset === 0 ? 2.05 : 1.05 });
      }
    }
  }
  for (const gap of GAPS) {
    const x = pick(gap.lanes) * LANE;
    for (const offset of [-45, -32, -19, -8]) tokens.push({ d: gap.start + offset, x, height: 1.05 + rampHeight(x, gap.start + offset) });
  }
  tokens.sort((a, b) => a.d - b.d);
  return { day, treeRows, logs, balls, tokens };
}

export function buildSledSegment(index, seed, length = Infinity) {
  const start = index * SLED_SEGMENT_LENGTH;
  const end = Math.min(length, start + SLED_SEGMENT_LENGTH);
  const random = mulberry32(seed ^ Math.imul(index + 1, 0x9e3779b9));
  const treeRows = [], logs = [], tokens = [], balls = [], line = [{ d: start, x: 0 }];
  const lanes = [-1, 0, 1], gaps = [];
  const pick = list => list[Math.floor(random() * list.length)];
  const clearRamp = start + 253 + Math.floor(random() * 130);
  const width = 19 + Math.floor(random() * 13);
  if (clearRamp + width + 102 < end) {
    const choices = random() < .37 ? [0, pick([-1, 1])].sort() : [pick(lanes)];
    gaps.push({ start: clearRamp, end: clearRamp + width, lanes: choices, name: 'Creek crossing' });
  }
  const gap = gaps[0];
  const obstacles = [];
  for (let d = start + 65 + random() * 13; d < end - 70; d += 55 + random() * 25) {
    if (!gap || d < gap.start - 82 || d > gap.end + 69) obstacles.push({ d });
  }
  if (gap) obstacles.push({ d: gap.start, gap });
  obstacles.sort((a, b) => a.d - b.d);
  let lane = 0;
  for (const entry of obstacles) {
    const d = entry.d;
    if (entry.gap) {
      lane = pick(entry.gap.lanes);
      const x = lane * LANE;
      line.push({ d: d - 43, x }, { d: entry.gap.end + 14, x });
      for (const offset of [-36, -23, -11]) {
        tokens.push({ d: d + offset, x, height: 1.05 + rampHeight(x, d + offset, gaps) });
      }
      continue;
    }
    lane = pick(lanes.filter(candidate => Math.abs(candidate - lane) === 1));
    const x = lane * LANE;
    const blocked = lanes.filter(candidate => candidate !== lane);
    const kind = Math.floor(random() * 3);
    const tree = (treeD, treeLane) => treeRows.push({
      d: treeD, x: treeLane * LANE + (random() - .5) * .65,
      h: 23 + random() * 13, hit: 1.02 + random() * .24,
    });
    if (kind === 0) {
      tree(d, blocked[0]);
      tree(d + 2, blocked[1]);
    } else if (kind === 1) {
      logs.push({ d, x, halfWidth: 2.9 + random() * .65, radius: .38 + random() * .16 });
      tree(d - 2, pick(blocked));
    } else {
      const ballLane = pick(blocked);
      balls.push([d - 10, ballLane * LANE, 4.8 + random() * 1.4, 1.5 + random() * .6]);
      tree(d + 2, blocked.find(candidate => candidate !== ballLane));
    }
    line.push({ d: d - 11, x }, { d: d + 13, x });
    for (const offset of [-14, 0, 10]) {
      tokens.push({ d: d + offset, x, height: kind === 1 && offset === 0 ? 2 : 1.05 });
    }
  }
  line.push({ d: end, x: 0 });
  return { start, end, length, gaps, treeRows, logs, balls, tokens, line };
}

export const movingBalls = course => course.balls.map(([start, side, rate, radius], i) => ({
  start, side, rate, radius, d: start, x: side, age: 0, angle: 0, phase: i * 1.42, passed: false,
}));

export function freshRun() {
  return { d: 0, x: 0, dx: 0, y: snowHeight(0, 0), dy: 0, speed: 19, elapsed: 0,
    jumps: 0, passes: 0, hops: 0, tokens: 0, nextToken: 0, lastToken: -1, jumpHeld: false,
    air: null, countdown: 2.65, crash: '', recovery: 0, recoveryHint: '', bumps: 0 };
}

const RIVAL_START_X = 1.85;

export function freshRival() {
  return { d: 0, x: RIVAL_START_X, dx: 0, y: snowHeight(RIVAL_START_X, 0), dy: 0, speed: 19,
    elapsed: 0, air: null, finishTime: null };
}

export function simulateRival(rival, run, course, dt) {
  if (rival.finishTime !== null) return;
  const before = rival.d, previousX = rival.x, previousY = rival.y;
  const phase = rival.elapsed;
  const length = course.length ?? RACE_LENGTH;
  const pace = 34.5 + 1.8 * Math.sin(phase * .3) + 1.25 * Math.sin(phase * .79 + .3)
    + clamp((run.d - rival.d) * .026, -2.1, 2.1);
  rival.elapsed += dt;
  rival.speed = damp(rival.speed, pace, 1.7, dt);
  rival.d = Math.min(length, rival.d + rival.speed * dt);
  const d = rival.d, gaps = course.gaps;
  const next = course.line.findIndex(point => point.d >= d);
  const a = course.line[Math.max(0, next < 0 ? course.line.length - 2 : next - 1)];
  const b = course.line[next] ?? course.line.at(-1);
  const t = next === 0 ? 0 : smoothstep(a.d, b.d, d);
  rival.x = a.x + (b.x - a.x) * t + RIVAL_START_X * (1 - smoothstep(0, 40, d));
  const creek = gaps.find(gap => d > gap.start - 2 && d < gap.end + 3);
  const log = course.logs.find(log => Math.abs(log.x - rival.x) < log.halfWidth && Math.abs(log.d - d) < 12);
  if (creek) {
    const start = creek.start - 2, end = creek.end + 3;
    const portion = (d - start) / (end - start);
    const takeoff = surfaceHeight(rival.x, start, gaps), landing = snowHeight(rival.x, end);
    rival.y = takeoff + (landing - takeoff) * portion + 4.6 * Math.sin(portion * Math.PI);
  } else {
    const hop = log ? 1.95 * Math.sin((d - log.d + 12) / 24 * Math.PI) : 0;
    rival.y = surfaceHeight(rival.x, d, gaps) + hop;
  }
  rival.air = creek || log || null;
  rival.dx = (rival.x - previousX) / dt;
  rival.dy = (rival.y - previousY) / dt;
  if (d >= length) rival.finishTime = rival.elapsed - dt + clamp((length - before) / rival.speed, 0, dt);
}

export function points(run, finish = false) {
  const bonus = finish ? Math.max(0, Math.round((63 - run.elapsed) * 24)) : 0;
  return Math.floor(run.d) + run.tokens * 40 + run.jumps * 250 + run.passes * 110 + bonus;
}

function updateBall(ball, run, dt) {
  if (run.d <= ball.start - 73 || ball.d < run.d - 25) return;
  ball.age += dt;
  // A passing rider can see the ball roll from the bank and drift downhill.
  // Confine its fall line to its own obstacle row even while the rider brakes.
  ball.d = ball.start + 21 * (1 - Math.exp(-ball.age * ball.rate / 21));
  ball.x = ball.side + 3.75 * Math.sin(ball.age * 1.16 + ball.phase);
  ball.angle += dt * ball.rate / ball.radius;
}

function recover(run, gaps, hint, side = 0) {
  run.recovery = .86;
  run.recoveryHint = hint;
  run.bumps++;
  run.speed = Math.max(16, run.speed * .73);
  if (side) run.dx = side * 9.4;
  run.air = null;
  run.y = surfaceHeight(run.x, run.d, gaps);
  run.dy = slope(run.d) * run.speed;
}

export function simulate(run, world, input, dt) {
  const { course, forgiving, pace, length = LENGTH } = world;
  const gaps = course.gaps ?? GAPS;
  if (run.tokenCourse !== course) {
    run.nextToken = 0;
    run.tokenCourse = course;
  }
  run.elapsed += dt;
  run.recovery = Math.max(0, run.recovery - dt);
  const before = run.d;
  const previousY = run.y;
  const steer = Number(input('right')) - Number(input('left'));
  const jump = input('jump');
  const pressed = jump && !run.jumpHeld;
  run.jumpHeld = jump;
  const bank = smoothstep(12, EDGE + .7, Math.abs(run.x));
  const brake = input('brake'), tuck = input('tuck');
  const lateralSpeed = run.air ? 6.2 : (brake ? 17 : 13.8) + run.speed * .075;
  run.dx = damp(run.dx, steer * lateralSpeed, run.air ? 2.8 : steer ? 7.8 : 4.9, dt);
  run.x = clamp(run.x + run.dx * dt, -EDGE - .7, EDGE + .7);
  const speedTarget = pace === 'race' ? (tuck ? 38.6 : 34.1) : tuck ? 46 : 33;
  const target = (brake ? 19.5 : speedTarget) - bank * 6.2 - 10 * (slope(run.d) + .286);
  run.speed = damp(run.speed, target, brake ? 3.4 : 1.35, dt);
  if (pressed && !run.air && !gapAt(before, gaps)) {
    const rise = rampHeight(run.x, before, gaps);
    const launch = 11.9 + (rise > 0 ? run.speed * .30 * (rise / RAMP_HEIGHT) ** .45 : 0);
    run.air = { gap: null };
    run.dy = slope(before) * run.speed + launch;
    run.hops++;
  }
  run.d = Math.min(length, before + run.speed * dt);
  const gap = gapAt(run.d, gaps);
  if (gap && before < gap.start) {
    if (!run.air) {
      const onRamp = gap.lanes.some(lane => Math.abs(run.x - lane * LANE) < RAMP_HALF);
      run.air = { gap };
      run.y = snowHeight(run.x, gap.start) + (onRamp ? RAMP_HEIGHT : 0);
      run.dy = slope(before) * run.speed + (onRamp ? run.speed * .34 + 2.8 : 0);
    } else {
      run.air.gap = gap;
    }
  }
  if (run.air) {
    run.y += run.dy * dt - 15.5 * dt * dt;
    run.dy -= 31 * dt;
    const crossing = run.air.gap;
    if (crossing) {
      if (before < crossing.end && run.d >= crossing.end) {
        const lipY = previousY + (run.y - previousY) * (crossing.end - before) / (run.d - before);
        if (run.air.short || lipY < snowHeight(run.x, crossing.end) - .17) {
          if (!forgiving) return `Short at ${crossing.name}. Line up with the chevrons, tuck and jump at the lip.`;
          recover(run, gaps, 'Short landing');
        } else run.jumps++;
      } else if (gap) {
        const base = snowHeight(run.x, run.d);
        if (!forgiving && run.y < base - 4) return `Missed ${gap.name}. Follow the chevrons onto a ramp.`;
        if (forgiving && (run.air.short || run.y < base - 3)) {
          run.air.short = true;
          // Guide a short jump back toward the far lip without restarting the run.
          run.y = base - 3 * clamp((crossing.end - run.d) / 10, 0, 1);
        }
      }
    }
    if (!gap && run.y <= surfaceHeight(run.x, run.d, gaps) + .015 && run.dy < slope(run.d) * run.speed) run.air = null;
  }
  if (!run.air) run.y = surfaceHeight(run.x, run.d, gaps);
  for (const tree of world.treeRows) {
    const along = tree.d - run.d;
    if (Math.abs(along) > 3.6) continue;
    const distance = Math.hypot(along, tree.x - run.x);
    if (distance < tree.hit + .54 && !run.recovery) {
      if (!forgiving) return 'Caught a fir trunk. Look through the gap between the trees.';
      const side = Math.sign(run.x - tree.x) || Math.sign(run.dx) || 1;
      run.x = clamp(tree.x + side * (tree.hit + .66), -EDGE - .7, EDGE + .7);
      recover(run, gaps, 'Clipped a fir', side);
    }
    if (!run.recovery && before < tree.d && tree.d <= run.d && distance < tree.hit + 2.05 && !run.air) run.passes++;
  }
  for (const log of course.logs) {
    if (Math.abs(log.d - run.d) > log.radius + .53 || Math.abs(run.x - log.x) > log.halfWidth + .46) continue;
    if (run.y - snowHeight(run.x, run.d) < log.radius * 2 && !run.recovery) {
      if (!forgiving) return 'Clipped a fallen cedar. Hop just before it or steer around either end.';
      recover(run, gaps, 'Clipped a log');
    }
  }
  for (const ball of world.balls) {
    const oldD = ball.d;
    updateBall(ball, run, dt);
    if (Math.abs(ball.d - run.d) > ball.radius + 2.25) continue;
    const distance = Math.hypot(ball.d - run.d, ball.x - run.x);
    if (distance < ball.radius + .55 && run.y - snowHeight(ball.x, ball.d) < ball.radius * 1.8 && !run.recovery) {
      if (!forgiving) return 'A rolling snowball caught you. Pass on its uphill side.';
      recover(run, gaps, 'Hit by a snowball', Math.sign(run.x - ball.x) || 1);
    }
    if (!run.recovery && before < oldD && ball.d <= run.d && distance < ball.radius + 2.25 && !ball.passed) {
      ball.passed = true;
      run.passes++;
    }
  }
  const { tokens } = course;
  while (run.nextToken < tokens.length) {
    const t = tokens[run.nextToken];
    if (run.d < t.d - 1) break;
    if (run.d <= t.d + 1) {
      if (Math.abs(t.x - run.x) > 1.5 || Math.abs(run.y + .85 - snowHeight(t.x, t.d) - t.height) > 1.5) break;
      run.lastToken = run.elapsed;
      run.tokens++;
    }
    run.nextToken++;
  }
  return '';
}
