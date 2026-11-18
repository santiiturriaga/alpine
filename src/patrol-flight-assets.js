import * as THREE from 'three';
import { createSkier } from './skier.js';
import { box, mergedMesh, part } from './scenery.js';
import { makeTextTexture } from './util.js';

const DECK_RADIUS = 7.2;
const deckEdge = DECK_RADIUS * Math.cos(Math.PI / 8);
const sector = Math.PI / 4;
const white = '#e6eeeb';
const orange = '#efb355';
const steel = '#364148';
const cable = new THREE.MeshStandardMaterial({ color:0xe4a653, roughness:.74 });
const beaconMaterial = new THREE.MeshBasicMaterial({ color:0xffbe58 });
const vertical = new THREE.Vector3(0, 1, 0), ropeAxis = new THREE.Vector3();

export function createPatrolPad(scene, pose, heightAt) {
  const {x,z,heading} = pose;
  const deckY = Math.max(...Array.from({length: 8}, (_, i) => {
    const a = i * sector + heading + sector / 2;
    return heightAt(x + Math.sin(a) * DECK_RADIUS, z + Math.cos(a) * DECK_RADIUS);
  }), heightAt(x,z)) + .14;
  const rampLength=5.0, rampWidth=2.9, rampEnd=deckEdge+rampLength;
  const rampY=heightAt(x-Math.sin(heading)*rampEnd,z-Math.cos(heading)*rampEnd)+.025;
  const rampPitch=Math.atan2(deckY-rampY,rampLength);
  const group = new THREE.Group();
  group.name = 'Upper Whiskey Jack · Alpine Patrol helipad';
  group.position.set(x,deckY,z);
  group.rotation.y = heading;
  scene.add(group);
  const pieces = [
    part(new THREE.CylinderGeometry(DECK_RADIUS,DECK_RADIUS,.24,8,1,false,sector/2), '#536166', [0,-.121,0]),
    part(new THREE.CylinderGeometry(DECK_RADIUS+.06,DECK_RADIUS+.06,.22,8,1,false,sector/2),'#303b42',[0,-.35,0]),
    box(.42,.012,3.78,white,[-1.14,.012,0]),
    box(.42,.012,3.78,white,[1.14,.012,0]),
    box(2.29,.012,.42,white,[0,.012,0]),
    box(rampWidth,.11,Math.hypot(rampLength,deckY-rampY),'#616c70',[0,(rampY-deckY)/2-.052,-deckEdge-rampLength/2],[-rampPitch,0,0]),
  ];
  for (let i = 0; i < 8; i++) {
    const a = i * sector;
    const lx = Math.sin(a), lz = Math.cos(a);
    pieces.push(box(.094,.014,4.51,white,[lx*5.65,.012,lz*5.65],[0,a+Math.PI/2,0]));
    pieces.push(box(.17,.075,4.78,i%2 ? '#dba749' : '#a17a39',[lx*deckEdge,-.08,lz*deckEdge],[0,a+Math.PI/2,0]));
    if (i%2) {
      const lampX=lx*6.38,lampZ=lz*6.38;
      pieces.push(box(.25,.12,.25,'#263139',[lampX,.055,lampZ]));
      const light = new THREE.Mesh(new THREE.BoxGeometry(.152,.049,.152),beaconMaterial);
      light.position.set(lampX,.13,lampZ);group.add(light);
    }
    const sx=lx*5.22,sz=lz*5.22;
    const wx=x+sx*Math.cos(heading)+sz*Math.sin(heading), wz=z+sz*Math.cos(heading)-sx*Math.sin(heading);
    const depth=Math.max(.4,deckY-heightAt(wx,wz)+.28);
    pieces.push(box(.54,depth,.54,steel,[sx,-depth/2-.08,sz]));
    pieces.push(box(.92,.34,.92,'#74797a',[sx,-depth+.08,sz]));
  }
  // Drainage and anti-slip grooves sit below the painted touchdown marks.
  for (let i=-13;i<=13;i++) {
    const z=i*.39, halfWidth=Math.min(5.4,Math.SQRT2*deckEdge-Math.abs(z)-.17);
    pieces.push(box(halfWidth*2,.007,.018,'#495559',[0,.003,z]));
  }
  for(let i=0;i<11;i++){
    const f=(i+.5)/11;
    pieces.push(box(rampWidth-.16,.013,.027,'#3c484d',[0,(rampY-deckY)*f,-deckEdge-rampLength*f],[-rampPitch,0,0]));
  }
  group.add(mergedMesh(pieces,{roughness:.85,metalness:.14}));

  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.08,.59),new THREE.MeshStandardMaterial({
    map:makeTextTexture('ALPINE PATROL  •  H1',{width:768,height:148,bg:'#3c474b',fg:'#f7e8bf',font:'700 76px Barlow Condensed,Arial'}),
    side:THREE.DoubleSide,roughness:.81
  }));
  sign.position.set(0,.09,-deckEdge-.14);
  sign.rotation.y = Math.PI;
  group.add(sign);

  const c=Math.cos(heading),s=Math.sin(heading);
  const deckPoint=(across,along)=>({x:x+c*across+s*along,z:z-s*across+c*along,y:deckY});
  return {
    group, y:deckY, boarding:{...deckPoint(3.67,.31),heading:heading-Math.PI/2},
    turns:[deckPoint(0,-deckEdge),deckPoint(3.58,-4.24)],
    access:{x:x-s*rampEnd,z:z-c*rampEnd,y:rampY,heading},
    surfaceAt(px,pz) {
      const dx=px-x,dz=pz-z;
      if (dx*dx+dz*dz>DECK_RADIUS**2) return null;
      for (let i=0;i<8;i++) {
        const a=heading+i*sector;
        if (dx*Math.sin(a)+dz*Math.cos(a)>deckEdge) return null;
      }
      return deckY;
    },
    walkAt(px,pz) {
      const dx=px-x,dz=pz-z;
      const across=dx*c-dz*s, along=dx*s+dz*c;
      if (Math.abs(across)<=rampWidth/2 && along < -deckEdge && along >= -rampEnd)
        return deckY+(rampY-deckY)*(-along-deckEdge)/rampLength;
      return this.surfaceAt(px,pz);
    },
  };
}

function patch(torso, rear) {
  const group = new THREE.Group();
  const size = rear ? .14 : .073;
  group.add(mergedMesh([
    box(size,size*.32,.009,white), box(size*.32,size,.009,white),
  ]));
  const name = new THREE.Mesh(new THREE.PlaneGeometry(size*1.56,size*.31),new THREE.MeshStandardMaterial({
    map:makeTextTexture('PATROL',{width:256,height:52,bg:'#a32631',fg:'#fff1da',font:'700 38px Barlow Condensed,Arial'}),
  }));
  name.position.set(0,-size*.7,.006);
  group.add(name);
  group.position.set(rear ? 0 : -.114,.354,rear ? -.258 : .117);
  group.rotation.y = rear ? Math.PI : -.34;
  torso.add(group);
}

export function createPatrolActor(parent, { name, jacket, helmet, patrol = false }) {
  const frame = new THREE.Group();
  frame.name = name;
  const rig = createSkier({jacket,helmet,pants:0x263138,accessories:false});
  if (patrol) {
    patch(rig.torso,false);
    patch(rig.torso,true);
  }
  frame.add(rig.group);
  parent.add(frame);
  return {frame,rig};
}

export function posePatrolActor(actor, p, dt, { speed = 0, walk = 0, phase = 0, steer = 0, footMode = true, mount, pitch = 0, roll = 0 } = {}) {
  actor.frame.position.set(p.x,p.y,p.z);
  actor.frame.rotation.set(pitch,p.heading,roll,'YXZ');
  actor.frame.updateMatrix();
  actor.rig.animate(dt,{speed,footMode,walk,stridePhase:phase,steer,tuck:footMode ? 0 : .22,mount,
    airborne:false,brake:0,grab:0,crash:false,crashTime:0},null);
}

export function createPatrolCable(parent) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(.037,.037,1,9),cable);
  mesh.name = 'Alpine Patrol · winch cable';
  parent.add(mesh);
  mesh.visible = false;
  return {
    mesh,
    set(top,bottom) {
      ropeAxis.subVectors(top,bottom);
      mesh.scale.y=ropeAxis.length();
      mesh.visible=mesh.scale.y>.12;
      if (!mesh.visible) return;
      mesh.position.copy(top).addScaledVector(ropeAxis,-.5);
      mesh.quaternion.setFromUnitVectors(vertical,ropeAxis.normalize());
    },
  };
}

export function createPatrolSignal(parent, site) {
  const g = new THREE.Group();
  g.name = 'Alpine Patrol · ' + site.name;
  g.position.set(site.x,site.markerY,site.z);
  const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(.59),beaconMaterial);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(1.08,.034,8,34),beaconMaterial);
  ring.rotation.x=-Math.PI/2;
  g.add(diamond,ring);
  parent.add(g);
  return {group:g,diamond,ring};
}

function rock(parent, color, x,y,z, width,height,depth, yaw) {
  const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(1,0),
    new THREE.MeshStandardMaterial({color,roughness:.94,flatShading:true}));
  stone.scale.set(width,height,depth);
  stone.position.set(x,y,z);
  stone.rotation.set(.025,yaw,-.03);
  stone.castShadow=stone.receiveShadow=true;
  parent.add(stone);
}

export function createPatrolLedge(parent, site) {
  const group = new THREE.Group();
  group.name = 'Scree Ridge · rescue ledge';
  group.position.set(site.anchor.x,site.anchor.y,site.anchor.z);
  group.rotation.y=site.heading;
  parent.add(group);
  rock(group,0x626971,0,.45,-.4,4.2,3.42,2.82,.28);
  rock(group,0x777e80,-.33,2.18,1.04,2.77,1.19,1.88,.21);
  rock(group,0x575f66,2.4,-.4,.55,2.13,1.96,1.78,-.52);
  rock(group,0x62676d,-2.25,-.48,1.05,2.03,1.57,1.57,.43);
  rock(group,0xa7b4bf,-1.02,3.38,-.67,2.47,.24,1.29,.12);
  rock(group,0xc1cbd0,-2.09,2.04,1.42,1.07,.16,1.3,.21);
  return group;
}
