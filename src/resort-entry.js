import { activeResort,bindResortTravel } from './resorts.js';
import { skierName } from './skier-profile.js';

document.getElementById('load-skier').textContent = skierName() || 'Guest Skier';

const mountain=activeResort();
if(mountain.terrainOnly)document.getElementById('load-tip').textContent='Start at the mountain approach. Open the map for nearby summits and viewpoints.';
bindResortTravel(mountain);
if(mountain.data){
  try {
    const {startMappedResort}=await import('./mapped-resort.js');
    await startMappedResort(mountain);
  }catch(error){
    console.error(error);
    document.getElementById('load-status').textContent='Could not load '+mountain.label+'. Reload to retry.';
    const back=document.createElement('a');back.href='./';back.textContent='Return to Whistler Blackcomb';
    document.getElementById('loading-screen').append(back);
  }
}else{
  await import('./main.js');
}
