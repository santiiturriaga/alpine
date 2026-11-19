import { activeResort,bindResortTravel,resortTravelURL,RESORTS } from './resorts.js';
import { compactDevice } from './device-budget.js';
import { skierName } from './skier-profile.js';
import { enterRenderer } from './renderer-recovery.js';
import { loadingProgress } from './mountain-loading.js';

document.getElementById('load-skier').textContent = skierName() || 'Guest Skier';

const mountain=activeResort();
if(mountain.terrainOnly)document.getElementById('load-tip').textContent='Start at the mountain approach. Open the map for nearby summits and viewpoints.';
const search = new URLSearchParams(location.search);
const standalone = search.has('selector') || compactDevice && !location.search;
bindResortTravel(mountain, { standalone });
if(standalone){
  document.getElementById('loading-screen').classList.add('hidden');
}else {
  await enterRenderer(mountain.id);
  loadingProgress(.015);
  try {
    if (mountain.data) {
      const {startMappedResort}=await import('./mapped-resort.js');
      await startMappedResort(mountain);
    } else {
      await import('./main.js');
    }
  }catch(error){
    console.error(error);
    document.getElementById('load-status').textContent='Could not load '+mountain.label+'. Reload to retry.';
    const back=document.createElement('a');back.href=resortTravelURL(RESORTS[0]);back.textContent='Return to Whistler Blackcomb';
    document.getElementById('loading-screen').append(back);
    document.getElementById('load-destinations').hidden = false;
  }
}
