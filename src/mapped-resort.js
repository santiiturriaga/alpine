import { installTouchButtons } from './touch-controls.js';
import { rendererUnavailable } from './renderer-recovery.js';
import { updatePassGates } from './pass-gates.js';
import { updateChaseFoliage } from './chase-foliage.js';
import { setForestQuality } from './forest-lod.js';
import { loadingProgress } from './mountain-loading.js';
import { createMultiplayer } from './multiplayer.js';
import { createTravelTracker } from './skier-profile.js';
import { createSnowTraffic } from './snow-traffic.js';
import { bindSnowMotionBlur } from './snow-crystals.js';
import { createRiderShadow } from './rider-shadow.js';
import {
  graphicsProfiles, bindRealism, createRenderer, resizeViewport, renderMountainFrame,
  applyShadowResolution, groundShadowWindow, sunShadowRefreshDue, updateSunShadow,
} from './graphics.js';
import { createPerformanceCalibration } from './performance-calibration.js';
import { compactDevice } from './device-budget.js';
import * as THREE from 'three';
import { AudioEngine } from './audio.js';
import { createClimate, bindConditionsClock, CLIMATE_PRESETS } from './climate.js';
import { buildMappedSlopeFixtures } from './slope-fixtures.js';
import { Collectibles } from './coins.js';
import { buildForestLines } from './forest-lines.js';
import {
  createLighting, createSky, createWinterEnvironment, ParticleFX, SkiContact, SkiTracks,
  Snowstorm, SUN_DIR, TuckWind,
} from './effects.js';
import { buildMappedResortLifts } from './mapped-resort-lifts.js';
import { buildMappedResortPeople } from './mapped-resort-people.js';
import { buildMappedResortWorld } from './mapped-resort-world.js';
import { STEVENS_OVERPASS_START } from './stevens-pass-crossing.js';
import { applyInternationalLandmarkSites } from './international-landmark-sites.js';
import { Outfitter } from './outfitter.js';
import { Expeditions } from './expeditions.js';
import { Player } from './player.js';
import { createTrickHud } from './trick-hud.js';
import { UI } from './ui.js';
import { createMountainMenu, initFieldGuide } from './mountain-menu.js';
import { mappedAtlasSettings } from './resort-map.js';
import { clamp, formatNumber } from './util.js';
import { initWorldData, runPointAt } from './worlddata.js';

const $ = (id) => document.getElementById(id);
const paint = () => new Promise((resolve) => setTimeout(resolve, 0));
const turnKeys = ['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'ArrowUp', 'ArrowDown'];
const moveKeys = new Set([...turnKeys, 'Space', 'ShiftLeft', 'ShiftRight']);
const slopeLabels = { green: 'Green', blue: 'Blue', red: 'Red', black: 'Black', double: 'Double black' };
const rideViewNames = { forward: 'Valley view', valley: 'Chase view', chase: 'Forward view' };
const label = (selector, value) => {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
};

function prepareRuns(runs) {
  const mappedRuns = runs.filter(({ points }) => points?.length > 1).map((run) => ({
    ...run, named: !!run.name && !run.connector, width: run.width ?? (run.connector ? 10 : 24),
  }));
  initWorldData(mappedRuns);
  return mappedRuns;
}

function trailPose(run, ground, env) {
  const points = run.samples;
  const first = points[0], last = points.at(-1);
  const direction = ground.heightAt(first.x, first.z) >= ground.heightAt(last.x, last.z) ? 1 : -1;
  const index = direction === 1 ? 0 : points.length - 1;
  const take = (offset) => points[clamp(index + direction * offset, 0, points.length - 1)];
  let fallback;
  for (let i = 0; i < Math.min(7, points.length - 2); i++) {
    const start = take(i), ahead = take(i + 2);
    const pose = { ...start, heading: Math.atan2(ahead.x - start.x, ahead.z - start.z), holdAtUnload: true };
    const y = ground.heightAt(start.x, start.z);
    if (env.isOpen && !env.isOpen(start.x, y, start.z, 1.3)) continue;
    fallback ??= pose;
    if (ground.heightAt(ahead.x, ahead.z) < y - .45) return pose;
  }
  return fallback ?? { ...take(1), heading: Math.atan2(take(3).x - take(1).x, take(3).z - take(1).z), holdAtUnload: true };
}

function registerLiftColliders(env, liftSystem) {
  for (const { x, z, r, radius, hw, hd, rot, type, ...extra } of liftSystem.colliders) {
    if (r || radius) env.addCircle(x, z, r ?? radius, type, extra);
    else if (hw && hd) env.addBox(x, z, hw, hd, rot ?? 0, type, extra);
  }
}

function crystalLocations(resortId, runs, ground, env) {
  const sections = new Map();
  for (const run of runs) {
    if (!run.named || run.length < 220 || (!run.gladed && !['black', 'double'].includes(run.difficulty))) continue;
    const section = run.section ?? '';
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section).push(run);
  }
  for (const localRuns of sections.values()) localRuns.sort((a, b) =>
    Number(!!b.gladed) - Number(!!a.gladed) || b.length - a.length);
  const crystals = [], used = new Set();
  for (const position of [0, 1]) {
    for (const localRuns of sections.values()) {
      const candidate = localRuns.slice(position).find((run) => !used.has(run.name));
      if (!candidate || crystals.length >= 4) continue;
      const t = [.52, .63, .43, .72].find((fraction) => {
        const { x, z, nx, nz } = runPointAt(candidate, fraction);
        const offsetX = x + .5 * nx, offsetZ = z + .5 * nz;
        const y = ground.heightAt(offsetX, offsetZ);
        return !env.isOpen || env.isOpen(offsetX, y, offsetZ, 2);
      });
      if (t === undefined) continue;
      used.add(candidate.name);
      crystals.push({ id: crystals.length, findId: `${resortId}:crystal:${candidate.id}`,
        run: candidate.id, name: `${candidate.name} crystal`, section: candidate.section, t });
    }
  }
  return crystals;
}

function prepareTitle(mountain, config, startName, base, baseHeight, vertical, liftCount) {
  const name = mountain.label;
  const terrainOnly = config.terrainOnly;
  label('.brand-lockup strong', name.toUpperCase());
  label('.brand-lockup small', (config.region ?? mountain.region ?? '').toUpperCase());
  const sections = [...new Set(config.runs.map(({ section }) => section).filter(Boolean))];
  label('.hero-copy > .kicker', (sections.length > 1 ? sections.join(' · ') : name).toUpperCase());
  label('.hero-sub', terrainOnly ? `Explore ${name} on measured terrain. Start on foot or choose a viewpoint on the map.` :
    `Ski the mapped runs of ${name} and ride its lifts.`);
  label('#drop-in .btn-label', terrainOnly ? 'Explore the mountain' : startName ? `Ski ${startName}` : 'Start skiing');
  label('.hero-meta > :last-child strong', `${formatNumber(vertical)} m`);
  label('.hero-meta > :last-child span', terrainOnly ? 'MAPPED SUMMIT ELEVATION' : 'LIFT-SERVED VERTICAL');
  label('.start-card .mini-kicker', terrainOnly ? 'EXPEDITION START' : `${name.toUpperCase()} BASE`);
  label('.start-card .elevation strong', formatNumber(baseHeight));
  label('.start-card-head p', base?.def.name ?? startName ?? 'Mountain approach');
  label('.village-copy', terrainOnly ? 'Set out in boots and open Mountain for the nearby viewpoints.' :
    liftCount > 1 ? 'Board here or find another lift or trail under Mountain.' : 'Board here to ride up the mountain.');
  label('#village-start span', terrainOnly ? 'Start on foot' : 'Start at the base');
  document.querySelector('.hero-tags').classList.add('hidden');
  $('pause-reset').firstChild.textContent = terrainOnly ? 'Return to camp ' : 'Return to trailhead ';
  if (startName) $('pause-reset').title = startName;
}

function prepareExploration(sections, travel) {
  const parent = $('mountain-destinations');
  const field = document.createElement('fieldset');
  field.className = 'arrivals';
  const legend = document.createElement('legend');
  legend.textContent = 'Travel on this mountain';
  field.append(legend);
  for (const [name, options] of sections) {
    if (!options.length) continue;
    const row = document.createElement('div');
    row.className = 'resort-switch';
    const label = document.createElement('label');
    label.textContent = name;
    const select = document.createElement('select');
    select.add(new Option('Choose a destination', '', true, true));
    select.options[0].disabled = true;
    const groups = new Map();
    for (const item of options) {
      const section = item.section ?? '';
      if (!groups.has(section)) {
        const group = section ? document.createElement('optgroup') : select;
        if (section) {
          group.label = section;
          select.append(group);
        }
        groups.set(section, group);
      }
      groups.get(section).append(new Option(item.label, item.id));
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Go';
    button.setAttribute('aria-label', name === 'Quick travel' ? 'Go to selected destination' : `Go to selected ${name.toLowerCase()}`);
    button.disabled = true;
    select.addEventListener('change', () => { button.disabled = !select.value; });
    button.addEventListener('click', () => travel(select.value));
    label.append(select);
    row.append(label, button);
    field.append(row);
  }
  parent.replaceChildren(field);
}

export async function startMappedResort(mountain) {
  $('app').classList.add('mapped-resort');
  document.title = `Alpine Descent · ${mountain.label}`;
  document.querySelector('meta[name="description"]')?.setAttribute('content',
    `Ski real trail routes and ride mapped lifts at ${mountain.label}.`);
  label('.loading-copy .kicker', mountain.label);
  label('#load-tip', 'Press G to choose a lift or trail, or M to open the resort map.');
  loadingProgress(.12, `Loading ${mountain.label} terrain…`);
  await paint();
  const dataUrl = new URL(mountain.data, document.baseURI);
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error(`Could not load ${mountain.label} resort data (HTTP ${response.status}).`);
  const config = await response.json();
  applyInternationalLandmarkSites(config);
  const query = new URLSearchParams(location.search);
  const host = $('webgl');
  const performanceCalibration = createPerformanceCalibration({ query, resort: mountain.id,
    profiles: graphicsProfiles, viewport: host, compact: compactDevice });
  let qualityIndex = performanceCalibration.quality;
  const initialQuality = graphicsProfiles[qualityIndex].name;
  setForestQuality(initialQuality);
  const runs = prepareRuns(config.runs);
  const renderer = createRenderer({ antialias: performanceCalibration.antialias });
  const canvas = renderer.domElement;
  host.append(canvas);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbdd0e1);
  scene.fog = new THREE.FogExp2(0xbdd0e1, .00005);
  scene.environment = createWinterEnvironment(renderer);
  const lighting = createLighting(scene);
  const sky = createSky(scene);
  const snowTraffic = createSnowTraffic();
  const storm = new Snowstorm(scene);
  const tuckWind = new TuckWind($('app'));
  const ui = new UI({ runs, lifts: config.lifts.map((def) => ({ ...def, rideable: def.rideable !== false })) });
  const camera = new THREE.PerspectiveCamera(58, 1, .23, config.viewDistance ?? 19000);
  ui.setLoading(.34, 'Building the mountain and forest…');
  await paint();
  const world = await buildMappedResortWorld(scene, config, new URL('./', dataUrl), { quality: initialQuality });
  const { ground: baseGround, env } = world;
  ui.setLoading(.72, 'Stringing the lifts…');
  await paint();
  const liftSystem = await buildMappedResortLifts(scene, config, baseGround, env, { quality: initialQuality });
  registerLiftColliders(env, liftSystem);
  const forestLines = buildForestLines(world.root, baseGround, env, runs);
  env.forestLines = forestLines;
  const { ground } = forestLines;
  const people = buildMappedResortPeople(world.root, { config, world, liftSystem });
  env.people = people;
  const lifts = liftSystem.lifts;
  ui.configureMap(scene, mappedAtlasSettings({ mountain, config, runs, ground, lifts }),
    (x, y, z) => env.isOpen(x, y, z, .65));
  const base = lifts.find(({ def }) => def.id === config.startLift) ?? lifts[0];
  const beginner = lifts.find(({ def }) => def.id === config.beginnerLift);
  const defaultPose = ground.startPose();
  const startName = defaultPose.runName ?? runs.find(({ id }) => id === config.startRun)?.name;
  const basePose = base?.boardPose ?? defaultPose;
  const peak = config.landmarks?.find(spot => spot.kind === 'peak');
  const baseHeight = ground.heightAt(basePose.x, basePose.z);
  const liftHeights = lifts.flatMap(({ boardPose, exitPose }) => [
    ground.heightAt(boardPose.x, boardPose.z), ground.heightAt(exitPose.x, exitPose.z),
  ]);
  const vertical = config.terrainOnly ? Math.round(peak?.elevation ?? baseHeight) :
    config.verticalMeters ?? Math.round(Math.max(...liftHeights) - Math.min(...liftHeights));
  prepareTitle(mountain, config, startName, base, baseHeight, vertical, lifts.length);
  initFieldGuide({ resortName: mountain.label, startName, terrainOnly: config.terrainOnly });
  if (config.terrainOnly) document.querySelector('.trail-key').hidden = true;

  const tracks = new SkiTracks(scene, 8000, ground);
  const contact = new SkiContact(scene, ground);
  const fx = new ParticleFX(scene, (x, z) => ground.heightAt(x, z), ground);
  const audio = new AudioEngine();
  const slopeFixtures = buildMappedSlopeFixtures(world.root, config, ground, env);
  const climate = createClimate({ scene, renderer, lighting, sky, storm, terrain: ground, slopeFixtures });
  const player = new Player(scene, camera, { ground, env, fx, tracks, audio });
  const updateTrickHud = createTrickHud($('trick-combo'), $('trick-announcement'));
  const travelTracker = createTravelTracker({ resortId: mountain.id, resortName: mountain.label, mountainAt: () => mountain.label });
  const mountainPanel = $('mountain-panel');
  const outfitter = new Outfitter(player, () => outfitter.dialog.close(), renderer);
  const riderShadow = createRiderShadow(renderer,lighting,player);
  outfitter.dialog.addEventListener('outfitterchange', riderShadow.equipmentChanged);
  const multiplayer = createMultiplayer(scene,mountain.id,()=>player);
  let trickScore = 0;
  const crystalSpecs = crystalLocations(mountain.id, runs, ground, env);
  const collectibles = new Collectibles(scene, fx, {
    runs, crystals: crystalSpecs, heightAt: ground.heightAt, coinStep: 10, forestCoins: forestLines.coins,
  });
  ui.collectibles = collectibles;
  outfitter.findsLabel = 'Mountain finds';
  $('coin-count').parentElement.classList.toggle('hidden', !collectibles.totalCoins);
  $('crystal-count').parentElement.classList.toggle('hidden', !collectibles.totalCrystals);
  outfitter.catalog = collectibles.crystals.map((crystal) => {
    const run = runs.find(({ id }) => id === crystal.run);
    return { id: crystal.findId, title: crystal.name, hint: `Look for a crystal on ${run.name}.` };
  });
  collectibles.onCoin = (coin) => {
    outfitter.credit(coin.hidden ? 2 : 1);
    audio.coin();
  };
  collectibles.onCrystal = (crystal) => {
    const rewarded = outfitter.find(crystal.findId, 12);
    audio.crystal();
    ui.toast(crystal.name, rewarded ? 'Added to mountain finds · 12 coins' : 'Added to mountain finds', 'gold', 'crystal');
  };
  restoreCrystals();
  const keys = Object.create(null);
  let touchControls;
  const heldAtTakeoff = new Set();
  const input = {};
  const lastShadowAnchor = new THREE.Vector3(Infinity, Infinity, Infinity);
  const menuCenter = new THREE.Vector3();
  let playing = false;
  let panelReturn = null;
  let lastFrame = performance.now();
  let benchmarkReady = false;
  let present = 0, simTime = 0, lastHud = -Infinity, lastShadow = -Infinity;
  let selectedLift = null, stationLabel = '', stationPose = null;
  let ollie = false, signs = true, drag = null;
  let wasPaused = false;
  let openingBlueHour = config.id === 'les-3-vallees' && !['time','hour','start'].some(key => query.has(key));

  const conditions = { hour: query.has('hour') ? Number(query.get('hour')) : 10.5 };
  for (const [key, id, presets, fallback] of [
    ['season', 'select-season', CLIMATE_PRESETS.seasons, 'winter'],
    ['weather', 'select-weather', CLIMATE_PRESETS.weather, 'clear'],
    ['time', 'select-light', CLIMATE_PRESETS.times, 'cycle'],
    ['traffic', 'select-traffic', CLIMATE_PRESETS.traffic, 'scheduled'],
  ]) {
    const select = $(id);
    select.setAttribute('aria-label', select.parentElement.firstChild.textContent.trim());
    select.replaceChildren(...Object.entries(presets).map(([value, { label: title }]) => new Option(title, value)));
    const requested = query.get(key);
    select.value = conditions[key] = Object.hasOwn(presets, requested) ? requested : fallback;
    select.addEventListener('change', () => {
      if (key === 'time') openingBlueHour = false;
      climate.set({ [key]: select.value });
    });
  }
  climate.set(openingBlueHour ? { ...conditions, time: 'blue-hour' } : conditions, { instant: true });
  const updateConditionsClock = bindConditionsClock(climate, $('resort-clock'));

  const arrivals = new Map();
  const summerRoutePoses = (config.summerRoutes ?? []).filter(({ points }) => points?.length > 1).map(route => {
    const points = route.points;
    const start = points.findIndex(([x,z], i) => i < points.length - 1 && env.isOpen(x,ground.heightAt(x,z),z,1.0));
    const index = Math.max(0,start);
    const [x,z] = points[index], [tx,tz] = points[Math.min(index+2,points.length-1)];
    return { ...route, pose:{x,z,heading:Math.atan2(tx-x,tz-z),holdAtUnload:true} };
  });
  const bikeRoutes = summerRoutePoses.filter(({ kind }) => kind === 'bike');
  if (!config.terrainOnly && !config.summerRoutes) bikeRoutes.push({ id:'bike',name:'Mountain bike',pose:defaultPose });
  for (const route of bikeRoutes) route.destination = route.id === 'bike' ? 'bike' : `bike:${route.id}`;
  const expeditions = new Expeditions(scene,null,{
    ground,env,fx,winterVehicles:false,season:() => climate.state.season,
    bikes:bikeRoutes.map(({destination,pose}) => ({id:destination,pose})),
  });
  const summerBikeChoices = bikeRoutes.map(({destination,name,section,difficulty}) => ({
    id:destination,label:[name,slopeLabels[difficulty]].filter(Boolean).join(' · '),section,
  }));
  for (const {id,label} of summerBikeChoices) {
    arrivals.set(id,{name:label,bike:true,summer:true,footMode:true});
  }
  const summerHikeChoices = summerRoutePoses.filter(({ kind }) => kind === 'hike').map(({ id,name,pose,section }) => {
    const destination = `hike:${id}`;
    arrivals.set(destination,{pose,name,summer:true,footMode:true});
    return {id:destination,label:name,section};
  });
  const travelLifts = [];
  for (const lift of lifts) {
    const section = lift.def.section ?? ui.findNearest({ pos: lift.boardPose }, true)?.run.section;
    travelLifts.push({ id: lift.def.id, name: lift.def.name, section, visitOnly: !lift.def.rideable });
    for (const [end, footMode, pose] of [['base', true, lift.boardPose], ['top', false, lift.exitPose]]) {
      const id = `${end}:${lift.def.id}`;
      const name = `${lift.def.name} · ${footMode ? 'base' : 'top'}`;
      arrivals.set(id, { pose: { ...pose, holdAtUnload: !footMode }, name, footMode: footMode || !!pose.footMode });
    }
  }
  ui.nearest = null;
  const runChoices = [];
  const runNameCounts = new Map();
  for (const { name } of runs) runNameCounts.set(name, (runNameCounts.get(name) ?? 0) + 1);
  for (const run of runs) {
    if (!run.named) continue;
    const id = `run:${run.id}`;
    const pose = trailPose(run, ground, env);
    arrivals.set(id, { pose, name: run.name });
    const elevation = runNameCounts.get(run.name) > 1 ? `${formatNumber(ground.heightAt(pose.x, pose.z))} m` : '';
    runChoices.push({
      id, label: [run.name, slopeLabels[run.difficulty], elevation].filter(Boolean).join(' · '), section: run.section,
    });
  }
  runChoices.sort((a, b) => a.label.localeCompare(b.label));
  const start = { pose: defaultPose, name: startName, footMode: config.terrainOnly };
  arrivals.set('base', base ? arrivals.get(`base:${base.def.id}`) : start);
  arrivals.set('default', start);
  const quickChoices = config.terrainOnly ? [{ id: 'default', label: startName ?? 'Mountain approach' }]
    : [{ id: 'base', label: `${mountain.label} base` }, { id: 'default', label: startName ?? 'Default ski start' }];
  for (const spot of config.landmarks ?? []) {
    if (!spot.point || (!config.terrainOnly && !spot.view)) continue;
    const [x,z] = spot.point;
    const id = `view:${spot.id}`;
    const heading = Math.atan2(x-defaultPose.x,z-defaultPose.z);
    arrivals.set(id, { name: spot.name, pose: spot.view ?? { x, z, heading }, footMode: true });
    quickChoices.push({ id, label: spot.name });
  }
  if (config.id === 'stevens-pass') {
    arrivals.set('stevens-overpass', { name: 'US 2 Pedestrian Bridge', pose: STEVENS_OVERPASS_START, footMode: true });
    quickChoices.push({ id: 'stevens-overpass', label: 'US 2 Pedestrian Bridge' });
    for (const [id, name, x, z, heading] of [
      ['clock-tower', 'Basecamp · Clock Tower', 169.4, -20.6, 2.12],
      ['west-parking', 'West Parking · Lift View', -152, -39, 1.18],
      ['gemini-traverse', 'Gemini · Transmission Crossing', 704.1, 1835.1, 1.58],
      ['mill-valley-pylon', 'Mill Valley · Transmission Tower', 961.5, 1748.0, 2.62],
    ]) {
      arrivals.set(id, { pose: { x, z, heading, holdAtUnload: true }, name,
        footMode: id === 'clock-tower' || id === 'west-parking' });
      quickChoices.push({ id, label: name });
    }
  }
  if (beginner && config.beginnerRun) {
    const pose = ground.beginnerPose?.();
    const arrival = pose ? { pose, name: pose.runName ?? beginner.def.name } : arrivals.get(`run:${config.beginnerRun}`);
    if (arrival) {
      arrivals.set('beginner', arrival);
      quickChoices.push({ id: 'beginner', label: `${arrival.name} · beginner start` });
    }
  }
  const preferredBike = bikeRoutes.find(({ id }) => id === config.startBikeRun) ?? bikeRoutes[0];
  if (preferredBike && preferredBike.destination !== 'bike') arrivals.set('bike', {
    ...arrivals.get(preferredBike.destination), destination:preferredBike.destination,
  });
  const choices = [['Quick travel', quickChoices], ['Ski trail', runChoices]];
  if (summerBikeChoices.length) choices.push(['Bike trail', summerBikeChoices]);
  if (summerHikeChoices.length) choices.push(['Summer hike', summerHikeChoices]);
  prepareExploration(choices, travel);
  const showMountainMenu = createMountainMenu({
    resortName: mountain.label,
    lifts: travelLifts,
    travel(id, end) {
      if (!travel(`${end}:${id}`)) return;
      const canBoard = end === 'base' && !travelLifts.find((lift) => lift.id === id).visitOnly;
      if (canBoard) selectedLift = id;
      updatePrompt();
      ui.toast(stationLabel, canBoard ? 'Use the lift prompt to board.' : 'Arrived at the lift station.', 'blue', 'lift');
    },
  });
  const courses = $('mountain-challenges').querySelector('.course-links');
  const sledButton = courses.querySelector('[data-minigame="sled"]');
  courses.replaceChildren(sledButton);
  sledButton.onclick = async () => {
    releaseLook();
    const { openSledGame } = await import('./sled-game.js');
    openSledGame({ resortRenderer: renderer, audio, outfit: outfitter.appearance });
  };

  function resize() {
    const quality = graphicsProfiles[qualityIndex];
    resizeViewport({ host, renderer, camera, quality, storm, tuckWind, resolution: performanceCalibration.resolution,
      resolutionScale: performanceCalibration.resolutionScale });
    performanceCalibration.viewportChanged();
  }

  function applyQuality() {
    const quality = graphicsProfiles[qualityIndex];
    applyShadowResolution(renderer, lighting.sun, quality.shadow);
    setForestQuality(quality.name);
    world.setQuality?.(quality.name);
    liftSystem.setQuality?.(quality.name);
    sky.setQuality?.(quality.name);
    resize();
  }

  function clearInput() {
    touchControls?.releaseAll();
    for (const code of Object.keys(keys)) keys[code] = false;
    heldAtTakeoff.clear();
    ollie = false;
    drag = null;
  }

  function releaseLook() {
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    drag = null;
  }

  const modal = () => ['map', 'guide', 'pause'].find((name) => ui.isOpen(name));
  const paused = () => !!(modal() || mountainPanel.open || outfitter.dialog.open || outfitter.customizing);
  const readyToLook = () => playing && !paused();
  const readyToMove = () => readyToLook() && !liftSystem.active && !expeditions.active;

  function showModal(name, focusTarget) {
    releaseLook();
    clearInput();
    if (name) ui.showModal(name, focusTarget);
    else {
      ui.hideModals();
      if (!playing) $('drop-in').focus({ preventScroll: true });
    }
  }

  function openPanel(name) {
    panelReturn = modal() ?? null;
    showModal(name);
    if (name === 'guide') $('guide-drop').querySelector('.btn-label').textContent =
      playing ? 'Back to pause menu' : config.terrainOnly ? 'Explore the mountain' : 'Drop in';
    if (name === 'map') {
      ui.resortMap.setSeason(climate.state.season);
      ui.drawBigMap(playing ? player : null, simTime);
    }
  }

  function closePanel() {
    const current = modal();
    const focusTarget = panelReturn === 'pause' ? $(`pause-${current}`) : undefined;
    showModal(panelReturn, focusTarget);
    if (current === 'guide' && !playing) $('how-to-btn').focus({ preventScroll: true });
    panelReturn = null;
  }

  function openMountain(section = 'travel') {
    updateConditionsClock();
    if (mountainPanel.open || outfitter.dialog.open || outfitter.customizing) return;
    releaseLook();
    clearInput();
    showMountainMenu(section);
  }

  function activateAudio() { audio.resume().catch(() => {}); }

  function restoreCrystals() {
    const found = new Set(outfitter.state.finds);
    collectibles.crystalCount = 0;
    for (const crystal of collectibles.crystals) {
      crystal.collected = found.has(crystal.findId);
      crystal.group.visible = !crystal.collected;
      if (crystal.collected) collectibles.crystalCount++;
    }
  }

  function restartSession() {
    trickScore = 0;
    tracks.clear();
    fx.clear();
    collectibles.reset();
    restoreCrystals();
    travel('default');
  }

  function travel(id, initializeAudio = true) {
    const arrival = arrivals.get(id);
    if (!arrival) return false;
    if (openingBlueHour) {
      openingBlueHour = false;
      climate.set({ time: conditions.time }, { instant: true });
    }
    if (initializeAudio) activateAudio();
    if (mountainPanel.open) mountainPanel.close();
    if (outfitter.dialog.open || outfitter.customizing) outfitter.close();
    if (liftSystem.active) {
      liftSystem.cancel(player);
      audio.gondolaStop();
    }
    if (expeditions.active) expeditions.leave(player,true);
    if (arrival.summer) climate.set({season:'summer',weather:'clear'},{instant:true});
    const pose = arrival.bike ? expeditions.arrival(arrival.destination ?? id,true) : arrival.pose;
    playing = true;
    panelReturn = null;
    showModal(null);
    document.activeElement?.blur();
    ui.showStart(false);
    ui.setHud(true);
    ui.cinematic(false);
    ui.clearToasts();
    player.footMode = !!arrival.footMode || climate.state.season === 'summer';
    travelTracker.reset();
    player.teleport(pose, { resetStats: true });
    stationLabel = arrival.name ?? '';
    stationPose = pose;
    selectedLift = null;
    lastHud = -Infinity;
    syncHud();
    return true;
  }

  function updatePrompt() {
    if (expeditions.active) {
      ui.prompt(expeditions.active.label,expeditions.controls(),false);
      return [];
    }
    if (!readyToMove() || player.speed > 4 || !player.grounded || player.crash) {
      ui.hidePrompt();
      return [];
    }
    const choices = liftSystem.nearby(player.pos);
    const bike = expeditions.nearest(player.pos);
    if (bike && player.speed < 3) { ui.prompt(bike.label,'Mount bike · W pedal · S brake',false); return []; }
    const choice = choices.find(({ lift }) => lift.def.id === selectedLift)
      ?? choices.find(({ lift }) => lift.def.id === ui.routeGuide.nextLift) ?? choices[0];
    selectedLift = choice?.lift.def.id ?? null;
    if (choice) ui.prompt(choice.lift.def.name, 'Board lift · ' + Math.round(choice.distance) + ' m', choices.length > 1);
    else ui.hidePrompt();
    return choices;
  }

  function nextLift() {
    const choices = updatePrompt();
    if (choices.length < 2) return;
    const index = choices.findIndex(({ lift }) => lift.def.id === selectedLift);
    selectedLift = choices[(index + 1) % choices.length].lift.def.id;
    updatePrompt();
  }

  function finishRide(ride) {
    if (!ride) return;
    clearInput();
    audio.gondolaStop();
    stationLabel = `${ride.lift.def.name} · top`;
    stationPose = ride.lift.exitPose;
    if (climate.state.season === 'summer') player.setFootMode(true);
    ui.cinematic(false);
    const touch = matchMedia('(pointer:coarse)').matches;
    ui.toast(stationLabel, touch ? 'Hold ↑ to ski · Tap the mountain for trail starts' : 'W to ski · G to choose a trail', 'blue', 'lift');
    syncHud();
  }

  function interact() {
    if (!playing || paused()) return;
    if (liftSystem.active) {
      finishRide(liftSystem.exit(player));
      return;
    }
    if (expeditions.active) {
      expeditions.leave(player);
      updatePrompt();
      return;
    }
    const bike = !player.crash && player.grounded && player.speed < 3 && expeditions.nearest(player.pos);
    if (bike) {
      activateAudio();
      expeditions.board(bike,player);
      updatePrompt();
      return;
    }
    const choice = updatePrompt().find(({ lift }) => lift.def.id === selectedLift);
    if (!choice) return;
    activateAudio();
    releaseLook();
    clearInput();
    const ride = liftSystem.board(choice, player, camera);
    if (!ride) return;
    audio.gondolaStart();
    ui.hidePrompt();
    const title = ride.lift.def.name;
    const { x, z, footMode } = ride.lift.exitPose;
    const summitHeight = (footMode ? env.walkSurfaceAt?.(x, z) : null) ?? ground.heightAt(x, z);
    const summit = `${formatNumber(summitHeight)} m`;
    const terminal = ride.destination && ride.destination !== title ? ride.destination : 'Upper terminal';
    ui.cinematic(true, { title, sub: `${terminal} · ${summit}` });
    syncRide(ride);
  }

  function syncRide(ride) {
    if (rideViewNames[ride.view]) ui.setText(ui.el.rideView, 'rideView', rideViewNames[ride.view]);
    ui.updateRide(ride.progress, ride.lift.length * (1 - ride.progress), ride.duration - ride.elapsed);
  }

  function cycleCamera() {
    if (!playing || (paused() && !ui.isOpen('pause'))) return;
    if (liftSystem.active) {
      liftSystem.changeView();
      syncRide(liftSystem.active);
    } else if (expeditions.active) expeditions.changeView();
    else ui.setCameraLabel(player.cycleCamera());
    audio.ui();
  }

  function toggleFoot() {
    if (!readyToMove()) return;
    if (!player.canChangeFootMode()) {
      ui.toast('Slow down to change gear','Come to a stop on the ground to change equipment.','','check');
      return;
    }
    if (player.footMode && player.surfaceType === 'ground') {
      ui.toast('On foot','Reach a snow-covered trail to ride again.','','check');
      return;
    }
    player.toggleFootMode();
    syncHud();
  }

  function syncHud() {
    const nearest = ui.findNearest(player, true, simTime);
    const distanceFromStation = stationPose ? Math.hypot(player.pos.x - stationPose.x, player.pos.z - stationPose.z) : Infinity;
    const trailName = distanceFromStation < 18 ? stationLabel : nearest?.run.name ?? '';
    const mountainName = [mountain.label, nearest?.run.section].filter(Boolean).join(' · ').toUpperCase();
    ui.update({ player, nearest, time: simTime, mountainName, trailName });
    updatePrompt();
  }

  function queueJump() { if (readyToMove()) ollie = true; }

  function buildInput() {
    const grounded = player.grounded && !player.crash;
    const active = (code) => keys[code] && (grounded || !heldAtTakeoff.has(code));
    const up = keys.KeyW || keys.ArrowUp, down = keys.KeyS || keys.ArrowDown;
    const shift = !!(keys.ShiftLeft || keys.ShiftRight);
    input.steer = Number(!!(active('KeyD') || active('ArrowRight'))) - Number(!!(active('KeyA') || active('ArrowLeft')));
    input.walkForward = player.footMode ? Number(!!up) - Number(!!down) : 0;
    input.walkRun = player.footMode && shift;
    input.tuck = grounded && !player.footMode && !!up;
    input.brake = grounded && !player.footMode && !!down;
    input.flip = grounded ? 0 : Number(!!(active('KeyS') || active('ArrowDown'))) - Number(!!(active('KeyW') || active('ArrowUp')));
    input.grab = shift;
    input.ollie = !player.footMode && ollie;
    input.air = !grounded;
    ollie = false;
  }

  function animateMenu(time) {
    if (config.id === 'les-3-vallees') {
      const sway = Math.sin(time * .11);
      camera.position.set(-2988 + sway*91, 1758 + sway*19, -7674 + sway*83);
      menuCenter.set(-1960, 1548, -6982);
      camera.lookAt(menuCenter);
      return;
    }
    if (config.terrainOnly) {
      const { x, z, heading } = defaultPose;
      const yaw = heading + .18 + Math.sin(time*.11)*.13;
      camera.position.set(x - Math.sin(yaw)*48, baseHeight+17, z - Math.cos(yaw)*48);
      menuCenter.set(x + Math.sin(heading)*135, baseHeight+41, z + Math.cos(heading)*135);
      camera.lookAt(menuCenter);
      return;
    }
    const [peakX,peakZ] = peak?.point ?? [defaultPose.x, defaultPose.z + 300];
    const end = base?.exitPose ?? { x: peakX, z: peakZ };
    const { x, z } = basePose;
    const heading = Math.atan2(end.x - x, end.z - z);
    const yaw = heading - .36 + Math.sin(time * .09) * .065;
    const offset = 220 + Math.sin(time * .11) * 20;
    camera.position.set(x - Math.sin(yaw) * offset, baseHeight + 136, z - Math.cos(yaw) * offset);
    menuCenter.set(x + Math.sin(heading + .15) * 410, baseHeight + 204, z + Math.cos(heading + .15) * 410);
    camera.lookAt(menuCenter);
  }

  const shadowGroundAnchor = new THREE.Vector3();
  function updateShadow() {
    if (!lighting.sun.castShadow) return;
    if (!paused()) riderShadow.update(playing, SUN_DIR);
    const helicopter = expeditions.active?.id === 'helicopter';
    const airborne = liftSystem.active || helicopter || player.airborne;
    if (playing && airborne) groundShadowWindow(shadowGroundAnchor, player.pos, ground.heightAt(player.pos.x, player.pos.z));
    const radius = helicopter ? 185 : liftSystem.active ? 132 : 73;
    const anchor = playing ? airborne ? shadowGroundAnchor : player.pos : menuCenter;
    const { name, shadowInterval } = graphicsProfiles[qualityIndex];
    if (!renderer.shadowMap.needsUpdate && lighting.sun.shadow.camera.right === radius &&
        !sunShadowRefreshDue(present - lastShadow, anchor.distanceToSquared(lastShadowAnchor), shadowInterval, name === 'BUDGET')) return;
    lastShadow = present;
    lastShadowAnchor.copy(anchor);
    updateSunShadow(renderer, lighting.sun, SUN_DIR, anchor, radius);
    world.forest.updateShadows(renderer, lighting.sun);
  }

  function draw(now) {
    if (rendererUnavailable) return;
    const raw = Math.max(0, (now - lastFrame) / 1000);
    if (document.hidden) { performanceCalibration.interrupt(); return; }
    if (ui.isOpen('map') || outfitter.customizing || document.getElementById('destination-selector')?.open || document.getElementById('sled-game')?.open) {
      performanceCalibration.interrupt();
      updateTrickHud(player, camera, false);
      if(playing)multiplayer.update(0,trickScore,outfitter.broadcastOutfit ?? outfitter.state.outfit,expeditions.active?.model,false);
      lastFrame = now;
      return;
    }
    const frozen = paused();
    const eligible = benchmarkReady && !frozen;
    if (!performanceCalibration.shouldRender(now, { eligible, context: playing ? 'game' : 'menu' })) return;
    if (frozen && wasPaused && raw < .055) return;
    wasPaused = frozen;
    lastFrame = now;
    const dt = clamp(raw, .001, .098);
    present += dt;
    if (!playing) animateMenu(present);
    expeditions.drawNear(camera.position);
    if (!frozen) {
      simTime += dt;
      if (expeditions.active) expeditions.update(dt,keys,player,camera,simTime);
      else if (playing && !liftSystem.active) {
        buildInput();
        player.update(dt, input, simTime);
        if (player.surfaceType === 'ground' && !player.footMode) player.setFootMode(true);
        collectibles.update(dt, simTime, player, camera);
      }
      const rideFinished = liftSystem.update(Math.min(raw, .35), simTime, player, camera, keys);
      if (rideFinished) finishRide(rideFinished);
      fx.update(dt);
      storm.update(dt);
    }
    updatePassGates(frozen?0:dt,playing&&!frozen?player:null,camera,()=>audio.tone(910,{dur:.065,gain:.025,type:'sine'}));
    if (playing) multiplayer.update(dt,trickScore,outfitter.broadcastOutfit ?? outfitter.state.outfit,expeditions.active?.model,!frozen);
    const ride = liftSystem.active;
    const vehicle = expeditions.active?.id;
    ui.resortMap.setSeason(climate.state.season);
    if (playing && (!frozen || ride)) ui.routeGuide.update(player, { riding: !!ride, hidden: !!vehicle && vehicle !== 'bike' });
    const skiing = playing && !ride && !vehicle && !player.footMode && player.grounded && !player.crash;
    climate.update(dt, camera, playing && !frozen ? Math.min(.5, raw) : 0);
    const conditionsNow = climate.state;
    people.setDensity(conditionsNow.crowd);
    if (mountainPanel.open) updateConditionsClock();
    const movingOnMountain = playing && !frozen && !ride && !vehicle;
    updateTrickHud(player, camera, movingOnMountain && !player.footMode);
    travelTracker.update(dt, player, { active: movingOnMountain, nearest: movingOnMountain ? ui.findNearest(player, false, simTime) : null });
    if (playing && !frozen) snowTraffic.update(dt, player, people.people, conditionsNow, movingOnMountain);
    ground.streamBackcountry?.(playing ? player.pos : camera.position, camera.position);
    world.update(dt, camera, movingOnMountain ? player.speed : 0, playing ? player.pos : null);
    people.update(frozen ? 0 : dt, simTime, camera, playing && !ride ? player : null);
    forestLines.update();
    sky.update(dt, camera);
    contact.update(player, playing && !ride && !vehicle);
    tracks.update(simTime, player, skiing);
    tuckWind.update(dt, player, skiing && !frozen);
    updateShadow();
    if (playing && present - lastHud > .1) {
      lastHud = present;
      if (ride) syncRide(ride);
      else syncHud();
    }
    if (audio.ready) audio.update(dt, {
      vehicle, speed: player.speed, grounded: player.grounded, airborne: player.airborne, crash: player.crash,
      powder: player.powder, altitude: player.pos.y, riding: !!ride, surface: player.surfaceType,
      trees: ground.forestAt?.(player.pos.x, player.pos.z) ?? 0, tuck: player.tuckAmount,
      stride: player.footMode ? player.walkAmount : player.strideAmount, stridePhase: player.stridePhase,
      gustKmh: conditionsNow.gust, night: conditionsNow.night, golden: conditionsNow.golden, steer: player.steer, stop: player.stopEdge,
      hiking: player.footMode, paused: frozen || !playing,
    });
    updateChaseFoliage(camera, playing && !ride && !vehicle ? player : null);
    collectibles.prepareRender(camera);
    renderMountainFrame(renderer, scene, camera);
    performanceCalibration.didRender(now);
  }

  player.onEvent = (event) => {
    if (event.type === 'launch' || event.type === 'ollie') {
      heldAtTakeoff.clear();
      for (const key of turnKeys) if (keys[key]) heldAtTakeoff.add(key);
      audio.launch();
    } else if (event.type === 'land' || event.type === 'touchdown') {
      trickScore += event.points ?? 0;
      audio.land(event.impact, event.points ?? 0);
    } else if (event.type === 'crash') {
      audio.crash();
      ui.toast('Wipeout', 'Stand up and continue or press R to reset.', '', 'crash');
    }
  };

  function openCustomizer(trigger) {
    releaseLook();
    clearInput();
    outfitter.openCustomizer(trigger);
  }

  function openOutfitter(trigger = document.activeElement) {
    if (outfitter.dialog.open || outfitter.customizing) return;
    releaseLook();
    clearInput();
    outfitter.open(undefined, trigger);
  }

  const bindings = {
    'drop-in': () => travel('default'), 'village-start': () => travel('base'),
    'menu-customize': () => openCustomizer($('menu-customize')),
    'pause-customize': () => openCustomizer($('pause-customize')),
    'menu-mountain': () => openMountain(), 'pause-mountain': () => openMountain(),
    'pause-lifts': () => openMountain('lifts'),
    'mountain-done': () => mountainPanel.close(), 'mountain-outfitter': event => openOutfitter(event.currentTarget),
    'how-to-btn': () => openPanel('guide'), 'pause-guide': () => openPanel('guide'),
    'guide-drop': () => playing ? closePanel() : travel('default'),
    'map-open': () => openPanel('map'), 'pause-map': () => openPanel('map'),
    'pause-reset': () => travel('default'), 'restart-session': restartSession,
    resume: () => showModal(null), 'pause-camera': cycleCamera, 'gear-mode': toggleFoot,
    'board-lift': interact, 'next-lift': nextLift, 'ride-skip': interact, 'ride-view': cycleCamera,
    'audio-toggle-menu': toggleAudio, 'pause-audio': toggleAudio, 'pause-music': toggleMusic,
    'pause-nearby-map': () => { ui.toggleNearbyMap(); syncHud(); },
    'pause-markers': () => { signs = !signs; env.setSignsVisible?.(signs); ui.setMarkers(signs); },
  };
  performanceCalibration.bind({
    apply(next) { qualityIndex = next; applyQuality(); },
    resize,
    renderer,
  });
  bindRealism($('pause-realism'), query);
  bindSnowMotionBlur($('pause-motion-blur'), $('motion-blur-hint'));
  for (const [id, action] of Object.entries(bindings)) $(id)?.addEventListener('click', action);
  for (const name of ['map', 'guide', 'pause']) {
    document.querySelectorAll(`[data-close="${name}-screen"]`).forEach((button) =>
      button.addEventListener('click', () => name === 'pause' ? showModal(null) : closePanel()));
  }
  $('pause-markers').closest('.setting-row').hidden = !env.setSignsVisible;
  ui.hideModals();
  ui.setAudio(audio.enabled);
  ui.setMarkers(signs);
  toggleMusic(false);

  function toggleAudio() {
    ui.setAudio(audio.toggle());
    if (audio.enabled) activateAudio();
  }

  function toggleMusic(change = true) {
    if (change !== false) audio.toggleMusic();
    const button = $('pause-music');
    button.classList.toggle('on', audio.musicEnabled);
    button.setAttribute('aria-pressed', String(audio.musicEnabled));
    button.querySelector('span').textContent = audio.musicEnabled ? 'ON' : 'OFF';
  }

  window.addEventListener('keydown', (event) => {
    const { code } = event;
    if (code !== 'Escape' && event.target.closest?.('input, select, textarea, [contenteditable="true"]')) return;
    if ((code === 'Enter' || code === 'Space') && event.target.closest?.('button, select, input, textarea, summary, a[href]')) return;
    if (outfitter.customizing || outfitter.dialog.open || mountainPanel.open || event.ctrlKey || event.metaKey || event.altKey) return;
    const shown = modal();
    if (shown === 'map' || shown === 'guide') {
      if (!event.repeat && (code === 'Escape' || (shown === 'map' && code === 'KeyM'))) closePanel();
      return;
    }
    if (playing && !shown && moveKeys.has(code)) {
      event.preventDefault();
      keys[code] = true;
      if (code === 'Space' && !event.repeat) queueJump();
    }
    if (event.repeat) return;
    if (code === 'KeyG') openMountain();
    else if (code === 'KeyM') openPanel('map');
    else if (code === 'KeyL') openOutfitter();
    else if (code === 'Enter' && !playing && !event.target.closest?.('button')) travel('default');
    else if (code === 'Escape' && playing) {
      if (shown === 'pause') showModal(null);
      else if (!document.pointerLockElement) showModal('pause');
    } else if (code === 'KeyR' && playing) travel('default');
    else if (!shown) {
      if (code === 'KeyE') interact();
      else if (code === 'KeyB') toggleFoot();
      else if (code === 'KeyC') cycleCamera();
      else if (code === 'KeyQ') nextLift();
    }
  });
  window.addEventListener('keyup', ({ code }) => {
    keys[code] = false;
    heldAtTakeoff.delete(code);
  });
  window.addEventListener('blur', clearInput);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearInput();
      if (playing && !paused()) showModal('pause');
    }
    lastFrame = performance.now();
  });
  const look = (dx,dy) => {
    if (liftSystem.active) liftSystem.look(dx,dy);
    else if (expeditions.active) expeditions.look(dx,dy);
    else player.lookAround(dx,dy);
  };
  canvas.addEventListener('pointerdown', (event) => {
    if (!readyToLook() || event.button !== 0) return;
    if (event.pointerType === 'mouse' && readyToMove()) player.swingPole();
    activateAudio();
    drag = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    if (event.pointerType === 'mouse' && canvas.requestPointerLock) {
      try { canvas.requestPointerLock()?.catch(() => {}); } catch {}
    }
  });
  document.addEventListener('pointerlockchange', () => { drag = null; });
  document.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement === canvas && readyToLook()) look(event.movementX, event.movementY);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag || document.pointerLockElement === canvas || !readyToLook()) return;
    look(event.clientX - drag.x, event.clientY - drag.y);
    drag = { x: event.clientX, y: event.clientY };
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(event, () => { drag = null; });
  }
  touchControls = installTouchButtons({ keys, queueJump, cycleCamera, openMountain: () => openMountain(), pause: () => showModal('pause'),
    clearJump: () => { ollie = false; }, releaseKey: code => heldAtTakeoff.delete(code) });

  applyQuality();
  new ResizeObserver(resize).observe(host);
  const preferredView = query.get('view');
  if (preferredView === 'helmet') {
    player.cameraMode = 2;
    ui.setCameraLabel('HELMET');
  }
  const requested = query.get('start');
  const destination = [requested, `run:${requested}`, `base:${requested}`].find((id) => arrivals.has(id));
  player.model.visible = false;
  if (destination) {
    travel(destination, false);
    window.addEventListener('keydown', activateAudio, { once: true });
    window.addEventListener('pointerdown', activateAudio, { once: true });
  }
  ui.setLoading(.95, 'Preparing the first view…');
  await paint();
  draw(performance.now());
  await ui.finishLoading();
  ui.showStart(!playing);
  benchmarkReady = true;
  renderer.setAnimationLoop(draw);

  window.__mappedResort = {
    mountain, config, world, ground, env, lifts, liftSystem, player, camera, scene, renderer, climate, audio, ui, tracks, collectibles, people, multiplayer, expeditions, snowTraffic,
    travel,
    boardLift: interact,
    get performance() { return performanceCalibration.result; },
    get state() {
      return { playing, paused: paused(), pos: player.pos.toArray(), speed: player.speedKmh, riding: !!liftSystem.active,
        coins: collectibles.coinCount, crystals: collectibles.crystalCount };
    },
  };
  return window.__mappedResort;
}
