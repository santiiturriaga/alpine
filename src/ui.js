import {
  WORLD, RUNS, LIFTS, LODGES, CHALETS, CRYSTALS, SECRETS, MOUNTAIN, DIFFICULTY,
  runPointAt, startPose,
} from './worlddata.js';
import { heightAt, pisteAt } from './terrain.js';
import { clamp, mulberry32, formatNumber, formatTime } from './util.js';

/* ═══════════════════════════════════════════════════════════════
   INTERFACE
   HUD, the hand-drawn resort map, toasts, floaters, prompts,
   modals, and the post-run summary.
   ═══════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);

const ICONS = {
  coin: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="#ffd37a"/><circle cx="12" cy="12" r="9" stroke="#c98a24" stroke-width="1.4"/><path d="M9 9.4c.5-1.2 2.2-1.6 3.4-.9 1.5.9 1 2.5-.5 3l-2.3.8c-1.7.6-1.9 2.4-.5 3.2 1.3.8 3.1.2 3.7-1" stroke="#9b6516" stroke-width="1.5" stroke-linecap="round"/></svg>',
  crystal: '<svg viewBox="0 0 24 24"><path d="M12 1.5 20.5 9 12 22.5 3.5 9 12 1.5Z" fill="#8fe7ff"/><path d="M3.5 9h17M12 1.5v21M8 9l4 13.5L16 9" fill="none" stroke="rgba(8,40,56,.4)" stroke-width=".8"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 2.6 2.9 5.9 6.5.9-4.7 4.6 1.1 6.4-5.8-3-5.8 3 1.1-6.4L2.6 9.4l6.5-.9L12 2.6Z" fill="#ffc75b"/></svg>',
  lift: '<svg viewBox="0 0 24 24" fill="none" stroke="#e8f2f5" stroke-width="1.6"><path d="M3 5.5 21 3M8 4.6V10m8-1.4V15"/><rect x="5" y="10" width="6" height="7" rx="1.1" fill="rgba(255,199,91,.18)"/><rect x="13" y="15" width="6" height="7" rx="1.1" fill="rgba(255,199,91,.18)"/></svg>',
  crash: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3 22 20H2L12 3Z" fill="rgba(255,124,94,.16)" stroke="#ff9c7d" stroke-width="1.4"/><path d="M12 8v6m0 2.7v.6" stroke="#ffd0c1" stroke-width="1.8" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="rgba(139,240,160,.12)" stroke="#8bf0c0" stroke-width="1.4"/><path d="m7.5 12.2 3.1 3.1 6-6.4" stroke="#8bf0c0" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  stash: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 2 4 6v6c0 5 3.4 8.4 8 10 4.6-1.6 8-5 8-10V6l-8-4Z" fill="rgba(255,199,91,.14)" stroke="#ffc75b" stroke-width="1.4"/><path d="M9 11.5h6M12 8.5v6" stroke="#ffc75b" stroke-width="1.4" stroke-linecap="round"/></svg>',
};

const TRAIL_ICON_CLASS = {
  green: 'green', blue: 'blue', black: 'black', double: 'double', hidden: 'stash',
};

const DIFF_COLOR = {
  green: '#2f9e60', blue: '#2f73c4', black: '#20272c', double: '#0f1418', hidden: '#c89a3f',
};

const MAP_FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';

function mapProject(w, h) {
  const padX = w * 0.045;
  const padY = h * 0.055;
  const sx = (w - padX * 2) / WORLD.sizeX;
  const sz = (h - padY * 2) / WORLD.sizeZ;
  return {
    sx, sz, padX, padY,
    px: (x) => padX + (x - WORLD.minX) * sx,
    py: (z) => padY + (z - WORLD.minZ) * sz,
    wx: (px) => WORLD.minX + (px - padX) / sx,
    wz: (py) => WORLD.minZ + (py - padY) / sz,
  };
}

function lerpColor(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

export class UI {
  constructor({ collectibles = null } = {}) {
    this.collectibles = collectibles;
    this.el = {
      loading: $('loading-screen'), loadBar: $('load-bar'), loadStatus: $('load-status'),
      start: $('start-screen'), hud: $('hud'),
      guide: $('guide-screen'), map: $('map-screen'), pause: $('pause-screen'), summary: $('summary-screen'),
      fade: $('fade'),
      altitude: $('altitude'), mountain: $('mountain-name'), trailName: $('trail-name'),
      trailState: $('trail-state'), trailIcon: $('trail-icon'),
      statVertical: $('stat-vertical'), statTop: $('stat-top'), statTime: $('stat-time'),
      coins: $('coin-count'), crystals: $('crystal-count'), score: $('score'),
      speed: $('speed'), speedArc: $('speed-arc-fill'), speedBar: $('speed-bar-fill'),
      speedState: $('speed-state'), vertNow: $('vert-now'), grade: $('grade'),
      snow: $('snow-state'), airCard: $('air-card'), airLabel: $('air-label'),
      airTime: $('air-time'), airFill: $('air-fill'), trickSpin: $('trick-spin'),
      trickFlip: $('trick-flip'), trickGrab: $('trick-grab'), combo: $('combo'),
      comboX: $('combo-x'), comboStreak: $('combo-streak'), comboRing: $('combo-ring-fill'),
      minimap: $('minimap'), bigmap: $('bigmap'),
      prompt: $('interaction-prompt'), promptTitle: $('prompt-title'), promptSub: $('prompt-sub'),
      caption: $('cinematic-caption'), bars: $('cinematic-bars'),
      toasts: $('toast-stack'), floaters: $('floater-layer'), hint: $('hint-bar'),
      mapAltitude: $('map-altitude'), mapRunName: $('map-run-name'),
      audioMenu: $('audio-toggle-menu'), pauseAudio: $('pause-audio'),
      pauseMarkers: $('pause-markers'), pauseCamera: $('pause-camera'), pauseQuality: $('pause-quality'),
      sumScore: $('sum-score'), sumSpeed: $('sum-speed'), sumVert: $('sum-vert'),
      sumCoins: $('sum-coins'), sumCrystals: $('sum-crystals'), sumAir: $('sum-air'),
      sumTrail: $('sum-trail'), sumTime: $('sum-time'),
    };
    this.changed = {};
    this.minimapBase = null;
    this.bigmapBase = null;
    this.lastMinimap = 0;
    this.lastBigmap = 0;
    this.nearest = null;
    this.lastNearestCheck = 0;
    this.lastMapSize = '';
    this.toastTimers = [];
    this.hintFadeAt = 24;
    this.comboBump = 0;
    this.airWasActive = false;
    this.airLandedUntil = 0;
    this.landedLabel = '';

    document.fonts?.ready.then(() => {
      this.minimapBase = null;
      this.bigmapBase = null;
      this.lastMapSize = '';
    }).catch(() => {});
  }

  /* ── loading & screens ─────────────────────────────────────── */

  setLoading(p, text) {
    const pct = clamp(p, 0, 1);
    if (this.el.loadBar) this.el.loadBar.style.width = `${(pct * 100).toFixed(1)}%`;
    if (text && this.el.loadStatus) this.el.loadStatus.textContent = text;
  }

  finishLoading() {
    this.el.loading?.classList.add('hidden');
  }

  showStart(show = true) {
    this.el.start?.classList.toggle('hidden', !show);
    if (show) this.setHud(false);
  }

  setHud(show = true) {
    this.el.hud?.classList.toggle('hidden', !show);
  }

  showModal(id) {
    for (const key of ['guide', 'map', 'pause', 'summary']) {
      const node = this.el[key];
      if (!node) continue;
      node.classList.toggle('hidden', key !== id);
    }
  }

  hideModals() {
    for (const key of ['guide', 'map', 'pause', 'summary']) {
      this.el[key]?.classList.add('hidden');
    }
  }

  isOpen(id) {
    return !!this.el[id] && !this.el[id].classList.contains('hidden');
  }

  fade(on, dark = false) {
    if (!this.el.fade) return;
    this.el.fade.classList.toggle('dark', dark);
    this.el.fade.classList.toggle('on', on);
  }

  setAudio(enabled) {
    this.el.audioMenu?.classList.toggle('muted', !enabled);
    if (this.el.pauseAudio) {
      this.el.pauseAudio.classList.toggle('on', enabled);
      const label = this.el.pauseAudio.querySelector('span');
      if (label) label.textContent = enabled ? 'ON' : 'OFF';
    }
  }

  setMarkers(on) {
    if (this.el.pauseMarkers) {
      this.el.pauseMarkers.classList.toggle('on', on);
      const label = this.el.pauseMarkers.querySelector('span');
      if (label) label.textContent = on ? 'ON' : 'OFF';
    }
  }

  setCameraLabel(label) {
    if (this.el.pauseCamera) this.el.pauseCamera.textContent = label;
  }

  setQualityLabel(label) {
    if (this.el.pauseQuality) this.el.pauseQuality.textContent = label;
  }

  /* ── toasts & floaters ─────────────────────────────────────── */

  toast(title, sub = '', variant = '', icon = 'coin') {
    const stack = this.el.toasts;
    if (!stack) return;
    const node = document.createElement('div');
    node.className = `toast ${variant}`.trim();
    node.innerHTML = `<div class="toast-icon">${ICONS[icon] || ICONS.coin}</div><div class="toast-copy"><strong></strong><span></span></div>`;
    node.querySelector('strong').textContent = title;
    node.querySelector('span').textContent = sub;
    stack.appendChild(node);
    while (stack.children.length > 3) stack.removeChild(stack.firstChild);
    const timer = setTimeout(() => {
      node.classList.add('out');
      setTimeout(() => node.remove(), 420);
    }, 3400);
    this.toastTimers.push(timer);
  }

  floaty(text, { big = false, cyan = false, x = 50, y = 43 } = {}) {
    const layer = this.el.floaters;
    if (!layer) return;
    const node = document.createElement('div');
    node.className = `floaty${big ? ' big' : ''}${cyan ? ' cyan' : ''}`;
    node.textContent = text;
    node.style.left = `calc(${x}% + ${(Math.random() - 0.5) * 3}rem)`;
    node.style.top = `${y}%`;
    layer.appendChild(node);
    setTimeout(() => node.remove(), 1100);
  }

  prompt(title, sub) {
    const node = this.el.prompt;
    if (!node) return;
    if (this.changed.promptTitle !== title) {
      this.el.promptTitle.textContent = title;
      this.changed.promptTitle = title;
    }
    if (this.changed.promptSub !== sub) {
      this.el.promptSub.textContent = sub;
      this.changed.promptSub = sub;
    }
    node.classList.remove('hidden');
  }

  hidePrompt() {
    this.el.prompt?.classList.add('hidden');
  }

  cinematic(on, { title = null, sub = null } = {}) {
    this.el.bars?.classList.toggle('on', on);
    this.el.caption?.classList.toggle('hidden', !on);
    if (title) {
      const strong = this.el.caption?.querySelector('strong');
      if (strong) strong.textContent = title;
    }
    if (sub) {
      const p = this.el.caption?.querySelector('p');
      if (p) p.textContent = sub;
    }
  }

  hintVisible(on) {
    this.el.hint?.classList.toggle('fade', !on);
  }

  /* ── nearest trail ─────────────────────────────────────────── */

  findNearest(player, force = false, time = 0) {
    if (!force && this.nearest && time - this.lastNearestCheck < 0.12) return this.nearest;
    this.lastNearestCheck = time;
    const px = player.pos.x, pz = player.pos.z;
    let best = null;
    let bestD2 = Infinity;
    for (const run of RUNS) {
      const samples = run.samples;
      if (!samples?.length) continue;
      const n = samples.length;
      let localD2 = Infinity;
      let localI = 0;
      for (let i = 0; i < n; i += 3) {
        const dx = samples[i].x - px, dz = samples[i].z - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 < localD2) { localD2 = d2; localI = i; }
      }
      for (let i = Math.max(0, localI - 3); i <= Math.min(n - 1, localI + 3); i++) {
        const dx = samples[i].x - px, dz = samples[i].z - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 < localD2) { localD2 = d2; localI = i; }
      }
      if (localD2 < bestD2) {
        bestD2 = localD2;
        best = { run, i: localI, dist: Math.sqrt(localD2) };
      }
    }
    if (!best) {
      this.nearest = null;
      return null;
    }
    const run = best.run;
    const onRun = best.dist <= run.width * 0.62 + 1.8;
    const nearRun = best.dist <= run.width * 0.95 + 7;
    let state;
    if (run.hidden && nearRun) state = 'SECRET STASH';
    else if (onRun) state = 'GROOMED';
    else if (nearRun) state = 'SOFT SHOULDER';
    else state = 'OFF-PISTE';
    this.nearest = {
      run, dist: best.dist, onRun, nearRun, state,
      sample: run.samples[best.i],
      index: best.i,
    };
    return this.nearest;
  }

  /* ── HUD ───────────────────────────────────────────────────── */

  setText(node, key, value) {
    if (!node) return;
    if (this.changed[key] === value) return;
    this.changed[key] = value;
    node.textContent = value;
  }

  update(state) {
    const {
      player, elapsed = 0, score = 0, streak = 0, comboFraction = 0,
      multiplier = 1, collectibles = this.collectibles, time = 0,
    } = state;

    const nearest = state.nearest || this.findNearest(player, false, time);
    const mountain = player.pos.x >= 0 ? 'WHISTLER MOUNTAIN' : 'BLACKCOMB MOUNTAIN';
    this.setText(this.el.mountain, 'mountain', mountain);
    this.setText(this.el.altitude, 'altitude', `${formatNumber(Math.round(player.pos.y))} m`);
    this.setText(this.el.trailName, 'trail', nearest ? nearest.run.name : 'Alpine');
    this.setText(this.el.trailState, 'trailState', nearest ? nearest.state : 'OFF-PISTE');

    const iconClass = nearest ? TRAIL_ICON_CLASS[nearest.run.difficulty] || 'blue' : 'blue';
    if (this.changed.trailIcon !== iconClass) {
      this.el.trailIcon.innerHTML = `<i class="${iconClass}"></i>`;
      this.changed.trailIcon = iconClass;
    }

    const vertical = Math.max(0, player.stats.vertical);
    this.setText(this.el.statVertical, 'vertical', `${formatNumber(Math.round(vertical))} m`);
    this.setText(this.el.statTop, 'topSpeed', `${Math.round(player.stats.topSpeed * 3.6)} km/h`);
    this.setText(this.el.statTime, 'time', formatTime(elapsed));
    this.setText(this.el.coins, 'coins', formatNumber(collectibles?.coinCount || 0));
    this.setText(this.el.crystals, 'crystals', `${collectibles?.crystalCount || 0}`);
    this.setText(this.el.score, 'score', formatNumber(Math.round(score)));

    const kmh = player.speedKmh;
    this.setText(this.el.speed, 'speed', `${Math.round(kmh)}`);
    const frac = clamp(kmh / 120, 0, 1);
    const arcOffset = 270 * (1 - frac);
    if (this.changed.arc !== arcOffset.toFixed(1)) {
      this.changed.arc = arcOffset.toFixed(1);
      this.el.speedArc.style.strokeDashoffset = `${arcOffset.toFixed(1)}`;
    }
    if (this.changed.bar !== frac.toFixed(3)) {
      this.changed.bar = frac.toFixed(3);
      this.el.speedBar.style.width = `${(frac * 100).toFixed(1)}%`;
    }

    let speedState = 'READY';
    if (player.crash) speedState = 'RECOVERING';
    else if (player.airborne) speedState = 'AIRBORNE';
    else if (kmh > 82) speedState = 'SENDING';
    else if (kmh > 58) speedState = 'FAST';
    else if (kmh > 24) speedState = 'CARVING';
    else if (kmh > 6) speedState = 'ROLLING';
    this.setText(this.el.speedState, 'speedState', speedState);
    this.el.speedState?.classList.toggle('hot', kmh > 62 || player.airborne);

    this.setText(this.el.vertNow, 'vertNow', `${Math.round(vertical)} m`);
    this.setText(this.el.grade, 'grade', `${Math.round(player.grade)}°`);
    this.setText(this.el.snow, 'snow', player.snowState);

    // air card
    const airActive = player.airborne || player.airTime > 0.08 || time < this.airLandedUntil;
    this.el.airCard?.classList.toggle('active', airActive);
    if (airActive) {
      const airborne = player.airborne;
      this.setText(this.el.airLabel, 'airLabel', airborne ? 'AIRBORNE' : 'TOUCHDOWN');
      this.setText(this.el.airTime, 'airTime', `${(player.airTime || 0).toFixed(1)}s`);
      this.el.airFill.style.width = `${clamp(player.airTime / 2.6, 0, 1) * 100}%`;
      this.setText(this.el.trickSpin, 'spin', `SPIN ${Math.round(player.spinDegrees)}°`);
      this.setText(this.el.trickFlip, 'flip', `FLIP ${Math.round(player.flipDegrees)}°`);
      const grabbing = player.grab > 0.25;
      this.setText(this.el.trickGrab, 'grab', grabbing ? 'GRAB ON' : 'GRAB —');
      this.el.trickGrab.classList.toggle('landed', !airborne && !grabbing);
    }

    // combo
    const comboOn = streak >= 3 && comboFraction > 0.001;
    this.el.combo?.classList.toggle('hidden', !comboOn);
    if (comboOn) {
      this.setText(this.el.comboX, 'comboX', `×${multiplier}`);
      this.setText(this.el.comboStreak, 'comboStreak', `${streak} COIN STREAK`);
      this.el.comboRing.style.strokeDashoffset = `${(119.4 * (1 - comboFraction)).toFixed(1)}`;
      if (this.comboBump < streak) {
        this.comboBump = streak;
        this.el.combo.classList.remove('bump');
        void this.el.combo.offsetWidth;
        this.el.combo.classList.add('bump');
      }
    } else {
      this.comboBump = 0;
    }

    this.hintVisible(elapsed < this.hintFadeAt);
  }

  /* ── summary ───────────────────────────────────────────────── */

  showSummary(data) {
    const {
      score = 0, topSpeed = 0, vertical = 0, coins = 0, crystals = 0,
      longestAir = 0, trail = 'Alpine', elapsed = 0,
    } = data;
    this.setText(this.el.sumScore, 'sumScore', formatNumber(Math.round(score)));
    this.setText(this.el.sumSpeed, 'sumSpeed', `${Math.round(topSpeed * 3.6)}`);
    this.setText(this.el.sumVert, 'sumVert', formatNumber(Math.round(vertical)));
    this.setText(this.el.sumCoins, 'sumCoins', formatNumber(coins));
    this.setText(this.el.sumCrystals, 'sumCrystals', `${crystals}`);
    this.setText(this.el.sumAir, 'sumAir', longestAir.toFixed(1));
    this.setText(this.el.sumTrail, 'sumTrail', trail);
    this.setText(this.el.sumTime, 'sumTime', formatTime(elapsed));
    this.showModal('summary');
  }

  /* ── maps ──────────────────────────────────────────────────── */

  drawMinimap(player, time = 0) {
    const canvas = this.el.minimap;
    if (!canvas) return;
    if (!this.minimapBase) this.minimapBase = this.buildMap(canvas.width, canvas.height, false);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.minimapBase, 0, 0);
    const proj = mapProject(canvas.width, canvas.height);
    this.drawMapOverlays(ctx, proj, player, time, false);
  }

  drawBigMap(player, time = 0) {
    const canvas = this.el.bigmap;
    if (!canvas) return;
    const key = `${canvas.width}x${canvas.height}`;
    if (!this.bigmapBase || this.lastMapSize !== key) {
      this.bigmapBase = this.buildMap(canvas.width, canvas.height, true);
      this.lastMapSize = key;
    }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.bigmapBase, 0, 0);
    const proj = mapProject(canvas.width, canvas.height);
    this.drawMapOverlays(ctx, proj, player, time, true);
    const nearest = this.nearest || (player ? this.findNearest(player, true, time) : null);
    this.setText(this.el.mapAltitude, 'mapAltitude', player ? `${formatNumber(Math.round(player.pos.y))} m` : '2,182 m');
    this.setText(this.el.mapRunName, 'mapRun', nearest ? nearest.run.name : 'Alpine');
  }

  buildMap(w, h, detailed) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const proj = mapProject(w, h);

    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#dfeae3');
    bg.addColorStop(0.55, '#e8f0e8');
    bg.addColorStop(1, '#e4ebdd');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // ── shaded relief, computed at low resolution and smoothed up
    const step = detailed ? 6 : 5;
    const cols = Math.max(2, Math.ceil(w / step));
    const rows = Math.max(2, Math.ceil(h / step));
    const relief = document.createElement('canvas');
    relief.width = cols;
    relief.height = rows;
    const rctx = relief.getContext('2d');
    const img = rctx.createImageData(cols, rows);
    const heights = new Float32Array(cols * rows);
    const worldX = new Float32Array(cols);
    const worldZ = new Float32Array(rows);

    for (let ix = 0; ix < cols; ix++) worldX[ix] = proj.wx(ix * step + step * 0.5);
    for (let iz = 0; iz < rows; iz++) worldZ[iz] = proj.wz(iz * step + step * 0.5);

    for (let iz = 0; iz < rows; iz++) {
      const z = worldZ[iz];
      for (let ix = 0; ix < cols; ix++) {
        heights[iz * cols + ix] = heightAt(worldX[ix], z);
      }
    }

    const spacingX = (w / cols) / proj.sx;
    const spacingZ = (h / rows) / proj.sz;
    const snowLow = [222, 233, 218];
    const snowMid = [235, 243, 235];
    const snowHigh = [248, 251, 249];
    const rock = [134, 143, 141];
    const rockLight = [176, 183, 179];

    for (let iz = 0; iz < rows; iz++) {
      const z = worldZ[iz];
      for (let ix = 0; ix < cols; ix++) {
        const idx = iz * cols + ix;
        const hgt = heights[idx];
        const left = heights[iz * cols + Math.max(0, ix - 1)];
        const right = heights[iz * cols + Math.min(cols - 1, ix + 1)];
        const up = heights[Math.max(0, iz - 1) * cols + ix];
        const down = heights[Math.min(rows - 1, iz + 1) * cols + ix];
        const dhx = (right - left) / (2 * spacingX);
        const dhz = (down - up) / (2 * spacingZ);
        const steep = Math.hypot(dhx, dhz);
        const facing = clamp(0.95 + (-dhx * 0.48 - dhz * 0.32) * 1.5, 0.7, 1.14);

        let col;
        if (hgt < 780) col = lerpColor(snowLow, snowMid, clamp((hgt - 620) / 160, 0, 1));
        else if (hgt < 1450) col = lerpColor(snowMid, snowHigh, clamp((hgt - 780) / 670, 0, 1));
        else col = snowHigh.slice();

        const x = worldX[ix];
        const treeNoise = Math.sin(x * 0.017 + z * 0.021) * Math.cos(z * 0.013 - x * 0.006);
        if (pisteAt(x, z) < 0.12 && hgt < 1650 && treeNoise > -0.1) {
          col = lerpColor(col, [176, 198, 180], clamp((treeNoise + 0.35) * 0.42, 0, 0.35));
        }
        if (steep > 0.62 && hgt > 1250) {
          col = lerpColor(col, steep > 1.12 ? rock : rockLight, clamp((steep - 0.62) * 0.95, 0, 0.78));
        }
        const p = pisteAt(x, z);
        if (p > 0.16) col = lerpColor(col, [252, 253, 252], clamp((p - 0.16) * 1.2, 0, 0.7));

        // 120 m contours
        const band = Math.floor(hgt / 120);
        const bandL = Math.floor(left / 120);
        const bandU = Math.floor(up / 120);
        const contour = (band !== bandL || band !== bandU) && hgt > 900 ? 0.94 : 1;

        const i4 = idx * 4;
        img.data[i4] = clamp(col[0] * facing * contour, 0, 255);
        img.data[i4 + 1] = clamp(col[1] * facing * contour, 0, 255);
        img.data[i4 + 2] = clamp(col[2] * facing * contour, 0, 255);
        img.data[i4 + 3] = 255;
      }
    }
    rctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(relief, 0, 0, cols, rows, 0, 0, w, h);

    // ── paper grain / snow stipple
    const rand = mulberry32(91224);
    ctx.fillStyle = 'rgba(255,255,255,.24)';
    for (let i = 0; i < (detailed ? 1700 : 500); i++) {
      const x = rand() * w;
      const y = rand() * h;
      ctx.fillRect(x, y, 0.8, 0.8);
    }
    ctx.fillStyle = 'rgba(75,104,88,.16)';
    const dots = detailed ? 1600 : 380;
    for (let i = 0; i < dots; i++) {
      const x = WORLD.minX + rand() * WORLD.sizeX;
      const z = WORLD.minZ + rand() * WORLD.sizeZ;
      const hgt = heightAt(x, z);
      if (hgt > 1650 || hgt < 730) continue;
      if (pisteAt(x, z) > 0.12) continue;
      const px = proj.px(x), py = proj.py(z);
      const r = 0.55 + rand() * (detailed ? 1.5 : 0.8);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── trails
    const lwScale = (proj.sx + proj.sz) * 0.5;
    const sorted = [...RUNS].sort((a, b) => b.width - a.width);
    for (const run of sorted) {
      if (!run.samples?.length) continue;
      const hidden = !!run.hidden;
      const width = Math.max(detailed ? 1.6 : 1.05, run.width * lwScale * (detailed ? 0.62 : 0.72));
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // white casing keeps lines legible on the relief
      ctx.strokeStyle = hidden ? 'rgba(250,245,225,.5)' : 'rgba(255,255,255,.55)';
      ctx.lineWidth = width + (detailed ? 2.1 : 1.2);
      if (hidden) ctx.setLineDash([6, 5]);
      ctx.beginPath();
      for (let i = 0; i < run.samples.length; i++) {
        const s = run.samples[i];
        const px = proj.px(s.x), py = proj.py(s.z);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.strokeStyle = hidden ? DIFF_COLOR.hidden : (DIFF_COLOR[run.difficulty] || DIFF_COLOR.blue);
      ctx.lineWidth = width;
      if (hidden) ctx.setLineDash([4.5, 5.5]);
      ctx.stroke();
      ctx.restore();
    }

    // ── run labels
    if (detailed) {
      const placed = [];
      const labelRuns = [...RUNS].filter(r => !r.hidden).sort((a, b) => (b.length || 0) - (a.length || 0));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const run of labelRuns) {
        if (!run.samples?.length || run.length < 900) continue;
        const p = runPointAt(run, 0.47);
        if (!p) continue;
        const px = proj.px(p.x), py = proj.py(p.z);
        let angle = Math.atan2(p.tz * proj.sz, p.tx * proj.sx);
        if (angle > Math.PI / 2) angle -= Math.PI;
        if (angle < -Math.PI / 2) angle += Math.PI;
        ctx.font = `700 12px ${MAP_FONT}`;
        const tw = ctx.measureText(run.name.toUpperCase()).width;
        const bw = Math.max(tw + 8, 34);
        const bh = 15;
        const box = { x: px, y: py, w: bw, h: bh };
        if (placed.some(b => Math.abs(b.x - box.x) < (b.w + box.w) * 0.48 && Math.abs(b.y - box.y) < (b.h + box.h) * 0.85)) continue;
        placed.push(box);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(angle);
        ctx.fillStyle = 'rgba(255,255,252,.8)';
        ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
        ctx.fillStyle = run.difficulty === 'black' || run.difficulty === 'double' ? '#1d2428' : '#264a3c';
        ctx.fillText(run.name.toUpperCase(), 0, 0.5);
        ctx.restore();
      }
    }

    // ── lifts
    for (const lift of LIFTS) {
      const pts = lift.points;
      const isP2P = lift.type === 'p2p';
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (isP2P) {
        ctx.strokeStyle = 'rgba(255,248,235,.9)';
        ctx.lineWidth = detailed ? 8 : 4.5;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const px = proj.px(pts[i][0]), py = proj.py(pts[i][1]);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.strokeStyle = '#a6392f';
        ctx.lineWidth = detailed ? 3.2 : 2;
        ctx.setLineDash(detailed ? [10, 5] : [5, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = 'rgba(44,74,82,.8)';
        ctx.lineWidth = detailed ? 1.5 : 1;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const px = proj.px(pts[i][0]), py = proj.py(pts[i][1]);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      if (detailed) {
        ctx.fillStyle = isP2P ? '#a6392f' : '#38545c';
        for (const [x, z] of pts) {
          ctx.beginPath();
          ctx.arc(proj.px(x), proj.py(z), isP2P ? 3 : 1.9, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    if (detailed) {
      const a = LIFTS.find(l => l.id === 'p2p');
      if (a) {
        const p0 = a.points[0], p1 = a.points[a.points.length - 1];
        const mx = proj.px((p0[0] + p1[0]) / 2), my = proj.py((p0[1] + p1[1]) / 2);
        ctx.save();
        ctx.translate(mx, my - 10);
        ctx.rotate(-0.06);
        ctx.font = `700 11px ${MAP_FONT}`;
        const text = 'PEAK 2 PEAK';
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = '#a6392f';
        ctx.fillRect(-tw / 2 - 6, -8, tw + 12, 15);
        ctx.fillStyle = '#fff8eb';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 0, 0.5);
        ctx.restore();
      }
    }

    // ── village and lodges
    for (const c of CHALETS) {
      const px = proj.px(c.x), py = proj.py(c.z);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(c.rot);
      const cw = Math.max(1.4, c.w * proj.sx);
      const ch = Math.max(1.4, c.d * proj.sz);
      ctx.fillStyle = '#9b7856';
      ctx.fillRect(-cw / 2, -ch / 2, cw, ch);
      ctx.fillStyle = 'rgba(255,252,244,.8)';
      ctx.fillRect(-cw / 2, -ch / 2, cw, Math.max(0.8, ch * 0.28));
      ctx.restore();
    }
    for (const lodge of LODGES) {
      const px = proj.px(lodge.x), py = proj.py(lodge.z);
      const lw = Math.max(2.2, lodge.size[0] * proj.sx);
      const lh = Math.max(2.0, lodge.size[2] * proj.sz);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(lodge.rot);
      ctx.fillStyle = '#6f4c34';
      ctx.strokeStyle = 'rgba(255,250,238,.85)';
      ctx.lineWidth = detailed ? 1.4 : 0.8;
      ctx.fillRect(-lw / 2, -lh / 2, lw, lh);
      ctx.strokeRect(-lw / 2, -lh / 2, lw, lh);
      ctx.restore();
    }

    // ── summit triangles + names
    const peaks = [
      { ...MOUNTAIN.whistlerPeak, name: 'WHISTLER', elev: '2,182 M' },
      { ...MOUNTAIN.blackcombPeak, name: 'BLACKCOMB', elev: '2,284 M' },
    ];
    for (const peak of peaks) {
      const px = proj.px(peak.x), py = proj.py(peak.z);
      ctx.save();
      ctx.translate(px, py);
      ctx.fillStyle = 'rgba(30,46,48,.82)';
      ctx.beginPath();
      ctx.moveTo(0, -8); ctx.lineTo(7, 4); ctx.lineTo(-7, 4); ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.beginPath();
      ctx.moveTo(0, -8); ctx.lineTo(2.6, -2); ctx.lineTo(-2.6, -2); ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    if (detailed) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(25,50,52,.16)';
      ctx.font = `700 62px ${MAP_FONT}`;
      ctx.fillText('WHISTLER', proj.px(1320), proj.py(-1630));
      ctx.fillText('BLACKCOMB', proj.px(-1300), proj.py(-1630));
      ctx.fillStyle = 'rgba(25,50,52,.4)';
      ctx.font = `600 13px ${MAP_FONT}`;
      ctx.fillText('2,182 M', proj.px(1320), proj.py(-1560));
      ctx.fillText('2,284 M', proj.px(-1300), proj.py(-1560));
      ctx.fillStyle = 'rgba(52,58,45,.58)';
      ctx.font = `600 12px ${MAP_FONT}`;
      ctx.fillText('WHISTLER VILLAGE', proj.px(250), proj.py(2160));
      ctx.fillText('CREEKSIDE', proj.px(790), proj.py(2130));
      ctx.fillText('BLACKCOMB BASE', proj.px(-420), proj.py(1900));
      ctx.fillStyle = 'rgba(32,70,63,.48)';
      ctx.font = `italic 600 12px ${MAP_FONT}`;
      ctx.fillText('LOCAL LINES HIDDEN IN THE TREES', proj.px(180), proj.py(-330));
      ctx.restore();
    }

    // ── soft paper border
    const edge = ctx.createLinearGradient(0, 0, 0, h);
    edge.addColorStop(0, 'rgba(255,255,255,.2)');
    edge.addColorStop(0.5, 'rgba(255,255,255,0)');
    edge.addColorStop(1, 'rgba(55,78,58,.08)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, w, h);

    return canvas;
  }

  drawMapOverlays(ctx, proj, player, time, detailed) {
    const crystals = this.collectibles?.crystals || [];
    for (const c of crystals) {
      const px = proj.px(c.x), py = proj.py(c.z);
      if (c.collected) {
        ctx.save();
        ctx.strokeStyle = 'rgba(199,168,76,.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px, py, detailed ? 4 : 2.2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        continue;
      }
      const pulse = 0.7 + Math.sin(time * 2.2 + c.phase) * 0.3;
      ctx.save();
      ctx.translate(px, py);
      if (detailed) {
        ctx.fillStyle = `rgba(255,199,91,${0.1 + pulse * 0.12})`;
        ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill();
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = '#ffd57a';
        ctx.strokeStyle = '#7a5a1d';
        ctx.lineWidth = 1.2;
        ctx.fillRect(-4.2, -4.2, 8.4, 8.4);
        ctx.strokeRect(-4.2, -4.2, 8.4, 8.4);
        ctx.rotate(-Math.PI / 4);
        ctx.font = `700 10px ${MAP_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(255,244,208,.95)';
        ctx.shadowColor = 'rgba(24,45,32,.55)';
        ctx.shadowBlur = 4;
        ctx.fillText(c.name.toUpperCase(), 0, 9);
      } else {
        ctx.fillStyle = `rgba(255,211,120,${0.55 + pulse * 0.45})`;
        ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    if (!player) return;

    // start pin
    const sp = startPose();
    const sx = proj.px(sp.x), sy = proj.py(sp.z);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.7)';
    ctx.fillStyle = '#d8532c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(sx, sy, detailed ? 4.4 : 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    const px = proj.px(player.pos.x);
    const py = proj.py(player.pos.z);
    const pulse = 1 + Math.sin(time * 3.4) * 0.24;
    const r = detailed ? 7.5 : 4.3;

    ctx.save();
    ctx.translate(px, py);
    // orientation: map y grows toward +z, world heading direction is (sin h, cos h)
    const dirX = Math.sin(player.heading) * proj.sx;
    const dirY = Math.cos(player.heading) * proj.sz;
    const angle = Math.atan2(dirY, dirX);
    ctx.rotate(angle + Math.PI / 2);

    ctx.strokeStyle = `rgba(255,140,82,${0.55 - Math.sin(time * 3.4) * 0.18})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.3 * pulse, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#ff6b3d';
    ctx.strokeStyle = '#fff8f1';
    ctx.lineWidth = detailed ? 2 : 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.25);
    ctx.lineTo(r * 0.82, r * 0.9);
    ctx.lineTo(0, r * 0.48);
    ctx.lineTo(-r * 0.82, r * 0.9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    if (detailed) {
      ctx.save();
      ctx.font = `700 11px ${MAP_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      ctx.shadowColor = 'rgba(10,30,30,.8)';
      ctx.shadowBlur = 5;
      ctx.fillText('YOU', px, py - 15);
      ctx.restore();
    }
  }
}
