import { jacketFinishes } from './garment-marks.js';
import { createGearPreview } from './gear-preview.js';
import { SNOW_SHOES } from './snow-shoes.js';
import { DEFAULT_GOGGLES, GOGGLES, isGoggleColor } from './ski-goggles.js';

// A local player's inventory. Race rewards, finds and slope coins all use
// the same currency. Purchases and the resulting equipped pair save together.
const key='alpine.outfitter.v1';
export const SKIS={
  'all-mountain':{name:'Salomon · All-mountain',price:0,description:'Balanced edges and a forgiving flex.',grip:1,drag:1,speed:1,pop:1,color:'#b75c42'},
  carver:{name:'Rossignol · Slalom carver',price:18,description:'Quicker edge engagement on hard snow.',grip:1.24,drag:1.02,speed:.98,pop:.98,color:'#236894'},
  powder:{name:'Atomic · Powder 112',price:24,description:'Wide shovels and less drag through soft snow.',grip:.90,drag:.83,speed:1.03,pop:1.04,color:'#7e995a'},
  park:{name:'LINE · Twin-tip park',price:21,description:'More pop and a shorter, softer sidecut.',grip:.96,drag:1.07,speed:.96,pop:1.24,color:'#d59a43'},
};
const colors={jacket:[['Clay','#ad4939'],['Alpine blue','#3b7190'],['Spruce','#3d6e54'],['Ochre','#ce933e'],['Graphite','#404348'],
    ['The North Face · Summit shell','summit-shell']],
  pants:[['Slate','#323e48'],['Sand','#a89a81'],['Navy','#24364a']],helmet:[['Chalk','#d6d6d1'],['Charcoal','#333a40'],['Copper','#9a6852']],
  backpack:[['Arc’teryx · Black','#24282a'],['Charcoal','#363d40'],['Cedar','#694e42'],['Ochre','#bc8340']]};
const questJackets = {
  'quest.overlook':['Glacier teal','#348d90'],
  'quest.wildlife':['Fireweed','#965387'],
  'quest.delivery':['Lichen','#9ba65e'],
  'quest.rescue':['Alpine crimson','#b92c40'],
  'quest.patrol-shell':['Arc’teryx · Alpine Patrol Shell · 2× tricks','patrol-shell'],
};
const patrolShell = questJackets['quest.patrol-shell'][1];
function jacketPalette(finds) {
  return [...colors.jacket,...Object.entries(questJackets).filter(([key])=>finds.includes(key)).map(([,value])=>value)];
}
const stickers={none:'No decal',peak:'Peak contour',maple:'Maple leaf',snowflake:'Snow crystal'};
const haircuts={helmet:'Keep helmet on',crop:'Short crop',part:'Side part',curls:'Curls'};
const hairColors=[['Dark brown','#382923'],['Chestnut','#814f32'],['Sandy blond','#bda36b']];
const defaultOutfit=Object.fromEntries(Object.entries(colors).map(([slot,palette])=>[slot,palette[0][1]]));
defaultOutfit.goggles=DEFAULT_GOGGLES;
const money=n=>Number.isSafeInteger(n)&&n>=0?n:0;
function read() {
  let data={};try{data=JSON.parse(localStorage.getItem(key)||'{}')||{};}catch{}
  const owned=new Set(['all-mountain',...(Array.isArray(data.owned)?data.owned.filter(s=>Object.hasOwn(SKIS,s)):[])]);
  const outfit={...defaultOutfit};
  const finds=Array.isArray(data.finds)?[...new Set(data.finds.filter(s=>typeof s==='string'))]:[];
  for(const [slot,palette] of Object.entries(colors))if((slot==='jacket'?jacketPalette(finds):palette).some(([,hex])=>hex===data.outfit?.[slot]))outfit[slot]=data.outfit[slot];
  if(isGoggleColor(data.outfit?.goggles))outfit.goggles=data.outfit.goggles;
  const ownsSnowShoes=data.ownsSnowShoes===true;
  return {balance:money(data.balance),owned:[...owned],skis:owned.has(data.skis)?data.skis:'all-mountain',outfit,
    sticker:Object.hasOwn(stickers,data.sticker)?data.sticker:'none',finds,ownsSnowShoes,
    footwear:ownsSnowShoes&&data.footwear==='traverse'?'traverse':'standard',
    haircut:Object.hasOwn(haircuts,data.haircut)?data.haircut:'helmet',
    hairColor:hairColors.some(([,color])=>color===data.hairColor)?data.hairColor:hairColors[0][1]};
}
const element=(tag,cls,text='')=>{const e=document.createElement(tag);if(cls)e.className=cls;e.textContent=text;return e;};

export class Outfitter {
  constructor(player,close,renderer) {
    this.player=player;this.state=read();this.dialog=document.getElementById('outfitter');
    this.dialog.querySelector('[data-shop-close]').onclick=close;
    this.dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
    this.notices=this.dialog.querySelector('output');
    this.previewCanvas=this.dialog.querySelector('[data-gear-preview]');
    this.previewCaption=this.dialog.querySelector('[data-preview-caption]');
    this.goggleButton=this.dialog.querySelector('[data-goggle-preview]');
    this.renderer=renderer;
    for (const button of this.dialog.querySelectorAll('[data-turn]')) button.onclick=()=>{
      this.angle+=Number(button.dataset.turn);
      this.drawPreview();
    };
    window.addEventListener('storage',e=>{if(e.key===key){this.state=read();this.equip();if(this.dialog.open)this.render();}});
    this.equip();
  }
  equip() {
    const s=this.state;
    this.player.tuning=SKIS[s.skis];
    const patrol=s.outfit.jacket===patrolShell;
    this.player.landingTrickMultiplier=patrol?2:1;
    this.player.walkFootwear=s.footwear==='traverse'?SNOW_SHOES:null;
    this.player.rig.setAppearance?.(this.appearance);
    if(this.dialog.open)this.drawPreview();
  }
  get appearance() {
    const { outfit,skis,sticker,footwear,haircut,hairColor }=this.state;
    return {...this.broadcastOutfit,apparel:outfit.jacket,skis,sticker,footwear,haircut,hairColor};
  }
  get broadcastOutfit() {
    const {outfit}=this.state;
    return Object.hasOwn(jacketFinishes,outfit.jacket) ? {...outfit,jacket:jacketFinishes[outfit.jacket]} : outfit;
  }
  equipPatrolShell() {
    if(!this.state.finds.includes('quest.patrol-shell'))return false;
    this.state.outfit.jacket=patrolShell;
    this.equip();
    this.save();
    if(this.dialog.open)this.render();
    return true;
  }
  save(){try{localStorage.setItem(key,JSON.stringify(this.state));}catch{}}
  credit(amount){if(!Number.isSafeInteger(amount)||amount<=0)return;this.state.balance+=amount;this.save();}
  spend(amount) {
    if(!Number.isSafeInteger(amount)||amount<=0||this.state.balance<amount)return false;
    this.state.balance-=amount;
    this.save();
    return true;
  }
  find(id,reward) {if(this.state.finds.includes(id))return false;this.state.finds.push(id);this.credit(reward);return true;}
  open(shop={}){
    this.barber=shop.kind==='barber';
    this.dialog.querySelector('#outfitter-name').textContent=shop.name||'Mountain outfitter';
    this.setPreviewMode(this.barber?'hair':'outfit');
    this.dialog.querySelector('[data-shop-gear]').hidden=this.barber;
    this.dialog.querySelector('[data-shop-barber]').hidden=!this.barber;
    this.notices.textContent='';
    this.render();
    this.dialog.showModal();
    this.dialog.scrollTop=0;
    this.drawPreview();
  }
  drawPreview(){
    if(!this.renderer)return;
    this.preview ??= createGearPreview(this.renderer,this.previewCanvas);
    this.preview(this.appearance,this.angle,this.previewMode);
  }
  setPreviewMode(mode) {
    if(this.previewMode===mode && this.dialog.open)return;
    this.previewMode=mode;
    this.angle=mode==='hair'?.13:mode==='goggles'?-.77:-.48;
    const caption=mode==='goggles'?'Smith × Supreme':'Your skier';
    this.previewCaption.textContent=caption;
    this.previewCanvas.setAttribute('aria-label',mode==='goggles'?'3D close-up of your Smith × Supreme goggles':
      mode==='hair'?'3D preview of your skier’s haircut':'3D preview of your skier and equipped outfit');
    this.goggleButton.setAttribute('aria-pressed',String(mode==='goggles'));
  }
  renderGoggles() {
    const s=this.state, card=this.dialog.querySelector('[data-goggles]');
    const color=card.querySelector('select');
    color.replaceChildren(...Object.entries(GOGGLES).map(([id, finish])=>new Option(finish.name,id)));
    color.value=s.outfit.goggles;
    card.style.setProperty('--topsheet',GOGGLES[color.value].frame);
    color.onchange=()=>{
      s.outfit.goggles=color.value;
      const finish=GOGGLES[color.value];
      card.style.setProperty('--topsheet',finish.frame);
      this.setPreviewMode('goggles');
      this.equip();this.save();
      this.notices.textContent=`${finish.name} goggles equipped.`;
    };
    this.goggleButton.onclick=()=>{
      this.setPreviewMode(this.previewMode==='goggles'?'outfit':'goggles');
      this.drawPreview();
    };
  }
  renderBarber(){
    const fields=this.dialog.querySelector('[data-shop-barber]');
    const s=this.state;
    const style=fields.querySelector('[data-haircut]'),color=fields.querySelector('[data-hair-color]');
    style.replaceChildren(...Object.entries(haircuts).map(([id,label])=>new Option(label,id)));
    color.replaceChildren(...hairColors.map(([label,hex])=>new Option(label,hex)));
    style.value=s.haircut;
    color.value=s.hairColor;
    color.disabled=s.haircut==='helmet';
    style.onchange=()=>{
      s.haircut=style.value;
      color.disabled=s.haircut==='helmet';
      this.equip();this.save();
    };
    color.onchange=()=>{s.hairColor=color.value;this.equip();this.save();};
  }
  renderFootwear(){
    const s=this.state,slot=this.dialog.querySelector('[data-footwear]');
    const equipped=s.footwear==='traverse';
    const button=element('button',null,equipped?'Switch to ski boots':s.ownsSnowShoes?'Equip':`Buy · ${SNOW_SHOES.price} coins`);
    button.disabled=!s.ownsSnowShoes&&s.balance<SNOW_SHOES.price;
    button.dataset.snowShoes='';
    button.onclick=()=>{
      if(!s.ownsSnowShoes){
        if(s.balance<SNOW_SHOES.price)return;
        s.balance-=SNOW_SHOES.price;
        s.ownsSnowShoes=true;
      }
      s.footwear=equipped?'standard':'traverse';
      this.equip();this.save();this.render();
      this.dialog.querySelector('[data-snow-shoes]').focus({preventScroll:true});
      this.notices.textContent=equipped?'Standard ski boots equipped.':`${SNOW_SHOES.name} equipped.`;
    };
    const boost=Math.round((SNOW_SHOES.speed-1)*100);
    slot.replaceChildren(element('strong',null,SNOW_SHOES.name),element('p',null,
      `Walk ${boost}% faster on level snow and keep more pace uphill. Switch to walking mode with B.`),button);
  }
  render(){
    const s=this.state,dialog=this.dialog;
    dialog.querySelector('[data-balance]').textContent=`${s.balance} mountain coins`;
    if(this.barber){this.renderBarber();return;}
    this.renderGoggles();
    this.renderFootwear();
    const list=dialog.querySelector('[data-skis]');list.replaceChildren();
    for(const [id,item] of Object.entries(SKIS)){
      const owned=s.owned.includes(id),active=s.skis===id,card=element('article','gear-card');
      card.style.setProperty('--topsheet',item.color);
      const heading=element('strong',null,item.name),stats=element('small',null,`Edge ${Math.round(item.grip*100)} · Glide ${Math.round(100/item.drag)} · Pop ${Math.round(item.pop*100)}`);
      const button=element('button',null,active?'Equipped':owned?'Equip':`Buy · ${item.price} coins`);
      button.disabled=active||(!owned&&s.balance<item.price);button.dataset.ski=id;
      button.onclick=()=>{
        if(!s.owned.includes(id)){
          if(s.balance<item.price)return;
          s.balance-=item.price;s.owned.push(id);
        }
        s.skis=id;this.equip();this.save();this.render();this.notices.textContent=`${item.name} equipped.`;
      };
      card.append(heading,element('p',null,item.description),stats,button);list.append(card);
    }
    const fields=dialog.querySelector('[data-apparel]');fields.replaceChildren();
    for(const [slot,palette] of Object.entries(colors)){
      const label=element('label',null,slot[0].toUpperCase()+slot.slice(1)),select=element('select');
      select.dataset.slot=slot;for(const [name,hex] of (slot==='jacket'?jacketPalette(s.finds):palette))select.add(new Option(name,hex));
      select.value=s.outfit[slot];select.onchange=()=>{s.outfit[slot]=select.value;this.equip();this.save();};
      label.append(select);fields.append(label);
    }
    const badge=element('select');for(const [id,label] of Object.entries(stickers))badge.add(new Option(label,id));
    badge.value=s.sticker;badge.onchange=()=>{s.sticker=badge.value;this.equip();this.save();};
    badge.dataset.slot='sticker';const label=element('label',null,'Helmet & pack');label.append(badge);fields.append(label);
    const finds=dialog.querySelector('[data-finds]');finds.replaceChildren();
    for(const find of this.catalog||[]){const li=element('li',s.finds.includes(find.id)?'collected':'',s.finds.includes(find.id)?find.title:find.hint);finds.append(li);}
  }
}
