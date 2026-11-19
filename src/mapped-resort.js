import { installTouchButtons } from './touch-controls.js';
import { rendererUnavailable } from './renderer-recovery.js';
import { updatePassGates } from './pass-gates.js';
import { updateChaseFoliage } from './chase-foliage.js';
import { setForestQuality } from './forest-lod.js';
import { loadingProgress } from './mountain-loading.js';
import { createMultiplayer } from './multiplayer.js';
import { createTravelTracker } from './skier-profile.js';
import { createSnowTraffic } from './snow-traffic.js';
import {
  graphicsProfiles, graphicsIndex, bindGraphics, bindRealism, createRenderer, resizeViewport,
  applyShadowResolution, sunShadowRefreshDue, updateSunShadow,
} from './graphics.js';
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
import { applyInternationalLandmarkSites } from './international-landmark-sites.js';
import { Outfitter } from './outfitter.js';
import { Expeditions } from './expeditions.js';
import { Player } from './player.js';
import { UI } from './ui.js';
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
  label('.start-card-head p', base?.def.name ?? 'Mountain approach');
  label('.village-copy', terrainOnly ? 'Set out in boots and open Mountain for the nearby viewpoints.' :
    liftCount > 1 ? 'Board here or find another lift or trail under Mountain.' : 'Board here to ride up the mountain.');
  label('#village-start span', terrainOnly ? 'Start on foot' : 'Start at the base');
  document.querySelector('.hero-tags').classList.add('hidden');
  $('pause-mountain').firstChild.textContent = 'Resort, weather & travel ';
  $('pause-reset').firstChild.textContent = `Return to ${startName ?? 'the start'} `;
  $('mountain-outfitter').firstChild.textContent = 'Outfitter ';
}

function prepareFieldGuide(name, startRun, terrainOnly) {
  const blocks = document.querySelectorAll('.guide-block');
  const instructions = {
    R: `Return to ${startRun || 'the starting trail'}.`,
    E: terrainOnly ? 'Interact when a prompt appears.' : 'Board a nearby lift. Press E again to skip to the unload.',
    C: 'Change the camera or the lift viewpoint. Click or drag on the snow to look around.',
    L: 'Visit the outfitter for skis and outerwear.',
    G: 'Find lift stations, trail starts, conditions and resorts.',
  };
  for (const row of blocks[0].querySelectorAll('.key-row')) {
    const key = row.querySelector('kbd').textContent;
    if (instructions[key]) row.querySelector('span').textContent = instructions[key];
    if (key === 'C') row.querySelector('kbd:nth-child(2)')?.remove();
  }
  label('.guide-block:nth-child(2) h3', 'The mountain');
  const paragraphs = blocks[1].querySelectorAll('p');
  paragraphs[0].textContent = terrainOnly ? `Explore ${name} on foot or pick a viewpoint under Mountain.` :
    `Explore ${name} using the lift network or choose a trail start from Mountain.`;
  paragraphs[1].textContent = terrainOnly ? 'Walk with W and S. Press B to switch between boots and skis.' :
    'At an unload, push off with W. Press B to switch to boots and walk around the terminals.';
  blocks[1].querySelector('.guide-note').remove();
  blocks[2].querySelector('p').textContent = 'Ride within your ability, give downhill skiers room, and look before you drop in.';
}

function prepareExploration(panel, sections, travel) {
  const resortFields = Array.from(panel.querySelectorAll(':scope > fieldset')).filter((field) =>
    ['Explore', 'Scenic viewpoints', 'Challenges'].includes(field.querySelector('legend')?.textContent.trim()));
  const explore = resortFields.shift();
  for (const field of resortFields) field.remove();
  const field = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = 'Explore';
  field.append(legend);
  for (const [name, options] of sections) {
    if (!options.length) continue;
    const row = document.createElement('div');
    row.className = 'resort-switch';
    const select = document.createElement('select');
    select.setAttribute('aria-label', name);
    select.add(new Option(name, '', true, true));
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
    button.setAttribute('aria-label', `Travel to ${name.toLowerCase()}`);
    button.disabled = true;
    select.addEventListener('change', () => { button.disabled = !select.value; });
    button.addEventListener('click', () => travel(select.value));
    row.append(select, button);
    field.append(row);
  }
  explore.replaceWith(field);
}

export async function startMappedResort(mountain) {
  $('app').classList.add('mapped-resort');
  document.title = `Alpine Descent · ${mountain.label}`;
  document.querySelector('meta[name="description"]')?.setAttribute('content',
    `Ski real trail routes and ride mapped lifts at ${mountain.label}.`);
  label('.loading-copy .kicker', mountain.label);
  label('#load-status', `Loading ${mountain.label} terrain…`);
  label('#load-tip', 'Press G to choose a lift or trail, or M to open the resort map.');
  loadingProgress(.12);
  await paint();
  const dataUrl = new URL(mountain.data, document.baseURI);
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error(`Could not load ${mountain.label} resort data (HTTP ${response.status}).`);
  const config = await response.json();
  applyInternationalLandmarkSites(config);
  const query = new URLSearchParams(location.search);
  const runs = prepareRuns(config.runs);
  const host = $('webgl');
  const renderer = createRenderer();
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
  const world = await buildMappedResortWorld(scene, config, new URL('./', dataUrl));
  const { ground: baseGround, env } = world;
  ui.setLoading(.72, 'Stringing the lifts…');
  await paint();
  const liftSystem = await buildMappedResortLifts(scene, config, baseGround, env);
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
  prepareFieldGuide(mountain.label, startName, config.terrainOnly);
  if (config.terrainOnly) document.querySelector('.trail-key').hidden = true;

  const tracks = new SkiTracks(scene, 8000, ground);
  const contact = new SkiContact(scene, ground);
  const fx = new ParticleFX(scene, (x, z) => ground.heightAt(x, z), ground);
  const audio = new AudioEngine();
  const slopeFixtures = buildMappedSlopeFixtures(world.root, config, ground, env);
  const climate = createClimate({ scene, renderer, lighting, sky, storm, terrain: ground, slopeFixtures });
  const player = new Player(scene, camera, { ground, env, fx, tracks, audio });
  const travelTracker = createTravelTracker({ resortId: mountain.id, resortName: mountain.label, mountainAt: () => mountain.label });
  const mountainPanel = $('mountain-panel');
  const outfitter = new Outfitter(player, () => outfitter.dialog.close(), renderer);
  const multiplayer = createMultiplayer(scene,mountain.id,()=>player);
  let trickScore = 0;
  const crystalSpecs = crystalLocations(mountain.id, runs, ground, env);
  const collectibles = new Collectibles(scene, fx, {
    runs, crystals: crystalSpecs, heightAt: ground.heightAt, coinStep: 10, forestCoins: forestLines.coins,
  });
  ui.collectibles = collectibles;
  const findList = outfitter.dialog.querySelector('[data-finds]');
  findList.previousElementSibling.textContent = 'Mountain finds';
  findList.previousElementSibling.hidden = findList.hidden = !collectibles.totalCrystals;
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
  const heldAtTakeoff = new Set();
  const input = {};
  const lastShadowAnchor = new THREE.Vector3(Infinity, Infinity, Infinity);
  const menuCenter = new THREE.Vector3();
  let playing = false;
  let panelReturn = null;
  let qualityIndex = graphicsIndex(query, 'BALANCED');
  let lastFrame = performance.now();
  let present = 0, simTime = 0, lastHud = -Infinity, lastShadow = -Infinity;
  let selectedLift = null, stationLabel = '', stationPose = null;
  let ollie = false, signs = true, drag = null;
  let wasPaused = false;

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
    select.addEventListener('change', () => climate.set({ [key]: select.value }));
  }
  climate.set(conditions, { instant: true });
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
  const stationChoices = [];
  for (const lift of lifts) {
    const section = lift.def.section ?? ui.findNearest({ pos: lift.boardPose }, true)?.run.section;
    for (const [end, footMode, pose] of [['base', true, lift.boardPose], ['top', false, lift.exitPose]]) {
      const id = `${end}:${lift.def.id}`;
      const name = `${lift.def.name} · ${footMode ? 'base' : 'top'}`;
      arrivals.set(id, { pose: { ...pose, holdAtUnload: !footMode }, name, footMode: footMode || !!pose.footMode });
      stationChoices.push({ id, label: name, section });
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
  const quickChoices = config.terrainOnly ? [{ id: 'default', label: 'Mountain approach' }]
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
  const choices = [['Quick travel', quickChoices], ['Choose a lift station', stationChoices], ['Choose a trail start', runChoices]];
  if (summerBikeChoices.length) choices.push(['Choose a bike trail',summerBikeChoices]);
  if (summerHikeChoices.length) choices.push(['Choose a summer hike',summerHikeChoices]);
  prepareExploration(mountainPanel, choices, travel);
  const sledButton = document.createElement('button');
  sledButton.type = 'button';
  sledButton.dataset.minigame = 'sled';
  sledButton.textContent = 'Sled Run';
  sledButton.onclick = async () => {
    releaseLook();
    const { openSledGame } = await import('./sled-game.js');
    openSledGame();
  };
  mountainPanel.querySelector('#mountain-outfitter').before(sledButton);

  function resize() {
    const quality = graphicsProfiles[qualityIndex];
    resizeViewport({ host, renderer, camera, quality, storm, tuckWind });
  }

  function applyQuality() {
    const quality = graphicsProfiles[qualityIndex];
    applyShadowResolution(renderer, lighting.sun, quality.shadow);
    setForestQuality(quality.name);
    world.setQuality?.(quality.name);
    resize();
  }

  function clearInput() {
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
  const paused = () => !!(modal() || mountainPanel.open || outfitter.dialog.open);
  const readyToLook = () => playing && !paused();
  const readyToMove = () => readyToLook() && !liftSystem.active && !expeditions.active;

  function showModal(name) {
    releaseLook();
    clearInput();
    if (name) ui.showModal(name);
    else {
      ui.hideModals();
      if (!playing) $('drop-in').focus({ preventScroll: true });
    }
  }

  function openPanel(name) {
    panelReturn = modal() ?? null;
    showModal(name);
    if (name === 'map') {
      ui.resortMap.setSeason(climate.state.season);
      ui.drawBigMap(playing ? player : null, simTime);
    }
  }

  function closePanel() {
    showModal(panelReturn);
    panelReturn = null;
  }

  function openMountain() {
    updateConditionsClock();
    if (mountainPanel.open || outfitter.dialog.open) return;
    releaseLook();
    clearInput();
    mountainPanel.showModal();
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
    tracks.clear();
    fx.clear();
    collectibles.reset();
    restoreCrystals();
    travel('default');
  }

  function travel(id, initializeAudio = true) {
    const arrival = arrivals.get(id);
    if (!arrival) return false;
    if (initializeAudio) activateAudio();
    if (mountainPanel.open) mountainPanel.close();
    if (outfitter.dialog.open) outfitter.dialog.close();
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
    ui.toast(stationLabel, touch ? 'Hold Go to ski · Mountain for trail starts' : 'W to ski · G to choose a trail', 'blue', 'lift');
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
      ui.toast('Slow down to change gear','Switch between boots and skis on the ground.','','check');
      return;
    }
    if (player.footMode && player.surfaceType === 'ground') {
      ui.toast('On foot','Reach a snow-covered trail to put your skis on.','','check');
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
    const [peakX,peakZ] = peak?.point ?? [defaultPose.x, defaultPose.z + 300];
    const end = base?.exitPose ?? { x: peakX, z: peakZ };
    const { x, z } = basePose;
    const heading = Math.atan2(end.x - x, end.z - z);
    const yaw = heading - .36 + Math.sin(time * .09) * .065;
    const offset = 220 + Math.sin(time * .11) * 20;
    camera.position.set(x - Math.sin(yaw) * offset, baseHeight + 136, z - Math.cos(yaw) * offset);
    if (config.terrainOnly) menuCenter.set(end.x, ground.heightAt(end.x,end.z) - 60, end.z);
    else menuCenter.set(x + Math.sin(heading + .15) * 410, baseHeight + 204, z + Math.cos(heading + .15) * 410);
    camera.lookAt(menuCenter);
  }

  function updateShadow() {
    if (!lighting.sun.castShadow) return;
    const anchor = playing ? player.pos : menuCenter;
    const { shadowInterval } = graphicsProfiles[qualityIndex];
    if (!renderer.shadowMap.needsUpdate &&
        !sunShadowRefreshDue(present - lastShadow, anchor.distanceToSquared(lastShadowAnchor), shadowInterval)) return;
    lastShadow = present;
    lastShadowAnchor.copy(anchor);
    updateSunShadow(renderer, lighting.sun, SUN_DIR, anchor);
  }

  function draw(now) {
    if (rendererUnavailable) return;
    const raw = Math.max(0, (now - lastFrame) / 1000);
    if (document.hidden) return;
    if (ui.isOpen('map') || document.getElementById('destination-selector')?.open || document.getElementById('sled-game')?.open) {
      if(playing)multiplayer.update(0,trickScore,outfitter.broadcastOutfit ?? outfitter.state.outfit,expeditions.active?.model,false);
      lastFrame = now;
      return;
    }
    const frozen = paused();
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
    travelTracker.update(dt, player, { active: movingOnMountain, nearest: movingOnMountain ? ui.findNearest(player, false, simTime) : null });
    if (playing && !frozen) snowTraffic.update(dt, player, people.people, conditionsNow, movingOnMountain);
    world.update(dt, camera);
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
    renderer.render(scene, camera);
  }

  player.onEvent = (event) => {
    if (event.type === 'launch' || event.type === 'ollie') {
      heldAtTakeoff.clear();
      for (const key of turnKeys) if (keys[key]) heldAtTakeoff.add(key);
      audio.launch();
    } else if (event.type === 'land' || event.type === 'touchdown') {
      trickScore += (event.points || 0) * (player.landingTrickMultiplier ?? 1);
      audio.land(event.impact, event.points ?? 0);
      if (event.label) ui.floaty(event.label, { big: true });
    } else if (event.type === 'crash') {
      trickScore = 0;
      audio.crash();
      ui.toast('Wipeout', 'Stand up and continue or press R to reset.', '', 'crash');
    }
  };

  function openOutfitter() {
    if (outfitter.dialog.open) return;
    if (mountainPanel.open) mountainPanel.close();
    releaseLook();
    clearInput();
    outfitter.open();
  }

  const bindings = {
    'drop-in': () => travel('default'), 'village-start': () => travel('base'),
    'menu-mountain': openMountain, 'pause-mountain': openMountain,
    'mountain-done': () => mountainPanel.close(), 'mountain-outfitter': openOutfitter,
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
  bindGraphics($('pause-quality'), qualityIndex, next => {
    qualityIndex = next;
    applyQuality();
  });
  bindRealism($('pause-realism'), query);
  for (const [id, action] of Object.entries(bindings)) $(id)?.addEventListener('click', action);
  for (const name of ['map', 'guide', 'pause']) {
    document.querySelectorAll(`[data-close="${name}-screen"]`).forEach((button) =>
      button.addEventListener('click', () => name === 'pause' ? showModal(null) : closePanel()));
  }
  $('guide-drop').querySelector('.btn-label').textContent = 'Go skiing';
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
    if (outfitter.dialog.open || mountainPanel.open || event.ctrlKey || event.metaKey || event.altKey) return;
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
  installTouchButtons({ keys, queueJump, cycleCamera, openMountain, pause: () => showModal('pause') });

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
  renderer.setAnimationLoop(draw);

  window.__mappedResort = {
    mountain, config, world, ground, env, lifts, liftSystem, player, camera, scene, renderer, climate, audio, ui, tracks, collectibles, people, multiplayer, expeditions, snowTraffic,
    travel,
    boardLift: interact,
    get state() {
      return { playing, paused: paused(), pos: player.pos.toArray(), speed: player.speedKmh, riding: !!liftSystem.active,
        coins: collectibles.coinCount, crystals: collectibles.crystalCount };
    },
  };
  return window.__mappedResort;
}
