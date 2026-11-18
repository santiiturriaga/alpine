import * as THREE from 'three';
import { canvasTexture, makeCanvas } from './util.js';

const gates=[];
const grey=new THREE.MeshStandardMaterial({color:0x9aa9ab,metalness:.64,roughness:.37});
const amber=new THREE.MeshBasicMaterial({color:0xf4ba54});
const green=new THREE.MeshBasicMaterial({color:0x63deb5});
const pivotPin=new THREE.CylinderGeometry(.046,.046,.09,12);
const led=new THREE.BoxGeometry(.108,.070,.04);
const ticket=new THREE.BoxGeometry(.091,.059,.003);
let ticketMaterial;
function printedPass(){
  if(ticketMaterial)return ticketMaterial;
  const {canvas,ctx}=makeCanvas(256,160);
  ctx.fillStyle='#f3f2e8';ctx.fillRect(0,0,256,160);
  ctx.fillStyle='#ad3f34';ctx.fillRect(0,0,256,41);
  ctx.fillStyle='#fff';ctx.font='bold 26px sans-serif';ctx.fillText('ALPINE',15,29);
  ctx.fillStyle='#1c3138';ctx.font='bold 22px sans-serif';ctx.fillText('LIFT ACCESS',15,76);
  for(let i=0;i<47;i++)ctx.fillRect(16+i*4.6,98,1+(i*7%3),30);
  return ticketMaterial=new THREE.MeshStandardMaterial({map:canvasTexture(canvas),roughness:.46});
}
export function addPassGate(parent,x,y,z,span,face=1) {
  const pivot=new THREE.Group();pivot.name='RFID lane · hinged arm';
  pivot.position.set(x,y+.83,z);parent.add(pivot);
  const bar=new THREE.Mesh(new THREE.BoxGeometry(Math.abs(span),.055,.048),grey);
  bar.position.x=span*.5;pivot.add(bar,new THREE.Mesh(pivotPin,grey));
  const indicator=new THREE.Mesh(led,amber);
  indicator.position.set(x,y+1.24,z+face*.147);
  const pass=new THREE.Mesh(ticket,printedPass());pass.visible=false;
  parent.add(indicator,pass);parent.updateWorldMatrix(true,false);
  const origin=new THREE.Vector3(x+span*.5,y,z).applyMatrix4(parent.matrixWorld);
  gates.push({pivot,indicator,pass,x,y,z,face,span,origin,age:Infinity,latched:false});
}

export function updatePassGates(dt, player, camera, onRead) {
  for(const g of gates){
    const visible=camera.position.distanceToSquared(g.origin)<110**2;
    g.pivot.visible=g.indicator.visible=visible;
    if(!visible){g.pass.visible=false;g.latched=false;g.age=Infinity;continue;}
    const distance=player ? Math.hypot(player.pos.x-g.origin.x,player.pos.z-g.origin.z) : Infinity;
    const inLane=distance<1.35 && Math.abs(player.pos.y-g.origin.y)<1.1 && !player.riding;
    if(!g.latched && inLane && player.speed<5){
      g.age=0;g.latched=true;onRead?.();
    }
    if(distance>2.15)g.latched=false;
    g.age+=dt;
    const read=THREE.MathUtils.smoothstep(g.age,.16,.43);
    const closing=g.latched?0:THREE.MathUtils.smoothstep(g.age,1.45,2.05);
    const open=Number.isFinite(g.age)?read*(1-closing):0;
    g.pivot.rotation.y=-Math.sign(g.span)*g.face*open*1.43;
    g.indicator.material=open>.25?green:amber;
    g.pass.visible=g.age<.67;
    if(g.pass.visible){
      const reach=Math.sin(Math.PI*g.age/.67);
      g.pass.position.set(g.x+Math.sign(g.span)*(.14-.10*reach),g.y+1.19+.05*reach,g.z+g.face*(.38-.21*reach));
      g.pass.rotation.set(-.25+reach*.15,g.face<0?Math.PI:0,-.34+.21*reach);
    }
  }
}
