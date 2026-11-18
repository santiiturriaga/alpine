import * as THREE from 'three';
import { RUNS, FINISHES, runPointAt } from './worlddata.js';
import { heightAt, normalAt } from './terrain.js';
import { createSkier } from './skier.js';
import { clamp, mulberry32 } from './util.js';

const courses = {
  avalanche: { title: 'Avalanche escape', run: 'Upper Whiskey Jack', start: 125, length: 350, gates: 0 },
  slalom: { title: 'Whiskey Jack slalom', run: 'Upper Whiskey Jack', start: 125, length: 350, gates: 9 },
  race: { title: 'Springboard head-to-head', run: 'Springboard', start: 155, length: 590, gates: 5 },
};

function setTransform(mesh, x, y, z, yaw = 0) {
  mesh.position.set(x,y,z);
  mesh.rotation.y = yaw;
  return mesh;
}

function buildGate(p, index, finish, slalom) {
  const group = new THREE.Group();
  group.name = finish ? 'Challenge finish' : 'Course gate ' + (index + 1);
  const gap = finish ? 16 : slalom ? 6.8 : 15;
  const tint = finish ? 0x234a47 : index % 2 ? 0x255f94 : 0xb73532;
  const cloth = new THREE.MeshStandardMaterial({ color:tint, roughness:.81, side:THREE.DoubleSide });
  const shaft = new THREE.MeshStandardMaterial({color:0xe9d781,roughness:.59});
  const yaw = Math.atan2(p.tx,p.tz);
  const lateral = !finish && slalom ? (index%2 ? -1 : 1)*4.4 : 0;
  const x=p.x+p.nx*lateral,z=p.z+p.nz*lateral;
  for (const side of [-1,1]) {
    const sx=x+p.nx*side*gap,sz=z+p.nz*side*gap,h=heightAt(sx,sz);
    group.add(setTransform(new THREE.Mesh(new THREE.CylinderGeometry(.045,.056,2.4,8),shaft),sx,h+1.19,sz));
    const geometry=new THREE.PlaneGeometry(1.13,.68,8,2);
    const pos=geometry.attributes.position;
    for(let i=0;i<pos.count;i++)pos.setZ(i,.085*Math.sin(pos.getX(i)*4+.4)+.045*pos.getY(i));
    geometry.computeVertexNormals();
    group.add(setTransform(new THREE.Mesh(geometry,cloth),sx+p.nx*side*.58,h+1.8,sz+p.nz*side*.58,yaw));
  }
  return { group,p:{...p,x,z},gap };
}

// Slab fragments roll in the leading edge. Broad, back-lit curls follow behind it.
function buildSlide() {
  const rand=mulberry32(6079), group=new THREE.Group();
  group.name='Moving avalanche front';
  const cloudGeometry=new THREE.SphereGeometry(1,14,10);
  const cloudMaterial=new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,
    uniforms:{seconds:{value:0}},
    vertexShader:`varying vec3 ball; varying vec3 eye; varying float seed;
    void main(){ball=position;seed=instanceMatrix[3].x*.37; vec4 pos=modelViewMatrix*instanceMatrix*vec4(position,1.);
    eye=normalize(mat3(modelViewMatrix*instanceMatrix)*normal);gl_Position=projectionMatrix*pos;}`,
    fragmentShader:`varying vec3 ball; varying vec3 eye; varying float seed; uniform float seconds;
    float hash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.3);return fract((p.x+p.y)*p.z);}
    float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
    mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
    void main(){vec3 p=ball*3.+vec3(seed,seconds*-.42,0);float n=.67*noise(p)+.33*noise(p*2.47);
    float a=smoothstep(.20,.74,n*.49+abs(normalize(eye).z)*.67);
    gl_FragColor=vec4(mix(vec3(.33,.46,.58),vec3(.96,.98,1.),.33+.40*n+.25*ball.y),a*.73);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    }`,
  });
  const cloud=new THREE.InstancedMesh(cloudGeometry,cloudMaterial,64);
  const chunks=new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1,0),new THREE.MeshStandardMaterial({color:0xdce7ed,roughness:.95}),60);
  cloud.frustumCulled=chunks.frustumCulled=false;
  group.add(cloud,chunks);
  const samples=Array.from({length:124},()=>({u:rand()*2-1,age:rand(),r:rand(),phase:rand()*6.28}));
  const o=new THREE.Object3D();let clock=0;
  return {group,update(dt,p){
    clock+=dt;cloudMaterial.uniforms.seconds.value=clock;
    for(let i=0;i<samples.length;i++){
      const a=samples[i],mist=i<64;
      const cycle=(a.age+clock*(mist?.22:.53))%1;
      const radius=mist?7.5+a.r*11.4:.28+a.r*1.2;
      const lateral=a.u*(mist?153:122)+Math.sin(clock+a.phase)*1.32;
      const offset=-Math.abs(a.u)*9-(mist?cycle*22:-2+cycle*5);
      const x=p.x+p.nx*lateral+p.tx*offset,z=p.z+p.nz*lateral+p.tz*offset;
      const lift=mist?radius*(.08+cycle*.65):Math.sin(cycle*Math.PI)*1.3;
      o.position.set(x,heightAt(x,z)+lift,z);
      o.rotation.set(cycle*2.8,a.phase+cycle,cycle*.7);
      o.scale.set(radius*(1+cycle*.36),radius*(mist?.75:.40),radius);
      o.updateMatrix();(mist?cloud:chunks).setMatrixAt(mist?i:i-64,o.matrix);
    }
    cloud.instanceMatrix.needsUpdate=chunks.instanceMatrix.needsUpdate=true;
  }};
}

export class MountainChallenges {
  constructor(scene, el) {
    this.scene=scene;this.el=el;this.state=null;
    this.title=el.querySelector('strong'); this.readout=el.querySelector('output');
    this.detail=el.querySelector('small'); this.actions=el.querySelector('.course-actions');
    this.meter=el.querySelector('progress');
  }

  clear() {
    if(this.opponent)this.opponent.frame.visible=false;
    if(this.group){
      this.scene.remove(this.group);
      const geometries=new Set(), materials=new Set();
      this.group.traverse(m=>{if(m.geometry)geometries.add(m.geometry);if(m.material)materials.add(m.material);if(m.isInstancedMesh)m.dispose();});
      geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
    }
    this.group=null;this.state=null;this.slide=null;this.el.hidden=true;
  }

  start(id,player) {
    const c=courses[id];if(!c)return;
    this.clear();
    const run=RUNS.find(r=>r.name===c.run && r.length>=c.start+c.length);
    if(!run)return;
    this.group=new THREE.Group();this.group.name=c.title;this.scene.add(this.group);
    this.run=run;this.course=c;
    this.gates=Array.from({length:c.gates},(_,i)=>{
      const d=c.start+(i+1)*c.length/c.gates;
      const gate=buildGate(runPointAt(run,d/run.length),i,i===c.gates-1,id==='slalom');
      this.group.add(gate.group);return gate;
    });
    this.state={id,phase:'ready',elapsed:0,progress:0,gate:0,front:-57,penalty:0,missed:0};
    this.slide=id==='avalanche'?buildSlide():null;
    if(this.slide){this.group.add(this.slide.group);this.slide.update(0,this.at(-57));}
    const start=this.at(0);player.footMode=false;player.teleport({...start,heading:Math.atan2(start.tx,start.tz),holdAtUnload:true},{resetStats:true});
    if(id==='avalanche'){
      this.state.summit=player.pos.y;
      this.state.snowline=player.pos.y+62;
      this.state.base=Math.min(...FINISHES.map(b=>heightAt(b.x,b.z)));
    }
    if(id==='race'){
      if(!this.opponent){
        const rig=createSkier({jacket:0x31798c,pants:0x344a57,helmet:0xe6cf85,accessories:false});
        const frame=new THREE.Group();frame.name='Springboard race opponent';
        frame.add(rig.group);this.scene.add(frame);
        this.opponent={rig,frame};
      }
      this.opponent.frame.visible=true;this.state.rival=0;this.state.rivalSpeed=0;
      this.placeRival(0,0);
    }
    this.lastX=start.x;this.lastZ=start.z;
    this.el.dataset.timed = String(id !== 'avalanche');
    this.title.textContent=c.title;this.readout.textContent=id==='avalanche'?c.run:'0.0 s';
    if (this.gates.length) this.highlightGate(0);
    this.detail.textContent=id==='avalanche'?'W to push off · Choose any descent to a village base before the slide catches you.'
      : id==='race'?'W to start · Beat the teal skier across the finish.':'W to start · Pass between the highlighted flags. Missed gates add 3 s.';
    this.actions.hidden=true;this.meter.value=0;this.el.hidden=false;
  }

  highlightGate(index) {
    for (const [i, gate] of this.gates.entries()) {
      const active = i === index;
      gate.group.visible = i >= index;
      for (const child of gate.group.children) {
        if (!child.material.emissive) continue;
        child.material.emissive.setHex(active ? 0xffb637 : 0x000000);
        child.material.emissiveIntensity = active ? .32 : 0;
      }
    }
  }

  at(metres) {return runPointAt(this.run,(this.course.start+metres)/this.run.length);}

  placeRival(dt,distance) {
    const p=this.at(distance),side=3.2+1.25*Math.sin(distance*.051),{frame,rig}=this.opponent;
    const x=p.x+p.nx*side,z=p.z+p.nz*side;
    frame.position.set(x,heightAt(x,z),z);
    frame.rotation.y=Math.atan2(p.tx+p.nx*.064*Math.cos(distance*.051),p.tz+p.nz*.064*Math.cos(distance*.051));
    frame.updateMatrix();
    rig.animate(dt,{speed:this.state.rivalSpeed,steer:.42*Math.sin(distance*.051),tuck:.76,brake:0,
      airborne:false,grab:0,crash:false,crashTime:0},heightAt);
  }

  updateSlide(dt,player) {
    const s=this.state,{x,z}=player.pos;
    const nearest=FINISHES.reduce((a,b)=>Math.hypot(x-a.x,z-a.z)<Math.hypot(x-b.x,z-b.z)?a:b);
    if(Math.hypot(x-nearest.x,z-nearest.z)<105 && player.pos.y<heightAt(nearest.x,nearest.z)+38){this.finish(true);return;}
    s.snowline-=dt*Math.min(3.25,.7+s.elapsed*.023);
    const ground=heightAt(x,z),lead=s.snowline-ground;
    // Find the intersection of the moving elevation front with this hillside.
    // The escape continues across piste boundaries, including off-piste routes.
    const n=normalAt(x,z);
    let dx=n.x,dz=n.z,len=Math.hypot(dx,dz);
    if(len<.02){dx=nearest.x-x;dz=nearest.z-z;len=Math.hypot(dx,dz)||1;}
    dx/=len;dz/=len;
    let lo=0,hi=12;
    while(hi<480 && heightAt(x-dx*hi,z-dz*hi)<s.snowline)hi*=1.6;
    for(let i=0;i<6;i++){const mid=(lo+hi)*.5;if(heightAt(x-dx*mid,z-dz*mid)>s.snowline)hi=mid;else lo=mid;}
    this.slide.group.visible=lead<145&&Math.abs(heightAt(x-dx*hi,z-dz*hi)-s.snowline)<25;
    if(this.slide.group.visible)this.slide.update(dt,{x:x-dx*hi,z:z-dz*hi,tx:dx,tz:dz,nx:-dz,nz:dx});
    s.progress=Math.max(0,s.summit-ground);
    this.meter.value=clamp(s.progress/(s.summit-s.base),0,1);
    this.readout.textContent=Math.max(0,Math.round(lead))+' m below the slide';
    this.detail.textContent=nearest.title+' · '+(Math.hypot(x-nearest.x,z-nearest.z)/1000).toFixed(1)+' km';
    if(lead<=0)this.finish(false);
  }

  finish(won) {
    const s=this.state;
    s.phase=won?'won':'lost';
    const result=s.elapsed+s.penalty;
    let best=null;
    try{
      const key='alpine.personal-best.'+s.id;
      const prior=Number(localStorage.getItem(key))||Infinity;
      if(won){best=Math.min(result,prior);localStorage.setItem(key,best);}
    }catch{}
    this.readout.textContent=won?(s.id==='avalanche'?'Escaped':s.id==='race'?'1st place':'Finished'):(s.id==='race'?'2nd place':'Caught by the slide');
    if(won)this.onWin?.(s.id);
    this.detail.textContent=won?`${result.toFixed(1)} s${s.missed?' · '+s.missed+' missed gate'+(s.missed===1?'':'s'):''}${best?' · Best '+best.toFixed(1)+' s':''}`:'Try another line or return to free skiing.';
    if(won)this.meter.value=1;
    this.actions.hidden=false;
    if(this.slide)this.slide.group.visible=false;
  }

  update(dt,player) {
    const s=this.state;if(!s || s.phase==='won'||s.phase==='lost')return;
    if(s.phase==='ready'){if(player.holdAtUnload)return;s.phase='running';}
    s.elapsed+=dt;
    if(s.id==='avalanche'){this.updateSlide(dt,player);return;}
    if(s.id==='race'){
      const p=this.at(s.rival),n=normalAt(p.x,p.z);
      const grade=Math.max(0,(n.x*p.tx+n.z*p.tz)/Math.max(.4,n.y));
      s.rivalSpeed=clamp(s.rivalSpeed+(1.35+8.9*grade-.012*s.rivalSpeed*s.rivalSpeed)*dt,1,21);
      s.rival=Math.min(this.course.length,s.rival+s.rivalSpeed*dt);this.placeRival(dt,s.rival);
    }
    const {x,z}=player.pos,c=this.course;
    // Project onto a short length of the actual piste, preserving branches
    // at trail crossings and avoiding progress from travel on another run.
    const from=c.start+Math.max(0,s.progress-45),to=c.start+Math.min(c.length,s.progress+65);
    let nearest=Infinity, along=s.progress;
    for(let d=from;d<to+4;d+=5){
      const p=this.at(Math.min(c.length,d-c.start)), dx=x-p.x,dz=z-p.z,err=dx*dx+dz*dz;
      if(err<nearest){nearest=err;along=clamp(d-c.start+dx*p.tx+dz*p.tz,0,c.length);}
    }
    s.progress=along;
    const g=this.gates[s.gate];
    const side=(x-g.p.x)*g.p.nx+(z-g.p.z)*g.p.nz;
    const ahead=(x-g.p.x)*g.p.tx+(z-g.p.z)*g.p.tz;
    const prev=(this.lastX-g.p.x)*g.p.tx+(this.lastZ-g.p.z)*g.p.tz;
    const dGate=(s.gate+1)*c.length/c.gates;
    const crossed=prev<=0 && ahead>=0 && Math.abs(side)<=g.gap+1;
    const missed=s.progress>dGate+5;
    if(crossed || (s.gate<c.gates-1 && missed)){
      if(!crossed && s.id==='slalom'){s.penalty+=3;s.missed++;}
      s.gate++;
      this.highlightGate(s.gate);
      if(s.gate===c.gates){this.finish(true);return;}
    }
    this.lastX=x;this.lastZ=z;
    this.meter.value=s.progress/c.length;
    if(s.id==='race'){
      if(s.rival>=c.length){this.finish(false);return;}
      const lead=s.progress-s.rival;
      this.readout.textContent=s.elapsed.toFixed(1)+' s';
      this.detail.textContent=(lead>=0?'1st':'2nd')+' · '+Math.abs(Math.round(lead))+' m '+(lead>=0?'ahead':'behind')+' · Between flags '+(s.gate+1)+' / '+c.gates;
    }else{
      this.readout.textContent=(s.elapsed+s.penalty).toFixed(1)+' s';
      this.detail.textContent='Gate '+(s.gate+1)+' / '+c.gates+(s.penalty?' · +'+s.penalty+' s':'');
    }
    if(s.gate===c.gates-1 && !crossed && s.progress>=c.length-1 && Math.abs(side)>g.gap)
      this.detail.textContent='Cross between the two green finish flags.';
  }
}
