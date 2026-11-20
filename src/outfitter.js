import { jacketFinishes } from './garment-marks.js';
import { createBarberPreview } from './gear-preview.js';
import { SKI_MODELS, SNOWBOARD_MODELS } from './gear-catalog.js';
import { restoreRide, rideOptions, equipRide } from './ride-inventory.js';
import { BACKPACK_MODELS, DEFAULT_BACKPACK_MODEL, isBackpackModel } from './backpack-catalog.js';
import { SNOW_SHOES } from './snow-shoes.js';
import { DEFAULT_GOGGLES, GOGGLES, isGoggleColor } from './ski-goggles.js';

// A local player's inventory. Race rewards, finds and slope coins all use
// the same currency. Purchases and the resulting equipped pair save together.
const key='alpine.outfitter.v1';
const colors={jacket:[['Clay','#ad4939'],['Alpine blue','#3b7190'],['Spruce','#3d6e54'],['Ochre','#ce933e'],['Graphite','#404348'],
    ['The North Face · Summit shell · +8% downhill speed','summit-shell']],
  pants:[['Slate','#323e48'],['Sand','#a89a81'],['Navy','#24364a']],helmet:[['Chalk','#d6d6d1'],['Charcoal','#333a40'],['Copper','#9a6852']],
  backpack:[['Black','#24282a'],['Charcoal','#363d40'],['Cedar','#694e42'],['Ochre','#bc8340']]};
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
  const ride=restoreRide(data);
  const outfit={...defaultOutfit};
  const finds=Array.isArray(data.finds)?[...new Set(data.finds.filter(s=>typeof s==='string'))]:[];
  for(const [slot,palette] of Object.entries(colors))if((slot==='jacket'?jacketPalette(finds):palette).some(([,hex])=>hex===data.outfit?.[slot]))outfit[slot]=data.outfit[slot];
  if(isGoggleColor(data.outfit?.goggles))outfit.goggles=data.outfit.goggles;
  const ownsSnowShoes=data.ownsSnowShoes===true;
  return {balance:money(data.balance), ...ride, outfit,
    backpackModel:isBackpackModel(data.backpackModel)?data.backpackModel:DEFAULT_BACKPACK_MODEL,
    sticker:Object.hasOwn(stickers,data.sticker)?data.sticker:'none',finds,ownsSnowShoes,
    footwear:ownsSnowShoes&&data.footwear==='traverse'?'traverse':'standard',
    haircut:Object.hasOwn(haircuts,data.haircut)?data.haircut:'helmet',
    hairColor:hairColors.some(([,color])=>color===data.hairColor)?data.hairColor:hairColors[0][1]};
}
const freeOptions = (entries, active) => entries.map(([id, name]) => ({
  id, name, owned: true, price: 0, active: id === active,
}));

export class Outfitter {
  constructor(player,close,renderer) {
    this.player=player;this.state=read();this.dialog=document.getElementById('outfitter');
    this.closeShop=close;
    this.findsLabel='Field notes';
    this.dialog.querySelector('[data-shop-close]').onclick=close;
    this.dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
    this.previewCanvas=this.dialog.querySelector('[data-gear-preview]');
    this.renderer=renderer;
    for (const button of this.dialog.querySelectorAll('[data-turn]')) button.onclick=()=>{
      this.angle+=Number(button.dataset.turn);
      this.drawPreview();
    };
    window.addEventListener('storage',e=>{if(e.key===key){this.state=read();this.equip();if(this.dialog.open)this.renderBarber();}});
    this.equip();
  }
  get customizing() { return !!(this.openRequest || this.customizer?.isOpen); }
  async openCustomizer(trigger = document.activeElement, options = {}) {
    if (this.customizing || this.dialog.open) return;
    const request = this.openRequest = {};
    let loading;
    const dismissLoading = () => {
      if (!loading) return;
      loading.close();
      loading.remove();
      loading = null;
    };
    try {
      if (!this.customizer) {
        // Take modal ownership before fetching the studio. A delayed import
        // must never reopen a shop after the rider has returned to the slope.
        loading = document.createElement('dialog');
        loading.id = 'outfitter-loading';
        loading.setAttribute('aria-labelledby', 'outfitter-loading-label');
        loading.innerHTML = '<span id="outfitter-loading-label" role="status">Opening outfitter…</span><button type="button" autofocus>Back</button>';
        request.cancel = () => {
          if (this.openRequest !== request) return;
          this.openRequest = null;
          dismissLoading();
          options.onClose?.();
          trigger?.focus({ preventScroll: true });
        };
        loading.querySelector('button').onclick = request.cancel;
        loading.oncancel = event => { event.preventDefault(); request.cancel(); };
        loading.onclose = () => { if (loading) request.cancel(); };
        document.body.append(loading);
        loading.showModal();
        const {createCharacterCustomizer} = await import('./character-customizer.js');
        if (this.openRequest !== request) return;
        dismissLoading();
        this.customizer = createCharacterCustomizer(this);
      }
      if (!options.onClose && (!trigger?.getClientRects().length || trigger.closest('[inert], .hidden'))) return;
      this.customizer.open(trigger, options);
    } catch (error) {
      if (this.openRequest !== request) return;
      dismissLoading();
      console.error('Could not open the outfitter', error);
      options.onClose?.();
    } finally {
      if (this.openRequest === request) this.openRequest = null;
    }
  }
  close() {
    this.openRequest?.cancel?.();
    if (this.customizer?.isOpen) this.customizer.close();
    if (this.dialog.open) this.closeShop();
  }
  equip() {
    const s=this.state;
    this.player.setEquipment?.({ discipline:s.discipline, skiModel:SKI_MODELS[s.skis], snowboardModel:SNOWBOARD_MODELS[s.snowboard], stance:s.stance });
    this.broadcastOutfit = { ...s.outfit, jacket: jacketFinishes[s.outfit.jacket] ?? s.outfit.jacket,
      backpackModel:s.backpackModel, skis:s.skis, snowboard:s.snowboard, discipline:s.discipline, stance:s.stance, sticker:s.sticker };
    const patrol=s.outfit.jacket===patrolShell;
    this.player.landingTrickMultiplier=patrol?2:1;
    this.player.shellSpeed=s.outfit.jacket==='summit-shell'?1.08:1;
    this.player.walkFootwear=s.footwear==='traverse'?SNOW_SHOES:null;
    this.player.rig.setAppearance?.(this.appearance);
    if(this.dialog.open)this.drawPreview();
    this.dialog.dispatchEvent(new Event('outfitterchange'));
  }
  get appearance() {
    const s = this.state;
    return { ...this.broadcastOutfit, apparel:s.outfit.jacket, skiModel:s.skis, snowboardModel:s.snowboard,
      footwear:s.footwear, haircut:s.haircut, hairColor:s.hairColor };
  }
  previewAppearance(slot, id) {
    const appearance = this.appearance;
    if (id === undefined) return appearance;
    if (slot === 'jacket') {
      appearance.jacket = jacketFinishes[id] ?? id;
      appearance.apparel = id;
    } else if (slot === 'skis') appearance.skis = appearance.skiModel = id;
    else if (slot === 'snowboard') appearance.snowboard = appearance.snowboardModel = id;
    else if (slot === 'backpack') appearance.backpackModel = id;
    else appearance[slot === 'backpackColor' ? 'backpack' : slot] = id;
    return appearance;
  }
  customizationOptions(slot) {
    const s = this.state;
    if (slot === 'skis' || slot === 'snowboard') return rideOptions(s,slot);
    if (slot === 'backpack') return Object.values(BACKPACK_MODELS).map(model => ({
      ...model, price:0, owned:true, active:model.id === s.backpackModel,
    }));
    if (slot === 'goggles') return Object.entries(GOGGLES).map(([id,g]) => ({
      id, name:g.name, color:g.frame, owned:true, price:0, active:s.outfit.goggles === id,
    }));
    if (slot === 'stance') return freeOptions([
      ['regular','Regular · left foot forward'],['goofy','Goofy · right foot forward'],
    ], s.stance);
    if (slot === 'sticker') return freeOptions(Object.entries(stickers), s.sticker);
    if (slot === 'footwear') return [
      { id:'standard',name:'Standard boots',price:0,owned:true,active:s.footwear==='standard' },
      { id:'traverse',name:SNOW_SHOES.name,price:SNOW_SHOES.price,owned:s.ownsSnowShoes,active:s.footwear==='traverse',
        description:`Walk ${Math.round((SNOW_SHOES.speed-1)*100)}% faster on level snow and keep more pace uphill. Switch to walking mode with B.` },
    ];
    const field = slot === 'backpackColor' ? 'backpack' : slot;
    const palette = field === 'jacket' ? jacketPalette(s.finds) : colors[field];
    if (!Array.isArray(palette)) return [];
    return palette.map(([name,id]) => ({
      id,name,color:jacketFinishes[id] ?? id,owned:true,price:0,active:s.outfit[field] === id,
    }));
  }
  equipCustomization(slot,id) {
    const s = this.state;
    if (slot === 'skis' || slot === 'snowboard') {
      if (!equipRide(s,slot,id)) return false;
    } else {
      const item = this.customizationOptions(slot).find(option => option.id === id);
      if (!item) return false;
      if (slot === 'footwear') {
        if (!item.owned) {
          if (s.balance < item.price) return false;
          s.balance -= item.price;
          s.ownsSnowShoes = true;
        }
        s.footwear = id;
      } else if (slot === 'backpack') s.backpackModel=id;
      else if (slot === 'stance' || slot === 'sticker') s[slot]=id;
      else s.outfit[slot === 'backpackColor' ? 'backpack' : slot]=id;
    }
    this.equip();
    this.save();
    return true;
  }
  equipPatrolShell() {
    if(!this.state.finds.includes('quest.patrol-shell'))return false;
    this.state.outfit.jacket=patrolShell;
    this.equip();
    this.save();
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
  open(shop={}, trigger){
    if (this.customizing || this.dialog.open) return;
    if (shop.kind !== 'barber') {
      return this.openCustomizer(trigger, { title: shop.name || 'Mountain outfitter', onClose: this.closeShop });
    }
    this.dialog.querySelector('#outfitter-name').textContent=shop.name||'Barber';
    this.angle=.13;
    this.renderBarber();
    this.dialog.showModal();
    this.dialog.scrollTop=0;
    this.drawPreview();
  }
  drawPreview(){
    if(!this.renderer)return;
    this.preview ??= createBarberPreview(this.renderer,this.previewCanvas);
    this.preview(this.appearance,this.angle);
  }
  renderBarber(){
    const fields=this.dialog.querySelector('[data-shop-barber]');
    const s=this.state;
    this.dialog.querySelector('[data-balance]').textContent=`${s.balance} mountain coins`;
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
}
