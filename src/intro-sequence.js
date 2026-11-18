import * as THREE from 'three';
import { VALLEY_VIEW } from './valley-scenery.js';
import { FAIRMONT_VIEW } from './fairmont.js';
import { DUSTYS_VIEW, CREEKSIDE_SLOPE_VIEW } from './creekside-village.js';
import { INUKSHUK_VIEW } from './inukshuk.js';
import { PEAK_TO_PEAK } from './worlddata.js';

// Each shot moves a camera through the playable scene, then cuts to the next view.
const century={eye:[-2450,2940,-4050],target:[1900,1540,3900],fov:54};
const itinerary=[
  {view:VALLEY_VIEW,seconds:5.5,truck:135,push:210,light:'day'},
  {view:CREEKSIDE_SLOPE_VIEW,seconds:4.5,truck:2.1,push:3.1,light:'day'},
  {view:DUSTYS_VIEW,seconds:4.5,truck:1.4,push:1.2,light:'day'},
  {action:true,seconds:4.4,light:'golden-hour'},
  {lift:PEAK_TO_PEAK,seconds:4.3,light:'day'},
  {view:INUKSHUK_VIEW,seconds:4.5,truck:.56,push:.55,light:'day'},
  {view:FAIRMONT_VIEW,seconds:5,truck:3.1,push:3,light:'blue-hour'},
  {view:century,seconds:5,truck:116,push:194,light:'golden-hour'},
];
export const INTRO_SHOT_SECONDS=itinerary.map(({seconds})=>seconds);
export const INTRO_SECONDS=INTRO_SHOT_SECONDS.reduce((sum,seconds)=>sum+seconds,0);
const forward=new THREE.Vector3(),right=new THREE.Vector3(),up=new THREE.Vector3(0,1,0),focus=new THREE.Vector3();
export function introShot(camera,seconds,riders,lifts,dt,anchor) {
  let t=((seconds%INTRO_SECONDS)+INTRO_SECONDS)%INTRO_SECONDS;
  const shot=itinerary.find(s=>{if(t<s.seconds)return true;t-=s.seconds;return false;})||itinerary[0];
  if(shot.action){
    anchor.copy(riders().frame(camera,t,dt));
    return shot;
  }
  if(shot.lift){
    const lift=lifts.lifts.find(({def})=>def.id===shot.lift);
    if(lift){
      const sampler=lift.samplers[0],u=t/shot.seconds;
      const progress=.27+t*lift.def.speed/sampler.total;
      lifts.setPassenger(lift,0,progress,0);
      sampler.at(progress,anchor,forward);
      forward.y=0;forward.normalize();right.crossVectors(forward,up).normalize();
      focus.copy(anchor).addScaledVector(up,-1.45);
      camera.position.copy(focus).addScaledVector(right,8.8-u*1.5).addScaledVector(forward,5.9-u*3.6).addScaledVector(up,.6);
      camera.up.copy(up);camera.lookAt(focus);
      if(camera.fov!==44){camera.fov=44;camera.updateProjectionMatrix();}
      return shot;
    }
  }
  const {eye,target,fov}=shot.view||VALLEY_VIEW, u=t/shot.seconds-.5;
  camera.position.fromArray(eye);focus.fromArray(target);
  forward.subVectors(focus,camera.position).normalize();right.crossVectors(forward,up).normalize();
  camera.position.addScaledVector(right,(shot.truck||0)*u).addScaledVector(forward,(shot.push||0)*u);
  camera.up.copy(up);camera.lookAt(focus);
  anchor.copy(focus);
  if(camera.fov!==fov){camera.fov=fov;camera.updateProjectionMatrix();}
  return shot;
}
