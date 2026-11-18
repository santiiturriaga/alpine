import * as THREE from 'three';
import { createSkier } from './skier.js';

// A shared WSS broker works from a static Pages origin. Rooms outlive the
// first skier. Only transient game poses and session scores leave the client.
const broker = 'wss://broker.emqx.io:8084/mqtt';
const now = () => performance.now();
const bounded = (v, limit) => Number.isFinite(v) && Math.abs(v) <= limit;
const clamp = THREE.MathUtils.clamp;
const ridges = ['Cedar','Raven','Hemlock','Boulder','Marmot','Alder','Glacier','Spruce'];
const callsign = id => ridges[parseInt(id.slice(0,2),16) % ridges.length] + ' ' + id.slice(-4).toUpperCase();
const colors = ['#ad4939','#3b7190','#3d6e54','#ce933e','#404348'];
const decimals = (v, scale) => Math.round(v * scale) / scale;

function validPose(s) {
  return Array.isArray(s) && s.length === 17 &&
    s.slice(0,3).every(v => bounded(v,80000)) && s.slice(3,7).every(v => bounded(v,1.01)) &&
    bounded(s[7],110) && bounded(s[8],1.01) && bounded(s[9],1.01) &&
    Number.isInteger(s[10]) && bounded(s[10],31) && bounded(s[11],7) &&
    s.slice(12,15).every(v => Number.isInteger(v) && v >= 0 && v <= 100000000) &&
    /^#[0-9a-f]{6}$/i.test(s[15]) && Number.isSafeInteger(s[16]) && s[16] >= 0;
}

export function createMultiplayer(scene, resort, getPlayer) {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), n => n.toString(16).padStart(2,'0')).join('');
  const channel = 'alpine-descent/santiiturriaga/v1/' + (location.hostname.endsWith('github.io') ? 'live' : 'preview') + '/' + resort;
  const topic = channel + '/' + id;
  const radioPrefix=channel+'/patrol/';
  let patrol='idle', assist='', radioAt=-Infinity, lastRadio='';
  const peers = new Map(), pool = [];
  const online = document.getElementById('lobby-status'), table = document.getElementById('lobby-scores');
  const toggle = document.getElementById('lobby-toggle');
  let client, loading = false, connected = false, enabled = true, generation = 0;
  let sentAt = -Infinity, lastTable = 0, sequence = 0, recentPose, fastest = 0;
  try { enabled = localStorage.getItem('alpine.multiplayer') !== 'off'; } catch {}
  const local = getPlayer();
  const target = new THREE.Vector3(), orientation = new THREE.Quaternion();
  const remoteForward = new THREE.Vector3();
  let contactCooldown=0;
  const rows = document.createElement('tbody');
  table.append(rows);

  function remove(id) {
    const p = peers.get(id);
    if (p?.actor) {
      p.actor.frame.visible = false;
      pool.push(p.actor);
    }
    peers.delete(id);
  }
  function updateTable() {
    const list = recentPose ? [[id,recentPose], ...Array.from(peers, ([key,p]) => [key,p.pose])] : [];
    list.sort((a,b) => b[1][12] - a[1][12] || b[1][13] - a[1][13] || a[0].localeCompare(b[0]));
    const fragment = document.createDocumentFragment();
    for (const [key,s] of list) {
      const row = document.createElement('tr');
      for (const value of [callsign(key) + (key===id?' · you':''), s[12], s[13] + ' m', s[14] + ' km/h']) {
        const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
      }
      fragment.append(row);
    }
    rows.replaceChildren(fragment);
    online.textContent = connected ? (1 + peers.size) + (peers.size ? ' skiers online' : ' skier online') :
      !enabled ? 'Solo' : client || loading ? 'Connecting to the mountain…' : 'Join when you drop in';
    toggle.textContent = enabled ? 'Ski solo' : 'Join multiplayer';
  }
  function onMessage(path, bytes) {
    if(path.startsWith(radioPrefix)){
      const sender=path.slice(radioPrefix.length),member=peers.get(sender);
      if(!member || bytes.length>72)return;
      const [stage,helper]=bytes.toString().split('/');
      if(!['idle','search','evacuate','delivered'].includes(stage) || helper && !/^[a-f0-9]{16}$/.test(helper))return;
      member.patrol=stage;member.assist=helper||'';
      return;
    }
    const key = path.slice(channel.length + 1);
    if (key === id || !/^[a-f0-9]{16}$/.test(key) || bytes.length > 560) return;
    if (!bytes.length) { remove(key); return; }
    let pose;
    try { pose = JSON.parse(bytes.toString()); } catch { return; }
    if (!validPose(pose)) return;
    const prev = peers.get(key);
    if (prev && prev.pose[16] >= pose[16]) return;
    if (!prev && peers.size >= 256) return;
    if (!prev) sentAt = -Infinity;
    peers.set(key, Object.assign(prev || {}, {pose, heard:now()}));
  }
  async function connect() {
    if (!enabled || client || loading) return;
    loading = true;
    const attempt = ++generation;
    try {
      const { default: mqtt } = await import('../vendor/mqtt.esm.js');
      if (!enabled || attempt !== generation) return;
      client = mqtt.connect(broker, {
        clientId:'alpine-' + id, clean:true, keepalive:30, reconnectPeriod:4500, connectTimeout:12000,
        queueQoSZero:false, will:{topic,payload:'',qos:0,retain:false},
      });
      const c = client;
      c.on('connect', () => {
        c.subscribe([channel + '/+',radioPrefix+'+'], {qos:0}, err => {
          if (c !== client) return;
          connected = !err; sentAt = -Infinity; updateTable();
        });
      });
      c.on('message', onMessage);
      c.on('close', () => {
        if (c !== client) return;
        connected = false; for (const key of peers.keys()) remove(key); updateTable();
      });
      c.on('error', () => { if (client === c) online.textContent = 'Offline · retrying'; });
    } finally { if (attempt === generation) loading = false; }
  }
  function disconnect() {
    generation++; loading = false; connected = false;
    const c = client; client = null;
    if (c?.connected) c.publish(topic,'');
    c?.end(false);
    for (const key of peers.keys()) remove(key);
    updateTable();
  }
  toggle.onclick = () => {
    enabled = !enabled;
    try { localStorage.setItem('alpine.multiplayer', enabled?'on':'off'); } catch {}
    if (!enabled) disconnect();
    else if (recentPose) connect();
    updateTable();
  };
  window.addEventListener('pagehide', disconnect);
  document.getElementById('lobby-invite').onclick = async () => {
    const url = new URL('./',location.href);
    if (resort !== 'whistler-blackcomb') url.searchParams.set('mountain',resort);
    try { await navigator.clipboard.writeText(url.href); online.textContent = 'Mountain link copied'; }
    catch { online.textContent = url.href; }
  };
  function actorFor() {
    if (pool.length) return pool.pop();
    const frame = new THREE.Group(), rig = createSkier({accessories:false});
    frame.name = 'Online skier'; frame.add(rig.group); scene.add(frame);
    return {frame,rig};
  }
  function update(dt, trickScore, outfit, vehicle, interactive=true) {
    const time = now(), p = local;
    if (!enabled) return;
    if (!client && !loading) connect().catch(() => { enabled=false; updateTable(); });
    const radio=patrol+'/'+assist;
    if(connected && (radio!==lastRadio || radio!=='idle/' && time-radioAt>1900)){
      client.publish(radioPrefix+id,radio);lastRadio=radio;radioAt=time;
    }
    const interval = !peers.size ? 1900 : p.speed < .3 ? 420 : 135;
    if (time - sentAt >= interval) {
      sentAt = time;
      const pos = p.riding ? p.pos : p.model.position, q = vehicle?.quaternion ?? p.model.quaternion;
      fastest = Math.max(fastest,Math.round(p.speedKmh || 0));
      const flags = Number(!!p.footMode) | Number(!!p.airborne)<<1 | Number(!!p.crash)<<2 |
        Number(!!p.riding)<<3 | Number(!!p.switchStance)<<4;
      recentPose = [...pos.toArray().map(v=>decimals(v,100)), ...q.toArray().map(v=>decimals(v,1000)),
        decimals(p.speed,10),decimals(p.steer||0,100),decimals(p.tuckAmount||0,100),flags,
        decimals((p.stridePhase||0) % (2*Math.PI),100),Math.round(trickScore||0),
        Math.round(p.stats.vertical||0),fastest,outfit.jacket || colors[0],++sequence];
      if (connected) client.publish(topic, JSON.stringify(recentPose), {qos:0,retain:false});
    }
    let visible = 0;
    for (const [key, remote] of peers) {
      if (time-remote.heard > 14000) { remove(key); continue; }
      if(!interactive)continue;
      const s = remote.pose;
      target.fromArray(s);
      const near = target.distanceToSquared(p.pos) < 340**2 && visible < 14;
      if (!near || (s[10]&8)) {
        if (remote.actor) { remote.actor.frame.visible=false; pool.push(remote.actor); remote.actor=null; }
        continue;
      }
      visible++;
      const fresh = !remote.actor;
      const {frame,rig} = remote.actor ||= actorFor();
      frame.visible = true; frame.name = callsign(key);
      orientation.fromArray(s,3).normalize();
      const snap = fresh || target.distanceToSquared(frame.position) > 28**2;
      const blend = snap ? 1 : 1-Math.exp(-dt*14);
      frame.position.lerp(target,blend); frame.quaternion.slerp(orientation,blend); frame.updateMatrix();
      const dx=p.pos.x-frame.position.x, dz=p.pos.z-frame.position.z;
      const closeHeight=Math.abs(p.pos.y-frame.position.y)<1.12;
      if(!snap && !p.crash && !p.riding && !p.footMode && p.speed>6 && closeHeight &&
          time-remote.heard<650 && time>=contactCooldown && !(s[10]&4) && remote.dx!==undefined){
        const stepX=dx-remote.dx, stepZ=dz-remote.dz, squared=stepX*stepX+stepZ*stepZ;
        // Swept body contact between rendered poses. A respawn or stale peer
        // packet cannot sweep a crash across the rest of the slope.
        if(squared>1e-8 && squared<4.5**2){
          const t=clamp(-(remote.dx*stepX+remote.dz*stepZ)/squared,0,1);
          remoteForward.set(0,0,s[10]&16?-1:1).applyQuaternion(frame.quaternion);
          const relativeSpeed=Math.hypot(p.vel.x-s[7]*remoteForward.x,p.vel.z-s[7]*remoteForward.z);
          if(relativeSpeed>7 && Math.hypot(remote.dx+t*stepX,remote.dz+t*stepZ)<.48){
            contactCooldown=time+2200;p.startCrash('collision with another skier');
          }
        }
      }
      remote.dx=dx;remote.dz=dz;
      if (fresh || remote.color !== s[15]) { remote.color=s[15]; rig.setAppearance({jacket:s[15]}); }
      rig.animate(dt,{speed:s[7],steer:s[8],tuck:s[9],brake:0,grab:0,crash:!!(s[10]&4),crashTime:0,
        airborne:!!(s[10]&2),footMode:!!(s[10]&1),switchStance:!!(s[10]&16),
        walk:Math.min(1,s[7]),stridePhase:s[11]},null);
    }
    if (time-lastTable > 600 && table.closest('dialog')?.open) { lastTable=time; updateTable(); }
  }
  updateTable();
  return {update, peers, get connected(){return connected;}, id, callsign,
    patrolRadio(stage, helping=''){patrol=stage;assist=helping;}};
}
