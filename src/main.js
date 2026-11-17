import * as THREE from 'three';
import { buildTerrain } from './terrain.js';
import { buildEnvironment } from './environment.js';
import {
  createSky, createLighting, createDistantRanges, Snowstorm, createGlitter,
  ParticleFX, SkiTracks, SUN_DIR,
} from './effects.js';
import { Player } from './player.js';
import { Collectibles } from './coins.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';
import { startPose, P2P_RIDE, SECRETS } from './worlddata.js';
import { clamp, formatNumber, smoothstep } from './util.js';

/* ═══════════════════════════════════════════════════════════════
   ALPINE DESCENT
   Two mountains, one continuous line, and a very large amount of
   snow. This file marries the world, the skier, and the interface.
   ═══════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

const COMBO_TIME = 4.8;
const QUALITIES = [
  { name: 'HIGH', pixel: 1.75, shadows: true, size: 2048 },
  { name: 'BALANCED', pixel: 1.25, shadows: true, size: 1024 },
  { name: 'LOW', pixel: 1.0, shadows: false, size: 512 },
];
const TIPS = [
  'Locals know: when the light goes flat, follow the trees, not the crowds.',
  'The Peak 2 Peak is 4.4 km of nothing but air. Enjoy the silence.',
  'A clean landing beats a big spin. Almost always.',
  'The glades hold the coldest snow on the mountain. Look for the small wooden signs.',
  'Coins build a streak. The multiplier is where the real score lives.',
  'If you can see your tracks behind you, you are going the right way.',
];

let renderer, scene, camera;
let terrain, env, sky, lighting, ranges, fx, tracks, storm, glitter;
let player, collectibles, audio, ui;
let introTime = 0;
let displayTime = 0;
let elapsed = 0;
let lastFrame = 0;
let lastMini = 0;
let lastBigmap = 0;
let playing = false;
let paused = false;
let finished = false;
let finishCooldown = 0;
let transitioning = false;
let ride = null;
let ridePending = false;
let arriving = false;
let mapReturn = null;
let introLook = new THREE.Vector3();
let qualityIndex = 0;
let markersOn = true;
let audioOn = true;
let score = 0;
let coinScore = 0;
let trickScore = 0;
let crystalScore = 0;
let streak = 0;
let comboTimer = 0;
let comboFraction = 0;
let multiplier = 1;
let ollieQueued = false;

const keys = Object.create(null);
const input = {
  steer: 0, tuck: false, brake: false, ollie: false, flip: 0, grab: false, air: false,
};

const _ridePos = new THREE.Vector3();
const _rideTan = new THREE.Vector3();
const _rideLook = new THREE.Vector3();
const _rideTan2 = new THREE.Vector3();

/* ── boot ───────────────────────────────────────────────────── */

async function boot() {
  const host = $('webgl');
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
  } catch (err) {
    showFatal('WebGL is required for Alpine Descent.', err);
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITIES[qualityIndex].pixel));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.03;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xc9dee8);
  scene.fog = new THREE.FogExp2(0xd7e4ea, 0.00018);

  camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.12, 15000);
  camera.position.set(1280, 2860, 3240);

  ui = new UI();
  ui.setLoading(0.02, 'Shaping the Coast Mountains…');
  await nextFrame();

  lighting = createLighting(scene);
  sky = createSky(scene);
  ranges = createDistantRanges(scene);
  introLook.set(0, 1500, -170);

  const setLoad = (p, text) => ui.setLoading(p, text);

  terrain = await buildTerrain(
    (p, text) => setLoad(0.03 + p * 0.44, text),
    nextFrame,
  );
  scene.add(terrain.mesh);
  await nextFrame();

  setLoad(0.49, 'Planting the old-growth forest…');
  await nextFrame();
  env = await buildEnvironment(scene, {
    onProgress: (p, text) => setLoad(0.5 + p * 0.42, text),
  });

  setLoad(0.93, 'Brushing in the last light…');
  await nextFrame();

  tracks = new SkiTracks(scene);
  fx = new ParticleFX(scene);
  storm = new Snowstorm(scene, camera);
  glitter = createGlitter(scene);

  player = new Player(scene, camera, { env, fx, tracks, audio: null });
  player.model.visible = false;
  collectibles = new Collectibles(scene, fx);
  ui.collectibles = collectibles;

  audio = new AudioEngine();
  player.audio = audio;
  ui.setAudio(true);
  ui.setMarkers(true);
  ui.setCameraLabel('CHASE');
  ui.setQualityLabel(QUALITIES[qualityIndex].name);

  player.onEvent = onPlayerEvent;
  collectibles.onCoin = onCoin;
  collectibles.onCrystal = onCrystal;

  bindUI();
  bindKeys();
  resetRunState(false);

  setLoad(0.97, 'Waxing the skis…');
  await nextFrame();
  updateSun();

  try {
    renderer.compile(scene, camera);
  } catch { /* some drivers dislike a cold compile; first frame will handle it */ }

  setLoad(1, 'Ready when you are.');
  await wait(280);
  ui.finishLoading();
  ui.showStart(true);
  ui.showModal(null);
  ui.hideModals();
  ui.setHud(false);
  updateIntroCamera(0.016, 0);
  lastFrame = performance.now();
  scheduleFrame();

  // handy for debugging in the console
  window.__alpine = {
    get player() { return player; },
    get collectibles() { return collectibles; },
    get env() { return env; },
    get scene() { return scene; },
    get camera() { return camera; },
    get renderer() { return renderer; },
    get ui() { return ui; },
    get audio() { return audio; },
    get state() {
      return {
        playing, paused, finished, score, streak, elapsed,
        coins: collectibles?.coinCount, crystals: collectibles?.crystalCount,
        pos: player?.pos.toArray(), speed: player?.speedKmh,
      };
    },
    start: () => startGame(true),
    ride: () => tryP2P(),
    get ride() {
      return ride ? { t: ride.t, dur: ride.dur, fromWhistler: ride.fromWhistler } : null;
    },
    finishRide: () => { if (ride) ride.t = ride.dur; },
  };
}

function showFatal(message, err) {
  console.error(err || message);
  const status = $('load-status');
  if (status) {
    status.textContent = message;
    status.style.color = '#ffb4a0';
  }
  const bar = $('load-bar');
  if (bar) bar.style.background = '#b23a2b';
}

/* ── flow ───────────────────────────────────────────────────── */

async function startGame(express = false) {
  if (transitioning || playing) return;
  transitioning = true;
  document.activeElement?.blur?.();
  try { await audio.init(); } catch { /* audio is optional */ }
  audioOn = audio.enabled;
  ui.setAudio(audioOn);
  audio.ui();

  ui.fade(true, false);
  await wait(express ? 380 : 520);

  ui.hideModals();
  ui.showStart(false);
  ui.setHud(true);
  player.model.visible = true;
  player.teleport(startPose(), { resetStats: true });
  resetRunState(false);
  playing = true;
  paused = false;
  finished = false;
  ui.fade(false, false);
  lastFrame = performance.now();
  audio.ui();
  ui.toast('DROPPED IN', "Franz's Run · Whistler Mountain", 'green', 'check');
  setTimeout(() => {
    if (playing && !paused) ui.toast('PEAK 2 PEAK', 'Press E for the gondola to Blackcomb', '', 'lift');
  }, 4200);
  transitioning = false;
}

function resetRunState(fullReset = false) {
  elapsed = 0;
  streak = 0;
  comboTimer = 0;
  comboFraction = 0;
  multiplier = 1;
  finished = false;
  finishCooldown = 0;
  paused = false;
  ride = null;
  ridePending = false;
  arriving = false;
  ui?.hidePrompt();
  if (fullReset) {
    coinScore = 0;
    trickScore = 0;
    crystalScore = 0;
    score = 0;
    collectibles?.reset();
  }
}

async function restartSession(fullReset = true) {
  if (!playing || transitioning) return;
  transitioning = true;
  ui.hideModals();
  ui.fade(true, false);
  await wait(380);
  player.teleport(startPose(), { resetStats: true });
  resetRunState(fullReset);
  ui.setHud(true);
  ui.fade(false, false);
  audio.ui();
  ui.toast(fullReset ? 'FRESH TRACKS' : 'BACK TO THE SUMMIT', 'Whistler Peak · 2,182 m', 'green', 'check');
  transitioning = false;
  lastFrame = performance.now();
}

function resetToSummit() {
  restartSession(false);
}

function pauseGame() {
  if (!playing || paused || finished || ride || ridePending) return;
  paused = true;
  keysBackupClear();
  ui.showModal('pause');
  const tip = $('pause-tip');
  if (tip) tip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  audio.ui();
}

function resumeGame() {
  if (!playing || finished) return;
  ui.hideModals();
  paused = false;
  lastFrame = performance.now();
  audio.ui();
}

function openGuide() {
  if (playing) return;
  ui.showModal('guide');
  audio.ui();
}

function closeGuide() {
  ui.hideModals();
}

function openMap(returnTo = null) {
  if (!playing) return;
  if (ui.isOpen('map')) return;
  mapReturn = returnTo
    || (ui.isOpen('pause') ? 'pause' : (ui.isOpen('summary') ? 'summary' : 'game'));
  ui.hideModals();
  ui.showModal('map');
  paused = true;
  lastBigmap = 0;
  ui.drawBigMap(player, displayTime);
  audio.ui();
}

function closeMap() {
  if (!ui.isOpen('map')) return;
  const returnTo = mapReturn;
  mapReturn = null;
  if (returnTo === 'pause') {
    ui.showModal('pause');
    paused = true;
  } else if (returnTo === 'summary') {
    ui.showModal('summary');
    paused = true;
  } else {
    ui.hideModals();
    paused = false;
    lastFrame = performance.now();
  }
  audio.ui();
}

function finishRun() {
  if (finished) return;
  finished = true;
  paused = true;
  keysBackupClear();
  ui.hidePrompt();
  const nearest = ui.findNearest(player, true, displayTime);
  ui.showSummary({
    score,
    topSpeed: player.stats.topSpeed,
    vertical: player.stats.vertical,
    coins: collectibles.coinCount,
    crystals: collectibles.crystalCount,
    longestAir: player.stats.longestAir,
    trail: nearest ? nearest.run.name : 'Franz’s Run',
    elapsed,
  });
  audio.finish();
}

async function rideAgain() {
  if (transitioning) return;
  transitioning = true;
  ui.hideModals();
  ui.fade(true, false);
  await wait(380);
  player.teleport(startPose(), { resetStats: true });
  resetRunState(true);
  ui.setHud(true);
  ui.fade(false, false);
  ui.toast('NEW LINE', 'The mountain remembers your tracks.', 'green', 'check');
  transitioning = false;
  lastFrame = performance.now();
}

function keepExploring() {
  ui.hideModals();
  paused = false;
  finished = false;
  finishCooldown = 16;
  lastFrame = performance.now();
}

/* ── Peak 2 Peak ────────────────────────────────────────────── */

async function tryP2P() {
  if (!playing || paused || finished || ridePending) return;
  if (ride) {
    ride.t = ride.dur;
    return;
  }
  const fromWhistler = player.pos.x >= 0;
  ridePending = true;
  paused = true;
  try { await audio.init(); } catch { /* ignore */ }
  audio.gondolaStart();
  ui.hidePrompt();
  ui.fade(true, true);
  await wait(420);

  player.setRiding(true);
  player.model.visible = false;
  ride = { t: 0, dur: 11.2, fromWhistler, phase: 'ride' };
  ridePending = false;
  paused = false;
  const destination = fromWhistler ? 'BLACKCOMB' : 'WHISTLER';
  ui.cinematic(true, {
    title: `CROSSING TO ${destination}`,
    sub: fromWhistler ? 'Whistler Peak  →  Blackcomb Mountain' : 'Blackcomb  →  Whistler Peak',
  });
  placeRideCamera(0);
  ui.fade(false, true);
  ui.toast('PEAK 2 PEAK', '4.4 km · longest unsupported span in the world', '', 'lift');
}

function placeRideCamera(progress) {
  if (!env?.p2p?.sampler) return;
  const p = clamp(progress, 0, 1);
  const t = ride?.fromWhistler === false
    ? 0.985 - p * 0.97
    : 0.015 + p * 0.97;
  env.p2p.sampler.at(t, _ridePos, _rideTan);
  const t2 = clamp(t + (ride?.fromWhistler === false ? -0.008 : 0.008), 0, 1);
  env.p2p.sampler.at(t2, _rideLook, _rideTan2);

  const sideX = -_rideTan.z;
  const sideZ = _rideTan.x;
  const sway = Math.sin(displayTime * 0.7) * 0.4;
  camera.position.set(
    _ridePos.x + sideX * (9.4 + sway),
    _ridePos.y + 3.1 + Math.sin(displayTime * 0.55) * 0.24,
    _ridePos.z + sideZ * (9.4 + sway),
  );
  camera.lookAt(_rideLook.x, _rideLook.y + 0.4, _rideLook.z);
  if (camera.fov !== 55) {
    camera.fov = 55;
    camera.updateProjectionMatrix();
  }
}

function updateRide(dt) {
  if (!ride) return;
  ride.t += dt;
  const p = smoothstep(0, 1, clamp(ride.t / ride.dur, 0, 1));
  placeRideCamera(p);
  if (ride.t >= ride.dur && !arriving) arriveFromRide();
}

async function arriveFromRide() {
  if (arriving) return;
  arriving = true;
  const fromWhistler = ride?.fromWhistler;
  ride = null;
  paused = true;
  audio.gondolaStop();
  ui.fade(true, true);
  await wait(420);

  const spec = fromWhistler ? P2P_RIDE.fromWhistler : P2P_RIDE.fromBlackcomb;
  const exitPose = { x: spec.exit.x, z: spec.exit.z, heading: spec.exit.heading };
  player.setRiding(false);
  player.model.visible = true;
  player.teleport(exitPose, { resetStats: true });
  player.snapCamera();
  resetRunState(false);
  ui.cinematic(false);
  ui.fade(false, true);
  ui.toast(
    fromWhistler ? 'BLACKCOMB' : 'WHISTLER',
    fromWhistler ? 'Rendezvous · 1,950 m · welcome to the dark side' : 'Whistler Peak · 2,182 m',
    'blue', 'lift',
  );
  arriving = false;
  paused = false;
  finished = false;
  lastFrame = performance.now();
}

/* ── scoring ────────────────────────────────────────────────── */

function comboMultiplier() {
  if (streak >= 30) return 4;
  if (streak >= 20) return 3;
  if (streak >= 12) return 2.5;
  if (streak >= 6) return 2;
  if (streak >= 3) return 1.5;
  return 1;
}

function onCoin(coin) {
  streak += 1;
  comboTimer = COMBO_TIME;
  multiplier = comboMultiplier();
  const value = Math.round((coin.value || 10) * multiplier);
  coinScore += value;
  audio.coin(streak);
  ui.floaty(`+${value}`, { x: 51 + (Math.random() - 0.5) * 8, y: 46 });
  if (streak === 3 || streak % 5 === 0) {
    ui.toast(`${streak} COIN STREAK`, `×${multiplier} multiplier`, 'gold', 'coin');
  }
  if (coin.hidden && Math.random() < 0.35) {
    ui.toast('LOCAL LINE', 'Stash coins are worth more.', 'gold', 'stash');
  }
}

function onCrystal(crystal) {
  streak += 1;
  comboTimer = COMBO_TIME;
  multiplier = comboMultiplier();
  const gained = Math.round(900 * multiplier);
  crystalScore += gained;
  const secret = SECRETS[crystal.id];
  audio.crystal();
  ui.floaty('CRYSTAL FOUND', { big: true, cyan: true, y: 38 });
  ui.toast(
    secret?.crystal ? secret.crystal.toUpperCase() : crystal.name.toUpperCase(),
    secret?.name ? `${secret.name} · +${formatNumber(gained)}` : `Hidden crystal · +${formatNumber(gained)}`,
    'gold', 'crystal',
  );
  if (collectibles.crystalCount >= collectibles.totalCrystals) {
    setTimeout(() => {
      ui.toast('ALL FIVE CRYSTALS', 'You know this mountain better than the locals.', 'gold', 'star');
    }, 900);
  }
}

function onPlayerEvent(event) {
  if (!event) return;
  if (event.type === 'launch' || event.type === 'ollie') {
    if (event.type === 'launch') audio.launch();
  } else if (event.type === 'land') {
    const mult = comboMultiplier();
    const gained = Math.round((event.points || 0) * mult);
    trickScore += gained;
    audio.land(event.impact, event.points);
    if (event.airTime > 0.55) {
      const label = event.label || 'CLEAN AIR';
      ui.floaty(label, { big: true, x: 50, y: 40 });
      if (gained > 40) ui.floaty(`+${formatNumber(gained)}`, { x: 50, y: 47 });
      if (event.turns > 0 || event.flips > 0) {
        ui.toast(label, `${event.airTime.toFixed(1)}s AIR · +${formatNumber(gained)}`, 'gold', 'star');
        audio.tone(880, { dur: 0.18, type: 'triangle', gain: 0.02, when: 0.08 });
      }
    }
  } else if (event.type === 'crash') {
    streak = 0;
    comboTimer = 0;
    comboFraction = 0;
    multiplier = 1;
    audio.crash();
    ui.toast('WIPEOUT', titleCase(event.reason || 'impact'), '', 'crash');
  } else if (event.type === 'touchdown') {
    audio.land(event.impact, 0);
  }
}

function updateCombo(dt) {
  if (comboTimer > 0) {
    comboTimer = Math.max(0, comboTimer - dt);
    comboFraction = comboTimer / COMBO_TIME;
    if (comboTimer <= 0) {
      streak = 0;
      multiplier = 1;
      comboFraction = 0;
    }
  } else {
    comboFraction = 0;
    multiplier = 1;
  }
  score = Math.round(coinScore + trickScore + crystalScore);
}

function titleCase(text) {
  return String(text).replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ── interaction ────────────────────────────────────────────── */

function nearestBoard() {
  if (!env?.p2p?.boards) return null;
  const fromWhistler = player.pos.x >= 0;
  const board = fromWhistler ? env.p2p.boards.whistler : env.p2p.boards.blackcomb;
  const d = Math.hypot(player.pos.x - board.x, player.pos.z - board.z);
  return { board, distance: d, fromWhistler };
}

function updatePrompt() {
  if (!playing || paused || finished || ride || ridePending) {
    ui.hidePrompt();
    return;
  }
  const near = nearestBoard();
  if (near && near.distance < 145) {
    ui.prompt(
      'RIDE PEAK 2 PEAK',
      near.fromWhistler ? 'Whistler Peak  →  Blackcomb Mountain' : 'Blackcomb  →  Whistler Peak',
    );
  } else {
    ui.hidePrompt();
  }
}

function checkFinish(dt) {
  if (finishCooldown > 0) finishCooldown = Math.max(0, finishCooldown - dt);
  if (finished || finishCooldown > 0) return;
  for (const arch of env.finishArches || []) {
    if (Math.hypot(player.pos.x - arch.x, player.pos.z - arch.z) < 15) {
      finishRun();
      return;
    }
  }
  if (player.pos.z > 2070 && player.pos.y < 760) finishRun();
}

/* ── input ──────────────────────────────────────────────────── */

function bindKeys() {
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'ArrowDown') {
      event.preventDefault();
    }
    if (event.repeat) {
      keys[event.code] = true;
      return;
    }
    keys[event.code] = true;

    if (event.code === 'Enter' && !playing) {
      startGame(true);
      return;
    }

    if (event.code === 'Escape') {
      if (ride) { ride.t = ride.dur; return; }
      if (ui.isOpen('map')) { closeMap(); return; }
      if (ui.isOpen('guide')) { closeGuide(); return; }
      if (ui.isOpen('summary')) { keepExploring(); return; }
      if (ui.isOpen('pause')) { resumeGame(); return; }
      if (playing && !finished) pauseGame();
      return;
    }

    if (event.code === 'KeyM') {
      if (!playing) return;
      if (ui.isOpen('map')) closeMap();
      else if (ui.isOpen('pause')) openMap('pause');
      else if (ui.isOpen('summary')) openMap('summary');
      else openMap('game');
      return;
    }

    if (event.code === 'KeyE') {
      if (!playing || paused || finished || transitioning) return;
      tryP2P();
      return;
    }

    if (event.code === 'KeyR') {
      if (!playing || transitioning) return;
      if (ui.isOpen('summary')) rideAgain();
      else resetToSummit();
      return;
    }

    if (event.code === 'KeyC') {
      if (!playing || paused || finished) return;
      const label = player.cycleCamera();
      ui.setCameraLabel(label);
      audio.ui();
      return;
    }

    if (event.code === 'Space' && playing && !paused && !finished && !ride) {
      ollieQueued = true;
    }
  });

  window.addEventListener('keyup', (event) => {
    keys[event.code] = false;
  });

  window.addEventListener('blur', () => {
    keysBackupClear();
    if (playing && !paused && !finished && !ride) pauseGame();
  });
}

function keysBackupClear() {
  for (const key of Object.keys(keys)) keys[key] = false;
  ollieQueued = false;
}

function buildInput() {
  const grounded = player.grounded && !player.crash;
  input.steer = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  input.tuck = grounded && !!keys.KeyW;
  input.brake = grounded && !!keys.KeyS;
  input.flip = grounded ? 0 : ((keys.KeyW ? -1 : 0) + (keys.KeyS ? 1 : 0));
  input.grab = !!(keys.ShiftLeft || keys.ShiftRight);
  input.ollie = ollieQueued;
  input.air = !grounded;
  ollieQueued = false;
}

/* ── UI wiring ──────────────────────────────────────────────── */

function bindUI() {
  $('drop-in')?.addEventListener('click', () => startGame(false));
  $('express-start')?.addEventListener('click', () => startGame(true));
  $('how-to-btn')?.addEventListener('click', openGuide);
  $('guide-drop')?.addEventListener('click', () => {
    ui.hideModals();
    startGame(true);
  });

  $('map-open')?.addEventListener('click', () => openMap('game'));
  $('pause-map')?.addEventListener('click', () => openMap('pause'));
  $('summary-map')?.addEventListener('click', () => openMap('summary'));
  $('resume')?.addEventListener('click', resumeGame);
  $('pause-reset')?.addEventListener('click', resetToSummit);
  $('restart-session')?.addEventListener('click', () => restartSession(true));
  $('ride-again')?.addEventListener('click', rideAgain);
  $('keep-skiing')?.addEventListener('click', keepExploring);

  document.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.getAttribute('data-close');
      if (id === 'map-screen') closeMap();
      else if (id === 'pause-screen') resumeGame();
      else if (id === 'guide-screen') closeGuide();
      else ui.hideModals();
      audio.ui();
    });
  });

  $('audio-toggle-menu')?.addEventListener('click', toggleAudio);
  $('pause-audio')?.addEventListener('click', toggleAudio);

  $('pause-markers')?.addEventListener('click', () => {
    markersOn = !markersOn;
    env.setMarkersVisible(markersOn);
    ui.setMarkers(markersOn);
    audio.ui();
  });

  $('pause-camera')?.addEventListener('click', () => {
    if (!player) return;
    const label = player.cycleCamera();
    ui.setCameraLabel(label);
    audio.ui();
  });

  $('pause-quality')?.addEventListener('click', () => {
    qualityIndex = (qualityIndex + 1) % QUALITIES.length;
    applyQuality();
    audio.ui();
  });

  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && playing && !paused && !finished && !ride) pauseGame();
  });
}

async function toggleAudio() {
  try { await audio.init(); } catch { /* ignore */ }
  const on = audio.toggle();
  audioOn = on;
  ui.setAudio(on);
  if (on) audio.ui();
}

function applyQuality() {
  const q = QUALITIES[qualityIndex];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixel));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = q.shadows;
  if (lighting?.sun) {
    lighting.sun.castShadow = q.shadows;
    if (q.shadows && lighting.sun.shadow.mapSize.x !== q.size) {
      lighting.sun.shadow.map?.dispose();
      lighting.sun.shadow.map = null;
      lighting.sun.shadow.mapSize.set(q.size, q.size);
    }
  }
  ui.setQualityLabel(q.name);
  onResize();
}

function onResize() {
  if (!renderer || !camera) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

/* ── frame ──────────────────────────────────────────────────── */

function updateIntroCamera(dt, time) {
  introTime += dt;
  const a = 0.58 + Math.sin(time * 0.028) * 0.12;
  const radius = 2620;
  camera.position.set(
    Math.sin(a) * radius,
    2790 + Math.sin(time * 0.05) * 34,
    Math.cos(a) * radius + 1180,
  );
  camera.lookAt(introLook);
  if (camera.fov !== 54) {
    camera.fov = 54;
    camera.updateProjectionMatrix();
  }
}

function updateSun() {
  if (!lighting?.sun) return;
  const anchor = playing && player ? player.pos : new THREE.Vector3(200, 1450, 200);
  lighting.sun.position.copy(anchor).addScaledVector(SUN_DIR, 460);
  lighting.sun.target.position.copy(anchor);
  lighting.sun.target.updateMatrixWorld();
}

/* rAF stalls when the tab is not painting. Keep a slow timer fallback so
   the simulation and the loading sequence always make progress. */
let frameScheduled = false;
function scheduleFrame() {
  if (frameScheduled) return;
  frameScheduled = true;
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    frameScheduled = false;
    frame(performance.now());
  }, 160);
  requestAnimationFrame((t) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    frameScheduled = false;
    frame(t);
  });
}

function frame(now) {
  const raw = (now - lastFrame) / 1000;
  lastFrame = now;
  const dt = clamp(Number.isFinite(raw) ? raw : 0.016, 0.001, 0.05);
  displayTime = now / 1000;

  if (!playing) {
    updateIntroCamera(dt, displayTime);
    env?.update(dt, displayTime);
    sky?.update(dt, camera);
    ranges?.update?.(dt, camera);
    storm?.update(dt, camera.position);
    glitter?.update(dt, camera.position, displayTime);
    renderer.render(scene, camera);
    scheduleFrame();
    return;
  }

  if (!paused && !finished && !ride) {
    buildInput();
    player.update(dt, input, displayTime);
    collectibles.update(dt, displayTime, player, camera);
    elapsed += dt;
    updateCombo(dt);
    updatePrompt();
    checkFinish(dt);
  } else if (ride) {
    updateRide(dt);
    updateCombo(0);
  } else {
    ui.hidePrompt();
  }

  if (!paused) {
    fx.update(dt);
    storm.update(dt, player.pos);
    glitter.update(dt, player.pos, displayTime);
  }
  env.update(dt, displayTime);
  sky.update(dt, camera);
  ranges?.update?.(dt, camera);
  tracks.update(displayTime);
  updateSun();

  score = Math.round(coinScore + trickScore + crystalScore);
  multiplier = comboMultiplier();

  ui.update({
    player,
    elapsed,
    score,
    streak,
    comboFraction,
    multiplier,
    collectibles,
    time: displayTime,
    nearest: ui.findNearest(player, false, displayTime),
  });

  if (displayTime - lastMini > 0.12) {
    lastMini = displayTime;
    ui.drawMinimap(player, displayTime);
  }
  if (ui.isOpen('map') && displayTime - lastBigmap > 0.2) {
    lastBigmap = displayTime;
    ui.drawBigMap(player, displayTime);
  }

  audio.update(dt, {
    speed: player.speed,
    grounded: player.grounded,
    airborne: player.airborne,
    crash: player.crash,
    powder: player.powder,
    riding: !!ride,
    paused,
  });

  renderer.render(scene, camera);
  scheduleFrame();
}

boot().catch((err) => showFatal('The mountain failed to load. Check the console.', err));
