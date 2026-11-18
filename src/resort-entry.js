import { activeResort,bindResortTravel } from './resorts.js';

const mountain=activeResort();
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
