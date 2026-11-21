import { bindDestinationSelector } from './destination-selector.js';
import { compactDevice } from './device-budget.js';

// Whistler has its own scene. Other destinations load local elevation and map data.
export const RESORTS = [
  {id:'whistler-blackcomb',label:'Whistler Blackcomb',region:'British Columbia',country:'Canada'},
  {id:'stevens-pass',label:'Stevens Pass',region:'Washington',country:'United States',
    data:new URL('../data/mountains/stevens-pass/resort.json',import.meta.url),
    atlas:{href:new URL('../assets/maps/stevens-pass/stevens-pass-winter-2024-25.pdf',import.meta.url).href}},
  {id:'snoqualmie',label:'The Summit at Snoqualmie',region:'Washington',country:'United States',
    data:new URL('../data/mountains/snoqualmie/resort.json',import.meta.url),
    atlas:{href:'https://www.summitatsnoqualmie.com/trail-maps',
      summerHref:'https://www.summitatsnoqualmie.com/activities/biking'}},
  {id:'crystal-mountain',label:'Crystal Mountain',region:'Washington',country:'United States',
    data:new URL('../data/mountains/crystal-mountain/resort.json',import.meta.url),
    atlas:{href:'https://www.crystalmountainresort.com/the-mountain/trail-maps',
      summerHref:'https://www.crystalmountainresort.com/things-to-do/activities/hiking'}},
  {id:'les-3-vallees',label:'Les 3 Vallées',region:'Savoie, France',country:'France',
    data:new URL('../data/mountains/les-3-vallees/resort.json',import.meta.url),
    atlas:{href:'https://www.les3vallees.com/en/guide/the-world-s-largest-ski-area/ski-area-map'}},
  {id:'zermatt-cervinia',label:'Zermatt–Cervinia',region:'Switzerland / Italy',country:'Switzerland / Italy',
    data:new URL('../data/mountains/zermatt-cervinia/resort.json',import.meta.url),
    atlas:{href:'https://www.matterhornparadise.ch/en/experience/skiing/piste-map'}},
  {id:'chamonix-mont-blanc',label:'Chamonix–Mont-Blanc',region:'Haute-Savoie, France',country:'France',
    data:new URL('../data/mountains/chamonix-mont-blanc/resort.json',import.meta.url),
    atlas:{href:'https://www.montblancnaturalresort.com/en/brochures'}},
  {id:'ski-arlberg',label:'Ski Arlberg',region:'Tyrol / Vorarlberg, Austria',country:'Austria',
    data:new URL('../data/mountains/ski-arlberg/resort.json',import.meta.url),
    atlas:{href:'https://www.skiarlberg.at/en/live-info/map-navigation'}},
  {id:'verbier-4-vallees',label:'Verbier / 4 Vallées',region:'Valais, Switzerland',country:'Switzerland',
    data:new URL('../data/mountains/verbier-4-vallees/resort.json',import.meta.url),
    atlas:{href:'https://verbier4vallees.ch/en/useful-information/interactive-map'}},
  {id:'tignes-val-disere',label:'Tignes–Val d’Isère',region:'Savoie, France',country:'France',
    data:new URL('../data/mountains/tignes-val-disere/resort.json',import.meta.url),
    atlas:{href:'https://en.tignes.net/skiing/ski-area/ski-map'}},
  {id:'vail',label:'Vail',region:'Colorado, USA',country:'United States',
    data:new URL('../data/mountains/vail/resort.json',import.meta.url),
    atlas:{href:'https://www.vail.com/the-mountain/about-the-mountain/trail-map'}},
  {id:'jackson-hole',label:'Jackson Hole Mountain Resort',region:'Wyoming, USA',country:'United States',
    data:new URL('../data/mountains/jackson-hole/resort.json',import.meta.url),
    atlas:{href:'https://www.jacksonhole.com/maps'}},
  {id:'niseko-united',label:'Niseko United',region:'Hokkaido, Japan',country:'Japan',
    data:new URL('../data/mountains/niseko-united/resort.json',import.meta.url),
    atlas:{href:'https://www.niseko.ne.jp/en/map/'}},
  {id:'mount-rainier',label:'Mount Rainier',region:'Washington, USA',country:'United States',terrainOnly:true,
    data:new URL('../data/mountains/mount-rainier/resort.json',import.meta.url),
    atlas:{href:'https://www.nps.gov/mora/planyourvisit/maps.htm'}},
  {id:'mont-blanc',label:'Mont Blanc',region:'France / Italy',country:'France / Italy',terrainOnly:true,
    data:new URL('../data/mountains/mont-blanc/resort.json',import.meta.url),
    atlas:{href:'https://www.chamoniarde.com/en/your-activities/mont-blanc'}},
  {id:'matterhorn',label:'Matterhorn',region:'Switzerland / Italy',country:'Switzerland / Italy',terrainOnly:true,
    data:new URL('../data/mountains/matterhorn/resort.json',import.meta.url),
    atlas:{href:'https://www.sac-cas.ch/en/huts-and-tours/sac-route-portal/matterhorn-1138/'}},
  {id:'eiger',label:'Eiger',region:'Bernese Oberland, Switzerland',country:'Switzerland',terrainOnly:true,
    data:new URL('../data/mountains/eiger/resort.json',import.meta.url),
    atlas:{href:'https://www.sac-cas.ch/en/huts-and-tours/sac-route-portal/eiger-555/'}},
  {id:'denali',label:'Denali / Mount McKinley',region:'Alaska, USA',country:'United States',terrainOnly:true,
    data:new URL('../data/mountains/denali/resort.json',import.meta.url),
    atlas:{href:'https://www.nps.gov/dena/planyourvisit/maps.htm'}},
  {id:'everest',label:'Mount Everest',region:'Nepal / Tibet',country:'Nepal / China',terrainOnly:true,
    data:new URL('../data/mountains/everest/resort.json',import.meta.url),
    atlas:{href:'https://ntb.gov.np/everest-base-camp'}},
  {id:'k2',label:'K2',region:'Pakistan / China',country:'Pakistan / China',terrainOnly:true,
    data:new URL('../data/mountains/k2/resort.json',import.meta.url),
    atlas:{href:'https://visitgilgitbaltistan.gov.pk/tour/id/35'}},
];

export function activeResort() {
  const id=new URLSearchParams(location.search).get('mountain');
  return RESORTS.find(place=>place.id===id) || RESORTS[0];
}

export function resortTravelURL(resort, { arrive = false } = {}) {
  const url=new URL('./',location.href);
  if(compactDevice || resort.id!==RESORTS[0].id)url.searchParams.set('mountain',resort.id);
  if(compactDevice && arrive && resort===RESORTS[0])url.searchParams.set('start','roundhouse');
  return url;
}

export function bindResortTravel(current, { standalone = false, openSled } = {}) {
  const selector = bindDestinationSelector(RESORTS, current, resortTravelURL, { standalone, openSled });
  if (standalone) selector.open();
  return selector;
}
