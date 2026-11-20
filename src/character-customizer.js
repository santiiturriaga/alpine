import * as THREE from 'three';
import { createSkier } from './skier.js';
import { skiDeck, snowboardDeck } from './skier-equipment.js';
import { canvasTexture, makeCanvas } from './util.js';

const slots = {
  goggles: { label: 'Goggles', side: 'left', point: [0, .14, .16], angle: -.25 },
  helmet: { label: 'Helmet', side: 'right', point: [.05, .237, .085] },
  jacket: { label: 'Jacket', side: 'left', point: [-.154, .351, -.102], angle: -.27, behind: true },
  backpack: { label: 'Backpack', side: 'right', point: [0, 0, 0], angle: 2.7, behind: true },
  pants: { label: 'Pants', side: 'left', behind: true },
  skis: { label: 'Skis', side: 'left', point: [0, .016, .64], angle: -.4 },
  snowboard: { label: 'Snowboard', side: 'right', point: [0, .02, .51], angle: -.55 },
};
const equipmentSlots = ['skis', 'snowboard'];
const orbitAngle = -.39;
const displayPose = { speed: 0, steer: 0, tuck: 0, brake: 0, grab: 0, grounded: true, display: true };
const ns = 'http://www.w3.org/2000/svg';
const turnPeriod = 2 * Math.PI;
const leaderInk = new THREE.Color('#b5bdb0');
const endpointInk = new THREE.Color('#eff0e7');
const selectedInk = new THREE.Color('#e2cb83');

function createStudio(canvas, mountainRenderer) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#252824');
  scene.add(new THREE.HemisphereLight('#fff3db', '#8d9283', 2.3));
  for (const [color, intensity, x, y, z] of [
    ['#fff3db', 2.35, -3, 4, 4], ['#edf3e6', 1.9, 2, 3, -4], ['#e4e9df', .82, 3, 1, 3],
  ]) {
    const light = new THREE.DirectionalLight(color, intensity);
    light.position.set(x, y, z);
    scene.add(light);
  }
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(.94, .96, .065, 72),
    new THREE.MeshStandardMaterial({ color: '#2b2d29', roughness: .9 }));
  platform.position.set(.17, -.035, 0);
  scene.add(platform);
  const { canvas: shadowCanvas, ctx } = makeCanvas(128, 128);
  const shadowInk = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  shadowInk.addColorStop(0, '#111611aa');
  shadowInk.addColorStop(1, '#11161100');
  ctx.fillStyle = shadowInk;
  ctx.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.08, 1.58),
    new THREE.MeshBasicMaterial({ map: canvasTexture(shadowCanvas), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = .001;
  scene.add(shadow);

  const rig = createSkier();
  scene.add(rig.group);
  const spare = new THREE.Group();
  spare.rotation.y = -.17;
  const mount = new THREE.Group();
  mount.rotation.set(Math.PI / 2, 0, Math.PI, 'ZXY');
  spare.add(mount);
  const spareDecks = [new THREE.Mesh(), new THREE.Mesh()];
  for (const mesh of spareDecks) mount.add(mesh);
  scene.add(spare);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .04, 15);
  camera.position.set(.19, 2.21, 4.76);
  camera.lookAt(.19, .84, 0);
  const rearLeaders = new Map();
  const endpointGeometry = new THREE.CircleGeometry(1, 18);
  for (const [slot, { behind }] of Object.entries(slots)) {
    if (!behind) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3).setUsage(THREE.DynamicDrawUsage));
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({
      color: leaderInk, transparent: true, opacity: .66, depthWrite: false, toneMapped: false,
    }));
    line.frustumCulled = false;
    const dot = new THREE.Mesh(endpointGeometry, new THREE.MeshBasicMaterial({
      color: endpointInk, depthWrite: false, toneMapped: false,
    }));
    line.visible = dot.visible = false;
    scene.add(line, dot);
    rearLeaders.set(slot, { line, dot });
  }
  const ray = new THREE.Raycaster();
  const vector = new THREE.Vector3();
  const pantsPoint = new THREE.Vector3();
  const candidates = [rig.group, spare];
  let spareSlot, spareKey, compact = false, screenWidth = 1, screenHeight = 1;

  function placeSpare() {
    const skis = spareSlot === 'skis';
    const offset = compact ? .61 : .69;
    spare.position.x = skis ? -offset : offset;
  }

  function setAppearance(appearance) {
    rig.setAppearance(appearance);
    rig.animate(.3, displayPose, null);
    const trousers = rig.gearAnchors.pants.geometry;
    trousers.computeBoundingBox();
    trousers.boundingBox.getCenter(pantsPoint);
    const centerX = pantsPoint.x, centerY = pantsPoint.y;
    const vertices = trousers.attributes.position;
    let rearScore = Infinity;
    for (let i = 0; i < vertices.count; i++) {
      const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i);
      const score = z + Math.abs(y - centerY) + Math.abs(x - centerX) * .7;
      if (score >= rearScore) continue;
      rearScore = score;
      pantsPoint.set(x, y, z - .008);
    }
    spareSlot = appearance.discipline === 'snowboard' ? 'skis' : 'snowboard';
    const model = appearance[spareSlot];
    const key = spareSlot + model;
    if (key === spareKey) return;
    spareKey = key;
    const isSki = spareSlot === 'skis';
    const data = isSki ? skiDeck(model) : snowboardDeck(model);
    const center = isSki ? -.16 : .19;
    spare.position.set(0, -data.profile[0][0], -.11);
    placeSpare();
    platform.position.x = center;
    camera.position.x = center;
    camera.lookAt(center, .84, 0);
    for (const [index, mesh] of spareDecks.entries()) {
      mesh.geometry = data.geometry;
      mesh.material = data.materials;
      mesh.visible = isSki || index === 0;
      mesh.position.x = isSki ? (index ? -.064 : .064) : 0;
      mesh.rotation.y = isSki ? (index ? -.045 : .045) : 0;
    }
  }

  function resize(width, height) {
    screenWidth = width;
    screenHeight = height;
    const aspect = width / Math.max(1, height);
    compact = width < 460;
    placeSpare();
    const extent = Math.max(1.14, .93 / aspect);
    camera.top = extent;
    camera.bottom = -extent;
    camera.left = -extent * aspect;
    camera.right = extent * aspect;
    camera.updateProjectionMatrix();
    // Preserve embroidery detail on larger displays without exceeding the
    // resolution the player uses on the mountain. Small game viewports still
    // get enough studio pixels to inspect the equipment.
    const game = mountainRenderer?.domElement;
    const pixels = Math.min(2560 * 1440, Math.max(1024 ** 2, game ? game.width * game.height : 0));
    const dpr = Math.min(devicePixelRatio || 1, 2, Math.sqrt(pixels / (width * height)));
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      renderer.setDrawingBufferSize(width, height, dpr);
    }
  }

  function rotate(angle) {
    rig.group.rotation.y = angle;
    camera.updateMatrixWorld();
  }

  function render() {
    renderer.render(scene, camera);
  }

  function anchor(slot, x, y) {
    const node = rig.gearAnchors[slot];
    if (slot === spareSlot) spare.localToWorld(vector.set(0, .23, .025));
    else if (slot === 'pants') node.localToWorld(vector.copy(pantsPoint));
    else if (node) node.localToWorld(vector.copy(node.userData.labelPoint ?? vector.fromArray(slots[slot].point)));
    else return null;
    vector.project(camera);
    return [(vector.x + 1) * x / 2, (1 - vector.y) * y / 2, vector.z];
  }

  function positionRearLeader(slot, startX, startY, elbowX, point, active) {
    const { line, dot } = rearLeaders.get(slot);
    const positions = line.geometry.attributes.position;
    // Place the elbow line in screen space at the attachment's depth so the
    // rotating skier naturally covers any portions behind their silhouette.
    const [x, y, depth] = point;
    for (const [i, px, py] of [[0, startX, startY], [1, elbowX, startY], [2, x, y]]) {
      vector.set(px * 2 / screenWidth - 1, 1 - py * 2 / screenHeight, depth - .0005).unproject(camera);
      positions.setXYZ(i, vector.x, vector.y, vector.z);
    }
    positions.needsUpdate = true;
    dot.position.copy(vector);
    dot.quaternion.copy(camera.quaternion);
    dot.scale.setScalar(2.6 * (camera.top - camera.bottom) / screenHeight);
    dot.material.color.copy(active ? selectedInk : endpointInk);
    line.material.color.copy(active ? selectedInk : leaderInk);
    line.material.opacity = active ? .97 : .66;
    dot.visible = line.visible = true;
  }

  function pick(x, y) {
    ray.setFromCamera({ x, y }, camera);
    const anchors = rig.gearAnchors;
    for (const { object } of ray.intersectObjects(candidates)) {
      let slot;
      let visible = true;
      for (let node = object; node; node = node.parent) {
        visible &&= node.visible;
        if (slot) continue;
        if (node === spare) slot = spareSlot;
        else slot = Object.keys(slots).find(key => node === anchors[key]);
        if (!slot && node.name.includes('trouser')) slot = 'pants';
        if (!slot && node.name === 'Ski equipment') slot = 'skis';
      }
      if (visible && slot) return slot;
    }
  }

  return { setAppearance, resize, rotate, render, anchor, positionRearLeader, pick };
}

export function createCharacterCustomizer(outfitter) {
  const dialog = document.createElement('dialog');
  dialog.id = 'character-customizer';
  dialog.setAttribute('aria-labelledby', 'customizer-title');
  dialog.innerHTML = `
    <header class="customizer-header">
      <h2 id="customizer-title">Customize</h2>
      <div><span class="customizer-balance"></span><button type="button" class="customizer-back" autofocus>Back <span aria-hidden="true">×</span></button></div>
    </header>
    <div class="customizer-main">
      <div class="customizer-stage">
        <canvas tabindex="0" aria-label="3D skier preview. Drag or use the arrow keys to turn."></canvas>
        <svg class="customizer-lines" aria-hidden="true"></svg>
        <div class="customizer-hotspots" role="group" aria-label="Equipment"></div>
        <div class="customizer-turn-controls">
          <button type="button" data-turn="-.55" aria-label="Turn left">‹</button>
          <button type="button" data-turn=".55" aria-label="Turn right">›</button>
          <button type="button" class="customizer-motion" aria-pressed="false">Auto-rotate</button>
        </div>
      </div>
      <section class="customizer-detail" aria-labelledby="customizer-selection">
        <h3 id="customizer-selection"></h3>
        <div class="customizer-options"></div>
        <p class="customizer-preview-error" hidden>The 3D preview is unavailable. Equipment changes still apply on the mountain.</p>
        <output class="customizer-notice" aria-live="polite"></output>
      </section>
    </div>`;
  document.body.append(dialog);
  const stage = dialog.querySelector('.customizer-stage');
  const canvas = stage.querySelector('canvas');
  const lines = stage.querySelector('svg');
  const hotspotGroup = dialog.querySelector('.customizer-hotspots');
  const options = dialog.querySelector('.customizer-options');
  const detail = dialog.querySelector('.customizer-detail');
  const selection = dialog.querySelector('#customizer-selection');
  const balance = dialog.querySelector('.customizer-balance');
  const back = dialog.querySelector('.customizer-back');
  const notice = dialog.querySelector('.customizer-notice');
  const error = dialog.querySelector('.customizer-preview-error');
  const motion = dialog.querySelector('.customizer-motion');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const hotspots = Object.entries(slots).map(([slot, { label, side, behind }]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.slot = slot;
    button.dataset.side = side;
    button.textContent = label;
    button.onclick = () => select(slot);
    let line, endpoint;
    if (!behind) {
      line = document.createElementNS(ns, 'path');
      endpoint = document.createElementNS(ns, 'circle');
      endpoint.setAttribute('r', '2.6');
      lines.append(line, endpoint);
    }
    hotspotGroup.append(button);
    return { slot, side, button, line, endpoint };
  });
  let studio, openError = false, trigger;
  let selected = 'jacket', pending, applying = false;
  let angle = orbitAngle, targetAngle = null, auto = true, drag = null;
  let tap, handledTouch, closeTapTimer;
  let width = 0, height = 0, frame = 0, lastTime = 0, dirty = true;

  function queueFrame() {
    if (!frame && studio && !openError && dialog.open) frame = requestAnimationFrame(tick);
  }

  function updateMotion() {
    motion.setAttribute('aria-pressed', String(auto));
  }

  function positionHotspots() {
    const gap = width < 600 ? 5 : 10;
    const margin = Math.round(Math.min(48, Math.max(9, width * .038)));
    const minY = gap + 4;
    const maxY = height - 50;
    for (const item of hotspots) item.anchor = studio.anchor(item.slot, width, height);
    for (const side of ['left', 'right']) {
      const sideItems = hotspots.filter(item => item.side === side && item.anchor);
      sideItems.sort((a, b) => a.anchor[1] - b.anchor[1]);
      let bottom = minY - gap;
      for (const item of sideItems) {
        const buttonHeight = item.button.offsetHeight;
        item.top = Math.max(bottom + gap, item.anchor[1] - buttonHeight / 2);
        bottom = item.top + buttonHeight;
      }
      let limit = maxY + gap;
      for (let i = sideItems.length - 1; i >= 0; i--) {
        const item = sideItems[i];
        const h = item.button.offsetHeight;
        item.top = Math.max(minY, Math.min(item.top, limit - gap - h));
        limit = item.top;
        const w = item.button.offsetWidth;
        const left = item.side === 'left';
        const endX = left ? margin + w : width - margin - w;
        const endY = item.top + h / 2;
        const [x, y] = item.anchor;
        const elbow = endX + (x - endX) * .69;
        item.button.style.transform = `translate(${left ? margin : width - margin - w}px, ${Math.round(item.top)}px)`;
        if (item.line) {
          item.line.setAttribute('d', `M${endX},${endY} H${elbow} L${x},${y}`);
          item.endpoint.setAttribute('cx', x);
          item.endpoint.setAttribute('cy', y);
        } else studio.positionRearLeader(item.slot, endX, endY, elbow, item.anchor, item.slot === selected);
      }
    }
    const bounds = lines.viewBox.baseVal;
    if (bounds.width !== width || bounds.height !== height) lines.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }

  function tick(timestamp) {
    frame = 0;
    if (!dialog.open || !studio) return;
    const elapsed = timestamp - lastTime;
    if (elapsed < 30 && !dirty) {
      queueFrame();
      return;
    }
    const seconds = lastTime ? Math.min(.06, elapsed / 1000) : 0;
    lastTime = timestamp;
    if (targetAngle !== null) {
      angle = THREE.MathUtils.damp(angle, targetAngle, 10, seconds);
      if (Math.abs(angle - targetAngle) < .003) {
        angle = targetAngle;
        targetAngle = null;
      }
      dirty = true;
    } else if (auto) {
      angle = (angle + seconds * .28) % turnPeriod;
      dirty = true;
    }
    if (dirty && width && height) {
      studio.rotate(angle);
      positionHotspots();
      studio.render();
      dirty = false;
    }
    if (auto || targetAngle !== null) queueFrame();
  }

  function refreshPreview() {
    if (!studio) return;
    const appearance = { ...outfitter.appearance };
    if (equipmentSlots.includes(selected)) appearance.discipline = selected === 'skis' ? 'ski' : 'snowboard';
    if (pending && selected === 'skis') appearance.skis = appearance.skiModel = pending;
    if (pending && selected === 'snowboard') appearance.snowboard = appearance.snowboardModel = pending;
    studio.setAppearance(appearance);
    dirty = true;
    queueFrame();
  }

  function turnTo(next) {
    auto = false;
    updateMotion();
    const destination = angle + Math.atan2(Math.sin(next - angle), Math.cos(next - angle));
    if (reducedMotion.matches) {
      angle = destination;
      targetAngle = null;
      dirty = true;
    } else targetAngle = destination;
    queueFrame();
  }

  function select(slot) {
    selected = slot;
    pending = undefined;
    notice.textContent = '';
    if (slots[slot].angle !== undefined) turnTo(slots[slot].angle);
    renderOptions();
    detail.scrollTop = 0;
    refreshPreview();
  }

  function keepOptionFocus(group, id) {
    const matching = Array.from(options.querySelectorAll('[data-item]')).find(button =>
      button.dataset.group === group && button.dataset.item === id);
    matching?.focus({ preventScroll: true });
  }

  function choose(group, item) {
    if (item.owned === false && item.price > 0) {
      pending = item.id;
      notice.textContent = '';
    } else {
      pending = undefined;
      equip(group, item);
    }
    renderOptions();
    keepOptionFocus(group, item.id);
    refreshPreview();
  }

  function equip(group, item) {
    applying = true;
    try {
      if (outfitter.equipCustomization(group, item.id)) {
        notice.textContent = `${item.name} equipped.`;
        return true;
      }
      if (item.price > outfitter.state.balance) notice.textContent = `You need ${item.price - outfitter.state.balance} more mountain coins.`;
      return false;
    } finally {
      applying = false;
    }
  }

  function addOptions(group, title, fragment) {
    const items = outfitter.customizationOptions(group);
    if (!items.length) return;
    if (title) {
      const heading = document.createElement('h4');
      heading.textContent = title;
      fragment.append(heading);
    }
    const list = document.createElement('ul');
    list.className = 'customizer-choices';
    for (const item of items) {
      const entry = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.item = item.id;
      button.dataset.group = group;
      const inPreview = group === selected && pending === item.id;
      button.setAttribute('aria-pressed', String(pending && group === selected ? inPreview : !!item.active));
      if (item.color && /^#[\da-f]{3,8}$/i.test(item.color)) {
        const swatch = document.createElement('i');
        swatch.style.backgroundColor = item.color;
        button.append(swatch);
      }
      const name = document.createElement('span');
      name.textContent = item.name;
      button.append(name);
      if (inPreview || item.active || (item.price && !item.owned)) {
        const status = document.createElement('small');
        status.textContent = inPreview ? 'Preview' : item.active ? 'Equipped' : `${item.price} coins`;
        button.append(status);
      }
      button.onclick = () => choose(group, item);
      entry.append(button);
      list.append(entry);
    }
    fragment.append(list);
    if (group !== selected) return;
    const current = items.find(item => item.id === pending) ?? items.find(item => item.active) ??
      items.find(item => equipmentSlots.includes(group) && outfitter.appearance[group] === item.id);
    if (!current?.description && !current?.specs && !pending) return;
    const info = document.createElement('div');
    info.className = 'customizer-item-detail';
    for (const value of [current?.description, current?.specs]) {
      if (!value) continue;
      const paragraph = document.createElement('p');
      paragraph.textContent = value;
      info.append(paragraph);
    }
    if (current?.source) {
      const source = document.createElement('a');
      source.href = current.source;
      source.target = '_blank';
      source.rel = 'noopener noreferrer';
      source.textContent = 'Manufacturer details ↗';
      info.append(source);
    }
    if (pending && current) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'customizer-buy';
      button.textContent = 'Buy and equip · ' + current.price + ' coins';
      button.onclick = () => {
        if (!equip(group, current)) return;
        pending = undefined;
        renderOptions();
        keepOptionFocus(group, current.id);
        refreshPreview();
      };
      info.append(button);
    }
    fragment.append(info);
  }

  function renderOptions() {
    balance.textContent = `${outfitter.state.balance} mountain coins`;
    selection.textContent = slots[selected].label;
    for (const { slot, button, line, endpoint } of hotspots) {
      button.setAttribute('aria-pressed', String(slot === selected));
      line?.classList.toggle('is-selected', slot === selected);
      endpoint?.classList.toggle('is-selected', slot === selected);
    }
    const fragment = document.createDocumentFragment();
    const groupTitle = selected === 'backpack' ? 'Model' : selected === 'goggles' ? 'Smith × Supreme' : '';
    addOptions(selected, groupTitle, fragment);
    if (selected === 'backpack') addOptions('backpackColor', 'Color', fragment);
    if (selected === 'snowboard') addOptions('stance', 'Lead foot', fragment);
    options.replaceChildren(fragment);
  }

  function resize() {
    if (!studio || openError || !dialog.open) return;
    ({ width, height } = stage.getBoundingClientRect());
    if (!width || !height) return;
    studio.resize(width, height);
    dirty = true;
    queueFrame();
  }
  const observer = new ResizeObserver(resize);

  function cancelTap(event) {
    if (tap?.id === event.pointerId) tap = undefined;
  }
  function tapDistance(event, start) {
    return Math.hypot(event.clientX - start.x, event.clientY - start.y);
  }
  dialog.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch') return;
    const button = event.target.closest('button');
    tap = event.isPrimary && button && !button.disabled
      ? { id: event.pointerId, x: event.clientX, y: event.clientY, button }
      : undefined;
  });
  dialog.addEventListener('pointermove', event => {
    if (tap?.id === event.pointerId && tapDistance(event, tap) > 8) cancelTap(event);
  });
  dialog.addEventListener('pointerup', event => {
    if (tap?.id !== event.pointerId) return;
    const { button } = tap;
    const moved = tapDistance(event, tap) > 8;
    tap = undefined;
    if (moved || !button.contains(document.elementFromPoint(event.clientX, event.clientY))) return;
    if (button === back) {
      // Keep the modal in the top layer while the browser delivers its tap
      // click. A pointerup close can send that click through to the menu.
      clearTimeout(closeTapTimer);
      closeTapTimer = setTimeout(() => {
        if (dialog.open) back.click();
      }, 420);
      return;
    }
    handledTouch = { x: event.clientX, y: event.clientY, time: performance.now() };
    button.click();
  });
  dialog.addEventListener('pointercancel', cancelTap);
  dialog.addEventListener('lostpointercapture', cancelTap);
  dialog.addEventListener('click', event => {
    // A mobile browser can omit the click after a swipe, or deliver it after
    // the tap has already replaced an equipment option.
    if (!handledTouch || !event.detail || (event.pointerType === 'mouse' && !event.sourceCapabilities?.firesTouchEvents)) return;
    if (performance.now() - handledTouch.time > 450 || tapDistance(event, handledTouch) > 12) return;
    event.stopImmediatePropagation();
    event.preventDefault();
  }, true);

  function stopDrag(event) {
    if (drag?.id !== event.pointerId) return;
    if (event.type === 'pointerup' && !drag.moved && tapDistance(event, drag) <= 5 && studio) {
      const bounds = canvas.getBoundingClientRect();
      const slot = studio.pick(2 * (event.clientX - bounds.left) / width - 1, 1 - 2 * (event.clientY - bounds.top) / height);
      if (slot) select(slot);
    }
    drag = null;
    canvas.classList.remove('is-dragging');
  }
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || !studio) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, angle, moved: false };
    canvas.setPointerCapture(event.pointerId);
    auto = false;
    targetAngle = null;
    updateMotion();
  });
  canvas.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    if (!drag.moved && tapDistance(event, drag) < 5) return;
    drag.moved = true;
    angle = (drag.angle + (event.clientX - drag.x) * .012) % turnPeriod;
    canvas.classList.add('is-dragging');
    dirty = true;
    queueFrame();
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, stopDrag);
  canvas.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    turnTo(angle + (event.key === 'ArrowLeft' ? -.44 : .44));
  });
  for (const button of dialog.querySelectorAll('[data-turn]')) button.onclick = () => turnTo(angle + Number(button.dataset.turn));
  motion.onclick = () => {
    auto = !auto;
    targetAngle = null;
    lastTime = 0;
    updateMotion();
    queueFrame();
  };
  reducedMotion.addEventListener('change', ({ matches }) => {
    if (!matches || !dialog.open) return;
    auto = false;
    targetAngle = null;
    updateMotion();
  });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    error.hidden = false;
    stage.classList.add('preview-unavailable');
    cancelAnimationFrame(frame);
    frame = 0;
    openError = true;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    requestAnimationFrame(() => {
      openError = false;
      error.hidden = true;
      stage.classList.remove('preview-unavailable');
      resize();
    });
  });
  back.onclick = () => {
    clearTimeout(closeTapTimer);
    dialog.close();
  };
  dialog.addEventListener('close', () => {
    clearTimeout(closeTapTimer);
    cancelAnimationFrame(frame);
    frame = 0;
    observer.disconnect();
    drag = null;
    tap = undefined;
    canvas.classList.remove('is-dragging');
    trigger?.focus({ preventScroll: true });
  });
  outfitter.dialog.addEventListener('outfitterchange', () => {
    if (dialog.open && !applying) {
      pending = undefined;
      renderOptions();
      refreshPreview();
    }
  });

  function open(opener = document.activeElement) {
    if (dialog.open) return;
    trigger = opener;
    selected = 'jacket';
    pending = undefined;
    angle = orbitAngle;
    auto = !reducedMotion.matches;
    targetAngle = null;
    lastTime = 0;
    notice.textContent = '';
    if (!studio && !openError) {
      try { studio = createStudio(canvas, outfitter.renderer); }
      catch (error) {
        console.warn('3D outfitter preview could not start', error);
        openError = true;
      }
    }
    error.hidden = !openError;
    stage.classList.toggle('preview-unavailable', openError);
    updateMotion();
    renderOptions();
    dialog.showModal();
    detail.scrollTop = 0;
    observer.observe(stage);
    resize();
    refreshPreview();
    document.fonts.ready.then(() => {
      if (!dialog.open) return;
      dirty = true;
      queueFrame();
    });
  }
  return { open, close: () => dialog.close(), get isOpen() { return dialog.open; } };
}
