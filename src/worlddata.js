import { catmullSample2D } from './util.js';

/* ═══════════════════════════════════════════════════════════════
   WORLD LAYOUT
   1 unit = 1 metre. +x = Whistler side, -x = Blackcomb side.
   -z = peaks / north, +z = valley / village.
   ═══════════════════════════════════════════════════════════════ */

export const WORLD = {
  minX: -2350, maxX: 2350,
  minZ: -2000, maxZ: 2500,
  get sizeX() { return this.maxX - this.minX; },
  get sizeZ() { return this.maxZ - this.minZ; },
  grid: 641,
};

export const START = { x: 1186, z: -902, heading: -0.62, altitude: 2182 };

export const MOUNTAIN = {
  whistlerPeak: { x: 1390, z: -1180 },
  blackcombPeak: { x: -1490, z: -1230 },
  village: { x: 250, z: 1890, elevation: 675 },
  creekside: { x: 790, z: 2010, elevation: 715 },
};

export const DIFFICULTY = {
  green:  { label: 'GREEN',  short: 'GREEN',  color: '#2faa63', map: '#2f9e60' },
  blue:   { label: 'BLUE',   short: 'BLUE',   color: '#2e7fe0', map: '#2f73c4' },
  black:  { label: 'BLACK',  short: 'BLACK',  color: '#e9f3f7', map: '#20272c' },
  double: { label: 'DOUBLE BLACK', short: 'DBL BLACK', color: '#f3f8fa', map: '#0f1418' },
  hidden: { label: 'LOCAL LINE', short: 'LOCAL', color: '#ffc75b', map: '#c89a3f' },
};

export const RUNS = [
  /* ── WHISTLER MOUNTAIN ─────────────────────────────────────── */
  {
    id: 'franz', name: "Franz's Run", mountain: 'Whistler', difficulty: 'green',
    width: 44, kind: 'groomer', description: 'A long, forgiving cruiser with the best view in the valley.',
    points: [[1180,-880],[1060,-720],[940,-540],[840,-340],[750,-120],[670,110],[590,360],[510,620],[440,880],[380,1120],[330,1330],[300,1500],[290,1640],[300,1760],[320,1840]],
  },
  {
    id: 'saddle', name: 'The Saddle', mountain: 'Whistler', difficulty: 'blue',
    width: 36, kind: 'groomer', description: 'Wide fall-line skiing under the old Red Chair.',
    points: [[1220,-930],[1150,-760],[1070,-570],[990,-370],[910,-160],[830,70],[750,300],[680,540],[610,770],[550,990],[500,1190],[460,1370],[440,1530],[440,1680],[460,1800]],
  },
  {
    id: 'dave', name: 'Dave Murray Downhill', mountain: 'Whistler', difficulty: 'black',
    width: 28, kind: 'race', description: 'The classic. A relentless, leg-burning downhill to the village.',
    points: [[1280,-970],[1240,-790],[1190,-600],[1130,-390],[1070,-170],[1010,60],[950,290],[880,520],[810,750],[740,970],[680,1170],[620,1360],[580,1530],[550,1680],[540,1800],[560,1880]],
  },
  {
    id: 'peak2creek', name: 'Peak to Creek', mountain: 'Whistler', difficulty: 'blue',
    width: 36, kind: 'groomer', description: 'A 5 km ribbon of rolling terrain from the summit to Creekside.',
    points: [[1190,-970],[1070,-830],[970,-660],[900,-470],[890,-260],[920,-50],[970,170],[1010,390],[1020,610],[990,830],[930,1040],[860,1240],[790,1420],[740,1580],[720,1730],[740,1880],[800,1990]],
  },
  {
    id: 'ego', name: 'Ego Bowl', mountain: 'Whistler', difficulty: 'blue',
    width: 32, kind: 'groomer', description: 'A rhythm section of rollers, banks, and wind-lips.',
    points: [[1050,-650],[980,-460],[910,-260],[840,-50],[770,170],[700,390],[630,610],[560,830],[500,1040],[450,1240],[410,1420],[390,1580],[390,1710],[410,1820]],
  },
  {
    id: 'whiskey', name: 'Whiskey Jack', mountain: 'Whistler', difficulty: 'green',
    width: 38, kind: 'groomer', description: 'The friendly way home. Long, wide, and always smooth.',
    points: [[760,320],[700,520],[640,720],[580,920],[520,1110],[470,1290],[430,1450],[410,1590],[400,1710],[410,1830]],
  },
  {
    id: 'olympic', name: 'Olympic', mountain: 'Whistler', difficulty: 'blue',
    width: 30, kind: 'groomer', description: 'A confident carve under the Olympic chair.',
    points: [[1040,80],[980,290],[920,500],[860,710],[800,910],[740,1100],[680,1280],[630,1450],[600,1600],[590,1720],[600,1840]],
  },
  {
    id: 'tokum', name: 'Tokum', mountain: 'Whistler', difficulty: 'black',
    width: 26, kind: 'moguls', description: 'A steep, seeded bump run. Pick a line and stay on it.',
    points: [[1150,-460],[1090,-250],[1040,-40],[990,180],[940,400],[890,620],[840,840],[790,1050],[740,1250],[700,1430],[670,1590],[660,1720],[670,1840]],
  },
  {
    id: 'harmony', name: 'Harmony Ridge', mountain: 'Whistler', difficulty: 'blue',
    width: 28, kind: 'traverse', description: 'A high traverse to the west with little pockets of powder.',
    points: [[950,-790],[790,-710],[620,-590],[460,-440],[320,-260],[220,-40],[160,200],[140,450],[150,700],[180,940],[230,1160],[280,1360],[320,1530],[350,1670],[370,1800]],
  },
  {
    id: 'burntstew', name: 'Burnt Stew Trail', mountain: 'Whistler', difficulty: 'green',
    width: 27, kind: 'traverse', description: 'The old traverse. Follow it for views, powder stashes, and shortcuts.',
    points: [[940,-840],[780,-760],[620,-650],[480,-510],[380,-330],[330,-100],[320,160],[340,420],[380,670],[420,900],[450,1120],[470,1320],[480,1500],[490,1650],[510,1780]],
  },
  {
    id: 'wildcard', name: 'Wild Card', mountain: 'Whistler', difficulty: 'black', hidden: true,
    width: 13, kind: 'glade', description: 'The locals’ cut beneath the Dave Murray ridge.',
    points: [[1210,-690],[1170,-480],[1140,-260],[1110,-30],[1080,200],[1030,430],[980,660],[920,880],[860,1080],[800,1270],[740,1440],[700,1600],[680,1740],[700,1850]],
  },
  {
    id: 'crystal', name: 'Crystal Glade', mountain: 'Whistler', difficulty: 'blue', hidden: true,
    width: 15, kind: 'glade', description: 'An old-growth ribbon between Ego and Olympic.',
    points: [[820,130],[790,330],[760,530],[710,730],[650,920],[590,1100],[540,1260],[500,1410],[480,1550],[480,1680],[500,1800]],
  },
  {
    id: 'bearhollow', name: "Bear's Hollow", mountain: 'Whistler', difficulty: 'blue', hidden: true,
    width: 13, kind: 'glade', description: 'A soft pocket hidden behind Franz’s wide-open shoulder.',
    points: [[700,150],[660,350],[610,550],[550,750],[490,930],[440,1100],[410,1260],[400,1410],[410,1550],[430,1680],[450,1800]],
  },
  {
    id: 'flute', name: 'Flute Bowl', mountain: 'Whistler', difficulty: 'double',
    width: 46, kind: 'bowl', description: 'The far-west bowl. A traverse for the devoted, then nothing but powder.',
    points: [[820,-1160],[720,-1000],[630,-820],[560,-620],[510,-400],[480,-170],[470,60],[480,300],[500,540]],
  },
  {
    id: 'whistlerbowl', name: 'Whistler Bowl', mountain: 'Whistler', difficulty: 'double',
    width: 40, kind: 'bowl', description: 'The big, steep east face under the peak. Cliffs, wind lips, consequence.',
    points: [[1330,-1030],[1300,-820],[1260,-610],[1210,-400],[1160,-190],[1120,20]],
  },

  /* ── BLACKCOMB MOUNTAIN ───────────────────────────────────── */
  {
    id: 'cruiser', name: 'Cruiser', mountain: 'Blackcomb', difficulty: 'blue',
    width: 38, kind: 'groomer', description: 'Blackcomb’s long, elegant blue. A perfect high-speed carve.',
    points: [[-980,-900],[-920,-740],[-860,-560],[-800,-360],[-740,-150],[-680,70],[-620,300],[-560,540],[-500,770],[-450,980],[-410,1170],[-380,1340],[-360,1490],[-350,1620],[-360,1740],[-380,1850]],
  },
  {
    id: 'catskinner', name: 'Catskinner', mountain: 'Blackcomb', difficulty: 'green',
    width: 44, kind: 'groomer', description: 'The gentle giant. Wide, sunny, and impossible to get wrong.',
    points: [[-930,150],[-860,380],[-790,610],[-720,830],[-650,1040],[-590,1220],[-540,1380],[-500,1510],[-470,1620],[-450,1720],[-440,1830]],
  },
  {
    id: 'springboard', name: 'Springboard', mountain: 'Blackcomb', difficulty: 'green',
    width: 36, kind: 'groomer', description: 'A friendly fall line from the Rendezvous down to the base.',
    points: [[-1150,-600],[-1080,-400],[-1010,-200],[-940,20],[-870,240],[-800,460],[-730,680],[-670,880],[-620,1060],[-580,1220],[-550,1360],[-530,1490],[-520,1600],[-520,1710],[-530,1810]],
  },
  {
    id: 'solar', name: 'Solar Coaster', mountain: 'Blackcomb', difficulty: 'blue',
    width: 32, kind: 'groomer', description: 'Sun-baked rollers under the old Solar Coaster line.',
    points: [[-700,-900],[-680,-700],[-660,-500],[-640,-290],[-620,-80],[-600,130],[-580,340],[-560,550],[-530,750],[-500,940],[-470,1110],[-450,1260],[-440,1400],[-440,1530],[-450,1650],[-470,1770]],
  },
  {
    id: 'cloud9', name: 'Cloud Nine', mountain: 'Blackcomb', difficulty: 'blue',
    width: 32, kind: 'groomer', description: 'A high, flowing line with big views over the Fitzsimmons valley.',
    points: [[-1210,-850],[-1140,-660],[-1070,-460],[-1000,-250],[-930,-40],[-860,170],[-790,380],[-720,590],[-650,790],[-590,980],[-540,1150],[-500,1300],[-470,1440],[-460,1570],[-470,1690],[-490,1800]],
  },
  {
    id: 'fantastic', name: 'Fantastic', mountain: 'Blackcomb', difficulty: 'blue',
    width: 30, kind: 'groomer', description: 'A playful mid-mountain line with natural banks and rhythm.',
    points: [[-940,-230],[-900,-30],[-860,170],[-810,380],[-760,580],[-710,780],[-660,970],[-610,1140],[-570,1300],[-540,1450],[-520,1580],[-520,1700],[-540,1810]],
  },
  {
    id: 'twist', name: 'Twist and Shout', mountain: 'Blackcomb', difficulty: 'blue',
    width: 28, kind: 'groomer', description: 'Every turn is a little different. Keep your feet moving.',
    points: [[-1320,-430],[-1260,-240],[-1200,-40],[-1130,170],[-1060,380],[-990,580],[-920,780],[-850,970],[-790,1140],[-740,1290],[-700,1430],[-670,1560],[-660,1680],[-670,1790],[-690,1880]],
  },
  {
    id: 'zigzag', name: 'Zig Zag', mountain: 'Blackcomb', difficulty: 'black',
    width: 26, kind: 'moguls', description: 'A narrow, top-to-bottom bump line. No hiding places.',
    points: [[-1080,-580],[-1050,-390],[-1020,-190],[-990,10],[-960,210],[-920,410],[-880,600],[-840,790],[-800,960],[-760,1120],[-730,1270],[-710,1410],[-700,1530],[-700,1650],[-710,1760],[-730,1870]],
  },
  {
    id: 'stoker', name: 'Stoker', mountain: 'Blackcomb', difficulty: 'black',
    width: 26, kind: 'moguls', description: 'Steep, direct, and unforgiving. The local’s shortcut.',
    points: [[-1260,-900],[-1200,-710],[-1140,-510],[-1080,-300],[-1020,-90],[-960,120],[-900,330],[-840,540],[-780,750],[-730,940],[-690,1110],[-660,1260],[-640,1400],[-630,1530],[-640,1650],[-660,1780],[-680,1880]],
  },
  {
    id: 'showcase', name: 'Showcase', mountain: 'Blackcomb', difficulty: 'black',
    width: 27, kind: 'moguls', description: 'A long expert pitch off the Crystal Ridge. Big, fast, and bumpy.',
    points: [[-1430,-760],[-1360,-570],[-1290,-370],[-1220,-160],[-1150,50],[-1080,260],[-1010,470],[-940,680],[-870,880],[-810,1060],[-760,1220],[-720,1370],[-700,1510],[-700,1640],[-720,1760],[-750,1870]],
  },
  {
    id: 'bushrat', name: 'Bushrat Glade', mountain: 'Blackcomb', difficulty: 'blue', hidden: true,
    width: 13, kind: 'glade', description: 'Blackcomb’s worst-kept secret. A slalom through old firs.',
    points: [[-960,120],[-930,320],[-900,520],[-860,720],[-820,910],[-770,1090],[-720,1260],[-680,1410],[-650,1540],[-640,1660],[-650,1780]],
  },
  {
    id: 'dusty', name: "Dusty's Glade", mountain: 'Blackcomb', difficulty: 'blue', hidden: true,
    width: 13, kind: 'glade', description: 'A low-angle powder stash that dumps you out near the village.',
    points: [[-620,320],[-590,520],[-550,720],[-510,910],[-470,1080],[-430,1240],[-400,1390],[-380,1530],[-370,1660],[-380,1780]],
  },
  {
    id: 'secretbowl', name: 'Secret Bowl', mountain: 'Blackcomb', difficulty: 'double',
    width: 34, kind: 'bowl', description: 'A steep, rock-walled entrance into the Blackcomb chutes.',
    points: [[-1480,-1100],[-1390,-920],[-1300,-720],[-1210,-510],[-1130,-300],[-1060,-90]],
  },
  {
    id: 'couloir', name: 'Couloir Extreme', mountain: 'Blackcomb', difficulty: 'double',
    width: 24, kind: 'bowl', description: 'The infamous narrow line. Mandatory air, mandatory commitment.',
    points: [[-1560,-1230],[-1460,-1040],[-1360,-840],[-1270,-630],[-1180,-420],[-1100,-210],[-1030,0]],
  },
  {
    id: 'ridge', name: 'Ridge Runner', mountain: 'Blackcomb', difficulty: 'black',
    width: 28, kind: 'groomer', description: 'A high-speed ridge run with huge views and long fall-away turns.',
    points: [[-600,-950],[-620,-780],[-650,-600],[-680,-400],[-700,-200],[-700,0],[-690,200],[-660,400],[-630,600],[-600,800],[-570,1000],[-540,1180],[-510,1340],[-490,1480],[-490,1610],[-510,1730],[-530,1840]],
  },
  {
    id: 'easyout', name: 'Easy Out', mountain: 'Blackcomb', difficulty: 'green',
    width: 25, kind: 'traverse', description: 'The mellow connector from mid-Blackcomb into Whistler Village.',
    points: [[-560,760],[-460,940],[-350,1110],[-240,1270],[-140,1420],[-60,1550],[10,1660],[70,1760],[120,1840]],
  },
];

export const SECRETS = {
  wildcard: {
    name: 'Wild Card', title: 'THE WILD CARD', type: 'glade',
    blurb: 'The locals’ cut beneath the Dave Murray ridge. Tight, dark, and much faster than it looks.',
    crystal: 'Black Diamond', crystalLore: 'A shard of night-blue ice. It hums when the light hits it.',
  },
  crystal: {
    name: 'Crystal Glade', title: 'CRYSTAL GLADE', type: 'glade',
    blurb: 'Old-growth corridors between Ego and Olympic. The snow stays cold and deep here all day.',
    crystal: 'Glacier Glass', crystalLore: 'Clear as a frozen lake, with a winter sun caught inside.',
  },
  bearhollow: {
    name: "Bear's Hollow", title: 'BEAR’S HOLLOW', type: 'glade',
    blurb: 'A soft, sheltered pocket behind Franz’s shoulder. No wind, no tracks, no witnesses.',
    crystal: 'Hollow Heart', crystalLore: 'Amber ice. Somehow warm to the touch.',
  },
  bushrat: {
    name: 'Bushrat Glade', title: 'BUSHRAT', type: 'glade',
    blurb: 'Blackcomb’s worst-kept secret. A slalom through old firs and pillow lines.',
    crystal: 'Bushrat Bauble', crystalLore: 'Green-glowing ice, threaded with tiny silver needles.',
  },
  dusty: {
    name: "Dusty's Glade", title: 'DUSTY’S', type: 'glade',
    blurb: 'A low-angle stash that dumps you out by the village. The last run of the day, every day.',
    crystal: 'Dusty’s Crystal', crystalLore: 'A pale gold crystal, warm as a late-afternoon window.',
  },
};

export const CRYSTALS = [
  { id: 'wildcard', run: 'wildcard', t: 0.63, name: 'Black Diamond' },
  { id: 'crystal', run: 'crystal', t: 0.64, name: 'Glacier Glass' },
  { id: 'bearhollow', run: 'bearhollow', t: 0.56, name: 'Hollow Heart' },
  { id: 'bushrat', run: 'bushrat', t: 0.52, name: 'Bushrat Bauble' },
  { id: 'dusty', run: 'dusty', t: 0.46, name: 'Dusty’s Crystal' },
];

export const KICKERS = [
  { run: 'franz', t: 0.24, width: 19, length: 23, height: 2.5, name: 'Franz’s Roller' },
  { run: 'ego', t: 0.29, width: 16, length: 21, height: 3.0, name: 'Ego Booter' },
  { run: 'cruiser', t: 0.31, width: 18, length: 24, height: 2.8, name: 'Cruiser Kicker' },
  { run: 'cloud9', t: 0.28, width: 16, length: 22, height: 3.2, name: 'Cloud Nine Air' },
  { run: 'showcase', t: 0.24, width: 15, length: 20, height: 3.8, name: 'Showcase Send' },
  { run: 'wildcard', t: 0.34, width: 11, length: 17, height: 2.2, name: 'Wild Card Lip' },
  { run: 'peak2creek', t: 0.48, width: 18, length: 25, height: 3.0, name: 'Creek Gap' },
  { run: 'solar', t: 0.22, width: 17, length: 22, height: 2.8, name: 'Solar Flare' },
];

export const CLIFFS = [
  { run: 'secretbowl', t: 0.18, width: 30, drop: 11, length: 8, name: 'The Door' },
  { run: 'couloir', t: 0.1, width: 22, drop: 15, length: 9, name: 'The Crux' },
  { run: 'wildcard', t: 0.57, width: 13, drop: 5.5, length: 6, name: 'The Step' },
];

export const LIFTS = [
  {
    id: 'p2p', name: 'Peak 2 Peak', type: 'p2p', color: '#b8332c', accent: '#f2eee6',
    points: [[945, -850], [-905, -700]], cabins: 7, speed: 0.012, height: 24,
  },
  {
    id: 'whistler-gondola', name: 'Whistler Village Gondola', type: 'gondola', color: '#1d2529',
    points: [[300, 1830], [355, 1370], [430, 880], [540, 370], [665, -100], [780, -530], [885, -820]],
    cabins: 11, speed: 0.009, height: 16,
  },
  {
    id: 'blackcomb-gondola', name: 'Blackcomb Gondola', type: 'gondola', color: '#a92e29',
    points: [[-400, 1790], [-440, 1360], [-500, 920], [-570, 450], [-650, -80], [-745, -500], [-870, -790]],
    cabins: 10, speed: 0.009, height: 16,
  },
  {
    id: 'harmony', name: 'Harmony 6 Express', type: 'chair', color: '#d7dde0',
    points: [[375, 730], [470, 400], [565, 60], [665, -300], [760, -590]],
    carriers: 16, speed: 0.018, height: 13,
  },
  {
    id: 'peak', name: 'Peak Express', type: 'chair', color: '#d7dde0',
    points: [[930, -470], [1010, -690], [1090, -860]],
    carriers: 9, speed: 0.018, height: 12,
  },
  {
    id: 'crystal', name: 'Crystal Ridge Express', type: 'chair', color: '#d7dde0',
    points: [[-555, 980], [-650, 590], [-735, 200], [-825, -130], [-895, -360]],
    carriers: 14, speed: 0.018, height: 14,
  },
  {
    id: 'seventh', name: '7th Heaven Express', type: 'chair', color: '#d7dde0',
    points: [[-520, 1290], [-570, 870], [-610, 430], [-645, -30], [-690, -480], [-740, -790]],
    carriers: 16, speed: 0.018, height: 15,
  },
  {
    id: 'magic', name: 'Magic Chair', type: 'chair', color: '#d7dde0',
    points: [[-700, 1430], [-730, 1260], [-760, 1090]],
    carriers: 6, speed: 0.013, height: 9,
  },
];

export const STATIONS = {
  whistlerTop: { x: 945, z: -850, label: 'ROUNDHOUSE · 2,182 M' },
  blackcombTop: { x: -905, z: -700, label: 'RENDEZVOUS · 1,950 M' },
};

export const P2P_RIDE = {
  fromWhistler: { board: { x: 945, z: -850 }, exit: { x: -888, z: -724, heading: 0.38 }, mountain: 'Blackcomb' },
  fromBlackcomb: { board: { x: -905, z: -700 }, exit: { x: 973, z: -836, heading: -0.62 }, mountain: 'Whistler' },
};

export const LODGES = [
  { id: 'roundhouse', name: 'Roundhouse Lodge', x: 1260, z: -985, rot: -0.5, size: [46, 13, 27], type: 'summit' },
  { id: 'rendezvous', name: 'Rendezvous Lodge', x: -815, z: -780, rot: 0.45, size: [36, 11, 22], type: 'summit' },
  { id: 'village-base', name: 'Whistler Village Base', x: 295, z: 1850, rot: 0.1, size: [42, 10, 24], type: 'base' },
  { id: 'blackcomb-base', name: 'Blackcomb Daylodge', x: -405, z: 1810, rot: -0.1, size: [38, 10, 23], type: 'base' },
  { id: 'creekside', name: 'Creekside Lodge', x: 830, z: 2015, rot: 0.3, size: [30, 9, 20], type: 'base' },
  { id: 'patrol', name: 'Ski Patrol', x: 1085, z: -968, rot: -0.3, size: [15, 6, 11], type: 'hut' },
];

/* Village chalets — placed off the main run corridors, with light collision. */
export const CHALETS = [
  { x: -170, z: 1860, rot: 0.12, w: 15, d: 11, h: 7 },
  { x: -105, z: 1955, rot: -0.2, w: 12, d: 10, h: 6 },
  { x: -20, z: 2020, rot: 0.36, w: 16, d: 12, h: 7 },
  { x: 90, z: 1990, rot: -0.1, w: 13, d: 10, h: 6 },
  { x: 160, z: 2075, rot: 0.25, w: 18, d: 12, h: 8 },
  { x: 460, z: 1930, rot: 0.5, w: 13, d: 10, h: 6 },
  { x: 540, z: 2010, rot: -0.3, w: 15, d: 11, h: 7 },
  { x: 640, z: 1940, rot: 0.1, w: 12, d: 9, h: 6 },
  { x: 705, z: 2080, rot: 0.4, w: 16, d: 12, h: 7 },
  { x: 930, z: 2010, rot: -0.2, w: 14, d: 10, h: 6 },
  { x: 1010, z: 2100, rot: 0.2, w: 18, d: 12, h: 8 },
  { x: -560, z: 1930, rot: -0.4, w: 14, d: 10, h: 6 },
  { x: -640, z: 2030, rot: 0.2, w: 16, d: 11, h: 7 },
  { x: -500, z: 2090, rot: 0.5, w: 12, d: 9, h: 5 },
  { x: 1080, z: 2200, rot: -0.2, w: 16, d: 12, h: 7 },
  { x: 240, z: 2170, rot: 0.3, w: 14, d: 10, h: 6 },
  { x: 360, z: 2260, rot: -0.4, w: 17, d: 12, h: 8 },
  { x: -250, z: 2170, rot: 0.1, w: 14, d: 10, h: 6 },
];

/* Runs sampled to ~10 m; filled by initWorldData(). */
export const RUN_SAMPLES = new Map();

export function initWorldData() {
  for (const run of RUNS) {
    const { points, length } = catmullSample2D(run.points, 20);
    // resample to ~9 m spacing + carry tangents and cumulative length
    const step = 9;
    const n = Math.max(2, Math.round(length / step));
    const samples = [];
    let total = 0;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const idx = Math.min(points.length - 1, Math.round(t * (points.length - 1)));
      const p = points[idx];
      const prev = points[Math.max(0, idx - 1)];
      const next = points[Math.min(points.length - 1, idx + 1)];
      const dx = next.x - prev.x, dz = next.z - prev.z;
      const l = Math.hypot(dx, dz) || 1;
      if (i > 0) {
        const last = samples[samples.length - 1];
        total += Math.hypot(p.x - last.x, p.z - last.z);
      }
      samples.push({
        x: p.x, z: p.z, t, dist: total,
        tx: dx / l, tz: dz / l,
        nx: -dz / l, nz: dx / l,
      });
    }
    run.length = length;
    run.samples = samples;
    RUN_SAMPLES.set(run.id, samples);
  }
}

export function getRun(id) {
  return RUNS.find(r => r.id === id);
}

export function runPointAt(runOrId, t) {
  const run = typeof runOrId === 'string' ? getRun(runOrId) : runOrId;
  if (!run?.samples?.length) return null;
  const f = Math.min(0.9999, Math.max(0, t)) * (run.samples.length - 1);
  const i = Math.floor(f), j = Math.min(run.samples.length - 1, i + 1);
  const k = f - i;
  const a = run.samples[i], b = run.samples[j];
  return {
    x: a.x + (b.x - a.x) * k,
    z: a.z + (b.z - a.z) * k,
    tx: a.tx + (b.tx - a.tx) * k,
    tz: a.tz + (b.tz - a.tz) * k,
    nx: a.nx + (b.nx - a.nx) * k,
    nz: a.nz + (b.nz - a.nz) * k,
  };
}

export function startPose() {
  const run = getRun('franz');
  if (!run?.samples?.length) return { ...START };
  const p = runPointAt(run, 0.012);
  return { x: p.x, z: p.z, heading: Math.atan2(p.tx, p.tz) };
}
