const preferencesKey = 'alpine.profile.v1';
const travelKey = 'alpine.travel.v1';
const saveInterval = 3;
const imperial = { small: 'ft', large: 'mi', speed: 'mph', lengthFactor: 1 / .3048, distanceFactor: 1 / 1609.344, speedFactor: 1 / 1.609344 };
const metric = { small: 'm', large: 'km', speed: 'km/h', lengthFactor: 1, distanceFactor: .001, speedFactor: 1 };
const profileEvents = new EventTarget();
const numberFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// Check the cleaned name and obvious punctuation and digit substitutions.
// Whole words account for short terms that also appear in ordinary names.
const offensiveWords = /^(?:ass|bitch|cunt|dick|fag|fuck|nigga|nigger|piss|pussy|shit|slut|whore)$/;
const offensivePhrases = /(?:bitch|cunt|faggot|fuck|nigg(?:er|a)|pussy|shit|asshole|dickhead|bastard|whore)/;
const substitutions = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't' };

export function checkSkierName(value) {
  if (typeof value !== 'string' || value.length > 100) return null;
  const name = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!name) return '';
  if ([...name].length > 24 || !/^[\p{L}\p{N}][\p{L}\p{N}\p{M} ._'’-]*$/u.test(name)) return null;
  const simplified = name.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '')
    .replace(/[013457]/g, (digit) => substitutions[digit]);
  if (simplified.split(/[^a-z]+/).some((word) => offensiveWords.test(word)) ||
      offensivePhrases.test(simplified.replace(/[^a-z]/g, ''))) return null;
  return name;
}

function normalizePreferences(saved) {
  return { name: checkSkierName(saved?.name) ?? '', units: saved?.units === 'mi' ? 'mi' : 'km' };
}

function readTravel() {
  const saved = read(travelKey);
  const entries = (values) => new Map(Array.isArray(values) ? values.filter((entry) =>
    Array.isArray(entry) && entry.length === 2 && entry.every((value) => typeof value === 'string')) : []);
  return {
    metres: Number.isFinite(saved?.metres) && saved.metres >= 0 ? saved.metres : 0,
    runs: entries(saved?.runs), resorts: entries(saved?.resorts), mountains: entries(saved?.mountains),
  };
}

let preferences = normalizePreferences(read(preferencesKey));
let travel = readTravel();

export function skierName() { return preferences.name; }
export function unitPreference() { return preferences.units; }
export function skiUnits() { return preferences.units === 'mi' ? imperial : metric; }

function setPreference(key, value) {
  const stored = read(preferencesKey);
  preferences = { ...(stored ? normalizePreferences(stored) : preferences), [key]: value };
  write(preferencesKey, preferences);
  profileEvents.dispatchEvent(new Event('preferences'));
}

export function setSkierName(value) {
  const name = checkSkierName(value);
  if (name === null) return false;
  setPreference('name', name);
  return true;
}

export function setSkierUnits(value) {
  setPreference('units', value === 'mi' ? 'mi' : 'km');
}

export const formatTravelDistance = (metres) => `${numberFormat.format(metres * skiUnits().distanceFactor)} ${skiUnits().large}`;

export function onProfileChange(callback) {
  profileEvents.addEventListener('preferences', callback);
  profileEvents.addEventListener('travel', callback);
}

export function travelStats() {
  return { metres: travel.metres, runs: [...travel.runs.values()], resorts: [...travel.resorts.values()], mountains: [...travel.mountains.values()] };
}

globalThis.addEventListener?.('storage', (event) => {
  if (event.key === preferencesKey || event.key === null) {
    preferences = normalizePreferences(read(preferencesKey));
    profileEvents.dispatchEvent(new Event('preferences'));
  }
  if (event.key === travelKey || event.key === null) {
    travel = readTravel();
    profileEvents.dispatchEvent(new Event('travel'));
  }
});

function projectedTrailDistance(run, index, x, z) {
  const samples = run.samples;
  let best = (run.width * .62 + 1.8) ** 2;
  let distance;
  for (let i = Math.max(0, index - 5); i < Math.min(index + 5, samples.length - 1); i++) {
    const a = samples[i], b = samples[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    const d = (x - a.x - t * dx) ** 2 + (z - a.z - t * dz) ** 2;
    if (d > best) continue;
    best = d;
    distance = a.dist + t * (b.dist - a.dist);
  }
  return distance;
}

function coverRange(ranges, from, to) {
  let low = Math.min(from, to), high = Math.max(from, to);
  let start = 0, end = 0;
  while (start < ranges.length && ranges[start][1] < low - .01) start++;
  for (end = start; end < ranges.length && ranges[end][0] <= high + .01; end++) {
    low = Math.min(low, ranges[end][0]);
    high = Math.max(high, ranges[end][1]);
  }
  ranges.splice(start, end - start, [low, high]);
  return ranges.reduce((sum, [a, b]) => sum + b - a, 0);
}

export function createTravelTracker({ resortId, resortName, mountainAt }) {
  const coverage = new Map();
  let previous, elapsed = 0, addedMetres = 0;
  const discoveries = { runs: new Map(), resorts: new Map(), mountains: new Map() };

  function flush() {
    if (!addedMetres && !Object.values(discoveries).some((set) => set.size)) return;
    const stored = readTravel();
    travel.metres = Math.max(travel.metres, stored.metres) + addedMetres;
    addedMetres = 0;
    elapsed = 0;
    for (const kind of Object.keys(discoveries)) {
      travel[kind] = new Map([...travel[kind], ...stored[kind], ...discoveries[kind]]);
      discoveries[kind].clear();
    }
    write(travelKey, { metres: travel.metres, runs: [...travel.runs], resorts: [...travel.resorts], mountains: [...travel.mountains] });
    profileEvents.dispatchEvent(new Event('travel'));
  }

  function reset() {
    previous = undefined;
    flush();
  }

  function visit(kind, key, name) {
    if (!travel[kind].has(key)) discoveries[kind].set(key, name);
  }

  globalThis.addEventListener?.('pagehide', flush);
  globalThis.document?.addEventListener('visibilitychange', () => {
    if (document.hidden) reset();
  });

  function update(dt, player, { active, nearest } = {}) {
    if (!active) {
      if (previous) reset();
      return;
    }
    const { x, y, z } = player.pos;
    if (![x, y, z].every(Number.isFinite)) { reset(); return; }
    const speed = Number.isFinite(player.speed) ? Math.max(0, player.speed) : 0;
    const last = previous;
    previous = { x, y, z, speed };
    const mountain = mountainAt(player.pos, nearest);
    visit('resorts', resortId, resortName);
    if (mountain) visit('mountains', `${resortId}/${mountain}`, mountain);
    if (discoveries.resorts.size || discoveries.mountains.size) flush();
    if (!last || !(dt > 0)) return;

    const moved = Math.hypot(x - last.x, z - last.z);
    if (moved > Math.max(2, Math.max(speed, last.speed) * dt * 1.5 + .7) ||
        Math.abs(y - last.y) > Math.max(3, 80 * dt)) return;
    elapsed += dt;
    addedMetres += moved;

    const run = nearest?.run;
    const runKey = run?.named && `${resortId}/${run.mountain ?? run.section ?? ''}/${run.name.toLowerCase()}`;
    if (runKey && nearest.onRun && moved > .005 && !travel.runs.has(runKey)) {
      const from = projectedTrailDistance(run, nearest.index, last.x, last.z);
      const to = projectedTrailDistance(run, nearest.index, x, z);
      if (from != null && to != null && Math.abs(to - from) > .005 && Math.abs(to - from) <= moved * 1.25 + .08) {
        const ranges = coverage.get(run.id) ?? [];
        coverage.set(run.id, ranges);
        // Short runs need substantial coverage, while long descents need at least 150 m.
        if (coverRange(ranges, from, to) >= Math.min(.65 * run.length, 150)) {
          visit('runs', runKey, run.name);
          coverage.delete(run.id);
          flush();
        }
      }
    }
    if (elapsed >= saveInterval) flush();
  }

  return { update, reset };
}
