// Whistler has its own scene. The Washington resorts share the mapped world loader.
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
];

export function activeResort() {
  const id=new URLSearchParams(location.search).get('mountain');
  return RESORTS.find(place=>place.id===id) || RESORTS[0];
}

export function bindResortTravel(current) {
  const select=document.getElementById('resort-choose'),go=document.getElementById('resort-travel');
  for(const resort of RESORTS)select.add(new Option(resort.label+' · '+resort.region,resort.id));
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
