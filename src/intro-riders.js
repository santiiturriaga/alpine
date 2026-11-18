import * as THREE from 'three';
import { createSkier } from './skier.js';
import { heightAt, normalAt } from './terrain.js';
import { RUNS, runPointAt } from './worlddata.js';
import { SkiTracks, ParticleFX } from './effects.js';

// A handheld follow shot on Upper Whiskey Jack. All three riders move through
// the same world and use the same ski/boot contact solver as the player.
export function createIntroRiders(scene) {
  const run = RUNS.filter(r => r.name === 'Upper Whiskey Jack').sort((a,b)=>b.length-a.length)[0];
  const costumes = [0xba8b3e, 0x355f85, 0x843c38];
  const cast = new THREE.Group();
  cast.name = 'Opening film skiers';
  scene.add(cast);
  const riders = costumes.map(jacket => {
    const rig=createSkier({jacket, accessories:false});
    const frame=new THREE.Group();
    frame.add(rig.group); cast.add(frame);
    return {rig,frame,tracks:new SkiTracks(cast,500),wake:new ParticleFX(cast)};
  });
  const forward=new THREE.Vector3(), right=new THREE.Vector3(), up=new THREE.Vector3(), basis=new THREE.Matrix4();
  const eye=new THREE.Vector3(), focus=new THREE.Vector3();
  const left=new THREE.Vector3(),rightTail=new THREE.Vector3(),velocity=new THREE.Vector3(),vertical=new THREE.Vector3(0,1,0);
  const start=Math.min(145,run.length*.28);
  return {
    hide(){ if(cast.visible){for(const r of riders){r.tracks.clear();r.wake.clear();}}cast.visible=false; },
    frame(camera,t,dt) {
      cast.visible=true;
      for(const [i,{rig,frame,tracks,wake}] of riders.entries()){
        const elapsed=t+i*.17, along=start+t*8.6+[0,3,5.2][i];
        const p=runPointAt(run,along/run.length), side=[.7,-3.5,3.6][i]+Math.sin(elapsed*1.55)*.82;
        const x=p.x+p.nx*side,z=p.z+p.nz*side;
        const rise=elapsed-1.65, air=Math.max(0,4.9*rise-4.905*rise*rise);
        frame.position.set(x,heightAt(x,z)+air,z);
        normalAt(x,z,up);
        if(air>0)up.lerp(vertical,Math.min(1,air)).normalize();
        forward.set(p.tx+p.nx*Math.cos(elapsed*1.55)*.16,0,p.tz+p.nz*Math.cos(elapsed*1.55)*.16);
        forward.addScaledVector(up,-forward.dot(up)).normalize();right.crossVectors(up,forward).normalize();
        basis.makeBasis(right,up,forward); frame.quaternion.setFromRotationMatrix(basis);
        frame.rotateX(air*.14);frame.updateMatrix();
        rig.animate(dt,{speed:8.8,steer:Math.sin(elapsed*1.55)*.56,tuck:.22,brake:0,airborne:air>0,
          grab:air*.23,crash:false,crashTime:0,airTime:Math.max(0,rise)},air>0?null:heightAt);
        if(air>0){tracks.breakTrack();wake.breakWake();}
        else{
          left.copy(rig.contactPoints[0]).addScaledVector(rig.skiAxes[0],-.78);
          rightTail.copy(rig.contactPoints[1]).addScaledVector(rig.skiAxes[1],-.78);
          const yaw=Math.atan2(forward.x,forward.z),steer=Math.sin(elapsed*1.55)*.56;
          tracks.addStep(left,rightTail,t,.72,{heading:yaw,carve:steer,axes:rig.skiAxes});
          wake.skiWake(...rig.contactPoints,velocity.copy(forward).multiplyScalar(8.8),yaw,.68,steer,0,dt);
        }
        tracks.update(t);wake.update(dt);
        if(i===0){
          eye.set(x-p.tx*8-p.nx*.85,0,z-p.tz*8-p.nz*.85);
          eye.y=heightAt(eye.x,eye.z)+2.05;
          focus.set(x+p.tx*3.9,frame.position.y+.75,z+p.tz*3.9);
        }
      }
      camera.position.copy(eye);camera.up.set(0,1,0);camera.lookAt(focus);
      if(camera.fov!==47){camera.fov=47;camera.updateProjectionMatrix();}
      return focus;
    },
  };
}
