import { createDestinationRelief, drawDestinationRelief, hitDestinationRelief, loadDestinationReliefs } from './destination-relief.js';

const $ = id => document.getElementById(id);
const TAU = Math.PI * 2;
const DEFAULT_ANGLE = -.91;
const OPENING_ANGLES = {
  'whistler-blackcomb': -2.52,
  'stevens-pass': -2.5,
  'matterhorn': 4.19,
  'eiger': -2.55,
  'mount-rainier': .68,
  'everest': .71,
};

function populatePicker(picker, places) {
  const resorts = document.createElement('optgroup');
  const summits = document.createElement('optgroup');
  resorts.label = 'Ski resorts';
  summits.label = 'Mountain visits';
  for (const place of places) {
    (place.terrainOnly ? summits : resorts).append(new Option(`${place.label} · ${place.country}`, place.id));
  }
  picker.replaceChildren(resorts, summits);
}

export function bindDestinationSelector(places, current, travelURL, { standalone }) {
  const dialog = $('destination-selector');
  const stage = $('destination-stage');
  const picker = $('destination-choose');
  const travel = $('destination-travel');
  const status = $('destination-preview-status');
  const rotatePreview = $('destination-rotate');
  const routesKey = $('destination-route-key');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const wrap = i => (i % places.length + places.length) % places.length;
  let selected = Math.max(0, places.findIndex(place => place.id === current.id));
  let records, pending, previewError = false;
  let pointer, suppressClick = false, idleUntil = 0;
  let lastWheelEvent = 0, lastWheelStep = 0, wheelTravel = 0;
  let frame = 0, lastFrame = 0;

  const tiles = places.map((place, index) => {
    const button = document.createElement('button');
    const canvas = document.createElement('canvas');
    const label = document.createElement('span');
    button.type = 'button';
    button.className = 'destination-tile';
    button.tabIndex = -1;
    button.dataset.destination = place.id;
    button.setAttribute('aria-label', `${place.label}, ${place.country}`);
    canvas.width = 1;
    canvas.height = 1;
    canvas.setAttribute('aria-hidden', 'true');
    label.textContent = place.label;
    button.append(canvas, label);
    $('destination-models').append(button);
    return { place, button, canvas, angle: OPENING_ANGLES[place.id] ?? DEFAULT_ANGLE, displayedAt: null };
  });
  let hitOrder = [];

  function layout(turn = 0) {
    for (let index = 0; index < tiles.length; index++) {
      const { button } = tiles[index];
      const half = places.length / 2;
      const distance = wrap(index - selected - turn + half) - half;
      const gap = Math.abs(distance);
      const visible = gap < 2.65;
      button.style.setProperty('--tile-x', Math.sin(Math.max(-3, Math.min(3, distance)) * .52) * 2.03);
      button.style.setProperty('--tile-y', -Math.min(gap, 3) * .061);
      button.style.setProperty('--tile-scale', 1 - Math.min(gap, 2.5) * .25);
      button.style.setProperty('--tile-opacity', gap >= 2.65 ? 0 : gap >= 1.65 ? .55 : 1);
      button.style.zIndex = String(10 - Math.round(gap * 2));
      button.setAttribute('aria-hidden', String(!visible));
      button.setAttribute('aria-current', String(index === selected));
      tiles[index].gap = gap;
      if (visible && records) renderTile(index);
    }
    hitOrder = tiles.map((_, i) => i).filter(i => tiles[i].gap < 2.65)
      .sort((a, b) => Number(tiles[b].button.style.zIndex) - Number(tiles[a].button.style.zIndex) || b - a);
  }

  function renderTile(index) {
    const tile = tiles[index];
    if (!tile.model) {
      const record = records.get(tile.place.id);
      if (!record) return;
      tile.model = createDestinationRelief(record);
    }
    const width = index === selected ? 840 : 350;
    if (tile.displayedAt === tile.angle && tile.canvas.width === width) return;
    if (tile.canvas.width !== width) {
      tile.canvas.width = width;
      tile.canvas.height = Math.round(width * 470 / 700);
    }
    drawDestinationRelief(tile.canvas, tile.model, tile.angle, index === selected);
    tile.displayedAt = tile.angle;
  }

  function showStatus() {
    const available = records?.has(places[selected].id);
    status.hidden = Boolean(available);
    rotatePreview.hidden = !available;
    if (!available) {
      status.textContent = previewError || records ? 'Terrain preview unavailable' : 'Loading terrain previews…';
    }
  }

  function select(index) {
    selected = wrap(index);
    const place = places[selected];
    $('destination-name').textContent = place.label;
    $('destination-country').textContent = place.country;
    picker.value = place.id;
    travel.textContent = !standalone && place.id === current.id ? 'Stay here' : place.terrainOnly ? 'Visit mountain' : 'Travel to resort';
    routesKey.hidden = Boolean(place.terrainOnly);
    idleUntil = performance.now() + 1250;
    showStatus();
    layout();
  }

  function animate(now) {
    frame = 0;
    if (!dialog.open || !records || reduceMotion.matches) return;
    if (now - lastFrame >= 67) {
      const elapsed = Math.min(.12, (now - lastFrame) / 1000);
      lastFrame = now;
      if (!pointer && now > idleUntil) {
        const tile = tiles[selected];
        tile.angle = (tile.angle + elapsed * .17) % TAU;
        renderTile(selected);
      }
    }
    frame = requestAnimationFrame(animate);
  }

  function resumeAnimation() {
    if (!frame && dialog.open && records && !reduceMotion.matches) {
      lastFrame = performance.now();
      frame = requestAnimationFrame(animate);
    }
  }

  async function ensurePreviews() {
    if (records || pending) return;
    previewError = false;
    showStatus();
    pending = loadDestinationReliefs();
    try {
      records = await pending;
      if (dialog.open) layout();
      resumeAnimation();
    } catch (error) {
      records = undefined;
      previewError = true;
      console.warn('Mountain previews unavailable.', error);
    } finally {
      pending = undefined;
      showStatus();
    }
  }

  function open() {
    if (dialog.open) return;
    dialog.showModal();
    dialog.focus({ preventScroll: true });
    select(selected);
    ensurePreviews();
    resumeAnimation();
  }

  function close() {
    if (standalone) location.assign(travelURL(current));
    else dialog.close();
  }

  function go() {
    const place = places[selected];
    if (!standalone && place.id === current.id) close();
    else location.assign(travelURL(place, { arrive: true }));
  }

  function hitTile(event) {
    const tile = event.target.closest?.('.destination-tile');
    if (tile && tile.getAttribute('aria-hidden') === 'false') {
      return places.findIndex(place => place.id === tile.dataset.destination);
    }
    // The relief and its box occupy different regions. Scan near-to-far so a
    // transparent part of the center canvas cannot steal a neighbouring peak.
    for (const index of hitOrder) {
      const { canvas, model } = tiles[index];
      if (!model) continue;
      const rect = canvas.getBoundingClientRect();
      const u = (event.clientX - rect.left) / rect.width;
      const v = (event.clientY - rect.top) / rect.height;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      if (hitDestinationRelief(model, u * canvas.width, v * canvas.height)) return index;
    }
    return -1;
  }

  stage.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || pointer || rotatePreview.contains(event.target)) return;
    suppressClick = false;
    const kind = event.pointerType;
    const rotate = kind !== 'touch' && hitTile(event) === selected;
    pointer = { id: event.pointerId, kind, rotate, x: event.clientX, y: event.clientY, axis: 'x',
      angle: tiles[selected].angle, moved: false, turn: 0 };
  });

  stage.addEventListener('pointermove', event => {
    if (pointer?.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (!pointer.moved && Math.hypot(dx, dy) < 7) return;
    if (!pointer.moved) {
      pointer.moved = true;
      if (pointer.kind === 'touch' && Math.abs(dy) > Math.abs(dx)) pointer.axis = 'y';
      stage.setPointerCapture(event.pointerId);
      stage.classList.add('is-dragging');
    }
    if (pointer.rotate) {
      tiles[selected].angle = (pointer.angle - dx * .011) % TAU;
      if (records) renderTile(selected);
    } else {
      const distance = pointer.axis === 'y' ? dy : dx;
      const span = pointer.axis === 'y' ? stage.clientHeight : stage.clientWidth;
      pointer.turn = Math.max(-2, Math.min(2, -distance / Math.min(245, span * .51)));
      layout(pointer.turn);
    }
  });

  function finishDrag(event, cancelled = false) {
    if (pointer?.id !== event.pointerId) return;
    const { moved, rotate, turn } = pointer;
    pointer = undefined;
    stage.classList.remove('is-dragging');
    if (!moved) return;
    suppressClick = true;
    idleUntil = performance.now() + 1600;
    if (!cancelled && !rotate && Math.abs(turn) >= .18) {
      select(selected + Math.sign(turn) * Math.max(1, Math.round(Math.abs(turn))));
    } else {
      layout();
    }
  }

  stage.addEventListener('pointerup', event => finishDrag(event));
  stage.addEventListener('pointercancel', event => finishDrag(event, true));
  stage.addEventListener('lostpointercapture', event => {
    if (event.target === stage) finishDrag(event, true);
  });
  stage.addEventListener('pointerleave', event => {
    if (!pointer?.moved) finishDrag(event, true);
  });
  stage.addEventListener('click', event => {
    if ((event.detail && suppressClick) || rotatePreview.contains(event.target)) return;
    const index = hitTile(event);
    if (index !== -1 && index !== selected) select(index);
  });

  dialog.addEventListener('wheel', event => {
    if (event.target === picker || dialog.scrollHeight > dialog.clientHeight && !stage.contains(event.target)) return;
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (!delta) return;
    event.preventDefault();
    const now = performance.now();
    if (now - lastWheelEvent > 140 || Math.sign(wheelTravel) !== Math.sign(delta)) wheelTravel = 0;
    lastWheelEvent = now;
    wheelTravel += delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1);
    if (Math.abs(wheelTravel) >= 44 && now - lastWheelStep > 100) {
      select(selected + Math.sign(wheelTravel));
      lastWheelStep = now;
      wheelTravel = 0;
    }
  }, { passive: false });

  dialog.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.target === picker || event.ctrlKey || event.metaKey || event.altKey) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'Home') select(0);
      else if (event.key === 'End') select(places.length - 1);
      else select(selected + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1));
    }
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => {
    cancelAnimationFrame(frame);
    frame = 0;
    pointer = undefined;
    stage.classList.remove('is-dragging');
  });
  reduceMotion.addEventListener('change', resumeAnimation);
  populatePicker(picker, places);
  picker.addEventListener('change', () => select(places.findIndex(place => place.id === picker.value)));
  $('destination-close').addEventListener('click', close);
  $('destination-previous').addEventListener('click', () => select(selected - 1));
  $('destination-next').addEventListener('click', () => select(selected + 1));
  rotatePreview.addEventListener('click', () => {
    const tile = tiles[selected];
    tile.angle = (tile.angle + Math.PI / 4) % TAU;
    idleUntil = performance.now() + 1600;
    if (records) renderTile(selected);
  });
  travel.addEventListener('click', go);
  document.addEventListener('click', event => {
    if (event.target.closest?.('[data-destination-open]')) open();
  });
  if (standalone) $('destination-close').setAttribute('aria-label', 'Back to game');
  return { open };
}
