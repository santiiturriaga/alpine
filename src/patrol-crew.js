import * as THREE from 'three';
import { createServiceAsset } from './service-assets.js';
import { winchReach, winchTop } from './patrol-flight.js';
import { freshWinchPeer, invitedPilot, WINCH_LEASE } from './patrol-winch-link.js';
import { clamp, damp, wrapAngle } from './util.js';

const stages = ['tree', 'ledge'];
const position = new THREE.Vector3(), top = new THREE.Vector3(), target = new THREE.Vector3();

export function createPatrolCrew({ scene, multiplayer, flight, home, player, camera, ui }) {
  const invite = invitedPilot();
  const panel = document.getElementById('patrol-winch');
  const status = document.getElementById('patrol-winch-status');
  const help = document.getElementById('patrol-winch-controls');
  let pilot = '', crew = '', joined = false, pendingAt = 0, handled = 0, request = 0;
  let asset, stage, phase = 0, depth = 0, attachedMix = 0, yaw = 0, lookYaw = 0, lookPitch = 0;

  function onPad(x,y,z) {
    return Math.hypot(x-flight.base.x,z-flight.base.z)<9 && Math.abs(y-flight.base.y)<2.1;
  }

  function openSeat([id, peer]) {
    const packet = freshWinchPeer(peer);
    return (!invite || invite === id) && packet?.[0] === 0 && !packet[2] &&
      packet[1] !== 'done' && onPad(packet[3],packet[4],packet[5]);
  }

  function findSeat() {
    return multiplayer.connected ? Array.from(multiplayer.peers).find(openSeat)?.[0] : undefined;
  }

  function join(id) {
    pilot = id;
    pendingAt = performance.now();
    request = 0;
  }

  function leave(message) {
    if (!pilot) return;
    multiplayer.winchRadio(null);
    panel.hidden = true;
    if (joined) {
      asset.group.visible = false;
      flight.reset();
      player.footMode = true;
      camera.near = .27;
      player.teleport({...flight.base.arrival, holdAtUnload:true});
      ui.setCameraLabel(['CHASE','WIDE','HELMET'][player.cameraMode]);
    }
    joined = false;
    pilot = '';
    stage = null;
    lookYaw = lookPitch = 0;
    if (message) ui.toast('Patrol airlift',message,'blue','lift');
  }

  function approachPatient() {
    if (phase !== 1 || !stages.includes(stage)) return false;
    return winchReach(stage === 'tree' ? flight.tree : flight.ledge, winchTop(asset.group.position,yaw,top),depth);
  }

  function nearby(canJoin) {
    if (joined) {
      if (phase === 1 && approachPatient())
        return { kind:'clip-skier',title:'Clip the skier to your harness',detail:'Then hold S to guide both of you back up' };
      if (phase === 0 && (stage === 'done' || onPad(...asset.group.position.toArray())))
        return { kind:'leave-winch',title:'Step out of the helicopter',detail:'Alpine Patrol helipad' };
      return { kind:'wait',title:phase === 2 ? 'Raise the skier' : phase === 1 ? 'Work the winch' : 'Winch operator',
        detail:phase === 2 ? 'Hold S to reel into the cabin' : phase === 1 ? 'Hold W to lower · S to raise' : 'Wait for the pilot to reach the pickup' };
    }
    if (pilot) return { kind:'wait',title:'Boarding request sent',detail:'Waiting for the pilot’s winch seat' };
    if (!canJoin || player.riding || player.crash || player.speed>3 || !onPad(player.pos.x,player.pos.y,player.pos.z)) return null;
    const id = findSeat();
    if (id) return { kind:'join-winch',id,title:'Board as winch operator',detail:`Fly with ${multiplayer.callsign(id)}` };
    if (invite && !crew) return { kind:'wait',title:'Waiting for the patrol pilot',detail:'Your pilot opens the winch seat at this pad after the ski escort' };
    return null;
  }

  function updateGuest(dt, keys) {
    const packet = freshWinchPeer(multiplayer.peers.get(pilot));
    if (!multiplayer.connected || (joined && (packet?.[0] !== 0 || packet[2] !== multiplayer.id)) ||
        (!joined && performance.now()-pendingAt>WINCH_LEASE)) {
      leave(joined?'Your pilot disconnected. You’re back at the helipad.':'The winch seat is unavailable. Try again at the pad.');
      return null;
    }

    const direction = phase ? Number(!!(keys.KeyW||keys.ArrowUp)) - Number(!!(keys.KeyS||keys.ArrowDown)) : 0;
    multiplayer.winchRadio([1,pilot,direction,request]);
    if (packet?.[0] !== 0 || packet[2] !== multiplayer.id) return null;
    const [,nextStage,,x,y,z,nextYaw,nextDepth,nextPhase] = packet;
    const first = !joined;
    const newLeg = first || stage !== nextStage;
    if (first) {
      asset ??= createServiceAsset('helicopter');
      if (!asset.group.parent) scene.add(asset.group);
      joined = true;
      player.setRiding(true);
      player.vehicleLabel = 'Patrol winch';
      player.model.visible = false;
      player.speed = 0;
      ui.setCameraLabel('WINCH');
      ui.toast('Winch operator aboard',`Pilot · ${multiplayer.callsign(pilot)}`,'gold','lift');
    }
    if (first || Boolean(phase) !== Boolean(nextPhase)) lookYaw = lookPitch = 0;
    if (newLeg) attachedMix = 0;
    const completed = stage !== 'done' && nextStage === 'done';
    stage = nextStage;
    phase = nextPhase;
    const model = asset.group;
    model.visible = true;
    position.set(x,y,z);
    const snap = newLeg || model.position.distanceToSquared(position)>20**2;
    model.position.lerp(position,snap ? 1 : 1-Math.exp(-dt*9));
    yaw = snap ? nextYaw : wrapAngle(yaw+wrapAngle(nextYaw-yaw)*(1-Math.exp(-dt*9)));
    model.rotation.y = yaw;
    model.updateMatrixWorld(true);
    asset.setOccupied(stage!=='board');
    asset.animate(dt);
    depth = snap || !phase ? nextDepth : damp(depth,nextDepth,11,dt);
    attachedMix = phase === 2 ? Math.min(1,attachedMix+dt*3) : 0;
    const eye = flight.passenger(dt,stage,model,yaw,depth,phase,attachedMix);
    const onRope = !!phase && depth >= .52;
    const site = stage === 'tree' ? flight.tree : flight.ledge;
    const forward = onRope ? Math.atan2(site.guest.x-eye.x,site.guest.z-eye.z) : yaw+1.15;
    const distance = Math.hypot(site.guest.x-eye.x,site.guest.z-eye.z);
    const aim = onRope && phase===1 ? clamp(Math.atan2(site.guest.y+1.1-eye.y,Math.max(.6,distance)),-1.22,.55) : -.045;
    const angle = forward+lookYaw, pitch = clamp(aim+lookPitch,-1.43,1.31);
    const fov = onRope ? 79 : 76;
    camera.position.copy(eye);
    camera.lookAt(target.set(eye.x+Math.sin(angle)*Math.cos(pitch),eye.y+Math.sin(pitch),eye.z+Math.cos(angle)*Math.cos(pitch)));
    if (camera.near!==.055 || camera.fov!==fov) {
      camera.near = .055;
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    player.pos.copy(eye);
    player.heading = angle;
    player.airborne = !onPad(x,y,z);
    player.grounded = !player.airborne;
    panel.hidden = false;
    const note = phase ? `${depth.toFixed(1)} m of cable` : stage==='done' ? 'Both skiers aboard' : 'Seated in the cabin';
    const controls = phase===2 ? 'Hold S to raise the skier' : phase===1 ?
      approachPatient() ? 'Press E to clip the skier in' : 'Hold W to lower · S to raise' :
      stage==='done' ? 'Press E to return to the helipad' : 'The pilot will set the hover';
    if (status.textContent!==note) status.textContent=note;
    if (help.textContent!==controls) help.textContent=controls;
    return completed ? 'done' : null;
  }

  function pilotOrders(stage, inAircraft) {
    if (!stage || !multiplayer.connected) { crew=''; return {}; }
    const person = freshWinchPeer(multiplayer.peers.get(crew));
    if (crew && (person?.[0]!==1 || person[1]!==multiplayer.id)) crew='';
    if (!crew && stage!=='done' && !flight.hoisting && onPad(...home.model.position.toArray())) {
      for (const [id, peer] of multiplayer.peers) {
        const packet = freshWinchPeer(peer);
        if (packet?.[0]!==1 || packet[1]!==multiplayer.id || !onPad(...peer.pose.slice(0,3))) continue;
        crew = id;
        handled = packet[3];
        ui.toast('Winch operator aboard',`${multiplayer.callsign(id)} will control the rope at each pickup.`,'gold','lift');
        break;
      }
    }
    const peer = multiplayer.peers.get(crew);
    const packet = freshWinchPeer(peer);
    const attach = !!packet && packet[3]>handled;
    if (attach) handled=packet[3];
    const liveInput = inAircraft && packet && performance.now()-peer.winchAt<1750;
    return { crew, direction:liveInput ? packet[2] : 0, attach };
  }

  function announce(stage) {
    if (!stage) { multiplayer.winchRadio(null); return; }
    const {x,y,z} = home.model.position;
    const {depth=0,phase=0} = flight.winch ?? {};
    const round = value => Math.round(value*100)/100;
    multiplayer.winchRadio([0,stage,crew,round(x),round(y),round(z),Math.round(wrapAngle(home.yaw)*1000)/1000,round(depth),phase,handled]);
  }

  return {join,leave,nearby,updateGuest,pilotOrders,announce,
    attach(){ if (approachPatient()) request++; },
    look(dx,dy){ lookYaw=wrapAngle(lookYaw-dx*.003);lookPitch=clamp(lookPitch-dy*.003,-1.11,1.01); },
    hideParkedAircraft(){home.model.visible=false;},
    get pilot(){return pilot;},get crew(){return crew;},get joined(){return joined;},get invite(){return invite;}
  };
}
