import { clamp, damp, mulberry32, smoothstep } from './math.js';

export const LENGTH = 1560;
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
export const gapAt = d => GAPS.find(gap => d >= gap.start && d < gap.end);

export function snowHeight(x, d) {
  const offset = Math.abs(x);
  const drifts = 1.2 * Math.sin(offset * .53 + d * .091) + 1.05 * Math.sin(x * .16 - d * .129);
  const banks = smoothstep(9, 20, offset) * (.8 + drifts * .8);
  return altitude(d) + banks + Math.max(0, offset - EDGE) * (x > 0 ? .38 : .27) + smoothstep(18, 74, offset) * drifts * 3.2;
}

export function rampHeight(x, d) {
  for (const gap of GAPS) {
    if (d < gap.start - RAMP_LENGTH || d >= gap.start) continue;
    if (gap.lanes.some(line => Math.abs(x - line * LANE) < RAMP_HALF)) {
      return RAMP_HEIGHT * ((d - gap.start + RAMP_LENGTH) / RAMP_LENGTH) ** 1.8;
    }
  }
  return 0;
}
export const surfaceHeight = (x, d) => snowHeight(x, d) + rampHeight(x, d);

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

export const movingBalls = course => course.balls.map(([start, side, rate, radius], i) => ({
  start, side, rate, radius, d: start, x: side, age: 0, angle: 0, phase: i * 1.42, passed: false,
}));

export function freshRun() {
  return { d: 0, x: 0, dx: 0, y: snowHeight(0, 0), dy: 0, speed: 19, elapsed: 0,
    jumps: 0, passes: 0, hops: 0, tokens: 0, nextToken: 0, lastToken: -1, jumpHeld: false,
    air: null, countdown: 2.65, crash: '' };
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

export function simulate(run, world, input, dt) {
  run.elapsed += dt;
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
  const target = (brake ? 19.5 : tuck ? 46 : 33) - bank * 6.2 - 10 * (slope(run.d) + .286);
  run.speed = damp(run.speed, target, brake ? 3.4 : 1.35, dt);
  if (pressed && !run.air && !gapAt(before)) {
    const rise = rampHeight(run.x, before);
    const launch = 10.7 + (rise > 0 ? run.speed * .30 * (rise / RAMP_HEIGHT) ** .45 : 0);
    run.air = { gap: null };
    run.dy = slope(before) * run.speed + launch;
    run.hops++;
  }
  run.d = Math.min(LENGTH, before + run.speed * dt);
  const gap = gapAt(run.d);
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
        if (lipY < snowHeight(run.x, crossing.end) - .17) return `Short at ${crossing.name}. Line up with the chevrons, tuck and jump at the lip.`;
        run.jumps++;
      } else if (gap && run.y < snowHeight(run.x, run.d) - 4) {
        return `Missed ${gap.name}. Follow the chevrons onto a ramp.`;
      }
    }
    if (!gap && run.y <= surfaceHeight(run.x, run.d) + .015 && run.dy < slope(run.d) * run.speed) run.air = null;
  }
  if (!run.air) run.y = surfaceHeight(run.x, run.d);
  for (const tree of world.treeRows) {
    const along = tree.d - run.d;
    if (Math.abs(along) > 3.6) continue;
    const distance = Math.hypot(along, tree.x - run.x);
    if (distance < tree.hit + .54) return 'Caught a fir trunk. Look through the gap between the trees.';
    if (before < tree.d && tree.d <= run.d && distance < tree.hit + 2.05 && !run.air) run.passes++;
  }
  for (const log of world.course.logs) {
    if (Math.abs(log.d - run.d) > log.radius + .53 || Math.abs(run.x - log.x) > log.halfWidth + .46) continue;
    if (run.y - snowHeight(run.x, run.d) < log.radius * 2) return 'Clipped a fallen cedar. Hop just before it or steer around either end.';
  }
  for (const ball of world.balls) {
    const oldD = ball.d;
    updateBall(ball, run, dt);
    if (Math.abs(ball.d - run.d) > ball.radius + 2.25) continue;
    const distance = Math.hypot(ball.d - run.d, ball.x - run.x);
    if (distance < ball.radius + .55 && run.y - snowHeight(ball.x, ball.d) < ball.radius * 1.8) return 'A rolling snowball caught you. Pass on its uphill side.';
    if (before < oldD && ball.d <= run.d && distance < ball.radius + 2.25 && !ball.passed) {
      ball.passed = true;
      run.passes++;
    }
  }
  const { tokens } = world.course;
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
