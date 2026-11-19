// This module is only loaded for the explicit Pages benchmark URL.
const bootTimeoutMs = 180000;
const arrivalTimeoutMs = 90000;
const runTimeoutMs = 650000;
const frameLimit = 60;

class BenchmarkStorage {
  #values = new Map();
  get length() { return this.#values.size; }
  key(index) { return [...this.#values.keys()][index] ?? null; }
  getItem(key) { return this.#values.get(String(key)) ?? null; }
  setItem(key, value) { this.#values.set(String(key), String(value)); }
  removeItem(key) { this.#values.delete(String(key)); }
  clear() { this.#values.clear(); }
}

function setUpBenchmark(resolution) {
  const prefs = new BenchmarkStorage();
  Object.defineProperty(window, 'localStorage', { value: prefs });
  Object.defineProperty(window, 'sessionStorage', { value: new BenchmarkStorage() });
  prefs.setItem('alpine.multiplayer', 'off');
  prefs.setItem('alpine.performance-options', JSON.stringify({ frameLimit, resolution, antialias: false }));
  const url = new URL(location.href);
  url.search = new URLSearchParams({ benchmark: 'ego-bowl', quality: 'budget', resolution,
    season: 'winter', weather: 'clear', time: 'day' });
  url.hash = '';
  history.replaceState(history.state, '', url);
  // The playback controller sends synthetic input. Shield that run from
  // physical gameplay keys while leaving browser and panel shortcuts alone.
  const blockGameKeys = event => {
    if (event.isTrusted && !event.ctrlKey && !event.metaKey && !event.altKey) event.stopImmediatePropagation();
  };
  window.addEventListener('keydown', blockGameKeys, true);
  window.addEventListener('keyup', blockGameKeys, true);
  document.getElementById('app').inert = true;
}

function createPanel(resolution) {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('../ski-benchmark.css', import.meta.url);
  document.head.append(stylesheet);

  const panel = document.createElement('section');
  panel.id = 'ski-benchmark';
  panel.setAttribute('aria-labelledby', 'ski-benchmark-title');
  panel.innerHTML = [
    '<h1 id="ski-benchmark-title" tabindex="-1">Ego Bowl benchmark</h1>',
    '<p class="ski-benchmark-settings"></p>',
    '<p class="ski-benchmark-status" role="status">Loading Whistler…</p>',
    '<div class="ski-benchmark-progress" hidden>',
    '<progress aria-label="Distance down Ego Bowl"></progress>',
    '<output></output>',
    '</div>',
    '<div class="ski-benchmark-result" hidden>',
    '<dl class="ski-benchmark-metrics"></dl>',
    '<p class="ski-benchmark-explainer">FPS counts game frames submitted to the browser.</p>',
    '<details class="ski-benchmark-stalls" open hidden><summary>Longest stalls</summary><ol></ol></details>',
    '<label class="ski-benchmark-copy-fallback" hidden>',
    'Select and copy this report',
    '<textarea rows="5" readonly></textarea></label>',
    '<p class="ski-benchmark-copy-status" role="status"></p>',
    '</div>',
    '<div class="ski-benchmark-actions">',
    '<button type="button" data-action="start" hidden>Start run</button>',
    '<button type="button" data-action="stop" hidden>Stop run</button>',
    '<button type="button" data-action="copy" hidden>Copy results</button>',
    '<button type="button" data-action="retry" hidden>Reload benchmark</button>',
    '<a data-action="play">Play Alpine Descent</a>',
    '</div>',
  ].join('');
  const controls = Object.fromEntries([...panel.querySelectorAll('[data-action]')].map(el => [el.dataset.action, el]));
  controls.play.href = location.pathname;
  controls.retry.addEventListener('click', () => location.reload());
  document.body.append(panel);
  const find = selector => panel.querySelector(selector);
  find('.ski-benchmark-settings').textContent = 'Budget · ' +
    (resolution === 'adaptive' ? 'Adaptive resolution' : resolution === 'native' ? 'Native resolution' : resolution + ' render ceiling') + ' · 60 FPS cap';
  return {
    panel, controls, heading: find('h1'), status: find('.ski-benchmark-status'), result: find('.ski-benchmark-result'),
    progress: find('progress'), distance: find('.ski-benchmark-progress output'),
    metrics: find('.ski-benchmark-metrics'), stalls: find('.ski-benchmark-stalls'),
    fallback: find('.ski-benchmark-copy-fallback'), copyStatus: find('.ski-benchmark-copy-status'),
  };
}

function waitUntil(read, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    const finish = callback => value => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      callback(value);
    };
    const abort = () => finish(reject)(signal.reason);
    function poll() {
      if (signal.aborted) { abort(); return; }
      try {
        const value = read();
        if (value) { finish(resolve)(value); return; }
      } catch (error) {
        finish(reject)(error);
        return;
      }
      timer = setTimeout(poll, 80);
    }
    signal.addEventListener('abort', abort, { once: true });
    poll();
  });
}

async function abortable(task, signal) {
  let abort;
  const interrupted = new Promise((_, reject) => {
    abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([task, interrupted]); }
  finally { signal.removeEventListener('abort', abort); }
}

function recordLoader() {
  const boot = window.skiBenchmarkBoot = { loader: [] };
  const screen = document.getElementById('loading-screen');
  const status = document.getElementById('load-status');
  boot.snowballMs = performance.now();
  function sample() {
    const { textContent: label } = status;
    if (boot.loader.at(-1)?.label !== label) boot.loader.push({ ms: performance.now(), label });
    if (screen.classList.contains('hidden')) {
      boot.loaderHiddenMs = performance.now();
      observer.disconnect();
    }
  }
  const observer = new MutationObserver(sample);
  observer.observe(screen, { childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['class'] });
  sample();
  return () => observer.disconnect();
}

const number = (value, suffix = '', places = 1) => Number.isFinite(value) ? value.toFixed(places) + suffix : '—';
const seconds = ms => Number.isFinite(ms) ? number(ms / 1000, ' s', 2) : '—';
const sizesFor = metrics => Object.keys(metrics?.canvasSizes ?? {}).map(size => size.replace('x', ' × ')).join(' / ');

function showReport(ui, report, hardware, boot, issue) {
  const { fullRun, first5s, steadyAfter20s } = report.metrics;
  const { result } = report.run;
  const stalls = [];
  const frames = report.frames;
  for (let i = 1; i < frames.length; i++) {
    const duration = frames[i][0] - frames[i - 1][0];
    if (duration > 100) stalls.push({ start: frames[i - 1][0], duration });
  }
  stalls.sort((a, b) => b.duration - a.duration);
  const longest = stalls.slice(0, 4).map(stall =>
    number(stall.duration, ' ms', 0) + ' at ' + seconds(stall.start) + ' into the run');
  const rows = [
    [issue ? 'Recorded FPS' : 'Whole-run FPS', number(fullRun?.fps, ' FPS')],
    ['First 5 seconds', [number(first5s?.fps, ' FPS'), sizesFor(first5s)].filter(Boolean).join(' · ')],
    ['After 20 seconds', [number(steadyAfter20s?.fps, ' FPS'), sizesFor(steadyAfter20s)].filter(Boolean).join(' · ')],
    ['P95 frame time', number(fullRun?.p95FrameMs, ' ms')],
    ['Game update before draw · median', number(fullRun?.beforeRenderMedianMs, ' ms')],
    ['WebGL submission · median', number(fullRun?.renderCpuMedianMs, ' ms')],
    ['GPU draw time · sampled median', report.run.gpu?.samples
      ? number(report.run.gpu.medianMs, ' ms') + ' (' + report.run.gpu.samples + ' frames)'
      : 'Unavailable'],
    ['Timer fallback frames', number(fullRun?.timerFrames, '', 0)],
    ['Gaps >50 / >100 ms', fullRun ? fullRun.framesOver50ms + ' / ' + fullRun.framesOver100ms : '—'],
    ['Route covered', number(result.coverage * 100, '%', 0)],
    ['Frames submitted', number(fullRun?.submissions, '', 0)],
    ['Run duration', seconds(result.durationMs)],
    ['Load to title', seconds(boot.loaderHiddenMs ?? boot.readyMs)],
    ['Start to playable frame', seconds(boot.clickToPlayableMs)],
    ['Render resolution', sizesFor(fullRun) || hardware.size.join(' × ')],
    ['WebGL adapter', hardware.renderer || 'Adapter name hidden by browser'],
    ['Settings', hardware.quality + ' · ' + hardware.resolution + ' · ' + hardware.frameLimit + ' FPS cap'],
    ['Page load', boot.navigation?.type === 'reload' ? 'Reload' : 'Initial navigation'],
  ];
  ui.metrics.replaceChildren();
  for (const [name, value] of rows) {
    const label = document.createElement('dt'), data = document.createElement('dd');
    label.textContent = name;
    data.textContent = value;
    ui.metrics.append(label, data);
  }
  ui.stalls.hidden = !longest.length;
  ui.stalls.querySelector('ol').replaceChildren(...longest.map(text => {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  }));
  const text = ['Alpine Descent · Ego Bowl benchmark', issue ? 'Incomplete — ' + issue : 'Complete run',
    ...rows.map(([name, value]) => name + ' — ' + value),
    ...longest.map(stall => 'Long stall — ' + stall)].join('\n');
  const fallback = ui.fallback.querySelector('textarea');
  fallback.value = text;
  ui.controls.copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      ui.fallback.hidden = true;
      ui.copyStatus.textContent = 'Results copied.';
    } catch {
      ui.fallback.hidden = false;
      fallback.focus();
      fallback.select();
      ui.copyStatus.textContent = 'Use your browser’s copy command to share the selected report.';
    }
  };
  ui.result.hidden = false;
  ui.controls.copy.hidden = false;
  ui.panel.scrollTop = 0;
  ui.heading.focus({ preventScroll: true });
}

function errorMessage(reason) {
  if (reason === 'tab hidden') return 'The tab was hidden during the run. Reload and keep it visible.';
  if (reason === 'WebGL context lost') return 'The browser released WebGL. Reload to try again.';
  if (reason === 'timeout') return 'The skier did not finish before the time limit.';
  if (reason === 'cancelled') return 'The run was stopped.';
  if (reason === 'mapped finish') return 'The skier reached the finish without covering enough of the mapped trail.';
  return reason || 'The run ended before the mapped finish.';
}

export async function launchSkiBenchmark() {
  const requested = new URLSearchParams(location.search).get('resolution');
  const resolution = ['480p', '720p', 'adaptive'].includes(requested) ? requested : 'native';
  const ui = createPanel(resolution);
  const controller = new AbortController();
  const { signal } = controller;
  let active, startup, titleTimer, progressTimer, hardware;
  const abort = message => {
    if (!signal.aborted) controller.abort(new Error(message));
    active?.stop(message);
  };
  const onHidden = () => {
    if (document.hidden) abort('The tab was hidden. Reload and keep it visible throughout the test.');
  };
  const onLost = () => abort('The browser released WebGL. Reload to try again.');
  const onResize = () => {
    if (hardware && (innerWidth !== hardware.viewport[0] || innerHeight !== hardware.viewport[1] ||
        devicePixelRatio !== hardware.dpr)) abort('Viewport changed. Reload at the size you want to measure.');
  };
  const checkLoading = () => {
    const loading = document.getElementById('loading-screen');
    if (loading.dataset.loadingFailed || loading.dataset.recovering)
      throw new Error(document.getElementById('load-status').textContent);
    return window.__alpine?.renderer && window.__alpine;
  };
  const dispose = () => {
    clearTimeout(startup);
    clearTimeout(titleTimer);
    clearInterval(progressTimer);
    document.removeEventListener('visibilitychange', onHidden);
    window.removeEventListener('pagehide', onHidden);
    window.removeEventListener('resize', onResize);
    window.__alpine?.renderer?.domElement.removeEventListener('webglcontextlost', onLost);
  };
  const fail = message => {
    dispose();
    ui.status.textContent = message;
    ui.controls.start.hidden = ui.controls.stop.hidden = ui.progress.parentElement.hidden = true;
    ui.controls.retry.hidden = false;
  };

  let stopLoader;
  try {
    setUpBenchmark(resolution);
    stopLoader = recordLoader();
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onHidden);
    onHidden();
    startup = setTimeout(() => abort('Whistler did not load before the time limit. Reload to try again.'), bootTimeoutMs);
    const launch = Promise.all([import('./ski-run-benchmark.js'), import('./resort-entry.js')]);
    const [{ captureTitleArrival, driveSkiRun, inspectSkiBenchmark, summarizeSkiRun }] = await abortable(launch, signal);
    const game = await waitUntil(checkLoading, signal);
    stopLoader();
    clearTimeout(startup);
    const ready = inspectSkiBenchmark({ game });
    if (ready.contextLost) throw new Error('The browser released WebGL. Reload to try again.');
    if (ready.quality !== 'Budget' || ready.resolution !== resolution || Number(ready.frameLimit) !== frameLimit)
      throw new Error('The benchmark could not apply the requested graphics settings.');
    game.renderer.domElement.addEventListener('webglcontextlost', onLost, { once: true });
    window.addEventListener('resize', onResize);
    ui.status.textContent = 'Start the automatic descent and keep this tab visible.';
    ui.controls.start.hidden = false;
    ui.controls.start.focus({ preventScroll: true });
    signal.addEventListener('abort', () => fail(signal.reason.message), { once: true });

    ui.controls.start.onclick = async () => {
      ui.controls.start.hidden = true;
      ui.controls.stop.hidden = false;
      ui.status.textContent = 'Entering Whistler…';
      ui.controls.stop.onclick = () => active ? active.stop() : abort('The run was stopped.');
      titleTimer = setTimeout(() => abort('The first playable frame took too long. Reload to try again.'), arrivalTimeoutMs);
      try {
        if (signal.aborted) throw signal.reason;
        hardware = { ...inspectSkiBenchmark({ game }), boot: ready.boot };
        const playable = captureTitleArrival({ game, signal });
        document.getElementById('drop-in').click();
        const arrival = await playable;
        clearTimeout(titleTimer);
        if (signal.aborted) throw signal.reason;
        active = await driveSkiRun({ game, timeoutMs: runTimeoutMs });
        if (signal.aborted) active.stop(signal.reason.message);
        ui.status.textContent = 'Skiing Ego Bowl…';
        ui.progress.parentElement.hidden = false;
        ui.progress.max = active.route.lengthM;
        const refresh = () => {
          const progress = active.state.snapshots.at(-1)?.[4] ?? 0;
          ui.progress.value = progress;
          ui.distance.value = Math.round(progress) + ' m / ' + Math.round(active.route.lengthM) + ' m';
        };
        refresh();
        progressTimer = setInterval(refresh, 350);
        const state = await active.done;
        refresh();
        const report = summarizeSkiRun(state);
        const dimensions = Object.keys(report.metrics.fullRun?.canvasSizes ?? {});
        const changedSize = resolution !== 'adaptive' &&
          (dimensions.length > 1 || dimensions.length === 1 && dimensions[0] !== hardware.size.join('x'));
        const issue = changedSize ? 'Render resolution changed. Reload at the size you want to measure.'
          : report.passed ? null : errorMessage(state.reason);
        dispose();
        ui.controls.stop.hidden = ui.progress.parentElement.hidden = true;
        ui.controls.retry.hidden = false;
        ui.status.textContent = issue ?? 'Ego Bowl complete.';
        showReport(ui, report, hardware, { ...hardware.boot, ...arrival }, issue);
      } catch (error) { fail(error.message); }
    };
  } catch (error) {
    stopLoader?.();
    fail(error.message);
  }
}
