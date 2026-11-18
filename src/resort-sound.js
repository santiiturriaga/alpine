// Quiet felt keys outdoors and a plucked waltz near the lodges. Web Audio
// schedules each note ahead of the render loop.
const air={
  beat:.54,bar:8,roots:[50,47,43,45,50,54,43,45], notes:[4,7,7,10,7,11,7,2,7,14,4,9,7,11,2,7],
};
const tavern={
  beat:.35,bar:6,roots:[55,52,48,50,55,59,48,50], notes:[7,9,7,4,2,0,4,7,11,9,7,2,4,0,2,5],
};
const night={
  beat:.58,bar:8,roots:[45,41,48,43,45,40,41,43],notes:[0,7,3,9,4,7,2,10,0,14,7,3,4,9,2,7],
};
const lateLight={
  beat:.57,bar:8,roots:[48,45,41,43,48,40,41,43],notes:[4,7,3,10,7,12,9,5,7,14,3,7,4,7,2,9],
};
const hz=n=>440*2**((n-69)/12);

export class ResortSound {
  constructor(engine){
    this.engine=engine;this.ctx=engine.ctx;this.next=0;this.step=0;this.popAt=0;this.chatterAt=0;
    this.piece=air;
    const ctx=this.ctx;
    this.music=ctx.createGain();this.music.gain.value=.55;this.music.connect(engine.master);
    this.delay=ctx.createDelay(1);this.delay.delayTime.value=.34;
    this.echo=ctx.createGain();this.echo.gain.value=.123;
    const roomTone=ctx.createBiquadFilter();roomTone.type='lowpass';roomTone.frequency.value=1170;
    this.music.connect(this.delay);this.delay.connect(roomTone);roomTone.connect(this.echo);this.echo.connect(engine.master);
    this.fire=engine.makeLoopNoise({type:'lowpass',freq:280,q:.35,gain:0});
    this.room=engine.makeLoopNoise({type:'bandpass',freq:540,q:.7,gain:0});
  }
  note(midi,time,duration,level,plucked=false,pan=0){
    const ctx=this.ctx,volume=ctx.createGain(),filter=ctx.createBiquadFilter(),panNode=ctx.createStereoPanner();
    panNode.pan.value=pan;volume.connect(panNode);panNode.connect(this.music);
    filter.type='lowpass';filter.frequency.setValueAtTime(plucked?2600:1350,time);
    filter.frequency.exponentialRampToValueAtTime(600,time+duration);filter.connect(volume);
    const a=ctx.createOscillator(),b=ctx.createOscillator(),harmonic=ctx.createGain();
    const pitch=hz(midi);a.type=plucked?'triangle':'sine';a.frequency.value=pitch;
    b.type='sine';b.frequency.value=pitch*(plucked?2.001:2.004);harmonic.gain.value=plucked?.22:.11;
    a.connect(filter);b.connect(harmonic);harmonic.connect(filter);
    volume.gain.setValueAtTime(.00001,time);volume.gain.linearRampToValueAtTime(level,time+(plucked?.012:.048));
    volume.gain.exponentialRampToValueAtTime(.00002,time+duration);
    a.start(time);b.start(time);a.stop(time+duration+.03);b.stop(time+duration+.03);
    a.onended=()=>{a.disconnect();b.disconnect();harmonic.disconnect();volume.disconnect();filter.disconnect();panNode.disconnect();};
  }
  update(state){
    const {ctx,engine}=this,t=ctx.currentTime;
    const near=state.tavern||0,fire=state.fire||0,playing=!state.paused&&engine.enabled;
    this.music.gain.setTargetAtTime(engine.musicEnabled&&playing?.50:0,t,.38);
    this.room.gain.gain.setTargetAtTime(playing?near*.055:0,t,.46);
    this.fire.gain.gain.setTargetAtTime(playing?fire*(.044+.012*Math.sin(t*4.3)):0,t,.23);
    if(!playing){this.next=t+.25;return;}
    if(fire>.025 && t>this.popAt){
      engine.noiseHit({dur:.024+Math.random()*.073,freq:1200+Math.random()*2300,q:.9,gain:fire*(.017+.049*Math.random()),slide:540});
      this.popAt=t+.08+Math.random()*(.35+1-fire);
    }
    if(near>.12&&t>this.chatterAt){
      // Alternating distant vowel-like babble and occasional glass chinks.
      const syllables=2+Math.floor(Math.random()*3);
      for(let i=0;i<syllables;i++){
        const f=122+Math.random()*51;
        engine.tone(f,{type:'triangle',gain:near*.012,dur:.12,attack:.039,slide:f*.93,when:i*.19});
        engine.noiseHit({freq:580+i*94,dur:.135,q:2.1,gain:near*.012,when:i*.19});
      }
      if(Math.random()<.35)engine.tone(1860+Math.random()*510,{gain:near*.015,dur:.23,when:.9});
      this.chatterAt=t+1.6+Math.random()*3.7;
    }
    if(!engine.musicEnabled){this.next=t+.25;return;}
    if(this.next<t)this.next=t+.018;
    const requested=near>.48 ? tavern : (state.night ?? 0)>.73 ? night : (state.golden ?? 0)>.53 ? lateLight : air;
    while(this.next<t+.36){
      if(this.step%this.piece.bar===0 && requested!==this.piece){
        this.piece=requested;
        this.step=0;
      }
      const score=this.piece,pluck=score===tavern;
      const bar=Math.floor(this.step/score.bar),n=this.step%score.bar,root=score.roots[bar%8];
      if(n===0)this.note(root-12,this.next,score.beat*(score.bar-.5),.055,false,-.18);
      if(n===1 && !pluck)this.note(root+7,this.next+.08,score.beat*5.4,.015,false,-.42);
      if(n===0||n===Math.floor(score.bar/2)){
        const voice=score.notes[(bar*2+(n?1:0))%score.notes.length];
        this.note(root+12+voice,this.next+.025,score.beat*(pluck?2.35:4.65),.044,pluck,.22);
      }
      if(n===2||n===4||(!pluck&&n===6))this.note(root+(n===4?12:7),this.next,score.beat*1.9,.026,pluck,-.27);
      if(!pluck && n===6 && bar%2===1)this.note(root+19,this.next+.045,score.beat*2.8,.017,false,.42);
      this.next+=score.beat;this.step++;
    }
  }
}
