import {
  RUNS, LIFTS, mountainAt, ROUNDHOUSE_START,
} from './worlddata.js';
import { ResortMap } from './resort-map.js';
import { RouteGuide } from './route-guide.js';
import { indexNearbyTrails } from './nearby-trails.js';
import { loadingProgress, finishMountainLoading } from './mountain-loading.js';
import { clamp, formatNumber, formatTime } from './util.js';
import {
  formatTravelDistance, onProfileChange, setSkierName, setSkierUnits, skierName, skiUnits, travelStats, unitPreference,
} from './skier-profile.js';

/* ═══════════════════════════════════════════════════════════════
   INTERFACE
   HUD, the resort trail map, toasts, floaters, prompts,
   modals, and the post-run summary.
   ═══════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);
const formatHeight = (metres, { lengthFactor, small }) => `${formatNumber(metres * lengthFactor)} ${small}`;

const NEARBY_MAP_SIZE = 160;
const NEARBY_MAP_RADIUS = 70;
const NEARBY_MAP_METRES = 300;
const MAP_INK = '#112434';
const NEARBY_LINE_STYLES = {
  lift: { color: '#ffd489', dash: [4, 3] },
  unrated: { color: '#d3dce4', dash: [1, 3] },
  green: { color: '#a6f88c', dash: [] },
  blue: { color: '#7bddff', dash: [] },
  red: { color: '#ff8b90', dash: [] },
  black: { color: '#f5fbff', dash: [] },
  double: { color: '#f5fbff', dash: [5, 2.5] },
};

function nearbyMapLine(points, style) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of points) {
    minX = Math.min(x, minX);
    maxX = Math.max(x, maxX);
    minZ = Math.min(z, minZ);
    maxZ = Math.max(z, maxZ);
  }
  return { points, style, minX, maxX, minZ, maxZ };
}

const ICONS = {
  coin: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="#ffd37a"/><circle cx="12" cy="12" r="9" stroke="#c98a24" stroke-width="1.4"/><path d="M9 9.4c.5-1.2 2.2-1.6 3.4-.9 1.5.9 1 2.5-.5 3l-2.3.8c-1.7.6-1.9 2.4-.5 3.2 1.3.8 3.1.2 3.7-1" stroke="#9b6516" stroke-width="1.5" stroke-linecap="round"/></svg>',
  crystal: '<svg viewBox="0 0 24 24"><path d="M12 1.5 20.5 9 12 22.5 3.5 9 12 1.5Z" fill="#8fe7ff"/><path d="M3.5 9h17M12 1.5v21M8 9l4 13.5L16 9" fill="none" stroke="rgba(8,40,56,.4)" stroke-width=".8"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 2.6 2.9 5.9 6.5.9-4.7 4.6 1.1 6.4-5.8-3-5.8 3 1.1-6.4L2.6 9.4l6.5-.9L12 2.6Z" fill="#ffc75b"/></svg>',
  lift: '<svg viewBox="0 0 24 24" fill="none" stroke="#e8f2f5" stroke-width="1.6"><path d="M3 5.5 21 3M8 4.6V10m8-1.4V15"/><rect x="5" y="10" width="6" height="7" rx="1.1" fill="rgba(255,199,91,.18)"/><rect x="13" y="15" width="6" height="7" rx="1.1" fill="rgba(255,199,91,.18)"/></svg>',
  crash: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3 22 20H2L12 3Z" fill="rgba(255,124,94,.16)" stroke="#ff9c7d" stroke-width="1.4"/><path d="M12 8v6m0 2.7v.6" stroke="#ffd0c1" stroke-width="1.8" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="rgba(139,240,160,.12)" stroke="#8bf0c0" stroke-width="1.4"/><path d="m7.5 12.2 3.1 3.1 6-6.4" stroke="#8bf0c0" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  stash: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 2 4 6v6c0 5 3.4 8.4 8 10 4.6-1.6 8-5 8-10V6l-8-4Z" fill="rgba(255,199,91,.14)" stroke="#ffc75b" stroke-width="1.4"/><path d="M9 11.5h6M12 8.5v6" stroke="#ffc75b" stroke-width="1.4" stroke-linecap="round"/></svg>',
};


export class UI {
  constructor({ collectibles = null, runs = RUNS, lifts = LIFTS } = {}) {
    this.collectibles = collectibles;
    this.runs = runs;
    this.lifts = lifts;
    this.el = {
      loading: $('loading-screen'), loadBar: $('load-bar'), loadStatus: $('load-status'),
      start: $('start-screen'), hud: $('hud'),
      guide: $('guide-screen'), map: $('map-screen'), pause: $('pause-screen'), summary: $('summary-screen'),
      fade: $('fade'),
      altitude: $('altitude'), mountain: $('mountain-name'), trailName: $('trail-name'),
      statVertical: $('stat-vertical'), speed: $('speed'), speedUnit: $('speed-unit'),
      gearMode: $('gear-mode'), gearModeLabel: $('gear-mode-label'), surface: $('snow-surface'), boost: $('boost-readout'),
      coins: $('coin-count'), crystals: $('crystal-count'), instruments: $('instruments'),
      bigmap: $('bigmap'), nearbyMap: $('nearby-map'), pauseNearbyMap: $('pause-nearby-map'),
      prompt: $('interaction-prompt'), promptTitle: $('prompt-title'), promptSub: $('prompt-sub'),
      nextLift: $('next-lift'), caption: $('cinematic-caption'),
      rideName: $('ride-name'), rideDestination: $('ride-destination'), rideRemaining: $('ride-remaining'),
      rideProgress: $('ride-progress'), rideView: $('ride-view-label'),
      toasts: $('toast-stack'), floaters: $('floater-layer'),
      mapAltitude: $('map-altitude'), mapRunName: $('map-run-name'),
      audioMenu: $('audio-toggle-menu'), pauseAudio: $('pause-audio'),
      pauseMarkers: $('pause-markers'), pauseCamera: $('pause-camera'), pauseQuality: $('pause-quality'),
      sumScore: $('sum-score'), sumSpeed: $('sum-speed'), sumVert: $('sum-vert'),
      sumCoins: $('sum-coins'), sumCrystals: $('sum-crystals'), sumAir: $('sum-air'),
      sumTrail: $('sum-trail'), sumTime: $('sum-time'),
    };
    this.changed = {};
    $('trail-count').textContent = formatNumber(runs.length);
    $('lift-count').textContent = formatNumber(lifts.filter((lift) => lift.rideable).length);
    this.resortMap = new ResortMap(this.el.bigmap);
    this.nearbyMapFrame = null;
    this.nearest = null;
    this.lastNearestCheck = 0;
    this.toastTimers = new Set();
    this.bindProfile();
  }

  bindProfile() {
    const form = $('profile-name-form'), input = $('profile-name');
    const status = $('profile-name-status'), units = $('profile-units');
    input.value = skierName();
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const accepted = setSkierName(input.value);
      input.setAttribute('aria-invalid', String(!accepted));
      if (accepted) input.value = skierName();
      status.textContent = accepted ? (input.value ? 'Name saved' : 'Automatic callsign restored') :
        'Choose a clean name of up to 24 characters.';
    });
    input.addEventListener('input', () => {
      input.removeAttribute('aria-invalid');
      status.textContent = '';
    });
    units.addEventListener('change', () => setSkierUnits(units.value));
    const render = (event) => {
      if (event?.type === 'preferences') {
        if (document.activeElement !== input) input.value = skierName();
        this.nearbyMapFrame = null;
      }
      const { metres, runs, resorts, mountains } = travelStats();
      units.value = unitPreference();
      this.setText($('profile-distance'), 'profileDistance', formatTravelDistance(metres));
      for (const [kind, entries] of [['run', runs], ['resort', resorts], ['mountain', mountains]]) {
        this.setText($(`profile-${kind}s`), `profile-${kind}s`, formatNumber(entries.length));
        this.setText($(`profile-${kind}-list`), `profile-${kind}-list`, entries.sort((a, b) => a.localeCompare(b)).join(', ') || 'None yet');
      }
    };
    onProfileChange(render);
    render();
  }

  /* ── loading & screens ─────────────────────────────────────── */

  setLoading(p, text) {
    loadingProgress(p, text);
  }

  finishLoading() {
    return finishMountainLoading();
  }

  showStart(show = true) {
    this.el.start?.classList.toggle('hidden', !show);
    if (show) this.setHud(false);
  }

  setHud(show = true) {
    this.el.hud?.classList.toggle('hidden', !show);
    this.el.instruments.classList.toggle('hidden', !show);
    document.getElementById('app').classList.toggle('in-game', show);
  }

  showModal(id, focusTarget = this.el[id]?.querySelector('button')) {
    for (const key of ['guide', 'map', 'pause', 'summary']) {
      const node = this.el[key];
      if (!node) continue;
      node.classList.toggle('hidden', key !== id);
      node.inert = key !== id;
    }
    if (!focusTarget) return;
    focusTarget.focus({ preventScroll: true });
    if (document.activeElement !== focusTarget) {
      // The outgoing visibility transition can briefly block focusing the new panel.
      setTimeout(() => {
        if (this.isOpen(id) && !this.el[id].contains(document.activeElement)) focusTarget.focus({ preventScroll: true });
      }, 340);
    }
  }

  hideModals() {
    for (const key of ['guide', 'map', 'pause', 'summary']) {
      const node = this.el[key];
      if (!node) continue;
      node.inert = true;
      node.classList.add('hidden');
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

  toggleNearbyMap() {
    const { nearbyMap, pauseNearbyMap } = this.el;
    const shown = nearbyMap.hidden;
    nearbyMap.hidden = !shown;
    pauseNearbyMap.classList.toggle('on', shown);
    pauseNearbyMap.setAttribute('aria-pressed', String(shown));
    pauseNearbyMap.querySelector('span').textContent = shown ? 'ON' : 'OFF';
    this.nearbyMapFrame = null;
  }

  setCameraLabel(label) {
    if (this.el.pauseCamera) this.el.pauseCamera.textContent = label;
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
      this.toastTimers.delete(timer);
      node.classList.add('out');
      setTimeout(() => node.remove(), 420);
    }, 3400);
    this.toastTimers.add(timer);
  }

  clearToasts() {
    for (const timer of this.toastTimers) clearTimeout(timer);
    this.toastTimers.clear();
    this.el.toasts?.replaceChildren();
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

  prompt(title, sub, canSwitch) {
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
    this.el.nextLift.classList.toggle('hidden', !canSwitch);
    if (node.classList.contains('hidden')) node.classList.remove('hidden');
  }

  hidePrompt() {
    const node = this.el.prompt;
    if (node && !node.classList.contains('hidden')) node.classList.add('hidden');
  }

  cinematic(on, { title = '', sub = '' } = {}) {
    this.el.hud.classList.toggle('riding', on);
    this.el.instruments.classList.toggle('riding', on);
    this.el.caption.classList.toggle('hidden', !on);
    if (on) {
      this.el.rideName.textContent = title;
      this.el.rideDestination.textContent = sub;
    }
  }

  setRideView(view,hasChase=false) {
    this.el.rideView.textContent = view === 'valley' ? 'Forward view'
      : view === 'forward' && hasChase ? 'Chase view' : 'Valley view';
  }

  updateRide(progress, metres, seconds) {
    this.el.rideProgress.value = progress;
    const clock = formatTime(Math.ceil(seconds));
    const { lengthFactor, distanceFactor, small } = skiUnits();
    const distance = metres * distanceFactor >= 1 ? formatTravelDistance(metres) : `${Math.ceil(metres * lengthFactor / 10) * 10} ${small}`;
    this.setText(this.el.rideRemaining, 'rideRemaining', `${distance} · ${clock}`);
  }

  /* ── nearest trail ─────────────────────────────────────────── */

  findNearest(player, force = false, time = 0) {
    if (!force && time > this.lastNearestCheck && time - this.lastNearestCheck < 0.12) return this.nearest;
    this.lastNearestCheck = time;
    const { x, z } = player.pos;
    if (x === this.lastNearestX && z === this.lastNearestZ) return this.nearest;
    this.lastNearestX = x;
    this.lastNearestZ = z;
    // Whistler's samples are built after constructing the UI.
    this.nearbyTrailQuery ??= indexNearbyTrails(this.runs);
    const best = this.nearbyTrailQuery(x, z);
    if (!best) {
      this.nearest = null;
      return null;
    }
    const run = best.run;
    const onRun = best.dist <= run.width * 0.62 + 1.8;
    const nearRun = best.dist <= run.width * 0.95 + 7;
    let state;
    if (run.gladed && nearRun) state = 'GLADE';
    else if (onRun) state = 'ON PISTE';
    else if (nearRun) state = 'SOFT SHOULDER';
    else state = 'OFF-PISTE';
    this.nearest = {
      run, dist: best.dist, onRun, nearRun, state,
      sample: run.samples[best.index],
      index: best.index,
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

  update({ player, collectibles = this.collectibles, nearest, time, mountainName, trailName, indoors = false }) {
    const units = skiUnits();
    const { gearMode, gearModeLabel, surface, boost } = this.el;
    const mountain = mountainName ?? nearest?.run.mountain ?? mountainAt(player.pos.x, player.pos.z);
    const nearUnload = trailName == null && Math.hypot(player.pos.x - ROUNDHOUSE_START.x, player.pos.z - ROUNDHOUSE_START.z) < 43;
    const trail = trailName ?? (nearUnload ? 'Roundhouse' : nearest?.run.named ? nearest.run.name : '');
    this.setText(this.el.mountain, 'mountain', mountain);
    this.setText(this.el.altitude, 'altitude', formatHeight(player.pos.y, units));
    this.setText(this.el.trailName, 'trail', trail);
    this.setText(this.el.statVertical, 'vertical', formatHeight(Math.max(0, player.stats.vertical), units));
    const hideGear = !player.canChangeFootMode() || (player.footMode && (indoors || player.surfaceType === 'ground'));
    if (gearMode.hidden !== hideGear) gearMode.hidden = hideGear;
    this.setText(gearModeLabel, 'gearMode', player.footMode ? 'Put on skis' : 'Walk');
    this.setText(surface, 'surface', player.vehicleLabel ? ` · ${player.vehicleLabel}` : player.footMode ? ' · On foot' :
      player.surfaceType === 'ice' ? ' · Ice' : player.surfaceType === 'powder' ? ' · Powder' : '');
    this.setText(this.el.coins, 'coins', formatNumber(collectibles?.coinCount || 0));
    this.setText(this.el.crystals, 'crystals', String(collectibles?.crystalCount || 0));
    this.setText(this.el.speed, 'speed', String(Math.round(player.speedKmh * units.speedFactor)));
    this.setText(this.el.speedUnit, 'speedUnit', units.speed);
    this.drawNearbyMap(player, time);
    const hideBoost = player.boostTime <= 0;
    if (boost.hidden !== hideBoost) boost.hidden = hideBoost;
    if(!boost.hidden){
      this.setText(boost.firstElementChild,'boostChain',player.trickChain>1?`Boost ×${player.trickChain}`:'Boost');
      boost.lastElementChild.value=player.boostTime/player.boostDuration;
    }
  }

  /* ── summary ───────────────────────────────────────────────── */

  showSummary(data) {
    const {
      score = 0, topSpeed = 0, vertical = 0, coins = 0, crystals = 0,
      longestAir = 0, trail = 'Alpine', elapsed = 0,
    } = data;
    this.setText(this.el.sumScore, 'sumScore', formatNumber(Math.round(score)));
    const units = skiUnits();
    this.setText(this.el.sumSpeed, 'sumSpeed', `${Math.round(topSpeed * 3.6 * units.speedFactor)}`);
    this.setText($('sum-speed-unit'), 'sumSpeedUnit', units.speed.toUpperCase());
    this.setText(this.el.sumVert, 'sumVert', formatNumber(vertical * units.lengthFactor));
    this.setText($('sum-vert-unit'), 'sumVertUnit', units.small.toUpperCase());
    this.setText(this.el.sumCoins, 'sumCoins', formatNumber(coins));
    this.setText(this.el.sumCrystals, 'sumCrystals', `${crystals}`);
    this.setText(this.el.sumAir, 'sumAir', longestAir.toFixed(1));
    this.setText(this.el.sumTrail, 'sumTrail', trail);
    this.setText(this.el.sumTime, 'sumTime', formatTime(elapsed));
    $('sum-location').textContent = (data.title || 'Alpine').toUpperCase();
    $('summary-lift').classList.toggle('hidden', !data.liftAvailable);
    this.showModal('summary');
  }

  /* ── maps ──────────────────────────────────────────────────── */

  drawNearbyMap(player, time) {
    const { nearbyMap: canvas, hud } = this.el;
    if (canvas.hidden || hud.classList.contains('riding')) return;
    const { x, z } = player.pos;
    const { heading } = player;
    const previous = this.nearbyMapFrame;
    if (previous && (time - previous.time < .08 || (
      Math.hypot(x - previous.x, z - previous.z) < 1 && Math.abs(heading - previous.heading) < .01
    ))) return;
    this.nearbyMapFrame = { x, z, heading, time };
    this.nearbyMapLines ??= [
      ...this.lifts.map(({ points }) => nearbyMapLine(points, NEARBY_LINE_STYLES.lift)),
      ...this.runs.map(({ points, difficulty }) => nearbyMapLine(points, NEARBY_LINE_STYLES[difficulty] ?? NEARBY_LINE_STYLES.unrated)),
    ];

    const ctx = canvas.getContext('2d');
    const dpr = canvas.width / NEARBY_MAP_SIZE;
    const cx = NEARBY_MAP_SIZE / 2, cy = 78;
    const radius = NEARBY_MAP_RADIUS, reach = NEARBY_MAP_METRES;
    const scale = radius / reach;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, NEARBY_MAP_SIZE, NEARBY_MAP_SIZE);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    for (const line of this.nearbyMapLines) {
      if (line.minX > x + reach || line.maxX < x - reach || line.minZ > z + reach || line.maxZ < z - reach) continue;
      ctx.beginPath();
      const [startX, startZ] = line.points[0];
      ctx.moveTo(cx + (startX - x) * scale, cy + (startZ - z) * scale);
      for (let i = 1; i < line.points.length; i++) {
        const [px, pz] = line.points[i];
        ctx.lineTo(cx + (px - x) * scale, cy + (pz - z) * scale);
      }
      ctx.setLineDash(line.style.dash);
      ctx.strokeStyle = MAP_INK;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = line.style.color;
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    // World heading is measured from south towards east. The map stays north-up.
    ctx.rotate(Math.PI - heading);
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(5.5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5.5, 6);
    ctx.closePath();
    ctx.strokeStyle = MAP_INK;
    ctx.lineWidth = 2.6;
    ctx.stroke();
    ctx.fillStyle = '#ff7050';
    ctx.fill();
    ctx.restore();

    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = MAP_INK;
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 2.7;
    ctx.strokeText('N', cx, 10);
    ctx.fillText('N', cx, 10);
    ctx.textAlign = 'left';
    const { lengthFactor, small } = skiUnits();
    const rulerLength = small === 'ft' ? 300 : 100;
    const ruler = rulerLength / lengthFactor * scale;
    const rulerLabel = `${rulerLength} ${small}`;
    ctx.beginPath();
    ctx.moveTo(11, 150);
    ctx.lineTo(11, 154);
    ctx.lineTo(11 + ruler, 154);
    ctx.lineTo(11 + ruler, 150);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.strokeStyle = MAP_INK;
    ctx.lineWidth = 2.7;
    ctx.strokeText(rulerLabel, 17 + ruler, 156);
    ctx.fillText(rulerLabel, 17 + ruler, 156);
  }

  configureMap(scene, settings, isOpen) {
    this.routeGuide = new RouteGuide(scene, { ...settings, isOpen,
      lifts: settings.lifts.filter(lift => lift.rideable !== false),
      summerLifts: settings.summerLifts?.filter(lift => lift.rideable !== false) });
    this.resortMap.configure(settings, this.routeGuide);
  }

  drawBigMap(player, time = 0) {
    this.resortMap.update(player, time);
    const nearest = this.nearest || (player ? this.findNearest(player, true, time) : null);
    this.setText(this.el.mapAltitude, 'mapAltitude', player ? formatHeight(player.pos.y, skiUnits()) : '');
    this.setText(this.el.mapRunName, 'mapRun', nearest ? nearest.run.name : 'Alpine');
  }
}
