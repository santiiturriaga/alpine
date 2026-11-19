import { installTouchButtons } from './touch-controls.js';
import { failMountainLoading } from './mountain-loading.js';
import { rendererUnavailable } from './renderer-recovery.js';
import { updatePassGates } from './pass-gates.js';
import { updateChaseFoliage } from './chase-foliage.js';
import { createMountainQuests } from './mountain-quests.js';
import { createMultiplayer } from './multiplayer.js';
import { createTravelTracker } from './skier-profile.js';
import { createSnowTraffic } from './snow-traffic.js';
import {
  graphicsProfiles, bindRealism, createRenderer, resizeViewport, prepareFirstFrame, renderMountainFrame,
  applyShadowResolution, sunShadowRefreshDue, updateSunShadow,
} from './graphics.js';
import { createPerformanceCalibration } from './performance-calibration.js';
import { setTerrainSamplingBudget } from './materials.js';
import { compactDevice } from './device-budget.js';
import * as THREE from 'three';
import { buildTerrain, heightAt, normalAt, surfaceAt, treeCoverAt } from './terrain.js';
import { buildEnvironment } from './environment.js';
import { buildForestLines } from './forest-lines.js';
import { setForestQuality } from './forest-lod.js';
import {
  createSky, createLighting, createWinterEnvironment, Snowstorm,
  ParticleFX, SkiTracks, SkiContact, TuckWind, SUN_DIR,
} from './effects.js';
import { createClimate, bindConditionsClock, CLIMATE_PRESETS } from './climate.js';
import { buildWhistlerSnowmaking } from './slope-fixtures.js';
import { buildVillageLighting, OLYMPIC_PLAZA } from './village-lights.js';
import { INUKSHUK_VIEW, INUKSHUK_START } from './inukshuk.js';
import { FAIRMONT_VIEW, FAIRMONT_START } from './fairmont.js';
import { DUSTYS_VIEW, DUSTYS_START, CREEKSIDE_SLOPE_VIEW } from './creekside-village.js';
import { VALLEY_VIEW, VALLEY_FOREST_VIEW, buildValleyScenery } from './valley-scenery.js';
import { Outfitter } from './outfitter.js';
import { buildFieldNotes } from './field-notes.js';
import { buildWildlife,WILDLIFE_START } from './wildlife.js';
import { Expeditions } from './expeditions.js';
import { SKIERS_PLAZA_START,SKIERS_PLAZA_VIEW } from './skiers-plaza.js';
import { introShot, INTRO_SECONDS } from './intro-sequence.js';
import { createIntroRiders } from './intro-riders.js';
import { MountainChallenges } from './mountain-challenges.js';
import { LIFTS, mountainAt } from './worlddata.js';
import { Player } from './player.js';
import { Collectibles } from './coins.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';
import { inRoundhouseBuilding, whistlerAtlasSettings } from './whistler-atlas.js';
import { createSkiPatrol } from './ski-patrol.js';
import { GondolaInterior } from './gondola-interior.js';
import { PEAK_TO_PEAK_BERTH_TIME, peakToPeakBerthOpening } from './gondola-shell.js';
import {
  FITZSIMMONS, PEAK_TO_PEAK, VILLAGE_GONDOLA_UPPER, PEAK_EXPRESS, RUNS, VILLAGE_START, COME_ALONG_START, startPose, runFromSource, runPointAt, FINISHES, WORLD,
} from './worlddata.js';
import { clamp, formatNumber, wrapAngle } from './util.js';
import { stationPoint, stationSite } from './station-sites.js';
import { ALPINE_CLIFF_START } from './alpine-cliffs.js';
import { GLACIER_CAVE_START } from './glacier-cave.js';

/* ═══════════════════════════════════════════════════════════════
   ALPINE DESCENT
   Two mountains, one continuous line, and a very large amount of
   snow. This file marries the world, the skier, and the interface.
   ═══════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);
const query = new URLSearchParams(location.search);
const destination = query.get('view') === 'valley' ? 'valley' : query.get('start');
const arrivalButtons = [...$('mountain-panel').querySelectorAll('[data-arrival]')];
const courseButtons = [...$('mountain-panel').querySelectorAll('[data-course]')];
const challengeArrival = courseButtons.some(button => button.dataset.course === query.get('challenge'));
const directArrival = challengeArrival || arrivalButtons.some(button => button.dataset.arrival === destination);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));
const terrainOcclusion = query.get('terrain-occlusion') !== 'off';

function renderTerrainFrame() {
  if (terrainOcclusion) terrain.hideOccludedTiles(camera);
  try {
    renderMountainFrame(renderer, scene, camera);
  } finally {
    if (terrainOcclusion) terrain.restoreOccludedTiles();
  }
}

const COMBO_TIME = 4.8;
let renderer, scene, camera;
let frameObserver;
let terrain, env, sky, lighting, fx, tracks, storm, tuckWind, skiContact;
let valley;
let outfitter,fieldNotes,shopReturn=null;
let wildlife,expeditions,multiplayer,quests;
let skiPatrol;
let player, collectibles, audio, ui, climate, challenges;
let updateConditionsClock;
let travelTracker, snowTraffic;
const capturingIntro = query.get('intro') === 'capture';
if (capturingIntro && !query.has('quality')) query.set('quality', 'HIGH');
const conditions = { season: destination === 'bike' ? 'summer' : query.get('season') || 'winter',
  weather: query.get('weather') || (destination === 'bike' ? 'clear' : 'flurries'),
  time: query.get('time') || (['olympic-plaza','fairmont','creekside-slope'].includes(query.get('start')) ? 'blue-hour' : 'cycle'),
  hour: query.has('hour') ? Number(query.get('hour')) : 10.5 };
let scenicPose=null;
const scenicTarget=new THREE.Vector3();
let referenceUrl=null;
let panelReturn = null;
let introTime = 0;
let displayTime = 0;
let elapsed = 0;
let lastFrame = 0;
let playing = false;
let paused = false;
let finished = false;
let finishCooldown = 0;
let transitioning = false;
let ride = null;
let selectedLift = null;
let mapReturn = null;
let previousShot=null;
let introRiders=null;
const performanceCalibration = createPerformanceCalibration({ query, resort: 'whistler-blackcomb',
  profiles: graphicsProfiles, viewport: $('webgl'), compact: compactDevice, enabled: !capturingIntro });
let qualityIndex = performanceCalibration.quality;
setForestQuality(graphicsProfiles[qualityIndex].name);
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
let touchControls;

const keys = Object.create(null);
const heldAtTakeoff = new Set();
const trickKeys = ['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS'];
const input = {
  steer: 0, tuck: false, brake: false, ollie: false, flip: 0, grab: false, air: false,
};

const _ridePos = new THREE.Vector3();
const _rideTan = new THREE.Vector3();
const _rideLook = new THREE.Vector3();
const _rideView = new THREE.Vector3();
const _rideAnchor = new THREE.Vector3();
const shadowAnchor = new THREE.Vector3(200, 1450, 200);
const lastShadowAnchor = new THREE.Vector3(Infinity, Infinity, Infinity);
let lastShadowTime = -Infinity;

/* ── boot ───────────────────────────────────────────────────── */

async function boot() {
  const host = $('webgl');
  try {
    renderer = createRenderer({ exposure: 1.03, shadows: true, antialias: performanceCalibration.antialias });
  } catch (err) {
    showFatal('WebGL is required for Alpine Descent.', err);
    return;
  }

  host.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xc9dee8);
  scene.fog = new THREE.FogExp2(0xbdd0e1, .000056);
  scene.environment = createWinterEnvironment(renderer);

  camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.27, 39000);
  camera.position.set(1280, 2860, 3240);

  onResize();
  new ResizeObserver(onResize).observe(host);
  ui = new UI();
  ui.setLoading(0.02, 'Shaping the Coast Mountains…');
  await nextFrame();

  lighting = createLighting(scene);
  sky = createSky(scene);
  snowTraffic = createSnowTraffic();

  const setLoad = (p, text) => ui.setLoading(p, text);

  terrain = await buildTerrain(
    (p, text) => setLoad(0.03 + p * 0.44, text), nextFrame,
    { quality: graphicsProfiles[qualityIndex].name },
  );
  scene.add(terrain.mesh, terrain.ranges);
  await nextFrame();

  setLoad(0.49, 'Planting the old-growth forest…');
  await nextFrame();
  env = await buildEnvironment(scene, {
    onProgress: (p, text) => setLoad(0.5 + p * 0.42, text),
    quality: graphicsProfiles[qualityIndex].name,
  });
  skiPatrol = createSkiPatrol(scene, env);
  const atlasSettings = whistlerAtlasSettings((def, direction) =>
    liftExit({ lift: { def }, direction, destination: liftDestination({ def }, direction) }), terrain);
  const atlasClear = (x, y, z) => {
    if (inRoundhouseBuilding(x, z) || env.grid.buildingsAt(x, z).length) return false;
    const obstacles = env.queryColliders(x, z, 1.5);
    if (!obstacles.length) return true;
    const floor = env.walkSurfaceAt?.(x, z, Infinity) ?? y;
    return !obstacles.some(c =>
      Math.max(y, floor) + 1.4 >= (c.minY ?? -Infinity) && Math.min(y, floor) <= (c.maxY ?? Infinity) &&
      (c.r ? Math.hypot(c.x - x, c.z - z) < c.r + .65 : env.pointInBox(x, z, c, .6, .6)));
  };
  ui.configureMap(scene, atlasSettings, atlasClear);
  terrain.setInteriorCutout(env.interiors?.rooms.find(({ id }) => id === 'roundhouse'));

  setLoad(0.93, 'Brushing in the last light…');
  await nextFrame();

  const forestLines = buildForestLines(scene,
    { ...terrain, normalAt, surfaceAt, forestAt: treeCoverAt, bounds: WORLD, startPose }, env, RUNS);
  env.forestLines = forestLines;
  const ground = forestLines.ground;
  tracks = new SkiTracks(scene, 8000, ground);
  skiContact = new SkiContact(scene, ground);
  fx = new ParticleFX(scene, ground.heightAt, ground);
  storm = new Snowstorm(scene);
  tuckWind = new TuckWind($('app'));
  tuckWind.resize($('webgl').clientWidth, $('webgl').clientHeight);
  storm.resize(renderer.domElement.height);

  const villageLights = buildVillageLighting(scene,{grid:env.grid,budget:() => env.budget});
  const slopeFixtures = buildWhistlerSnowmaking(scene, ground, RUNS, env);
  valley = await buildValleyScenery(scene);
  climate=createClimate({scene,renderer,lighting,sky,storm,villageLights,terrain,slopeFixtures});
  climate.set(conditions,{instant:true});
  updateConditionsClock = bindConditionsClock(climate, $('resort-clock'));
  forestLines.update();
  challenges=new MountainChallenges(scene,$('course-hud'));
  player = new Player(scene, camera, { env, ground, fx, tracks, audio: null });
  travelTracker = createTravelTracker({
    resortId: 'whistler-blackcomb', resortName: 'Whistler Blackcomb',
    mountainAt: position => mountainAt(position.x, position.z),
  });
  outfitter=new Outfitter(player,closeShop,renderer);
  multiplayer=createMultiplayer(scene,'whistler-blackcomb',()=>player);
  challenges.onWin=id=>{const coins=id==='avalanche'?12:id==='race'?8:5;outfitter.credit(coins);
    ui.toast('FINISH BONUS',coins+' mountain coins','green','check');};
  fieldNotes=buildFieldNotes(scene,env.grid,outfitter,ui.toast.bind(ui));
  player.model.visible = false;
  collectibles = new Collectibles(scene, fx, { finishes: FINISHES, heightAt: ground.heightAt,
    forestCoins: forestLines.coins });
  ui.collectibles = collectibles;

  audio = new AudioEngine();
  wildlife=buildWildlife(scene,outfitter,audio);
  const bikeRun = RUNS.find(({ name }) => name === 'Ego Bowl');
  const bikeStart = runPointAt(bikeRun, Math.min(.5,60/bikeRun.length));
  expeditions = new Expeditions(scene,env.grid,{
    ground,env,fx,season:() => climate.state.season,
    bikes:[{id:'bike',pose:{x:bikeStart.x,z:bikeStart.z,heading:Math.atan2(bikeStart.tx,bikeStart.tz)}}],
  });
  quests=createMountainQuests({scene,env,ui,wildlife,expeditions,shop:outfitter,player,camera,multiplayer,
    season: () => climate.state.season});
  player.audio = audio;
  ui.setAudio(true);
  ui.setMarkers(true);
  ui.setCameraLabel('CHASE');
  applyQuality();

  player.onEvent = onPlayerEvent;
  collectibles.onCoin = onCoin;
  collectibles.onCrystal = onCrystal;

  bindUI();
  bindKeys();
  resetRunState(false);

  setLoad(0.97, 'Lighting the first view…');
  await nextFrame();
  // Upload the scene the player will actually see. Other arrivals upload on approach.
  if (directArrival) {
    const pose = arrivalPose(destination);
    player.footMode = pedestrianArrival(pose);
    player.teleport(pose);
    shadowAnchor.copy(player.pos);
  } else {
    updateIntroCamera(0);
  }
  env.update(0, 0, camera);
  villageLights.update(0, 0, climate.state, camera);
  terrain.streamDetail(directArrival ? player.pos : camera.position, camera.position);
  expeditions.drawNear(camera.position);
  valley?.update(0, camera);
  sky.update(0, camera);
  updateSun(true);
  collectibles.prepareRender(camera);
  await prepareFirstFrame(renderer, scene, camera);
  renderTerrainFrame();

  await ui.finishLoading();
  ui.showStart(!directArrival);
  ui.showModal(null);
  ui.hideModals();
  ui.setHud(false);
  lastFrame = performance.now();
  if (!directArrival) scheduleFrame();

  // handy for debugging in the console
  window.__alpine = {
    setFrameObserver(observer) { frameObserver = observer; },
    ...(capturingIntro ? { filmDuration:INTRO_SECONDS, filmFrame(seconds,dt=1/24) {
      introTime=seconds-dt;displayTime=seconds;
      updateIntroCamera(dt); climate.update(dt,camera);
      terrain.updateDetail(camera.position);env.update(dt,seconds,camera);valley?.update(dt,camera);
      sky.update(dt,camera);storm.update(dt);updateSun();collectibles.prepareRender(camera);renderer.render(scene,camera);
      return renderer.domElement.toDataURL('image/jpeg',.91);
    }} : {}),
    get player() { return player; },
    get climate() { return climate; },
    get snowTraffic() { return snowTraffic; },
    get challenges() { return challenges; },
    get collectibles() { return collectibles; },
    get env() { return env; },
    get scene() { return scene; },
    get camera() { return camera; },
    get renderer() { return renderer; },
    get performance() { return performanceCalibration.result; },
    get scenicView() { return scenicPose?.name ?? null; },
    get ui() { return ui; },
    get audio() { return audio; },
    get wildlife() {return wildlife;},
    get skiPatrol() {return skiPatrol;},
    get quests() {return quests;},
    get multiplayer() {return multiplayer;},
    get expeditions() {return expeditions;},
    get outfitter() {return outfitter;},
    get state() {
      return {
        playing, paused, finished, score, streak, elapsed,
        coins: collectibles?.coinCount, crystals: collectibles?.crystalCount,
        pos: player?.pos.toArray(), speed: player?.speedKmh,
      };
    },
    start: () => startGame(VILLAGE_START),
    boardLift: () => boardLift(),
    get ride() {
      return ride ? { t: ride.t, dur: ride.dur, name: ride.lift.def.name,
        direction: ride.direction, length: ride.sampler.total, inside: ride.inside,
        walk: ride.cabin?.walk.toArray() } : null;
    },
  };

  if (directArrival) {
    const resumeSound = () => {
      window.removeEventListener('keydown', resumeSound);
      window.removeEventListener('pointerdown', resumeSound);
      audio.resume().catch(() => {});
    };
    window.addEventListener('keydown', resumeSound);
    window.addEventListener('pointerdown', resumeSound);
    const view = query.get('view');
    const preframed = !challengeArrival && destination !== 'valley' && view !== 'photo' && view !== 'helmet';
    await startGame(arrivalPose(destination), false, { preframed });
    if (challengeArrival) startCourse(query.get('challenge'));
    if (query.get('view') === 'helmet') { player.cameraMode=2; player.snapCamera(); ui.setCameraLabel('HELMET'); }
    if (!query.has('challenge')&&(destination==='valley'||query.get('view')==='photo'))enterScenicView(destination,photoView(destination));
  }
}

function showFatal(message, err) {
  console.error(err || message);
  failMountainLoading(message);
}

/* ── flow ───────────────────────────────────────────────────── */

async function startGame(pose = startPose(), startAudio = true, { preframed = false } = {}) {
  if (transitioning || playing) return;
  transitioning = true;
  document.activeElement?.blur?.();
  if (startAudio) {
    try { await audio.init(); } catch { /* audio is optional */ }
  }
  audioOn = audio.enabled;
  ui.setAudio(audioOn);
  audio.ui();

  if (!preframed) {
    ui.fade(true, false);
    await wait(380);
  }

  introRiders?.hide();
  if(previousShot)climate.set(conditions,{instant:true});
  previousShot=null;
  ui.hideModals();
  ui.showStart(false);
  ui.setHud(true);
  player.model.visible = true;
  player.footMode = pedestrianArrival(pose);
  player.teleport(pose, { resetStats: true });
  resetRunState(false);
  ui.findNearest(player, true, displayTime);
  playing = true;
  paused = false;
  finished = false;
  ui.fade(false, false);
  lastFrame = performance.now();
  scheduleFrame();
  updatePrompt();
  audio.ui();
  if (pose === startPose() && !query.has('challenge')) ui.toast('ROUNDHOUSE LODGE', matchMedia('(pointer:coarse)').matches ? 'Hold ↑ to ski · Tap the lift prompt to board' : 'W to push off · E to board PEAK 2 PEAK', 'blue', 'lift');
  if (pose === COME_ALONG_START) ui.toast('COME A LONG', 'W to push off · A and D to carve', 'blue', 'check');
  transitioning = false;
}

function resetRunState(fullReset = false) {
  travelTracker?.reset();
  quests?.leaveWinch();
  if(expeditions?.active)expeditions.leave(player,true);
  if(scenicPose)leaveScenicView();
  challenges?.clear();
  elapsed = 0;
  streak = 0;
  comboTimer = 0;
  comboFraction = 0;
  multiplier = 1;
  finished = false;
  finishCooldown = 0;
  paused = false;
  ride?.cabin?.dispose();
  ride = null;
  if (camera) {
    camera.near = .27;
    camera.up.set(0, 1, 0);
    camera.updateProjectionMatrix();
  }
  selectedLift = null;
  ui?.cinematic(false);
  env?.lifts.setPassenger(null);
  ui?.hidePrompt();
  if (fullReset) {
    env.people?.reset();
    tracks?.clear();
    fx?.clear();
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
  keysBackupClear();
  ui.hideModals();
  ui.fade(true, false);
  await wait(380);
  resetRunState(fullReset);
  player.teleport(startPose(), { resetStats: true });
  ui.setHud(true);
  ui.fade(false, false);
  audio.ui();
  ui.toast(fullReset ? 'FRESH TRACKS' : 'BACK TO ROUNDHOUSE', 'Roundhouse Lodge · Whistler Mountain', 'green', 'check');
  transitioning = false;
  lastFrame = performance.now();
}

function resetToRoundhouse() {
  restartSession(false);
}

function pauseGame() {
  if (!playing || paused || finished || transitioning) return;
  releaseMouseLook();
  paused = true;
  keysBackupClear();
  $('pause-camera').disabled = !!ride || quests.winchPassenger;
  ui.showModal('pause');
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
  const fromPause = ui.isOpen('pause');
  if (playing && !fromPause) return;
  $('guide-drop').querySelector('.btn-label').textContent = fromPause ? 'Back to pause' : 'Drop in';
  ui.showModal('guide');
  audio.ui();
}

function closeGuide() {
  if (playing) {
    ui.showModal('pause', $('pause-guide'));
  } else {
    ui.hideModals();
    $('how-to-btn').focus({ preventScroll: true });
  }
  audio.ui();
}

function openMap(returnTo = null) {
  if (transitioning || ui.isOpen('map')) return;
  releaseMouseLook();
  keysBackupClear();
  mapReturn = returnTo
    || (!playing ? 'title' : ui.isOpen('pause') ? 'pause' : ui.isOpen('summary') ? 'summary' : 'game');
  if (mapReturn === 'title') ui.el.start.inert = true;
  ui.hideModals();
  ui.showModal('map');
  paused = true;
  ui.drawBigMap(playing ? player : null, displayTime);
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
    if (returnTo === 'title') {
      ui.el.start.inert = false;
      $('drop-in').focus({ preventScroll: true });
    }
  }
  audio.ui();
}

function arrivalPose(name) {
  const shop = env.interiors.rooms.find(room => room.id === name && room.approach);
  if (shop) return shop.approach;
  const vehicle=expeditions.arrival(name);
  if(vehicle)return vehicle;
  if(name==='skiers-plaza')return SKIERS_PLAZA_START;
  if(name==='wildlife')return WILDLIFE_START;
  if (name === 'alpine-cliffs') return ALPINE_CLIFF_START;
  if (name === 'glacier-cave') return GLACIER_CAVE_START;
  if (name === 'glacier-cave-interior') {
    const { eye, target } = env.glacierCave.views.interior;
    const [x,,z] = eye;
    return {x,z,heading:Math.atan2(target[0]-x,target[2]-z),footMode:true};
  }
  if (name === 'fairmont') return FAIRMONT_START;
  if (name === 'dustys') return DUSTYS_START;
  if (name === 'come-along') return COME_ALONG_START;
  if (name === 'inukshuk') return INUKSHUK_START;
  if (name === 'olympic-plaza') return OLYMPIC_PLAZA.start;
  if (name === 'creekside' || name === 'creekside-slope') {
    const lift=LIFTS.find(l=>l.name==='Creekside Gondola');
    if(lift){
      const [x,z]=lift.points[0], [xb,zb]=lift.points[1];
      const angle=Math.atan2(xb-x,zb-z);
      const sx=x-22*Math.sin(angle),sz=z-22*Math.cos(angle);
      return {x:sx,z:sz,heading:Math.atan2(x-sx,z-sz),holdAtUnload:true};
    }
  }
  return startPose();
}

function photoView(name) {
  if(name==='skiers-plaza')return SKIERS_PLAZA_VIEW;
  if (name === 'alpine-cliffs') return env.alpineCliffs.view;
  if (name === 'glacier-cave') return env.glacierCave.views.entrance;
  if (name === 'glacier-cave-interior') return env.glacierCave.views.interior;
  if(name==='fairmont')return FAIRMONT_VIEW;
  if(name==='dustys')return DUSTYS_VIEW;
  if(name==='creekside-slope')return CREEKSIDE_SLOPE_VIEW;
  if(name==='valley')return VALLEY_VIEW;
  if(name==='valley-forest')return VALLEY_FOREST_VIEW;
  if(name==='inukshuk')return INUKSHUK_VIEW;
  return null;
}

function pedestrianArrival(pose) {
  return pose.footMode || pose===OLYMPIC_PLAZA.start || pose===FAIRMONT_START || pose===INUKSHUK_START || pose===DUSTYS_START
    || pose===GLACIER_CAVE_START || pose===SKIERS_PLAZA_START || pose===WILDLIFE_START;
}

function openMountainPanel() {
  const dialog=$('mountain-panel');
  if(dialog.open||transitioning||finished)return;
  releaseMouseLook();
  panelReturn=playing ? (paused?'pause':'game') : 'menu';
  if(playing){paused=true;keysBackupClear();}
  for(const [id,key] of [['select-season','season'],['select-weather','weather'],['select-light','time'],['select-traffic','traffic']])
    $(id).value=climate.state[key];
  updateConditionsClock();
  dialog.showModal();
}

function closeMountainPanel(resume=true) {
  if($('mountain-panel').open)$('mountain-panel').close();
  if(resume && panelReturn==='game')resumeGame();
  panelReturn=null;
}

function openShop(shop){
  if(!outfitter||outfitter.dialog.open||transitioning)return;
  if(scenicPose)leaveScenicView();
  shopReturn=$('mountain-panel').open ? panelReturn : paused?'pause':playing?'game':'menu';
  closeMountainPanel(false);releaseMouseLook();keysBackupClear();
  if(playing)paused=true;
  outfitter.open(shop);
}
function closeShop(){
  outfitter.dialog.close();
  if(shopReturn==='game')resumeGame();
  else if(shopReturn==='pause')ui.showModal('pause');
  shopReturn=null;
}

function enterScenicView(name,view) {
  if(!view)return;
  const {eye,target,fov}=view;
  scenicTarget.fromArray(target);
  scenicPose={name,fov,eye:new THREE.Vector3(...eye),aspect:view.aspect||1.5};
  if (name === 'glacier-cave-interior') {
    const dx = target[0]-eye[0], dy = target[1]-eye[1], dz = target[2]-eye[2];
    scenicPose.yaw = Math.atan2(dx,dz);
    scenicPose.pitch = Math.atan2(dy,Math.hypot(dx,dz));
  }
  camera.position.copy(scenicPose.eye);
  camera.up.set(0,1,0);camera.lookAt(scenicTarget);
  frameScenicView();
  keysBackupClear();ui.clearToasts();ui.hidePrompt();ui.setHud(false);
  player.model.visible=false;
  $('scenic-controls').hidden=false;
}

function frameScenicView() {
  const {fov,aspect}=scenicPose;
  // On narrow screens keep the entire referent inside the horizontal frame.
  camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(fov/2))*Math.max(1,aspect/camera.aspect)));
  camera.updateProjectionMatrix();
}

function leaveScenicView() {
  if(!scenicPose)return;
  scenicPose=null;
  $('scenic-controls').hidden=true;
  clearReferencePhoto();
  player.model.visible=true;player.snapCamera();ui.setHud(true);keysBackupClear();updatePrompt();
}

function clearReferencePhoto() {
  if(referenceUrl)URL.revokeObjectURL(referenceUrl);
  referenceUrl=null;
  const image=$('scenic-reference');image.hidden=true;image.removeAttribute('src');
  $('scenic-blend').hidden=true;$('scenic-file').value='';
  $('scenic-load').textContent='Overlay photo';
}

async function travelTo(name,photo=false) {
  const pose=arrivalPose(name);
  closeMountainPanel(false);
  if (name === 'bike') climate.set({season:'summer',weather:'clear'},{instant:true});
  if(['olympic-plaza','fairmont','creekside-slope'].includes(name))climate.set({time:'blue-hour'},{instant:true});
  if(!playing){
    await startGame(pose);
    if (name === 'bike') {
      climate.set({season:'summer',weather:'clear'},{instant:true});
      updatePrompt();
    }
    if(photo)enterScenicView(name,photoView(name));
    return;
  }
  if(transitioning)return;
  keysBackupClear();ui.hideModals();resetRunState(false);
  const arrival = name === 'bike' ? expeditions.arrival('bike',true) : pose;
  player.footMode=pedestrianArrival(arrival);
  player.teleport(arrival,{resetStats:true});ui.clearToasts();ui.findNearest(player,true,displayTime);ui.setHud(true);
  lastFrame=performance.now();updatePrompt();
  if(photo)enterScenicView(name,photoView(name));
}

async function startCourse(id) {
  if(transitioning)return;
  closeMountainPanel(false);
  if(!playing)await startGame(startPose());
  ui.hideModals();resetRunState(false);keysBackupClear();
  climate.set({season:'winter'},{instant:true});
  challenges.start(id,player);ui.setHud(true);lastFrame=performance.now();
}

function bindMountainPanel() {
  const dialog=$('mountain-panel');
  for(const [id,key,options] of [['select-season','season',CLIMATE_PRESETS.seasons],
    ['select-weather','weather',CLIMATE_PRESETS.weather],['select-light','time',CLIMATE_PRESETS.times],
    ['select-traffic','traffic',CLIMATE_PRESETS.traffic]]){
    const select=$(id);
    for(const [value,item] of Object.entries(options))select.add(new Option(item.label,value));
    select.addEventListener('change',()=>climate.set({[key]:select.value}));
  }
  $('mountain-done').onclick=()=>closeMountainPanel();
  dialog.addEventListener('cancel',e=>{e.preventDefault();closeMountainPanel();});
  $('menu-mountain').onclick=$('pause-mountain').onclick=openMountainPanel;
  for (const button of arrivalButtons) {
    button.onclick = () => travelTo(button.dataset.arrival, button.hasAttribute('data-photo'));
  }
  $('scenic-return').onclick=leaveScenicView;
  $('mountain-outfitter').onclick=openShop;
  const file=$('scenic-file'),preview=$('scenic-reference'),opacity=$('scenic-opacity');
  $('scenic-load').onclick=()=>file.click();
  file.onchange=()=>{
    const photo=file.files[0];if(!photo)return;
    clearReferencePhoto();
    referenceUrl=URL.createObjectURL(photo);
    preview.onload=()=>{
      if(!referenceUrl)return;
      preview.hidden=false;$('scenic-blend').hidden=false;
      $('scenic-load').textContent='Change photo';
      opacity.value='50';preview.style.opacity='.5';
    };
    preview.onerror=()=>{clearReferencePhoto();$('scenic-load').textContent='Choose another image';};
    preview.src=referenceUrl;
  };
  opacity.oninput=()=>{preview.style.opacity=Number(opacity.value)/100;};
  for (const button of courseButtons) button.onclick = () => startCourse(button.dataset.course);
  dialog.querySelector('[data-minigame="sled"]').onclick = async () => {
    releaseMouseLook();
    const { openSledGame } = await import('./sled-game.js');
    openSledGame();
  };
  $('course-retry').onclick=()=>{if(challenges.state)startCourse(challenges.state.id);};
  $('course-explore').onclick=()=>challenges.clear();
}

function finishRun(title) {
  if (finished) return;
  finished = true;
  paused = true;
  keysBackupClear();
  ui.hidePrompt();
  const nearest = ui.findNearest(player, true, displayTime);
  ui.showSummary({
    title,
    liftAvailable: nearbyLifts(true).length > 0,
    score,
    topSpeed: player.stats.topSpeed,
    vertical: player.stats.vertical,
    coins: collectibles.coinCount,
    crystals: collectibles.crystalCount,
    longestAir: player.stats.longestAir,
    trail: nearest ? nearest.run.name : 'Alpine',
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

/* ── lift rides ────────────────────────────────────────────── */

const liftDestinations = {
  [FITZSIMMONS]: { label: 'Fitzsimmons top · Fitz to Lower Olympic', trail: 'way/1174890341' },
  [PEAK_TO_PEAK]: { label: 'Rendezvous Lodge · Blackcomb', pose: { x: 3821, z: 1914, heading: -1.99, holdAtUnload: true } },
  [PEAK_EXPRESS]: { label: 'Whistler Peak · Top of the World', pose: { x: -283, z: 5976, heading: .9, holdAtUnload: true } },
  [VILLAGE_GONDOLA_UPPER]: { label: 'Roundhouse Lodge · Whistler', pose: startPose() },
  'way-29362437': { label: 'Rendezvous Lodge · Blackcomb', trail: 'way/39993424' },
};
const roundhouse = { label: 'Roundhouse Lodge · Whistler', pose: { x: 531, z: 4862, heading: 2.22 } };

function liftDestination(lift, direction) {
  return direction ? roundhouse : liftDestinations[lift.def.id] || { label: lift.def.type === 'surface' ? 'Top of the track' : 'Upper station' };
}

function nearbyLifts(atFinish = false) {
  if (!player.grounded || player.crash || (!atFinish && player.speedKmh > 22)) return [];
  if (env.interiorAt?.(player.pos.x, player.pos.z, player.pos.y)) return [];
  const choices = [];
  for (const lift of env.lifts.lifts) {
    if (!lift.def.rideable) continue;
    const last = lift.def.points.length - 1;
    for (const direction of lift.def.type === 'p2p' ? [0, 1] : [0]) {
      const site = stationSite(lift.def, direction ? last : 0);
      const distance = Math.hypot(player.pos.x - site.x, player.pos.z - site.z);
      const radius = lift.def.type === 'surface' ? 13 : lift.def.type === 'p2p' ? 72 : 52;
      if (distance <= radius) choices.push({ lift, direction, distance });
    }
  }
  return choices.sort((a, b) => a.distance - b.distance);
}

function selectedBoard(choices) {
  return choices.find(({ lift }) => lift.def.id === selectedLift)
    || choices.find(({ lift }) => lift.def.id === ui.routeGuide.nextLift) || choices[0];
}

function liftExit({ lift, direction, destination }) {
  const open = (x, z) => {
    const y = heightAt(x, z);
    return !env.grid.buildingsAt(x, z).length && !env.interiorAt(x, z, y) &&
      !env.queryColliders(x, z, 3).some(c => y >= (c.minY ?? -Infinity) && y <= (c.maxY ?? Infinity) &&
        (c.r ? Math.hypot(c.x - x, c.z - z) < c.r + .8 : env.pointInBox(x, z, c, .7, .7)));
  };
  if (destination.pose && open(destination.pose.x, destination.pose.z)) return destination.pose;
  if (destination.trail) {
    const run = runFromSource(destination.trail);
    if (run) {
      const p = runPointAt(run, Math.min(0.22, 12 / run.length));
      if (open(p.x, p.z)) return { x: p.x, z: p.z, heading: Math.atan2(p.tx, p.tz) };
    }
  }
  const site = stationSite(lift.def, direction ? 0 : lift.def.points.length - 1);
  const { x, z, yaw } = site;
  const surface = lift.def.type === 'surface';
  const exit = stationPoint(site, 0, surface ? -3.5 : -15);
  if (surface && open(exit.x, exit.z)) return { ...exit, heading: yaw + Math.PI, holdAtUnload: true };
  const base = heightAt(x, z);
  let best = null;
  for (const run of RUNS) {
    for (const p of run.samples) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < 14 || d > 95 || (best && d >= best.d)) continue;
      const h = heightAt(p.x, p.z);
      const drop = h - heightAt(p.x + p.tx * 12, p.z + p.tz * 12);
      if (Math.abs(h - base) > 31 || drop <= 0.6) continue;
      if (!open(p.x, p.z)) continue;
      best = { x: p.x, z: p.z, heading: Math.atan2(p.tx, p.tz), d };
    }
  }
  if (best) return best;
  for (const radius of [surface ? 3.5 : 15, 19, 26, 34, 46, 62]) {
    for (const angle of [0, .45, -.45, .9, -.9, 1.55, -1.55, Math.PI]) {
      const p = stationPoint(site, radius * Math.sin(angle), -radius * Math.cos(angle));
      if (open(p.x, p.z)) return { ...p, heading: yaw + Math.PI - angle, holdAtUnload: true };
    }
  }
  return { ...exit, heading: yaw + Math.PI, holdAtUnload: true };
}

async function boardLift(choice = selectedBoard(nearbyLifts())) {
  if (!playing || paused || finished || transitioning || ride || !choice) return;
  challenges.clear();
  transitioning = true;
  keysBackupClear();
  ui.hidePrompt();
  ui.fade(true, true);
  audio.gondolaStart();
  await wait(360);

  const { lift, direction } = choice;
  const sampler = lift.samplers[direction];
  const destination = liftDestination(lift, direction);
  const surface = lift.def.type === 'surface';
  const haul=lift.circulation?.sections[direction*2];
  const travel=haul?.duration??sampler.total/lift.def.speed,berth=lift.def.type==='p2p'?PEAK_TO_PEAK_BERTH_TIME:0;
  ride = {
    lift, direction, sampler, destination,
    t: 0, dur: travel+berth*2, travel, berth, haul, view: surface ? 'forward' : 'valley', blend: surface ? 0 : 1,
    lookOffset: 0, lookPitch: 0, arm: 1,
    inside: lift.def.type === 'gondola' || lift.def.type === 'p2p',
  };
  if (ride.inside) {
    ride.cabin = new GondolaInterior(scene, lift.def.type === 'p2p', lift.def.name === 'Creekside Gondola', lift.def.name);
    camera.near = .045;
    camera.updateProjectionMatrix();
  }
  ride.exit = liftExit(ride);
  player.setRiding(true);
  player.model.visible = false;
  ui.cinematic(true, { title: lift.def.name, sub: destination.label });
  ui.setRideView(ride.view,ride.lift.def.type === 'chair');
  updateRideControls();
  updateRide(0);
  ui.fade(false, true);
  transitioning = false;
}

function placeRideCamera(progress, dt) {
  const { lift, direction, sampler, view, berth, travel } = ride;
  const t = direction ? 1 - progress : progress;
  const berthOpening=berth?peakToPeakBerthOpening(ride.t<berth?ride.t:ride.t-berth-travel,ride.t<berth):undefined;
  const doorOpening=env.lifts.setPassenger(lift,direction,t,berthOpening);
  sampler.at(t, _ridePos, _rideTan);
  const forward = Math.atan2(_rideTan.x, _rideTan.z) + (direction ? Math.PI : 0);
  if (ride.cabin) {
    // Keep fleet overlap suppression, replacing only the occupied opaque shell.
    lift.passenger.visible = false;
    ride.cabin.update(_ridePos, forward, ride.t, doorOpening);
    player.pos.set(_ridePos.x, _ridePos.y - 2, _ridePos.z);
    if (ride.inside) {
      ride.cabin.move(dt, keys);
      ride.cabin.placeCamera(camera);
      if (camera.fov !== 75) { camera.fov = 75; camera.updateProjectionMatrix(); }
      return;
    }
  }
  camera.up.set(0, 1, 0);
  // Face back down the chair line, or across the valley from the tram.
  const valleyYaw = lift.def.type === 'p2p' ? -0.35 : Math.PI * 0.83;
  const steer = Number(!!(keys.KeyD || keys.ArrowRight)) - Number(!!(keys.KeyA || keys.ArrowLeft));
  ride.lookOffset = wrapAngle(ride.lookOffset - steer * dt * 0.93);
  const settle = 1 - Math.exp(-Math.min(.15, dt) * 4.3);
  ride.blend += ((view === 'valley' ? 1 : 0) - ride.blend) * settle;
  const yaw = forward + ride.lookOffset + ride.blend * valleyYaw;
  const chair = lift.def.type === 'chair';
  if (lift.def.type === 'surface') {
    if (lift.def.surfaceType === 't-bar') {
      _ridePos.x -= Math.cos(forward) * 1.1;
      _ridePos.z += Math.sin(forward) * 1.1;
    }
    _ridePos.y = Math.max(_ridePos.y, heightAt(_ridePos.x, _ridePos.z) + .02);
    player.pos.copy(_ridePos);
    camera.position.copy(_ridePos).y += 1.62;
    _rideLook.set(camera.position.x + Math.sin(yaw) * 35, camera.position.y + _rideTan.y * 22 - 2 + Math.tan(ride.lookPitch) * 35,
      camera.position.z + Math.cos(yaw) * 35);
    camera.lookAt(_rideLook);
    if (camera.fov !== 74) { camera.fov = 74; camera.updateProjectionMatrix(); }
    return;
  }
  camera.position.set(_ridePos.x, _ridePos.y - (chair ? 1.24 : 0.8), _ridePos.z);
  // Keep the seated eye on the same chair when changing the direction of view.
  camera.position.x += Math.sin(forward) * .18;
  camera.position.z += Math.cos(forward) * .18;
  _rideLook.set(
    camera.position.x + Math.sin(yaw) * 45,
    camera.position.y - (.7 + ride.blend * 5.8) + Math.tan(ride.lookPitch) * 45,
    camera.position.z + Math.cos(yaw) * 45,
  );
  if (!chair || view === 'chase') {
    // Orbit the occupied carrier from the side and ease the arm back out once it clears a support.
    const sideYaw = yaw + .88, length = chair ? 8.4 : 10.4;
    _rideAnchor.set(_ridePos.x,_ridePos.y-1.6,_ridePos.z);
    _rideView.set(_ridePos.x - Math.sin(sideYaw) * length, _ridePos.y + .9 - ride.lookPitch * length * .38,
      _ridePos.z - Math.cos(sideYaw) * length);
    camera.position.copy(_rideView);
    const clear = env.clipCameraArm(_rideAnchor.x,_rideAnchor.y,_rideAnchor.z,camera.position);
    const fraction = clear / Math.max(.001,_rideAnchor.distanceTo(_rideView));
    ride.arm = dt <= 0 ? fraction : Math.min(fraction,ride.arm + (fraction-ride.arm)*(1-Math.exp(-2.8*dt)));
    camera.position.copy(_rideAnchor).lerp(_rideView,ride.arm);
    _rideLook.set(_ridePos.x + Math.sin(yaw)*4, _ridePos.y - 2.0,
      _ridePos.z + Math.cos(yaw)*4);
  }
  camera.lookAt(_rideLook);
  const fov = view === 'chase' ? 70 : 76;
  if (camera.fov !== fov) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  player.pos.set(_ridePos.x, _ridePos.y - 2, _ridePos.z);
}

function changeRideView() {
  if (!ride || paused || transitioning) return;
  if (ride.inside) ride.inside = false;
  else if (ride.view === 'valley') ride.view = 'forward';
  else if (ride.view === 'forward' && ride.lift.def.type === 'chair') ride.view = 'chase';
  else ride.view = 'valley';
  ride.lookOffset = 0;
  ride.lookPitch = 0;
  ui.setRideView(ride.view,ride.lift.def.type === 'chair');
  updateRideControls();
}

function enterRideCabin() {
  if (!ride?.cabin || paused || transitioning) return;
  ride.inside = !ride.inside;
  keysBackupClear();
  updateRideControls();
}

function updateRideControls() {
  const inside = !!ride?.inside;
  const button = $('ride-cabin');
  if (button) {
    button.classList.toggle('hidden', !ride?.cabin);
    button.innerHTML = `${inside ? 'Scenic view' : 'Walk inside'} <kbd>V</kbd>`;
  }
  const hint = $('ride-hint');
  if (hint) {
    hint.textContent = inside ? 'WASD walk · arrows or drag to look'
      : 'Drag or A / D to look · C change view';
  }
  if (inside && $('ride-view-label')) $('ride-view-label').textContent = 'Valley view';
  else if (ride) ui.setRideView(ride.view,ride.lift.def.type === 'chair');
}

function updateRide(dt) {
  ride.t = Math.min(ride.dur, ride.t + dt);
  const onboard = clamp(ride.t-ride.berth,0,ride.travel);
  const progress = ride.haul?.distanceFractionAt(onboard)??onboard/ride.travel;
  placeRideCamera(progress, dt);
  ui.updateRide(progress, ride.sampler.total * (1 - progress), ride.dur - ride.t);
  if (ride.t >= ride.dur && !transitioning) arriveFromRide();
}

async function arriveFromRide() {
  if (!ride || paused || transitioning) return;
  transitioning = true;
  keysBackupClear();
  const { exit, destination, lift } = ride;
  ui.fade(true, true);
  audio.gondolaStop();
  await wait(360);

  env.lifts.setPassenger(null);
  player.teleport(exit, { resetStats: true });
  resetRunState(false);
  finishCooldown = 5;
  ui.fade(false, true);
  ui.toast(lift.def.name, destination.label, 'blue', 'lift');
  lastFrame = performance.now();
  transitioning = false;
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
  outfitter.credit(coin.hidden?2:1);
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
  outfitter.find('crystal-'+crystal.name,12);
  streak += 1;
  comboTimer = COMBO_TIME;
  multiplier = comboMultiplier();
  const gained = Math.round(900 * multiplier);
  crystalScore += gained;
  audio.crystal();
  ui.floaty('CRYSTAL FOUND', { big: true, cyan: true, y: 38 });
  ui.toast(crystal.name.toUpperCase(), `+${formatNumber(gained)}`, 'gold', 'crystal');
  if (collectibles.crystalCount >= collectibles.totalCrystals) {
    setTimeout(() => {
      ui.toast('ALL FIVE CRYSTALS', 'You know this mountain better than the locals.', 'gold', 'star');
    }, 900);
  }
}

function onPlayerEvent(event) {
  if (!event) return;
  if (event.type === 'launch' || event.type === 'ollie') {
    heldAtTakeoff.clear();
    for (const key of trickKeys) if (keys[key]) heldAtTakeoff.add(key);
    if (event.type === 'launch') audio.launch();
  } else if (event.type === 'land') {
    const mult = comboMultiplier();
    const gained = Math.round((event.points || 0) * mult * (player.landingTrickMultiplier ?? 1));
    trickScore += gained;
    audio.land(event.impact, event.points);
    if (event.airTime > 0.55) {
      const label = event.label || 'CLEAN AIR';
      ui.floaty(label, { big: true, x: 50, y: 40 });
      if (gained > 40) ui.floaty(`+${formatNumber(gained)}`, { x: 50, y: 47 });
        if (event.boost) {
          ui.toast(label, `${event.boost.toFixed(1)}s boost · +${formatNumber(gained)}`, 'gold', 'star');
        audio.tone(880, { dur: 0.18, type: 'triangle', gain: 0.02, when: 0.08 });
      }
    }
  } else if (event.type === 'crash') {
    trickScore = 0;
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

function nearbyDiningCounter() {
  const { x, y, z } = player.pos;
  return player.footMode ? env.interiors?.serviceAt?.(x,z,y) : null;
}

function nearbyShop() {
  if (!player.footMode) return null;
  const { x, y, z } = player.pos;
  const room = env.interiorAt?.(x,z,y);
  return room?.kind === 'outfitter' || room?.kind === 'barber' ? room : null;
}

function interact() {
  if (!playing || paused || transitioning || finished || scenicPose) return;
  if(ride){arriveFromRide();return;}
  if(quests.act(quests.nearby()))return;
  if(expeditions.active){
    if(!expeditions.leave(player))ui.toast('Land first','Left Shift to descend','blue','lift');
    updatePrompt();return;
  }
  const vehicle=player.grounded && player.speed < 3 && expeditions.nearest(player.pos);
  if(vehicle){
    challenges.clear();expeditions.board(vehicle,player);player.clearBoost();
    ui.prompt(vehicle.label,expeditions.controls(vehicle),false);
    return;
  }
  const counter=nearbyDiningCounter();
  if(counter){
    const bought=outfitter.spend(counter.price);
    ui.toast(bought?counter.item:'More mountain coins needed',
      bought?`Paid ${counter.price} · ${outfitter.state.balance} coins left`:`${counter.item} costs ${counter.price} coins`,
      bought?'green':'blue',bought?'check':'coin');
    return;
  }
  const animal=wildlife.nearest(player.pos);
  if(animal){
    const first=wildlife.observe(animal);
    if(first!==undefined)ui.toast(animal.title,first?'Wildlife sighting · 4 coins':'Wildlife sighting','green','star');
    return;
  }
  const shop=nearbyShop();
  if(shop){openShop(shop);return;}
  boardLift();
}

function updatePrompt() {
  const assignment=quests.nearby();
  if(assignment){ui.prompt(assignment.title,assignment.detail,false);return;}
  const machine=player.grounded && player.speed < 3 && expeditions.nearest(player.pos);
  if(machine){ui.prompt(machine.label,'Enter · W/S travel · A/D steer',false);return;}
  const counter=nearbyDiningCounter();
  if(counter){ui.prompt(counter.title,`Buy ${counter.item} · ${counter.price} coins`,false);return;}
  const animal=wildlife.nearest(player.pos);
  if(animal){ui.prompt(animal.title,'Observe quietly',false);return;}
  const shop=nearbyShop();
  if(shop){
    ui.prompt(shop.name,shop.kind==='barber'?'Choose a haircut and color':'Browse outerwear, footwear and skis',false);return;
  }
  const choices = nearbyLifts();
  const board = selectedBoard(choices);
  if (!board) {
    selectedLift = null;
    ui.hidePrompt();
    return;
  }
  const { lift, direction } = board;
  ui.prompt(lift.def.name, 'Ride to '+liftDestination(lift, direction).label, choices.length > 1);
}

function selectNextLift() {
  const choices = nearbyLifts();
  if (choices.length < 2) return;
  const current = selectedBoard(choices);
  selectedLift = choices[(choices.indexOf(current) + 1) % choices.length].lift.def.id;
  updatePrompt();
}

function checkFinish(dt) {
  if (finishCooldown > 0) finishCooldown = Math.max(0, finishCooldown - dt);
  if (finished || finishCooldown > 0) return;
  for (const arch of env.finishArches || []) {
    if (Math.hypot(player.pos.x - arch.x, player.pos.z - arch.z) < 15) {
      finishRun(arch.title);
      return;
    }
  }
}

/* ── input ──────────────────────────────────────────────────── */

function bindKeys() {
  window.addEventListener('keydown', (event) => {
    if ((event.code === 'Enter' || event.code === 'Space') && event.target.closest?.('.touch-controls button')) return;
    if(outfitter?.dialog.open)return;
    if (ui.isOpen('guide')) {
      if (event.code === 'Escape' && !event.repeat) closeGuide();
      return;
    }
    if ($('mountain-panel').open) return;
    if(event.code==='KeyL'&&!event.repeat&&!finished&&!ui.isOpen('map')){openShop();return;}
    if(scenicPose && !ui.isOpen('map') && event.code!=='KeyM'){
      if(event.target.closest?.('.photo-tools') && event.code!=='Escape' && event.code!=='KeyG')return;
      if(event.code==='KeyG'){leaveScenicView();openMountainPanel();}
      else if (['Escape','Enter','Space','KeyW','KeyA','KeyS','KeyD','KeyC'].includes(event.code))leaveScenicView();
      else return;
      event.preventDefault();return;
    }
    if (event.code === 'KeyG' && !event.repeat && !transitioning && !ui.isOpen('map')) {
      openMountainPanel();return;
    }
    if (event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'ArrowDown') {
      event.preventDefault();
    }
    if (event.repeat) {
      keys[event.code] = true;
      return;
    }
    keys[event.code] = true;

    if (event.code === 'Enter' && !playing && !ui.isOpen('map') && !event.target.closest?.('button')) {
      startGame();
      return;
    }

    if (event.code === 'Escape') {
      if (ui.isOpen('map')) { closeMap(); return; }
      if (ui.isOpen('summary')) { keepExploring(); return; }
      if (ui.isOpen('pause')) { resumeGame(); return; }
      if (playing && !finished) pauseGame();
      return;
    }

    if (event.code === 'KeyM') {
      if (ui.isOpen('map')) closeMap();
      else if (ui.isOpen('pause')) openMap('pause');
      else if (ui.isOpen('summary')) openMap('summary');
      else openMap();
      return;
    }

    if (event.code === 'KeyE') {interact();return;}

    if (event.code === 'KeyQ' && playing && !paused && !finished && !ride && !transitioning) {
      selectNextLift();
      return;
    }

    if (event.code === 'KeyR') {
      if (!playing || transitioning) return;
      if (ui.isOpen('summary')) rideAgain();
      else resetToRoundhouse();
      return;
    }

    if (event.code === 'KeyB') {
      toggleFootMode();
      return;
    }

    if (event.code === 'KeyC') {
      if (ride) { changeRideView(); return; }
      if (!playing || paused || finished || transitioning) return;
      if(quests.winchPassenger)return;
      if(expeditions.active){expeditions.changeView();return;}
      const label = player.cycleCamera();
      ui.setCameraLabel(label);
      audio.ui();
      return;
    }

    if (event.code === 'KeyV' && ride?.cabin) {
      enterRideCabin();
      return;
    }

    if (event.code === 'Space' && playing && !paused && !finished && !ride) {
      ollieQueued = true;
    }
  });

  window.addEventListener('keyup', (event) => {
    keys[event.code] = false;
    heldAtTakeoff.delete(event.code);
  });

  window.addEventListener('blur', () => {
    keysBackupClear();
    if (playing && !paused && !finished && !ride) pauseGame();
  });

  let drag = null;
  const canvas=renderer.domElement;
  const canLook=()=>playing&&!paused&&!finished&&!transitioning&&
    (!scenicPose||scenicPose.name==='glacier-cave-interior')&&!document.querySelector('dialog[open]');
  const look=(dx,dy)=>{
    if(scenicPose?.name==='glacier-cave-interior'){
      const { eye } = scenicPose;
      const yaw = scenicPose.yaw = wrapAngle(scenicPose.yaw - dx*.003);
      const pitch = scenicPose.pitch = clamp(scenicPose.pitch - dy*.003,-1.32,1.32);
      scenicTarget.set(eye.x + Math.sin(yaw)*Math.cos(pitch), eye.y + Math.sin(pitch),
        eye.z + Math.cos(yaw)*Math.cos(pitch));
      camera.lookAt(scenicTarget);
    }
    else if(quests.winchPassenger)quests.lookWinch(dx,dy);
    else if(expeditions.active)expeditions.look(dx,dy);
    else if(ride?.inside)ride.cabin.look(dx,dy);
    else if(ride) {
      ride.lookOffset = wrapAngle(ride.lookOffset - dx*.003);
      ride.lookPitch = clamp(ride.lookPitch - dy*.003,-.86,.78);
    }
    else player.lookAround(dx,dy);
  };
  renderer.domElement.addEventListener('pointerdown', (event) => {
    if (!canLook() || event.button !== 0) return;
    if (event.pointerType === 'mouse' && !ride && !expeditions.active && !scenicPose && !quests.winchPassenger) player.swingPole();
    drag = { x: event.clientX, y: event.clientY };
    if(event.pointerType==='mouse' && canvas.requestPointerLock){
      try { canvas.requestPointerLock()?.catch(()=>{}); } catch { /* drag remains available */ }
    }else canvas.setPointerCapture(event.pointerId);
  });
  document.addEventListener('pointerlockchange',()=>{drag=null;});
  document.addEventListener('mousemove',e=>{
    if(document.pointerLockElement===canvas && canLook())look(e.movementX,e.movementY);
  });
  renderer.domElement.addEventListener('pointermove', (event) => {
    if (!drag || !canLook() || document.pointerLockElement===canvas) return;
    look(event.clientX-drag.x, event.clientY-drag.y);
    drag = { x: event.clientX, y: event.clientY };
  });
  const endDrag = () => { drag = null; };
  renderer.domElement.addEventListener('pointerup', endDrag);
  renderer.domElement.addEventListener('pointercancel', endDrag);
  renderer.domElement.addEventListener('lostpointercapture', endDrag);
}

function releaseMouseLook(){
  if(document.pointerLockElement===renderer?.domElement)document.exitPointerLock();
}

function keysBackupClear() {
  touchControls?.releaseAll();
  for (const key of Object.keys(keys)) keys[key] = false;
  heldAtTakeoff.clear();
  ollieQueued = false;
}

function toggleFootMode() {
  if (!playing || paused || finished || ride || expeditions.active || quests.winchPassenger || transitioning || player.crash) return;
  if (!player.canChangeFootMode()) {
    ui.toast('Slow down to change gear', 'Switch between boots and skis on the ground.', '', 'check');
    return;
  }
  if (player.footMode && env.interiorAt?.(player.pos.x, player.pos.z, player.pos.y)) {
    ui.toast('Skis off indoors', 'Step outside to put your skis on.', '', 'check');
    return;
  }
  if (player.footMode && player.surfaceType === 'ground') {
    ui.toast('On foot', 'Reach a snow-covered trail to put your skis on.', '', 'check');
    return;
  }
  player.toggleFootMode();
  audio.ui();
}

function buildInput() {
  const grounded = player.grounded && !player.crash;
  const active = (key) => keys[key] && (grounded || !heldAtTakeoff.has(key));
  input.steer = Number(!!(active('KeyD') || active('ArrowRight'))) - Number(!!(active('KeyA') || active('ArrowLeft')));
  input.walkForward = player.footMode ? Number(!!keys.KeyW) - Number(!!keys.KeyS) : 0;
  input.walkRun = player.footMode && !!(keys.ShiftLeft || keys.ShiftRight);
  input.tuck = grounded && !player.footMode && !!keys.KeyW;
  input.brake = grounded && !player.footMode && !!keys.KeyS;
  input.flip = grounded ? 0 : Number(!!active('KeyS')) - Number(!!active('KeyW'));
  input.grab = !!(keys.ShiftLeft || keys.ShiftRight);
  input.ollie = !player.footMode && ollieQueued;
  input.air = !grounded;
  ollieQueued = false;
}

/* ── UI wiring ──────────────────────────────────────────────── */

function bindUI() {
  bindMountainPanel();
  touchControls = installTouchButtons({
    keys, queueJump: () => { ollieQueued = true; },
    clearJump: () => { ollieQueued = false; },
    releaseKey: code => heldAtTakeoff.delete(code),
    cycleCamera: () => {
      if (ride) changeRideView();
      else if (expeditions.active) expeditions.changeView();
      else ui.setCameraLabel(player.cycleCamera());
    },
    openMountain: openMountainPanel, pause: pauseGame,
  });
  $('drop-in')?.addEventListener('click', () => startGame());
  $('village-start')?.addEventListener('click', () => startGame(VILLAGE_START));
  $('board-lift')?.addEventListener('click', interact);
  $('next-lift')?.addEventListener('click', selectNextLift);
  $('ride-skip')?.addEventListener('click', arriveFromRide);
  $('ride-view')?.addEventListener('click', changeRideView);
  const rideControls = $('ride-view')?.parentElement;
  if (rideControls) {
    const cabinButton = document.createElement('button');
    cabinButton.type = 'button';
    cabinButton.id = 'ride-cabin';
    cabinButton.className = 'lift-control hidden';
    cabinButton.addEventListener('click', enterRideCabin);
    rideControls.prepend(cabinButton);
    const hint = document.createElement('p');
    hint.id = 'ride-hint';
    hint.style.cssText = 'flex-basis:100%;margin:5px 0 0;font-size:11px;line-height:1.5;opacity:.78';
    rideControls.append(hint);
    rideControls.style.flexWrap = 'wrap';
  }
  $('how-to-btn')?.addEventListener('click', openGuide);
  $('pause-guide')?.addEventListener('click', openGuide);
  $('guide-drop')?.addEventListener('click', () => {
    if (playing) { closeGuide(); return; }
    ui.hideModals();
    startGame();
  });

  $('map-open')?.addEventListener('click', () => openMap('game'));
  $('pause-map')?.addEventListener('click', () => openMap('pause'));
  $('summary-map')?.addEventListener('click', () => openMap('summary'));
  $('resume')?.addEventListener('click', resumeGame);
  $('pause-reset')?.addEventListener('click', resetToRoundhouse);
  $('gear-mode')?.addEventListener('click', toggleFootMode);
  $('restart-session')?.addEventListener('click', () => restartSession(true));
  $('ride-again')?.addEventListener('click', rideAgain);
  $('keep-skiing')?.addEventListener('click', keepExploring);
  $('summary-lift')?.addEventListener('click', () => {
    const choices = nearbyLifts(true);
    if (!choices.length) return;
    keepExploring();
    boardLift(choices[0]);
  });

  document.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.getAttribute('data-close');
      if (id === 'map-screen') closeMap();
      else if (id === 'pause-screen') resumeGame();
      else if (id === 'guide-screen') { closeGuide(); return; }
      else ui.hideModals();
      audio.ui();
    });
  });

  $('audio-toggle-menu')?.addEventListener('click', toggleAudio);
  $('pause-audio')?.addEventListener('click', toggleAudio);
  const musicButton = $('pause-music');
  function showMusicSetting() {
    musicButton.classList.toggle('on', audio.musicEnabled);
    musicButton.setAttribute('aria-pressed', String(audio.musicEnabled));
    musicButton.querySelector('span').textContent = audio.musicEnabled ? 'ON' : 'OFF';
  }
  musicButton.addEventListener('click', () => { audio.toggleMusic(); showMusicSetting(); });
  showMusicSetting();

  $('pause-markers')?.addEventListener('click', () => {
    markersOn = !markersOn;
    env.setMarkersVisible(markersOn);
    ui.setMarkers(markersOn);
    audio.ui();
  });

  $('pause-nearby-map')?.addEventListener('click', () => {
    ui.toggleNearbyMap();
    audio.ui();
  });

  $('pause-camera')?.addEventListener('click', () => {
    if (!player || quests.winchPassenger) return;
    const label = player.cycleCamera();
    ui.setCameraLabel(label);
    audio.ui();
  });

  performanceCalibration.bind({
    apply(next) { qualityIndex = next; applyQuality(); },
    resize: onResize,
    renderer,
  });
  bindRealism($('pause-realism'), query);

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
  const quality = graphicsProfiles[qualityIndex];
  setTerrainSamplingBudget(quality.name === 'BUDGET');
  terrain?.setQuality?.(quality.name);
  setForestQuality(quality.name);
  env?.setQuality?.(quality.name);
  sky?.setQuality?.(quality.name);
  applyShadowResolution(renderer, lighting.sun, quality.shadow);
  onResize();
}

function onResize() {
  if (!renderer || !camera) return;
  const host = $('webgl');
  const quality = graphicsProfiles[qualityIndex];
  resizeViewport({ host, renderer, camera, quality, storm, tuckWind, resolution: performanceCalibration.resolution,
    resolutionScale: performanceCalibration.resolutionScale });
  performanceCalibration.viewportChanged();
  if (scenicPose) frameScenicView();
}

/* ── frame ──────────────────────────────────────────────────── */

function updateIntroCamera(dt) {
  introTime += dt;
  const shot=introShot(camera,introTime,()=>introRiders??=createIntroRiders(scene),env.lifts,dt,shadowAnchor);
  if(shot!==previousShot){
    if(!shot.action)introRiders?.hide();
    if(!shot.lift&&previousShot?.lift)env.lifts.setPassenger(null);
    climate.set({time:shot.light},{instant:true});
    lastShadowTime=-Infinity;
    previousShot=shot;
  }
}

function updateSun(force = false) {
  if (!lighting?.sun?.castShadow || paused) return;
  const anchor = scenicPose ? scenicTarget : playing && player ? player.pos : shadowAnchor;
  const change = anchor.distanceToSquared(lastShadowAnchor);
  const { name, shadowInterval } = graphicsProfiles[qualityIndex];
  if (!force && !renderer.shadowMap.needsUpdate &&
      !sunShadowRefreshDue(displayTime - lastShadowTime, change, shadowInterval, name === 'BUDGET')) return;
  lastShadowTime = displayTime;
  lastShadowAnchor.copy(anchor);
  const flightHeight = expeditions.active?.id === 'helicopter' ? expeditions.active.clearance : 0;
  const radius = Math.round(73 + 126 * clamp((flightHeight - 20) / 105, 0, 1));
  updateSunShadow(renderer, lighting.sun, SUN_DIR, anchor, radius);
}

/* rAF stalls when the tab is not painting. Keep a slow timer fallback so
   the simulation and the loading sequence always make progress. */
let frameScheduled = false;
function scheduleFrame() {
  if (frameScheduled || (!playing && capturingIntro)) return;
  frameScheduled = true;
  const draw = (time, vsync) => {
    frameScheduled = false;
    frame(time, vsync);
  };
  if (document.hidden) {
    setTimeout(() => draw(performance.now(), false), 180);
    return;
  }
  const animationFrame = requestAnimationFrame((time) => {
    clearTimeout(timer);
    draw(time, true);
  });
  const timer = setTimeout(() => {
    cancelAnimationFrame(animationFrame);
    draw(performance.now(), false);
  }, performanceCalibration.testing ? 2000 : 160);
}

function frame(now, vsync) {
  if (rendererUnavailable) return;
  const callbackStart = frameObserver ? performance.now() : 0;
  const raw = (now - lastFrame) / 1000;
  const dt = clamp(Number.isFinite(raw) ? raw : 0.016, 0.001, 0.12);
  if (document.hidden) {
    performanceCalibration.interrupt();
    lastFrame = now;
    if (playing) {
      if(!transitioning && quests.winchLive)quests.update(Math.min(.5,Math.max(dt,raw)));
      multiplayer.update(0, trickScore, outfitter.broadcastOutfit, expeditions.active?.model, false);
    }
    scheduleFrame();
    return;
  }
  if (ui.isOpen('map') || document.getElementById('destination-selector')?.open || document.getElementById('sled-game')?.open) {
    performanceCalibration.interrupt();
    lastFrame = now;
    if(playing){
      if(!transitioning && quests.winchLive)quests.update(dt);
      multiplayer.update(0,trickScore,outfitter.broadcastOutfit ?? outfitter.state.outfit,expeditions.active?.model,false);
    }
    scheduleFrame();
    return;
  }
  const eligible = !paused && !transitioning && !finished && !ui.isOpen('guide') && !$('mountain-panel').open;
  if (!performanceCalibration.shouldRender(now, { eligible, vsync, context: playing ? 'game' : 'intro' })) {
    scheduleFrame();
    return;
  }
  lastFrame = now;
  frameObserver?.(callbackStart, vsync);
  climate.update(dt,camera, playing && !paused && !transitioning ? Math.min(.5, Math.max(0, raw)) : 0);
  const conditionsNow = climate.state;
  env.people.setDensity(conditionsNow.crowd);
  if ($('mountain-panel').open) updateConditionsClock();
  env?.forestLines?.update();
  valley?.update(dt,camera);
  displayTime = now / 1000;

  if (!playing) {
    skiPatrol?.update(0, null, camera, climate.state.season);
    updateIntroCamera(dt);
    updatePassGates(dt,null,camera);
    env?.update(dt, displayTime, camera);
    terrain.updateDetail(camera.position);
    updateSun();
    sky?.update(dt, camera);
    storm?.update(dt);
    collectibles.prepareRender(camera);
    renderTerrainFrame();
    performanceCalibration.didRender(now);
    scheduleFrame();
    return;
  }

  multiplayer.update(dt,trickScore,outfitter.broadcastOutfit ?? outfitter.state.outfit,expeditions.active?.model,!paused&&!transitioning);
  if(!transitioning && (!paused || quests.winchLive))quests.update(dt,paused ? undefined : keys);
  const passenger=quests.winchPassenger;
  const mounted=expeditions.active || passenger;
  terrain.streamDetail(player.pos, camera.position);
  expeditions.drawNear(camera.position);
  if(passenger)quests.hideParkedAircraft();
  if(passenger && !paused && !transitioning){
    updatePrompt();
  } else if(expeditions.active&&!paused&&!transitioning){
    expeditions.update(dt,keys,player,camera,displayTime);
    const v=expeditions.active;
    if(v){
      const assignment=quests.nearby();
      ui.prompt(assignment?.title??v.label,assignment?.detail??expeditions.controls(v),false);
    }
  } else if (!paused && !finished && !ride && !transitioning && !scenicPose) {
    buildInput();
    player.update(dt, input, displayTime);
    if (!player.footMode && player.grounded && (player.surfaceType === 'ground' ||
        env.interiorAt?.(player.pos.x, player.pos.z, player.pos.y))) {
      player.setFootMode(true);
    }
    collectibles.update(dt, displayTime, player, camera);
    elapsed += dt;
    updateCombo(dt);
    fieldNotes.update(player);
    updatePrompt();
    if (challenges.state) challenges.update(dt, player);
    else checkFinish(dt);
  } else if (ride && !paused && !transitioning) {
    updateRide(document.hidden ? 0 : clamp(raw, 0, 2));
    updateCombo(0);
  } else {
    ui.hidePrompt();
  }

  updatePassGates(paused?0:dt,playing&&!paused?player:null,camera,() => audio.tone(910,{dur:.065,gain:.025,type:'sine'}));
  env.people?.setListener({position:player.pos,audioEnabled:audio.enabled,audioReady:audio.ready,paused:paused || !!ride});
  const indoors = !!env.interiorAt?.(player.pos.x, player.pos.z, player.pos.y);
  const movingOnMountain = !paused && !transitioning && !scenicPose && !ride && !mounted && !indoors;
  const nearest = ui.findNearest(player, false, displayTime);
  travelTracker.update(dt, player, { active: movingOnMountain, nearest });
  if (!paused && !transitioning) snowTraffic.update(dt, player, env.people.people, conditionsNow, movingOnMountain);
  const enclosed = !!ride?.inside || indoors || scenicPose?.name === 'glacier-cave-interior';
  const skiingOnSnow = !scenicPose && !ride && !mounted && !indoors && !player.footMode && player.grounded && !player.crash;
  if (!paused || ride) ui.routeGuide.update(player, { riding: !!ride, hidden: !!(scenicPose || mounted || indoors) });
  terrain.updateSkiSnow(player, skiingOnSnow);
  skiContact.update(player, !ride && !mounted && !indoors && !scenicPose);
  if (!paused) {
    fx.update(dt);
    storm.update(dt, enclosed);
  }
  env.update(dt, displayTime, camera);
  skiPatrol.update(paused ? 0 : dt, scenicPose ? null : player, camera, climate.state.season);
  if(!paused)wildlife.update(dt,displayTime,climate.state.season,player.pos);
  sky.update(dt, camera);
  tracks.update(displayTime, player, skiingOnSnow);
  updateSun();

  score = Math.round(coinScore + trickScore + crystalScore);
  multiplier = comboMultiplier();

  ui.update({
    player,
    indoors,
    elapsed,
    score,
    streak,
    comboFraction,
    multiplier,
    collectibles,
    time: displayTime,
    nearest,
  });

  tuckWind.update(dt, player, !paused && !ride && !finished && !player.footMode);
  const listener = player.pos;
  const dining = env.interiors?.rooms || [];
  let tavern = clamp(1 - Math.hypot(listener.x + 2549.25, listener.z - 2071.35,
    listener.y - heightAt(-2549.25, 2071.35) - 2) / 43, 0, 1);
  let fire = 0;
  for (const room of dining) {
    if (room.kind === 'rental') continue;
    const distance = Math.hypot(listener.x-room.x, listener.z-room.z, 2*(listener.y-room.y-1));
    tavern = Math.max(tavern, clamp(1-distance/(Math.max(room.w,room.d)*.7+10),0,1));
    const h = room.hearth;
    if (h) fire = Math.max(fire, clamp(1-Math.hypot(listener.x-h.x, listener.z-h.z, listener.y-h.y)/12,0,1));
  }
  audio.update(dt, {
    vehicle:expeditions.active?.id ?? (passenger ? 'helicopter' : undefined),
    tavern: ride ? 0 : tavern, fire: ride ? 0 : fire,
    gustKmh: climate.state.gust,
    night: conditionsNow.night,
    steer: player.steer,
    stop: player.stopEdge,
    golden: conditionsNow.golden,
    hiking: player.footMode,
    speed: player.speed,
    grounded: player.grounded,
    airborne: player.airborne,
    crash: player.crash,
    powder: player.powder,
    riding: !!ride,
    surface: player.surfaceType,
    trees: treeCoverAt(player.pos.x, player.pos.z),
    stride: player.footMode ? player.walkAmount : player.strideAmount,
    stridePhase: player.stridePhase,
    tuck: player.tuckAmount,
    altitude: player.pos.y,
    enclosed,
    paused,
  });

  updateChaseFoliage(camera, ride || mounted || scenicPose || indoors ? null : player);
  collectibles.prepareRender(camera);
  renderTerrainFrame();
  quests.capture(renderer.domElement);
  performanceCalibration.didRender(now);
  scheduleFrame();
}

boot().catch((err) => showFatal('The mountain failed to load. Check the console.', err));
