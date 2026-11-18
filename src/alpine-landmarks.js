import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { HARMONY_EXPRESS } from './worlddata.js';
import { beam, box, mergeParts, mergedMesh } from './scenery.js';
import { buildInukshuk, PEAK_STONE_SITE, ROUNDHOUSE_STONE_SITE } from './inukshuk.js';
import { makeCanvas, canvasTexture, makeTextTexture, lerp } from './util.js';

export function slowBanner(parent, a, b, title = 'SLOW ZONE') {
  const { canvas, ctx } = makeCanvas(1024, 240);
  ctx.fillStyle = '#edbc35';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#937336';
  ctx.lineWidth = 5;
  ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  ctx.fillStyle = '#242924';
  ctx.font = '900 131px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 512, 122, 660);
  for (const x of [120, 904]) {
    ctx.save();
    ctx.translate(x, 120);
    ctx.rotate(Math.PI / 4);
    ctx.strokeRect(-60, -60, 120, 120);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x-3,91,12,0,Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x+5,107);ctx.lineTo(x-9,138); ctx.lineTo(x-26,153);
    ctx.moveTo(x-9,138);ctx.lineTo(x+13,150);
    ctx.moveTo(x+4,112);ctx.lineTo(x+22,126);ctx.lineTo(x+31,151);
    ctx.moveTo(x-37,157);ctx.lineTo(x+39,157);
    ctx.lineWidth=7;ctx.strokeStyle='#242924';ctx.stroke();
  }
  const map = canvasTexture(canvas);
  const geometry = new THREE.PlaneGeometry(1,1,40,7);
  const coords = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const feet = [];
  const poles = [];
  for (let i = 0; i <= 3; i++) {
    const x = lerp(a[0], b[0], i / 3), z = lerp(a[1], b[1], i / 3);
    const y = heightAt(x,z);
    feet.push(y);
    poles.push(box(.043,1.43,.045,'#7b3832',[x,y+.67,z],[0,0,i%2 ? .07 : -.035]));
    poles.push(box(.049,.19,.05,'#403933',[x,y+1.28,z],[0,0,i%2 ? .07 : -.035]));
  }
  const poleMesh = new THREE.Mesh(mergeParts(poles),new THREE.MeshStandardMaterial({vertexColors:true,roughness:.61}));
  poleMesh.castShadow=true;
  parent.add(poleMesh);
  const material = new THREE.MeshStandardMaterial({ map, side:THREE.DoubleSide,roughness:.69 });
  const cloth = new THREE.Mesh(geometry,material);
  cloth.name = title;
  cloth.castShadow = cloth.receiveShadow = true;
  cloth.frustumCulled = false;
  parent.add(cloth);

  return (time) => {
    const xAxis = b[0]-a[0], zAxis=b[1]-a[1];
    const length = Math.hypot(xAxis,zAxis);
    for (let i=0;i<coords.count;i++) {
      const u = uv.getX(i), v = uv.getY(i);
      const panel = Math.min(2, Math.floor(u*3)), t = u*3-panel;
      const sag = 4*t*(1-t);
      const gust = sag * (.085 * Math.sin(time * 1.48 + u*15 + v*3) + .052 * Math.sin(v*8-u*22 + time*.81));
      const y = lerp(feet[panel],feet[panel+1],t) + .22 + v*.96 - sag*(.05+.15*v);
      coords.setXYZ(i,a[0]+u*xAxis-zAxis/length*gust,y,a[1]+u*zAxis+xAxis/length*gust);
    }
    coords.needsUpdate = true;
    geometry.computeVertexNormals();
  };
}

export function buildAlpineChairStation(scene, grid, def, pointIndex) {
  const [x,z] = def.points[pointIndex], [nx,nz] = def.points[pointIndex === 0 ? 1 : pointIndex - 1];
  const yaw = Math.atan2(nx-x,nz-z);
  const group = new THREE.Group();
  group.name = def.name + (pointIndex === 0 ? ' · base' : ' · upper unload');
  group.position.set(x,heightAt(x,z)-.32,z);
  group.rotation.y = yaw;
  const shelter = [], machinery = [];
  const outline = [[-3.55,4.59],[-3.31,3.89],[-2.61,3.49],[2.6,3.49],[3.27,3.85],[3.55,4.58],[3.37,5.27],[2.85,5.77],[2.14,6.18],[-2.13,6.18],[-2.92,5.77],[-3.38,5.25]];
  for(let i=0;i<outline.length;i++){
    const a=outline[i],b=outline[(i+1)%outline.length];
    const h=Math.hypot(a[0]-b[0],a[1]-b[1]);
    const angle=Math.atan2(a[1]-b[1],a[0]-b[0]);
    const col=i>=5 && i<=10 ? '#4a6375' : '#86949a';
    shelter.push(box(h,.108,13.55,col,[(a[0]+b[0])/2,(a[1]+b[1])/2,-.36],[0,0,angle]));
    for(const z of [-6.95,-3.63,-.1,3.29,6.4]){
      shelter.push(box(h+.07,.22,.12,'#c5c9c9',[(a[0]+b[0])/2,(a[1]+b[1])/2,z],[0,0,angle]));
    }
  }
  for(const sign of [-1,1]){
    const sx=sign*(def.seats>=6?3.95:3.5);
    machinery.push(box(.57,3.75,.55,'#61696e',[sx,1.75,-3.79]),box(1.01,.4,1.27,'#929696',[sx,.12,-3.79]));
    machinery.push(box(.39,3.65,.42,'#626e76',[sx,1.73,3.68]));
    machinery.push(box(.25,.24,10.2,'#65737b',[sign*1.9,2.85,0]));
    shelter.push(box(.047,.32,13.24,'#92323a',[sign*3.35,4.82,-.37]));
    for(const z of [-3.79,3.68]){
      const px=x+sx*Math.cos(yaw)+z*Math.sin(yaw);
      const pz=group.position.z-sx*Math.sin(yaw)+z*Math.cos(yaw);
      grid.addCircle(px,pz,.4,'station');
    }
  }
  for (const z of [-7.16,6.61]) {
    const lower = def.id === HARMONY_EXPRESS ? '#dce1e4' : '#b4bcc0';
    shelter.push(box(6.95,.72,.22,lower,[0,4.02,z]));
    shelter.push(box(6.30,1.22,.095,'#324858',[0,5.12,z]));
    for(const x of [-3.17,-1.54,0,1.54,3.17])
      shelter.push(box(.10,1.19,.18,'#94a4ad',[x,5.12,z+(z>0?.05:-.05)]));
    for(const side of [-1,1]) shelter.push(beam([side*3.29,4.01,z],
      [side*2.60,5.85,z],.16,.24,lower));
  }
  const title=def.id===HARMONY_EXPRESS ? 'HARMONY 6 EXPRESS' : def.name.toUpperCase();
  const plate=makeTextTexture(title,{
    width:800,height:160,bg:'#dce1e3',fg:'#1d3540',
    font:'700 78px Barlow Condensed,Arial',border:'#8a9b9f',
  });
  const plateMat=new THREE.MeshStandardMaterial({map:plate,roughness:.6});
  const face=new THREE.Mesh(new THREE.PlaneGeometry(5.15,.57),plateMat);
  face.position.set(0,4.04,-7.30);
  face.rotation.y=Math.PI;
  group.add(face);
  const back=face.clone();
  back.position.z=6.73;
  back.rotation.y=0;
  group.add(back);
  if (def.id===HARMONY_EXPRESS) {
    for(const side of [-1,1]){
      shelter.push(box(.082,.52,13.1,'#bec9d0',[side*3.39,4.22,-.37]));
      shelter.push(box(.083,.115,12.9,'#a3383e',[side*3.43,4.49,-.37]));
      const label=new THREE.Mesh(new THREE.PlaneGeometry(4.7,.54),plateMat);
      label.position.set(side*3.46,4.25,1.57);
      label.rotation.y=side*Math.PI/2;
      group.add(label);
    }
  }
  group.add(mergedMesh(shelter,{roughness:.48,metalness:.16}),mergedMesh(machinery,{roughness:.77,metalness:.22}));
  scene.add(group);
}

export function buildSummitLandmarks(scene) {
  const summit = PEAK_STONE_SITE, lodge = ROUNDHOUSE_STONE_SITE;
  buildInukshuk(scene,summit.x,summit.z,summit.yaw,'Whistler Peak inukshuk');
  buildInukshuk(scene,lodge.x,lodge.z,lodge.yaw,'Roundhouse inukshuk','roundhouse');
  const signs = new THREE.Group();
  signs.name = 'Peak Express and Harmony slow zones';
  scene.add(signs);
  const peak = slowBanner(signs,[106,5122],[115,5118]);
  const harmony = slowBanner(signs,[1565,5058],[1573,5063]);
  return (time) => { peak(time); harmony(time); };
}
