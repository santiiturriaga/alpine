import * as THREE from 'three';
import { checkSkierName, onProfileChange, skierName, skiUnits } from './skier-profile.js';
import { shellForColor } from './garment-marks.js';
import { createSkier } from './skier.js';
import { DEFAULT_GOGGLES, isGoggleColor } from './ski-goggles.js';
import { readWinchPacket } from './patrol-winch-link.js';

// A shared WSS broker works from a static Pages origin. Rooms outlive the
// first skier. Only transient game poses and session scores leave the client.
const broker = 'wss://broker.emqx.io:8084/mqtt';
const now = () => performance.now();
const bounded = (v, limit) => Number.isFinite(v) && Math.abs(v) <= limit;
const clamp = THREE.MathUtils.clamp;
const ridges = ['Cedar','Raven','Hemlock','Boulder','Marmot','Alder','Glacier','Spruce'];
const defaultCallsign = id => ridges[parseInt(id.slice(0,2),16) % ridges.length] + ' ' + id.slice(-4).toUpperCase();
const colors = ['#ad4939','#3b7190','#3d6e54','#ce933e','#404348'];
const decimals = (v, scale) => Math.round(v * scale) / scale;
// Field 16 stays a strictly increasing integer for older clients. The prefix
// distinguishes millisecond timestamps from their packet counters.
const timePrefix = 1_000_000_000_000;
const movingInterval = 135;
const playbackDelay = 270;
const predictionLimit = 92;
const historyLimit = 12;
const idleTimeout = 5 * 60 * 1000;
const peerPacketLimit = 26;
const newPeersPerSecond = 18;
const roomPacketLimit = 620;
const nameRefreshInterval = 3800;
const labelHeight = 56;
const lerp = THREE.MathUtils.lerp;

function validPose(s) {
  return Array.isArray(s) && s.length === 17 &&
    Number.isFinite(s[0]) && bounded(s[1],80000) && Number.isFinite(s[2]) &&
    Number.isSafeInteger(Math.round(s[0] * 100)) && Number.isSafeInteger(Math.round(s[2] * 100)) &&
    s.slice(3,7).every(v => bounded(v,1.01)) &&
    bounded(s[7],110) && bounded(s[8],1.01) && bounded(s[9],1.01) &&
    Number.isInteger(s[10]) && bounded(s[10],31) && bounded(s[11],7) &&
    s.slice(12,15).every(v => Number.isInteger(v) && v >= 0 && v <= 100000000) &&
    typeof s[15] === 'string' && /^#[0-9a-f]{6}$/i.test(s[15]) && Number.isSafeInteger(s[16]) && s[16] >= 0;
}

function discontinuous(before, after, elapsed) {
  const seconds = Math.max(0, elapsed) / 1000;
  const speed = Math.max(Math.abs(before[7]), Math.abs(after[7]));
  return ((before[10] ^ after[10]) & 8) !== 0 ||
    Math.hypot(after[0] - before[0], after[2] - before[2]) > Math.max(3.1, speed * seconds * 1.42 + 1.6) ||
    Math.abs(after[1] - before[1]) > Math.max(3.6, 80 * seconds);
}

function recordSnapshot(remote, pose, heard) {
  const clocked = pose[16] >= timePrefix;
  const at = clocked ? pose[16] - timePrefix : heard;
  const last = remote.history?.at(-1);
  const elapsed = last ? at - last.at : 0;
  const silence = heard - remote.heard;
  if (!last || clocked !== remote.clocked || elapsed > 2100 || silence > 2600 ||
      discontinuous(last.pose, pose, elapsed)) {
    remote.history = [];
    remote.segment = (remote.segment ?? 0) + 1;
    remote.cursor = -Infinity;
  }
  const offset = heard - at;
  // Favor the least delayed packets, allowing for gradual clock drift. Neither
  // clock depends on local wall time or synchronization with the other skier.
  remote.clockOffset = !remote.history.length ? offset : Math.min(offset,
    remote.clockOffset + Math.max(0, silence) * .003);
  if (clocked && remote.history.length && last.pose[7] >= .3 && pose[7] >= .3 &&
      elapsed >= movingInterval && elapsed <= movingInterval * 1.7) {
    // Measure actual send cadence without folding a dropped update into it.
    const interval = lerp(remote.motionInterval ?? elapsed, elapsed, .12);
    remote.motionInterval = interval;
    remote.playbackDelay = clamp(2 * interval + 60 - predictionLimit, 235, 320);
  }
  remote.clocked = clocked;
  remote.pose = pose;
  remote.heard = heard;
  remote.history.push({ at, pose });
  if (remote.history.length > historyLimit) remote.history.shift();
}

function makeNametag() {
  const canvas = document.createElement('canvas');
  canvas.height = labelHeight;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map:texture, sizeAttenuation:false, depthWrite:false, toneMapped:false });
  const sprite = new THREE.Sprite(material);
  sprite.visible = false;
  sprite.name = 'Skier nametag';
  sprite.center.y = 0;
  let currentName;

  return {
    sprite,
    draw(name, position, camera) {
      if (currentName !== name) {
        currentName = name;
        const font = '600 33px system-ui, sans-serif';
        ctx.font = font;
        canvas.width = Math.ceil(ctx.measureText(name).width) + 38;
        ctx.font = font;
        ctx.beginPath();
        ctx.roundRect(1, 1, canvas.width - 2, labelHeight - 2, 13);
        ctx.fillStyle = 'rgba(11, 28, 40, .92)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(214, 236, 245, .55)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#f4fbff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(name, canvas.width / 2, labelHeight / 2);
        texture.needsUpdate = true;
      }
      const height = 48 / (camera.projectionMatrix.elements[5] * Math.max(1, window.innerHeight));
      sprite.scale.set(height * canvas.width / labelHeight, height, 1);
      sprite.position.copy(position).y += 1.98;
      sprite.visible = true;
    },
  };
}

export function createMultiplayer(scene, resort, getPlayer) {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), n => n.toString(16).padStart(2,'0')).join('');
  const channel = 'alpine-descent/santiiturriaga/v1/' + (location.hostname.endsWith('github.io') ? 'live' : 'preview') + '/' + resort;
  const topic = channel + '/' + id;
  const radioPrefix=channel+'/patrol/';
  const winchPrefix=channel+'/winch/';
  const namePrefix = channel + '/name/';
  const gearPrefix = channel + '/gear/';
  let patrol='idle', assist='', radioAt=-Infinity, lastRadio='';
  let winch='', winchAt=-Infinity, lastWinch='';
  const peers = new Map(), pool = [];
  const online = document.getElementById('lobby-status'), table = document.getElementById('lobby-scores');
  const toggle = document.getElementById('lobby-toggle');
  let client, loading = false, connected = false, enabled = true, generation = 0;
  let sentAt = -Infinity, lastTable = 0, sequence = 0, recentPose, fastest = 0;
  let nameAt = -Infinity, sentName;
  let gearAt = -Infinity, sentGoggles;
  let idle = false, lastInput;
  let packetSecond = -1, packets = 0, joins = 0;
  try { enabled = localStorage.getItem('alpine.multiplayer') !== 'off'; } catch {}
  const local = getPlayer();
  const target = new THREE.Vector3(), nextTarget = new THREE.Vector3();
  const orientation = new THREE.Quaternion(), nextOrientation = new THREE.Quaternion();
  const remoteForward = new THREE.Vector3();
  let contactCooldown=0;
  const rows = document.createElement('tbody');
  table.append(rows);

  const callsign = (key) => (key === id ? skierName() : peers.get(key)?.name) || defaultCallsign(key);

  function releaseActor(actor) {
    actor.frame.visible = false;
    actor.nametag.sprite.visible = false;
    pool.push(actor);
  }
  function remove(id) {
    const p = peers.get(id);
    if (p?.actor) releaseActor(p.actor);
    peers.delete(id);
  }
  function updateTable() {
    const list = recentPose ? [[id,recentPose], ...Array.from(peers, ([key,p]) => [key,p.pose])] : [];
    list.sort((a,b) => b[1][12] - a[1][12] || b[1][13] - a[1][13] || a[0].localeCompare(b[0]));
    const fragment = document.createDocumentFragment();
    const units = skiUnits();
    for (const [key,s] of list) {
      const row = document.createElement('tr');
      for (const value of [callsign(key) + (key===id?' · you':''), s[12],
        `${Math.round(s[13] * units.lengthFactor)} ${units.small}`, `${Math.round(s[14] * units.speedFactor)} ${units.speed}`]) {
        const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
      }
      fragment.append(row);
    }
    rows.replaceChildren(fragment);
    online.textContent = connected ? (1 + peers.size) + (peers.size ? ' skiers online' : ' skier online') :
      !enabled ? 'Solo' : idle ? 'Idle · move to rejoin' : client || loading ? 'Connecting to the mountain…' : 'Join when you drop in';
    toggle.textContent = enabled ? 'Ski solo' : 'Join multiplayer';
  }
  function onMessage(path, bytes) {
    if (!path.startsWith(channel + '/') || path.length > channel.length + 28 || bytes.length > 560) return;
    const time = now(), second = Math.floor(time / 1000);
    if (second !== packetSecond) { packetSecond = second; packets = joins = 0; }
    if (++packets > roomPacketLimit) return;
    const sender = path.slice(path.lastIndexOf('/') + 1);
    if (sender === id || !/^[a-f0-9]{16}$/.test(sender)) return;
    const known = peers.get(sender);
    if (known) {
      if (known.packetSecond !== second) { known.packetSecond = second; known.packets = 0; }
      if (++known.packets > peerPacketLimit) return;
    }
    if (path.startsWith(namePrefix)) {
      const member = peers.get(path.slice(namePrefix.length));
      if (!member || bytes.length > 100) return;
      member.name = checkSkierName(bytes.toString()) ?? '';
      return;
    }
    if (path === gearPrefix + sender) {
      if (known && bytes.length <= 11) {
        const color = bytes.toString();
        if (isGoggleColor(color)) known.goggles = color;
      }
      return;
    }
    if(path.startsWith(radioPrefix)){
      const sender=path.slice(radioPrefix.length),member=peers.get(sender);
      if(!member || bytes.length>72)return;
      const [stage,helper]=bytes.toString().split('/');
      if(!['idle','search','tree','ledge','evacuate','delivered'].includes(stage) || helper && !/^[a-f0-9]{16}$/.test(helper))return;
      member.patrol=stage;member.assist=helper||'';
      return;
    }
    if (path === winchPrefix + sender) {
      if (!known || bytes.length > 200) return;
      if (!bytes.length) { known.winch = null; return; }
      const packet = readWinchPacket(bytes);
      if (packet) { known.winch = packet; known.winchAt = time; }
      return;
    }
    const key = path.slice(channel.length + 1);
    if (key === id || !/^[a-f0-9]{16}$/.test(key) || bytes.length > 560) return;
    if (!bytes.length) { remove(key); return; }
    if (!known && (peers.size >= 74 || ++joins > newPeersPerSecond)) return;
    let pose;
    try { pose = JSON.parse(bytes.toString()); } catch { return; }
    if (!validPose(pose)) return;
    const prev = peers.get(key);
    if (prev && prev.pose[16] >= pose[16]) return;
    if (!prev) sentAt = nameAt = gearAt = -Infinity;
    const remote = prev ?? {};
    recordSnapshot(remote, pose, now());
    if (!prev) peers.set(key, remote);
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
        c.subscribe([channel + '/+',radioPrefix+'+',namePrefix+'+',winchPrefix+'+',gearPrefix+'+'], {qos:0}, err => {
          if (c !== client) return;
          connected = !err; sentAt = nameAt = winchAt = gearAt = -Infinity; lastRadio = lastWinch = ''; updateTable();
        });
      });
      c.on('message', (path, bytes) => { if (client === c) onMessage(path, bytes); });
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
  function returnFromIdle(event) {
    if (!event.isTrusted) return;
    lastInput = now();
    if (!idle) return;
    idle = false;
    updateTable();
  }
  for (const type of ['pointerdown','keydown','wheel']) window.addEventListener(type, returnFromIdle, { passive: true });
  document.addEventListener('mousemove', event => {
    if (document.pointerLockElement && (event.movementX || event.movementY)) returnFromIdle(event);
  }, { passive: true });
  document.getElementById('lobby-invite').onclick = async () => {
    const url = new URL('./',location.href);
    if (resort !== 'whistler-blackcomb') url.searchParams.set('mountain',resort);
    try { await navigator.clipboard.writeText(url.href); online.textContent = 'Mountain link copied'; }
    catch { online.textContent = url.href; }
  };
  function actorFor() {
    if (pool.length) return pool.pop();
    const frame = new THREE.Group(), rig = createSkier({accessories:false});
    const nametag = makeNametag();
    frame.name = 'Online skier'; frame.add(rig.group); scene.add(frame, nametag.sprite);
    return {frame,rig,nametag};
  }
  function update(dt, trickScore, outfit, vehicle, interactive=true) {
    const time = now(), p = local;
    if (!enabled) return;
    lastInput ??= time;
    if (time - lastInput >= idleTimeout) {
      if (!idle) {
        idle = true;
        disconnect();
      }
      return;
    }
    if (!client && !loading) connect().catch(() => { enabled=false; updateTable(); });
    const radio=patrol+'/'+assist;
    if(connected && (radio!==lastRadio || radio!=='idle/' && time-radioAt>1900)){
      client.publish(radioPrefix+id,radio);lastRadio=radio;radioAt=time;
    }
    if (connected && time - winchAt >= 135 && (winch !== lastWinch || (winch && time - winchAt > 900))) {
      client.publish(winchPrefix + id, winch, {qos:0,retain:false});
      lastWinch = winch; winchAt = time;
    }
    const speed = interactive ? p.speed : 0;
    const moving = speed >= .3;
    const flags = Number(!!p.footMode) | Number(!!p.airborne)<<1 | Number(!!p.crash)<<2 |
      Number(!!p.riding)<<3 | Number(!!p.switchStance)<<4;
    const score = Math.round(trickScore || 0), jacket = outfit.jacket || colors[0];
    const changed = recentPose && ((recentPose[7] >= .3) !== moving || recentPose[10] !== flags ||
      recentPose[12] !== score || recentPose[15] !== jacket);
    const interval = changed ? movingInterval : !peers.size ? 1900 : moving ? movingInterval : 420;
    if (time - sentAt >= interval) {
      sentAt = time;
      const pos = p.riding ? p.pos : p.model.position, q = vehicle?.quaternion ?? p.model.quaternion;
      fastest = Math.max(fastest,Math.round(p.speedKmh || 0));
      sequence = Math.max(sequence + 1, timePrefix + Math.round(time));
      recentPose = [...pos.toArray().map(v=>decimals(v,100)), ...q.toArray().map(v=>decimals(v,1000)),
        decimals(speed,10),decimals(interactive ? p.steer || 0 : 0,100),decimals(p.tuckAmount||0,100),flags,
        decimals((p.stridePhase||0) % (2*Math.PI),100),score,
        Math.round(p.stats.vertical||0),fastest,jacket,sequence];
      if (connected) client.publish(topic, JSON.stringify(recentPose), {qos:0,retain:false});
    }
    const name = skierName();
    if (connected && (name !== sentName || time - nameAt >= nameRefreshInterval)) {
      // Keep display names independent of the pose schema and its ordering.
      client.publish(namePrefix + id, name, {qos:0,retain:false});
      nameAt = time; sentName = name;
    }
    const goggles = isGoggleColor(outfit.goggles) ? outfit.goggles : DEFAULT_GOGGLES;
    if (connected && (goggles !== sentGoggles || time - gearAt >= nameRefreshInterval)) {
      // Gear travels separately so older clients still receive a standard pose.
      client.publish(gearPrefix + id, goggles, {qos:0,retain:false});
      gearAt = time; sentGoggles = goggles;
    }
    let visible = 0;
    for (const [key, remote] of peers) {
      if (time-remote.heard > 14000) { remove(key); continue; }
      if (!interactive) { remote.dx = undefined; continue; }
      const { history } = remote;
      const latest = history.at(-1);
      const bufferedAt = time - remote.clockOffset - (remote.playbackDelay ?? playbackDelay);
      const at = Math.min(latest.at + predictionLimit, Math.max(remote.cursor, bufferedAt));
      remote.cursor = at;
      while (history.length > 2 && history[1].at <= at) history.shift();
      const a = history[0], b = history[1] ?? a;
      const gap = b.at - a.at;
      const mix = gap > 0 ? clamp((at - a.at) / gap, 0, 1) : 1;
      const s = (mix === 1 ? b : a).pose, next = b.pose;
      target.fromArray(a.pose).lerp(nextTarget.fromArray(next), mix);
      const ahead = at - b.at;
      const predicting = ahead > 0 && gap >= 30 && gap <= 450 && a.pose[7] >= .3 && next[7] >= .3;
      if (predicting) {
        // Bridge one lost packet using confirmed motion. An extended gap
        // holds the last predicted position and cannot cause a collision.
        nextTarget.fromArray(a.pose).sub(target);
        const maxTravel = ahead * Math.max(a.pose[7], next[7]) * .00135;
        target.addScaledVector(nextTarget, -Math.min(ahead / gap, maxTravel / Math.max(.001, nextTarget.length())));
      }
      const near = target.distanceToSquared(p.pos) < 340**2 && visible < 14;
      if (!near || (s[10]&8)) {
        if (remote.actor) { releaseActor(remote.actor); remote.actor=null; }
        remote.dx = undefined;
        continue;
      }
      visible++;
      const fresh = !remote.actor;
      const {frame,rig,nametag} = remote.actor ||= actorFor();
      frame.visible = true; frame.name = callsign(key);
      orientation.fromArray(s,3).normalize().slerp(nextOrientation.fromArray(next,3).normalize(),mix);
      const snap = fresh || remote.actorSegment !== remote.segment || target.distanceToSquared(frame.position) > 28**2;
      remote.actorSegment = remote.segment;
      frame.position.copy(target); frame.quaternion.copy(orientation); frame.updateMatrix();
      if (target.distanceToSquared(p.pos) < 85**2 && p.camera) nametag.draw(frame.name, target, p.camera);
      else nametag.sprite.visible = false;
      const remoteSpeed = lerp(s[7],next[7],mix);
      const dx=p.pos.x-frame.position.x, dz=p.pos.z-frame.position.z;
      const closeHeight=Math.abs(p.pos.y-frame.position.y)<1.12;
      if(!snap && !predicting && !p.crash && !p.riding && !p.footMode && p.speed>6 && closeHeight &&
          time-remote.heard<650 && time>=contactCooldown && !(s[10]&4) && remote.dx!==undefined){
        const stepX=dx-remote.dx, stepZ=dz-remote.dz, squared=stepX*stepX+stepZ*stepZ;
        // Swept body contact between rendered poses. A respawn or stale peer
        // packet cannot sweep a crash across the rest of the slope.
        if(squared>1e-8 && squared<4.5**2){
          const t=clamp(-(remote.dx*stepX+remote.dz*stepZ)/squared,0,1);
          remoteForward.set(0,0,s[10]&16?-1:1).applyQuaternion(frame.quaternion);
          const relativeSpeed=Math.hypot(p.vel.x-remoteSpeed*remoteForward.x,p.vel.z-remoteSpeed*remoteForward.z);
          if(relativeSpeed>7 && Math.hypot(remote.dx+t*stepX,remote.dz+t*stepZ)<.48){
            contactCooldown=time+2200;p.startCrash('collision with another skier');
          }
        }
      }
      remote.dx=predicting?undefined:dx;remote.dz=dz;
      const goggleColor = remote.goggles ?? DEFAULT_GOGGLES;
      if (fresh || remote.color !== s[15] || remote.renderedGoggles !== goggleColor) {
        remote.color = s[15];
        remote.renderedGoggles = goggleColor;
        rig.setAppearance({ jacket: remote.color, apparel: shellForColor(remote.color), goggles: goggleColor });
      }
      const phase = Math.atan2(Math.sin(next[11] - s[11]), Math.cos(next[11] - s[11]));
      rig.animate(dt,{speed:remoteSpeed,steer:lerp(s[8],next[8],mix),tuck:lerp(s[9],next[9],mix),brake:0,grab:0,crash:!!(s[10]&4),crashTime:0,
        airborne:!!(s[10]&2),footMode:!!(s[10]&1),switchStance:!!(s[10]&16),
        walk:Math.min(1,remoteSpeed),stridePhase:s[11]+phase*mix},null);
    }
    if (time-lastTable > 600 && table.closest('dialog')?.open) { lastTable=time; updateTable(); }
  }
  onProfileChange((event) => { if (event.type === 'preferences') updateTable(); });
  updateTable();
  return {update, peers, get connected(){return connected;}, id, callsign,
    patrolRadio(stage, helping=''){patrol=stage;assist=helping;},
    winchRadio(packet){winch=packet ? JSON.stringify(packet) : '';}};
}
