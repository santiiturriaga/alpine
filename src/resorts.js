// Whistler has its own scene. Other destinations load local elevation and map data.
export const RESORTS = [
  {id:'whistler-blackcomb',label:'Whistler Blackcomb',region:'British Columbia'},
  {id:'stevens-pass',label:'Stevens Pass',region:'Washington',
    data:new URL('../data/mountains/stevens-pass/resort.json',import.meta.url),
    atlas:{href:new URL('../assets/maps/stevens-pass/stevens-pass-winter-2024-25.pdf',import.meta.url).href}},
  {id:'snoqualmie',label:'The Summit at Snoqualmie',region:'Washington',
    data:new URL('../data/mountains/snoqualmie/resort.json',import.meta.url),
    atlas:{href:'https://www.summitatsnoqualmie.com/trail-maps',
      summerHref:'https://www.summitatsnoqualmie.com/activities/biking'}},
  {id:'crystal-mountain',label:'Crystal Mountain',region:'Washington',
    data:new URL('../data/mountains/crystal-mountain/resort.json',import.meta.url),
    atlas:{href:'https://www.crystalmountainresort.com/the-mountain/trail-maps',
      summerHref:'https://www.crystalmountainresort.com/things-to-do/activities/hiking'}},
  {id:'les-3-vallees',label:'Les 3 Vallées',region:'Savoie, France',
    data:new URL('../data/mountains/les-3-vallees/resort.json',import.meta.url),
    atlas:{href:'https://www.les3vallees.com/en/guide/the-world-s-largest-ski-area/ski-area-map'}},
  {id:'zermatt-cervinia',label:'Zermatt–Cervinia',region:'Switzerland / Italy',
    data:new URL('../data/mountains/zermatt-cervinia/resort.json',import.meta.url),
    atlas:{href:'https://www.matterhornparadise.ch/en/experience/skiing/piste-map'}},
  {id:'chamonix-mont-blanc',label:'Chamonix–Mont-Blanc',region:'Haute-Savoie, France',
    data:new URL('../data/mountains/chamonix-mont-blanc/resort.json',import.meta.url),
    atlas:{href:'https://www.montblancnaturalresort.com/en/brochures'}},
  {id:'ski-arlberg',label:'Ski Arlberg',region:'Tyrol / Vorarlberg, Austria',
    data:new URL('../data/mountains/ski-arlberg/resort.json',import.meta.url),
    atlas:{href:'https://www.skiarlberg.at/en/live-info/map-navigation'}},
  {id:'verbier-4-vallees',label:'Verbier / 4 Vallées',region:'Valais, Switzerland',
    data:new URL('../data/mountains/verbier-4-vallees/resort.json',import.meta.url),
    atlas:{href:'https://verbier4vallees.ch/en/useful-information/interactive-map'}},
  {id:'tignes-val-disere',label:'Tignes–Val d’Isère',region:'Savoie, France',
    data:new URL('../data/mountains/tignes-val-disere/resort.json',import.meta.url),
    atlas:{href:'https://en.tignes.net/skiing/ski-area/ski-map'}},
  {id:'vail',label:'Vail',region:'Colorado, USA',
    data:new URL('../data/mountains/vail/resort.json',import.meta.url),
    atlas:{href:'https://www.vail.com/the-mountain/about-the-mountain/trail-map'}},
  {id:'jackson-hole',label:'Jackson Hole Mountain Resort',region:'Wyoming, USA',
    data:new URL('../data/mountains/jackson-hole/resort.json',import.meta.url),
    atlas:{href:'https://www.jacksonhole.com/maps'}},
  {id:'niseko-united',label:'Niseko United',region:'Hokkaido, Japan',
    data:new URL('../data/mountains/niseko-united/resort.json',import.meta.url),
    atlas:{href:'https://www.niseko.ne.jp/en/map/'}},
  {id:'mount-rainier',label:'Mount Rainier',region:'Washington, USA',terrainOnly:true,
    data:new URL('../data/mountains/mount-rainier/resort.json',import.meta.url),
    atlas:{href:'https://www.nps.gov/mora/planyourvisit/maps.htm'}},
  {id:'mont-blanc',label:'Mont Blanc',region:'France / Italy',terrainOnly:true,
    data:new URL('../data/mountains/mont-blanc/resort.json',import.meta.url),
    atlas:{href:'https://www.chamoniarde.com/en/your-activities/mont-blanc'}},
  {id:'matterhorn',label:'Matterhorn',region:'Switzerland / Italy',terrainOnly:true,
    data:new URL('../data/mountains/matterhorn/resort.json',import.meta.url),
    atlas:{href:'https://www.sac-cas.ch/en/huts-and-tours/sac-route-portal/matterhorn-1138/'}},
  {id:'eiger',label:'Eiger',region:'Bernese Oberland, Switzerland',terrainOnly:true,
    data:new URL('../data/mountains/eiger/resort.json',import.meta.url),
    atlas:{href:'https://www.sac-cas.ch/en/huts-and-tours/sac-route-portal/eiger-555/'}},
  {id:'denali',label:'Denali / Mount McKinley',region:'Alaska, USA',terrainOnly:true,
    data:new URL('../data/mountains/denali/resort.json',import.meta.url),
    atlas:{href:'https://www.nps.gov/dena/planyourvisit/maps.htm'}},
  {id:'everest',label:'Mount Everest',region:'Nepal / Tibet',terrainOnly:true,
    data:new URL('../data/mountains/everest/resort.json',import.meta.url),
    atlas:{href:'https://ntb.gov.np/everest-base-camp'}},
  {id:'k2',label:'K2',region:'Pakistan / China',terrainOnly:true,
    data:new URL('../data/mountains/k2/resort.json',import.meta.url),
    atlas:{href:'https://visitgilgitbaltistan.gov.pk/tour/id/35'}},
];

export function activeResort() {
  const id=new URLSearchParams(location.search).get('mountain');
  return RESORTS.find(place=>place.id===id) || RESORTS[0];
}

export function bindResortTravel(current) {
  const select=document.getElementById('resort-choose'),go=document.getElementById('resort-travel');
  const skiAreas=document.createElement('optgroup'),mountains=document.createElement('optgroup');
  skiAreas.label='Ski resorts';mountains.label='Mountain visits';
  for(const resort of RESORTS){
    const group=resort.terrainOnly?mountains:skiAreas;
    group.append(new Option(resort.label+' · '+resort.region,resort.id));
  }
  select.replaceChildren(skiAreas,mountains);
  select.value=current.id;
  const update=()=>{go.disabled=select.value===current.id;};
  select.addEventListener('change',update);update();
  go.addEventListener('click',()=>{
    const resort=RESORTS.find(place=>place.id===select.value);
    if(!resort||resort===current)return;
    const url=new URL('./',location.href);
    if(resort.id!==RESORTS[0].id)url.searchParams.set('mountain',resort.id);
    location.assign(url);
  });
}
