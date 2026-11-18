import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { makeCanvas,canvasTexture } from './util.js';
import { box,part,beam } from './scenery.js';
import { timberMesh } from './plaza-materials.js';

// Events and dates from the Whistler Museum, Tourism Whistler and the 2010
// official venue guide. The trail-side displays are original game exhibits.
const exhibits=[
  {id:'original-lift',year:'1966',title:'The first gondola',hint:'Find the old lift exhibit in the Creekside forecourt.',
    story:'Whistler opened here in January 1966. Its original four-person gondola carried skiers to midstation.',x:-2545,z:2124,yaw:.2},
  {id:'alpine-games',year:'2010',title:'The Olympic downhill',hint:'Visit the alpine racing exhibit at Creekside.',
    story:'Creekside hosted Olympic alpine skiing in 2010. The men’s downhill raced on the Dave Murray Downhill course.',x:-2540,z:2098,yaw:.55},
  {id:'valley-span',year:'2008',title:'Across Fitzsimmons Creek',hint:'Look for the span exhibit outside the Whistler PEAK 2 PEAK terminal.',
    story:'PEAK 2 PEAK connected the two mountains in December 2008. Its cabins cross the Fitzsimmons Creek valley.',x:520,z:4863,yaw:.27},
  {id:'games-plaza',year:'2010',title:'The medals plaza',hint:'Walk to the rings in Village North.',
    story:'Olympic and Paralympic celebrations brought athletes and spectators to the medals plaza in Whistler Village.',x:-135,z:-622,yaw:2.7},
  {id:'cedar-horse',title:'The little cedar horse',hint:'Look for a tiny horse where Creekside skiers meet after the last lap.',
    story:'A hand-carved souvenir of Dusty’s namesake.',x:-2532.5,z:2081,yaw:.76,secret:true},
  {id:'lost-ski',title:'The lost wooden ski',hint:'A wooden ski is leaning near the Roundhouse stairs.',
    story:'Someone left a leather-bound wooden ski and a brass mountain pin here.',x:506,z:4838,yaw:1.95,secret:true},
];

function boardFor(site){
  const {canvas,ctx}=makeCanvas(768,464);
  ctx.fillStyle='#e6dfc8';ctx.fillRect(0,0,768,464);
  ctx.fillStyle='#773f30';ctx.font='bold 64px Georgia';ctx.fillText(site.year,35,83);
  ctx.fillStyle='#172c2c';ctx.font='bold 35px Arial';ctx.fillText(site.title,35,148);
  ctx.fillRect(35,172,690,2);ctx.font='28px Arial';
  let y=228,line='';
  for(const word of site.story.split(' ')){
    if(ctx.measureText(line+' '+word).width>681){ctx.fillText(line,35,y);line='';y+=37;}
    line+=(line?' ':'')+word;
  }
  ctx.fillText(line,35,y);
  const face=new THREE.Mesh(new THREE.PlaneGeometry(1.36,.82),new THREE.MeshStandardMaterial({map:canvasTexture(canvas),roughness:.71}));
  face.position.set(0,1.36,.067);return face;
}
export function buildFieldNotes(scene,grid,shop,toast){
  shop.catalog=exhibits;
  for(const site of exhibits){
    const group=new THREE.Group();group.name=site.title;
    group.position.set(site.x,heightAt(site.x,site.z),site.z);site.y=group.position.y;
    group.rotation.y=site.yaw;scene.add(group);
    if(!site.secret){
      group.add(timberMesh([box(.13,1.79,.14,'#654837',[-.52,.88,0]),box(.13,1.79,.14,'#73503a',[.52,.88,0]),
        box(1.48,.94,.12,'#503e34',[0,1.36,0]),box(1.53,.055,.18,'#8e7960',[0,1.84,0])]),boardFor(site));
      grid.addCircle(site.x,site.z,.63,'display');
    }else if(site.id==='cedar-horse'){
      const wood='#975e3a',pieces=[box(.26,.28,.57,wood,[0,.53,0]),
        beam([0,.61,.21],[0,.91,.25],.20,.17,wood),box(.16,.15,.31,wood,[0,.89,.33])];
      for(const side of [-1,1]){
        for(const z of [-.19,.21])pieces.push(beam([side*.10,.51,z],[side*.14,.09,z+.04],.07,.07,wood));
        pieces.push(part(new THREE.ConeGeometry(.053,.15,5),'#72462f',[side*.049,.99,.235]));
      }
      pieces.push(beam([0,.62,-.22],[.03,.35,-.34],.06,.08,'#674635'));
      group.add(timberMesh(pieces));
    }else{
      const ski=timberMesh([box(.12,1.64,.026,'#ac7744',[0,.93,0]),box(.115,.29,.055,'#584235',[0,.83,.012]),
        part(new THREE.SphereGeometry(1,14,8),'#ae7c4c',[0,1.76,.025],[0,0,0],[.061,.14,.044])]);
      ski.rotation.z=.14;group.add(ski);
    }
  }
  return {update(player){
    if(player.riding||player.crash||player.speed>8)return;
    for(const site of exhibits){
      if(shop.state.finds.includes(site.id)||Math.abs(site.y-player.pos.y)>3.0)continue;
      if(Math.hypot(site.x-player.pos.x,site.z-player.pos.z)<(site.secret?2.7:3.8) && shop.find(site.id,site.secret?10:5)){
        toast(site.title,site.secret?'Hidden souvenir · 10 coins':'Field note · 5 coins','gold','star');
      }
    }
  }};
}
