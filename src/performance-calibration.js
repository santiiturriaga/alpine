const targets = [60, 120, 240];
const minimumFpsRatio = .94;
const warmupMs = 400;
const sampleMs = 1300;
const maxSampleMs = 2600;
const resizeDelayMs = 300;
const manualQualityKey = 'alpine.graphics';
const optionsKey = 'alpine.performance-options';

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function readObject(key) {
  try { return JSON.parse(read(key)) ?? {}; } catch { return {}; }
}

function save(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

export function measureRefresh(intervals) {
  // Keep the slower samples out of the refresh estimate, while requiring a
  // substantial share of the observations to support every higher target.
  const period = percentile(intervals, .35);
  return Number.isFinite(period) ? Math.min(1000 / period, 480) : 0;
}

export function summarizeFrames(intervals, target, refresh) {
  const duration = intervals.reduce((total, interval) => total + interval, 0);
  const fps = duration ? 1000 * intervals.length / duration : 0;
  const p90Ms = percentile(intervals, .9) ?? Infinity;
  const maxMs = Math.max(...intervals);
  // For example, a 120 cap on a 144 Hz display necessarily spans either
  // one or two refreshes. Budget for refresh quantization and mild jitter.
  const maxFrameMs = Math.max(1000 / target * 1.3, 1000 / target + 1000 / refresh * .75) + 1;
  const stallMs = 3000 / target + 1000 / refresh;
  const passed = target > 0 && intervals.length >= 12 && fps >= target * minimumFpsRatio && p90Ms <= maxFrameMs && maxMs <= stallMs;
  return { fps, p90Ms, maxMs, passed };
}

export function* calibrationPlan({ refresh, firstQuality, lastQuality, frameLimit }) {
  let best;
  let highestMeasured = 0;
  for (const target of targets) {
    if (target > refresh / minimumFpsRatio || (frameLimit && target > frameLimit)) break;
    const sample = yield { quality: firstQuality, target };
    highestMeasured = Math.max(highestMeasured, sample.fps);
    if (!sample.passed) break;
    best = { ...sample, quality: firstQuality, target };
  }
  if (!best) {
    const target = frameLimit === 30 ? 30 : 0;
    const sample = yield { quality: firstQuality, target };
    highestMeasured = Math.max(highestMeasured, sample.fps);
    return { ...sample, quality: firstQuality, target: sample.passed ? target : 0, highestMeasured };
  }
  for (let quality = firstQuality + 1; quality <= lastQuality; quality++) {
    const sample = yield { quality, target: best.target };
    if (!sample.passed) break;
    best = { ...sample, quality, target: best.target };
  }
  return { ...best, highestMeasured };
}

export function createFrameLimiter() {
  let lastTarget;
  let due = null;
  return (now, target) => {
    if (target !== lastTarget || (due !== null && now - due > 250)) due = null;
    lastTarget = target;
    if (!target) return true;
    const interval = 1000 / target;
    if (due !== null && now + 1 < due) return false;
    // Catch up by at most one refresh. Always measure ordinary simulation dt
    // from the previous rendered frame, including any rate-limited skips.
    due = Math.max((due ?? now) + interval, now);
    return true;
  };
}

export function createPerformanceCalibration({ query, resort, profiles, viewport, compact = false, enabled = true }) {
  const resultKey = `alpine.performance.v1.${resort}`;
  const profileIndex = name => profiles.findIndex(profile => profile.name === name?.toUpperCase());
  const savedQuality = profileIndex(read(manualQualityKey));
  const queryQuality = profileIndex(query.get('quality'));
  let manualQuality = queryQuality >= 0 ? queryQuality : savedQuality;
  const stored = readObject(optionsKey);
  const manualCaps = [30, ...targets];
  let frameLimit = manualCaps.includes(stored.frameLimit) ? stored.frameLimit : 0;
  const preferredResolution = query.get('resolution') ?? stored.resolution;
  let resolution = ['native', 'scaled'].includes(preferredResolution)
    ? preferredResolution : (compact ? 'scaled' : 'native');
  let requestedAA = typeof stored.antialias === 'boolean' ? stored.antialias : manualQuality > 0 && !compact;
  const antialias = requestedAA;
  const limitFrame = createFrameLimiter();
  const display = () => `${screen.width}x${screen.height}@${window.devicePixelRatio || 1}`;
  const signature = () => `${display()}:${resolution}:${antialias}:${manualQuality}:${frameLimit}`;
  const measureViewport = () => ({
    width: viewport?.clientWidth ?? window.innerWidth,
    height: viewport?.clientHeight ?? window.innerHeight,
  });
  let renderSize = measureViewport();
  let renderDisplay = display();
  let resizeTimer = null;
  function sameSize(previous, current) {
    if (!previous || !Number.isFinite(previous.width) || !Number.isFinite(previous.height)) return false;
    const widthTolerance = Math.max(16, previous.width * .06);
    // Mobile browser controls can change the visible height during ordinary play.
    const heightTolerance = Math.max(compact ? 64 : 16, previous.height * .06);
    return Math.abs(previous.width - current.width) <= widthTolerance && Math.abs(previous.height - current.height) <= heightTolerance;
  }
  let result = readObject(resultKey);
  if (queryQuality >= 0 || result.signature !== signature() || !profiles[result.quality] ||
      !sameSize(result.viewport, renderSize) || !Number.isFinite(result.fps) ||
      (result.target !== 0 && !manualCaps.includes(result.target))) result = null;
  if (result) renderSize = result.viewport;
  let quality = manualQuality >= 0 ? manualQuality : result?.quality ?? 0;
  let requestPending = enabled && !result && queryQuality < 0;
  let test = null;
  let settings;
  let clearNotice;
  let countGameplay = false, counterStart = null, counterFrames = 0;

  function updateCounter(now) {
    if (!settings?.counter) return;
    if (counterStart === null) {
      counterStart = now;
      counterFrames = 0;
      return;
    }
    counterFrames++;
    const elapsed = now - counterStart;
    if (elapsed < 750 || counterFrames < 2) return;
    const fps = Math.round(counterFrames * 1000 / elapsed);
    const label = (fps || '<1') + ' FPS';
    if (settings.counter.textContent !== label) settings.counter.textContent = label;
    counterStart = now;
    counterFrames = 0;
  }

  function persistOptions() {
    save(optionsKey, JSON.stringify({ frameLimit, resolution, antialias: requestedAA }));
  }

  function applyQuality(index) {
    if (quality !== index) {
      quality = index;
      settings?.apply(index);
    }
    present();
  }

  function cap() {
    return frameLimit || result?.target || 0;
  }

  function status() {
    if (test?.candidate) {
      const name = profiles[test.candidate.quality].name.toLowerCase();
      return `Testing ${test.candidate.target ? `${test.candidate.target} FPS` : 'uncapped'} · ${name}`;
    }
    if (test) return 'Checking display refresh…';
    if (requestPending) return 'Benchmark queued for gameplay.';
    if (!result) return 'Run the benchmark to measure this setup.';
    const fps = Math.round(result.fps);
    const measured = `${fps} FPS measured`;
    if (result.frameLimit) return `${result.frameLimit} FPS cap · ${measured}`;
    if (result.target >= 60) return `${result.target} FPS target · ${measured}`;
    return `Uncapped · ${measured}`;
  }

  function notice(message, timeout) {
    if (!settings) return;
    clearTimeout(clearNotice);
    settings.notice.textContent = message;
    settings.notice.hidden = !message;
    if (timeout) clearNotice = setTimeout(() => { settings.notice.hidden = true; }, timeout);
  }

  function profileLabel(index) {
    const name = profiles[index].name;
    return name[0] + name.slice(1).toLowerCase();
  }

  function presentProfile(index) {
    const label = profileLabel(index);
    settings.slider.value = index;
    settings.slider.setAttribute('aria-valuetext', label);
    settings.level.textContent = label;
  }

  function present() {
    if (!settings) return;
    presentProfile(quality);
    settings.auto.checked = manualQuality < 0;
    settings.frame.value = String(frameLimit);
    settings.resolution.value = resolution;
    settings.aa.checked = requestedAA;
    settings.aaPending.hidden = requestedAA === antialias && (!requestedAA || settings.antialiasActive);
    settings.aaPending.textContent = requestedAA === antialias ? 'Unavailable in this browser' : 'Applies when you reload';
    settings.status.textContent = status();
    settings.run.textContent = test || requestPending ? 'Restart test' : 'Run benchmark';
  }

  function cancelTest() {
    if (test) applyQuality(test.restoreQuality);
    test = null;
    requestPending = false;
    notice('');
  }

  function queueTest() {
    cancelTest();
    requestPending = true;
    present();
  }

  function startTest() {
    requestPending = false;
    test = { probe: [], previousProbe: null, restoreQuality: quality };
    present();
    notice(status());
  }

  function beginCandidate(candidate) {
    test.candidate = candidate;
    test.warmupUntil = null;
    test.previousFrame = null;
    test.intervals = [];
    applyQuality(candidate.quality);
    notice(status());
  }

  function interrupt() {
    counterStart = null;
    if (!test) return;
    test.context = null;
    test.previousProbe = null;
    test.probe.length = 0;
    test.probeStarted = null;
    test.warmupUntil = null;
    test.previousFrame = null;
    if (test.intervals) test.intervals.length = 0;
    notice('');
  }

  function viewportChanged() {
    if (settings) {
      const { canvas, device, gpuName } = settings;
      device.textContent = [gpuName, `${canvas.width} × ${canvas.height}`].filter(Boolean).join(' · ');
    }
    clearTimeout(resizeTimer);
    resizeTimer = null;
    const changed = () => display() !== renderDisplay || !sameSize(renderSize, measureViewport());
    if (!changed()) return;
    if (test?.context != null) interrupt();
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      if (!changed()) return;
      renderSize = measureViewport();
      renderDisplay = display();
      const retest = enabled && (queryQuality < 0 || requestPending || test || result);
      result = null;
      if (retest) queueTest();
      else present();
    }, resizeDelayMs);
  }

  function shouldRender(now, { eligible = true, vsync = true, context } = {}) {
    countGameplay = eligible && context === 'game';
    if (!countGameplay) counterStart = null;
    if (!eligible || !vsync || context !== 'game' || resizeTimer !== null) {
      if (test?.context != null) interrupt();
      return limitFrame(now, cap());
    }
    if (requestPending) startTest();
    if (!test) return limitFrame(now, cap());
    if (test.context !== context) {
      interrupt();
      test.context = context;
      notice(status());
    }
    if (test.candidate) return limitFrame(now, test.candidate.target);

    // Pause scene draws briefly to measure the browser's animation cadence.
    // These callbacks are never counted in the game's measured frame rate.
    test.probeStarted ??= now;
    if (test.previousProbe !== null) {
      const delta = now - test.previousProbe;
      if (delta > 1.5 && delta < 100) test.probe.push(delta);
    }
    test.previousProbe = now;
    if (test.probe.length < 24 && now - test.probeStarted < 650) return false;
    test.refresh = measureRefresh(test.probe);
    const firstQuality = Math.max(manualQuality, 0);
    const lastQuality = manualQuality >= 0 ? manualQuality : profiles.length - 1;
    test.plan = calibrationPlan({ refresh: test.refresh, firstQuality, lastQuality, frameLimit });
    beginCandidate(test.plan.next().value);
    return limitFrame(now, test.candidate.target);
  }

  function didRender(now) {
    if (countGameplay) updateCounter(now);
    if (!test?.candidate || test.context == null) return;
    test.warmupUntil ??= now + warmupMs;
    if (now < test.warmupUntil) return;
    if (test.previousFrame !== null) test.intervals.push(now - test.previousFrame);
    test.previousFrame = now;
    const duration = now - test.warmupUntil;
    if (duration < sampleMs || (test.intervals.length < 12 && duration < maxSampleMs)) return;

    const sample = summarizeFrames(test.intervals, test.candidate.target, test.refresh);
    const next = test.plan.next(sample);
    if (!next.done) {
      beginCandidate(next.value);
      return;
    }
    renderSize = measureViewport();
    renderDisplay = display();
    result = { ...next.value, refresh: test.refresh, frameLimit, viewport: renderSize, signature: signature() };
    if (queryQuality < 0) save(resultKey, JSON.stringify(result));
    test = null;
    applyQuality(result.quality);
    notice(`${profileLabel(result.quality)} · ${status()}`, 6500);
  }

  function bind({ apply, resize, renderer }) {
    const gl = renderer.getContext();
    const adapter = gl.getExtension('WEBGL_debug_renderer_info');
    const description = adapter && gl.getParameter(adapter.UNMASKED_RENDERER_WEBGL);
    // ANGLE also includes the API, PCI ID and shader model in this string.
    const gpuName = description?.match(/^ANGLE \([^,]+, (.+?)(?: \(0x| Direct3D|, (?:D3D|OpenGL|Vulkan|Metal)|\)$)/)?.[1] || description;
    settings = {
      apply, antialiasActive: gl.getContextAttributes()?.antialias,
      gpuName, canvas: renderer.domElement, device: document.getElementById('benchmark-device'),
      counter: document.getElementById('fps-counter'),
      slider: document.getElementById('pause-quality'),
      level: document.getElementById('graphics-level'),
      auto: document.getElementById('pause-auto-quality'),
      frame: document.getElementById('pause-frame-cap'),
      resolution: document.getElementById('pause-resolution'),
      aa: document.getElementById('pause-antialias'),
      aaPending: document.getElementById('antialias-reload'),
      status: document.getElementById('benchmark-status'),
      notice: document.getElementById('benchmark-notice'),
      run: document.getElementById('pause-benchmark'),
    };
    viewportChanged();
    settings.slider.max = profiles.length - 1;
    settings.slider.addEventListener('input', () => presentProfile(settings.slider.valueAsNumber));
    settings.slider.addEventListener('change', () => {
      const next = settings.slider.valueAsNumber;
      cancelTest();
      manualQuality = next;
      result = null;
      save(manualQualityKey, profiles[next].name);
      persistOptions();
      applyQuality(next);
      if (!frameLimit) queueTest();
    });
    settings.auto.addEventListener('change', () => {
      const checked = settings.auto.checked;
      if (checked) {
        manualQuality = -1;
        result = null;
        save(manualQualityKey, null);
        queueTest();
      } else {
        cancelTest();
        manualQuality = quality;
        result = null;
        save(manualQualityKey, profiles[quality].name);
        persistOptions();
        if (!frameLimit) queueTest();
        else present();
      }
    });
    settings.frame.addEventListener('change', () => {
      frameLimit = Number(settings.frame.value);
      result = null;
      persistOptions();
      queueTest();
    });
    settings.resolution.addEventListener('change', () => {
      resolution = settings.resolution.value;
      result = null;
      persistOptions();
      resize();
      queueTest();
    });
    settings.aa.addEventListener('change', () => {
      requestedAA = settings.aa.checked;
      persistOptions();
      present();
    });
    settings.run.addEventListener('click', queueTest);
    present();
  }

  return {
    get quality() { return quality; },
    get resolution() { return resolution; },
    get result() { return result; },
    get measuring() { return requestPending || !!test; },
    get testing() { return !!test; },
    antialias, shouldRender, didRender, interrupt, viewportChanged, bind,
  };
}
