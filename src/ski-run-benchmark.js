// The Pages launcher and the Playwright harness share this module. Timings use
// the game window's clock, including when the launcher hosts it in an iframe.
export const DEFAULT_SKI_RUN = 'd69cb22c9615';

export function inspectSkiBenchmark({ targetWindow = window, game = targetWindow.__alpine } = {}) {
  const { document, performance } = targetWindow;
  const {renderer} = game;
  const gl = renderer.getContext();
  const adapter = gl.getExtension('WEBGL_debug_renderer_info');
  const size = [gl.drawingBufferWidth, gl.drawingBufferHeight];
  return {
    vendor: adapter ? gl.getParameter(adapter.UNMASKED_VENDOR_WEBGL) : null,
    renderer: adapter ? gl.getParameter(adapter.UNMASKED_RENDERER_WEBGL) : null,
    webgl: gl.getParameter(gl.VERSION), size, viewport: [targetWindow.innerWidth, targetWindow.innerHeight],
    dpr: targetWindow.devicePixelRatio, antialias: gl.getContextAttributes()?.antialias ?? null,
    quality: document.getElementById('graphics-level')?.textContent?.trim(),
    frameLimit: document.getElementById('pause-frame-cap')?.value,
    resolution: document.getElementById('pause-resolution')?.value ?? null,
    contextLost: gl.isContextLost(), pageVisible: !document.hidden,
    boot: { ...targetWindow.skiBenchmarkBoot, readyMs: performance.now(),
      navigation: performance.getEntriesByType('navigation')[0]?.toJSON(),
      paint: performance.getEntriesByType('paint').map(({name,startTime}) => ({name, ms:startTime})) }
  };
}

export function captureTitleArrival({ targetWindow = window, game = targetWindow.__alpine, signal } = {}) {
  const { document, performance } = targetWindow;
  const { renderer, scene, camera } = game;
  const draw = renderer.render;
  const boot = targetWindow.skiBenchmarkBoot ??= {};
  const dropIn = document.getElementById('drop-in');
  boot.afterClick = [];
  return new Promise((resolve, reject) => {
    const clicked = () => {
      boot.clickMs = performance.now();
    };
    const abort = () => {
      cleanup();
      reject(signal.reason ?? new DOMException('Title arrival cancelled', 'AbortError'));
    };
    function cleanup() {
      if (renderer.render === trackTitle) renderer.render = draw;
      dropIn.removeEventListener('click', clicked, { capture: true });
      signal?.removeEventListener('abort', abort);
    }
    function trackTitle(s, c) {
      const main = s === scene && c === camera && renderer.getRenderTarget() == null;
      draw.call(this, s, c);
      if (!main || boot.clickMs == null || document.hidden) return;
      const now = performance.now();
      boot.afterClick.push(now);
      if (!game.state.playing || document.getElementById('hud')?.classList.contains('hidden')) return;
      boot.firstPlayableSubmissionMs = now;
      const submissions = [boot.clickMs, ...boot.afterClick];
      const gaps = submissions.slice(1).map((next, i) => next - submissions[i]);
      boot.clickToPlayableMs = now - boot.clickMs;
      boot.snowballToPlayableMs = Number.isFinite(boot.snowballMs) ? now - boot.snowballMs : null;
      boot.clickWindowMaxIntervalMs = Math.max(...gaps);
      boot.clickWindowFramesOver50ms = gaps.filter(gap => gap > 50).length;
      boot.clickWindowFramesOver100ms = gaps.filter(gap => gap > 100).length;
      cleanup();
      resolve(boot);
    }
    if (signal?.aborted) {
      abort();
      return;
    }
    boot.clickMs = boot.firstPlayableSubmissionMs = null;
    signal?.addEventListener('abort', abort, { once: true });
    dropIn.addEventListener('click', clicked, { once: true, capture: true });
    renderer.render = trackTitle;
  });
}

export async function driveSkiRun({
  runId = DEFAULT_SKI_RUN, timeoutMs = 260000, targetWindow = window,
  game = targetWindow.__alpine,
} = {}) {
  const { document, performance, KeyboardEvent } = targetWindow;
  if (targetWindow.skiBenchmark && !targetWindow.skiBenchmark.done) {
    throw new Error('A ski run is already being measured.');
  }
  const { RUNS } = await import(new URL('./src/worlddata.js', document.baseURI));
  const run = RUNS.find(r => r.id === runId);
  if (!run) throw new Error('Unknown Whistler route ID ' + runId);
  const { player, renderer, scene, camera } = game;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const angle = x => Math.atan2(Math.sin(x), Math.cos(x));
  const points = run.points.filter((p, i, all) =>
    i === 0 || p[0] !== all[i-1][0] || p[1] !== all[i-1][1]);
  const segments = [];
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const [x,z] = points[i-1], [endX,endZ] = points[i];
    const dx = endX-x, dz = endZ-z, distance = Math.hypot(dx,dz);
    segments.push({x,z,dx,dz,distance,start:length});
    length += distance;
  }
  function station(distance) {
    const s = segments.find(s => s.start+s.distance >= distance) ?? segments.at(-1);
    const t = clamp((distance-s.start)/s.distance,0,1);
    return {x:s.x+t*s.dx,z:s.z+t*s.dz};
  }
  function project(x,z) {
    let best = {error:Infinity};
    for (const s of segments) {
      const t = clamp(((x-s.x)*s.dx+(z-s.z)*s.dz)/s.distance**2,0,1);
      const error = Math.hypot(x-s.x-t*s.dx,z-s.z-t*s.dz);
      if (error < best.error) best = {error, distance:s.start+t*s.distance};
    }
    return best;
  }
  const pressed = new Set();
  function key(code, on) {
    if (pressed.has(code) === on) return;
    if (on) pressed.add(code); else pressed.delete(code);
    targetWindow.dispatchEvent(new KeyboardEvent(on?'keydown':'keyup', {code,bubbles:true,cancelable:true}));
  }
  const start = station(2), toe = station(15);
  const startHeading = Math.atan2(toe.x-start.x,toe.z-start.z);
  const route = {id:run.id,name:run.name,lengthM:length,widthM:run.width,
    mappedTop:points[0], mappedEnd:points.at(-1), segments:segments.length};
  const state = targetWindow.skiBenchmark = {
    route, frames:[], snapshots:[], teleports:0, done:false, started:0, reason:null
  };
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  // Stage once at the mapped trailhead. From the first W until finish only keys change.
  player.teleport({...start, heading:startHeading, holdAtUnload:true}, {resetStats:true});
  state.startPose = player.pos.toArray();
  state.cameraMode = player.cameraMode;
  const teleport = player.teleport;
  player.teleport = function (...args) {
    state.teleports++;
    return teleport.apply(this,args);
  };
  const draw = renderer.render;
  const coverage = new Set();
  const binSize = 10;
  const bins = Math.ceil(length/binSize);
  const corridor = Math.max(11, (run.width ?? 24)*.70);
  let lastPoint = player.pos.clone(), progress = 0, snapshotMs = -250, lastBin = -1;
  let pathM = 0, maxSpeed = 0, endDistance = length, maxDeviation = 0, priorCrash = false, crashes = 0;
  let submittedMs = -Infinity, brake = false;
  let frameStart, fromAnimationFrame;
  game.setFrameObserver?.((time, vsync) => { frameStart = time; fromAnimationFrame = vsync; });
  const finishRadius = 6;
  const gl = renderer.getContext();
  const contextLost = () => finish('WebGL context lost',performance.now());
  const visibilityChanged = () => {
    if (document.hidden) finish('tab hidden',performance.now());
  };
  function finish(reason, now) {
    if (state.done) return;
    targetWindow.clearTimeout(deadline);
    renderer.domElement.removeEventListener('webglcontextlost',contextLost);
    document.removeEventListener('visibilitychange',visibilityChanged);
    for (const code of [...pressed]) key(code,false);
    player.teleport = teleport;
    renderer.render = draw;
    game.setFrameObserver?.(null);
    state.finishedMs = now;
    state.reason = reason;
    state.done = true;
    state.result = {
      durationMs: now-state.started, progressM: progress, pathM, endDistanceM: endDistance,
      coverage: coverage.size/bins, coveredBins:coverage.size, bins, corridorM:corridor,
      descentM: state.startPose[1]-player.pos.y, start:state.startPose, end:player.pos.toArray(),
      maxDeviationM:maxDeviation, topSpeedKmh:maxSpeed*3.6, crashes, teleports:state.teleports,
      crashReason:player.crashReason,
      playerGameDistanceM:player.stats.distance, contextLost:gl.isContextLost(), visible:!document.hidden
    };
    resolveDone(state);
  }
  function inputs(p, at) {
    const speed = player.speed;
    const look = clamp(9+speed*.89,12,37);
    const target = station(at.distance+look);
    const ahead = station(at.distance+look*2.6);
    const targetYaw = Math.atan2(target.x-p.x,target.z-p.z);
    const turn = Math.abs(angle(Math.atan2(ahead.x-target.x,ahead.z-target.z)-targetYaw));
    const desiredSpeed = clamp(18-11*turn-at.error*.34,6,18);
    const yaw = angle(targetYaw - player.travelHeading);
    const rollback = speed > 2.4 && player.vel.x*Math.sin(targetYaw)+player.vel.z*Math.cos(targetYaw)<-1.5;
    brake = rollback || speed > desiredSpeed+(brake?-.4:.55) || (speed>7 && Math.abs(yaw)>1);
    const deadband = speed > 9 ? .062 : .085;
    key('KeyA', yaw > deadband);
    key('KeyD', yaw < -deadband);
    key('KeyS', brake);
    key('KeyW', !brake);
  }
  renderer.render = function (s,c) {
    const main = s === scene && c === camera && renderer.getRenderTarget() == null;
    const begin = main ? performance.now() : 0;
    draw.call(this,s,c);
    if (!main || state.done || !game.state.playing || document.hidden || gl.isContextLost()) return;
    const now = performance.now();
    // Chrome can submit more than one internal draw per tick. Count one onscreen game render.
    if (now-submittedMs < 1) return;
    submittedMs = now;
    const info = renderer.info.render;
    state.frames.push([now-state.started,now-begin,info.calls,info.triangles,
      gl.drawingBufferWidth,gl.drawingBufferHeight,
      frameStart == null ? null : begin-frameStart, fromAnimationFrame ?? null]);
    const p = player.pos;
    const at = project(p.x,p.z);
    progress = Math.max(progress,at.distance);
    pathM += Math.hypot(p.x-lastPoint.x,p.z-lastPoint.z);
    lastPoint.copy(p);
    maxSpeed = Math.max(maxSpeed,player.speed);
    maxDeviation = Math.max(maxDeviation,at.error);
    endDistance = Math.hypot(p.x-points.at(-1)[0],p.z-points.at(-1)[1]);
    if (at.error <= corridor) {
      const bin = Math.min(bins-1, Math.floor(at.distance/binSize));
      if (lastBin >= 0 && bin-lastBin <= 3)
        for (let i = lastBin+1; i <= bin; i++) coverage.add(i);
      coverage.add(bin);
      lastBin = bin;
    } else lastBin = -1;
    if (player.crash && !priorCrash) crashes++;
    priorCrash = player.crash;
    if (now-state.started-snapshotMs >= 250) {
      snapshotMs=now-state.started;
      state.snapshots.push([snapshotMs,p.x,p.y,p.z,at.distance,at.error,player.speed,player.heading,
        player.crash?1:0,player.footMode?1:0,[...pressed].join(',')]);
    }
    if (state.teleports) finish('unexpected teleport',now);
    else if (player.footMode) finish('left ski mode',now);
    else if (endDistance < finishRadius && at.distance > length-finishRadius) finish('mapped finish',now);
    else if (now-state.started > timeoutMs) finish('timeout',now);
    else inputs(p,at);
  };
  state.started = performance.now();
  const deadline = targetWindow.setTimeout(() => finish('timeout',performance.now()),timeoutMs + 1000);
  renderer.domElement.addEventListener('webglcontextlost',contextLost);
  document.addEventListener('visibilitychange',visibilityChanged);
  key('KeyW',true);
  return {route, state, done, stop(reason = 'cancelled') { finish(reason, performance.now()); }};
}

const sorted = values => [...values].sort((a, b) => a - b);
const rank = (ordered, p) => ordered[Math.max(0, Math.ceil(ordered.length * p) - 1)];

function median(values) {
  const q = sorted(values);
  return (q[Math.floor((q.length - 1) / 2)] + q[Math.ceil((q.length - 1) / 2)]) * .5;
}

export function skiFrameStats(frames, low, high) {
  const rows = frames.filter(row => low <= row[0] && row[0] <= high);
  const gaps = sorted(frames.slice(1).flatMap((row, i) =>
    low < row[0] && row[0] <= high ? [row[0] - frames[i][0]] : []));
  if (high <= low || !rows.length || !gaps.length) return null;
  const sizes = {};
  const preparation = [];
  let timerFrames = 0;
  for (const row of rows) {
    const size = row[4] + 'x' + row[5];
    sizes[size] = (sizes[size] ?? 0) + 1;
    if (Number.isFinite(row[6])) preparation.push(row[6]);
    if (row[7] === false) timerFrames++;
  }
  return {
    seconds: (high - low) / 1000,
    submissions: rows.length,
    fps: 1000 * rows.length / (high - low),
    p50FrameMs: median(gaps),
    p95FrameMs: rank(gaps, .95),
    p99FrameMs: rank(gaps, .99),
    framesOver50ms: gaps.filter(gap => gap > 50).length,
    framesOver100ms: gaps.filter(gap => gap > 100).length,
    renderCpuMedianMs: median(rows.map(row => row[1])),
    beforeRenderMedianMs: preparation.length ? median(preparation) : null,
    timerFrames: preparation.length ? timerFrames : null,
    medianDrawCalls: median(rows.map(row => row[2])),
    medianTriangles: median(rows.map(row => row[3])),
    canvasSizes: sizes,
  };
}

export function summarizeSkiRun(state) {
  if (!state.done) throw new Error('Wait for the ski run to finish before summarizing it.');
  const {frames, ...run} = state;
  const result = run.result;
  const duration = result.durationMs;
  const firstFrame = frames[0]?.[0] ?? null;
  return {
    passed: run.reason === 'mapped finish' && result.coverage >= .95
      && duration >= 20000 && result.pathM >= .88 * run.route.lengthM
      && result.descentM >= 15 && result.teleports === 0 && result.visible && !result.contextLost,
    run, firstSubmissionAfterInputMs: firstFrame,
    firstSubmissionAfterNavigationMs: firstFrame == null ? null : run.started + firstFrame,
    metrics: {
      first5s: skiFrameStats(frames, 0, Math.min(5000, duration)),
      first20s: skiFrameStats(frames, 0, Math.min(20000, duration)),
      steadyAfter20s: skiFrameStats(frames, 20000, duration),
      fullRun: skiFrameStats(frames, 0, duration),
    },
    frames,
    sampleFields: ['elapsedMs', 'x', 'y', 'z', 'routeM', 'crossTrackM', 'mps', 'heading',
      'crash', 'footMode', 'keys'],
    frameFields: ['elapsedMs', 'renderCpuMs', 'drawCalls', 'triangles', 'width', 'height',
      'beforeRenderWallMs', 'fromAnimationFrame'],
  };
}
