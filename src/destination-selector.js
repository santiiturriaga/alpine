import { createDestinationRelief, loadDestinationReliefs } from './destination-relief.js';
import { createDestinationStage } from './destination-stage.js';

const $ = id => document.getElementById(id);
const TAU = Math.PI * 2;

// Camera headings that show the trail networks or landmark-facing ridges first.
const OPENING_ANGLES = {
  'whistler-blackcomb': -2.52,
  'stevens-pass': -2.03,
  'snoqualmie': -1.26,
  'crystal-mountain': -.54,
  'les-3-vallees': 2.49,
  'zermatt-cervinia': 1.64,
  'chamonix-mont-blanc': 3.07,
  'ski-arlberg': -.93,
  'verbier-4-vallees': .86,
  'tignes-val-disere': -2.8,
  'vail': 1.48,
  'jackson-hole': .49,
  'niseko-united': -1.84,
  'mount-rainier': .68,
  'mont-blanc': 2.9,
  'matterhorn': -2.1,
  'eiger': -2.55,
  'denali': -2.14,
  'everest': 2.28,
  'k2': 2.35,
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
  const models = $('destination-models');
  const picker = $('destination-choose');
  const travel = $('destination-travel');
  const status = $('destination-preview-status');
  const rotatePreview = $('destination-rotate');
  const routesKey = $('destination-route-key');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const wrap = i => (i % places.length + places.length) % places.length;
  const relative = (index, center) => wrap(index - center + places.length / 2) - places.length / 2;
  let selected = Math.max(0, places.findIndex(place => place.id === current.id));
  let position = selected, target = selected;
  let records, pending, previewError = false, view, contextLost = false;
  let pointer, suppressClick = false, idleUntil = 0;
  let lastWheelEvent = 0, lastWheelStep = 0, wheelTravel = 0;
  let frame = 0, lastFrame = 0, resize = true, dirty = true, warming = false, rotating = false;

  const tiles = places.map((place, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'destination-tile';
    button.tabIndex = -1;
    button.dataset.destination = place.id;
    button.setAttribute('aria-label', `${place.label}, ${place.country}`);
    button.textContent = place.label;
    button.hidden = true;
    models.append(button);
    return { place, button, angle: OPENING_ANGLES[place.id] ?? -.91, index };
  });

  function build(tile) {
    if (tile.model || !records.has(tile.place.id)) return;
    view.attach(tile, createDestinationRelief(records.get(tile.place.id)), tile.index);
  }

  function warmPreviews() {
    if (warming || !view || !dialog.open || contextLost) return;
    const next = tiles.filter(tile => !tile.model && records.has(tile.place.id))
      .sort((a, b) => Math.abs(relative(a.index, target)) - Math.abs(relative(b.index, target)))[0];
    if (!next) return;
    warming = true;
    const warm = () => {
      warming = false;
      if (!dialog.open || contextLost) return;
      build(next);
      if (Math.abs(relative(next.index, position)) < 2.34) invalidate();
      warmPreviews();
    };
    if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 170 });
    else setTimeout(warm, 48);
  }

  function showStatus() {
    const available = view && !contextLost && records?.has(places[selected].id);
    status.hidden = Boolean(available);
    rotatePreview.hidden = !available;
    if (!available) {
      status.textContent = previewError || contextLost || records ? 'Terrain preview unavailable' : 'Loading terrain previews…';
    }
  }

  function select(index) {
    const next = wrap(index);
    const step = relative(next, selected);
    if (step) tiles[selected].angleGoal = undefined;
    selected = next;
    target += step;
    if (reduceMotion.matches || Math.abs(step) > 2) position = target;
    else if (Math.abs(position - target) > 2.3) position = target + Math.sign(position - target) * 2.3;
    const place = places[selected];
    $('destination-name').textContent = place.label;
    $('destination-country').textContent = place.country;
    picker.value = place.id;
    travel.textContent = !standalone && place.id === current.id ? 'Stay here' : place.terrainOnly ? 'Visit mountain' : 'Travel to resort';
    routesKey.hidden = Boolean(place.terrainOnly);
    for (const { button, index } of tiles) button.setAttribute('aria-current', String(index === selected));
    idleUntil = performance.now() + 1050;
    showStatus();
    invalidate();
    warmPreviews();
  }

  function animate(now) {
    frame = 0;
    if (!dialog.open || !view || contextLost) return;
    const elapsed = Math.min(.05, Math.max(.001, (now - lastFrame) / 1000));
    lastFrame = now;
    const still = reduceMotion.matches;
    const blend = still ? 1 : 1 - Math.exp(-elapsed * 14);
    if (!pointer?.moved && position !== target) {
      position += (target - position) * blend;
      if (Math.abs(position - target) < .001 || still) position = target;
      dirty = true;
    }
    const tile = tiles[selected];
    if (tile.angleGoal !== undefined) {
      tile.angle += (tile.angleGoal - tile.angle) * blend;
      if (Math.abs(tile.angleGoal - tile.angle) < .001 || still) {
        tile.angle = tile.angleGoal % TAU;
        tile.angleGoal = undefined;
      }
      rotating = true;
    } else if (!still && !pointer && now > idleUntil) {
      tile.angle = (tile.angle + elapsed * .23) % TAU;
      rotating = true;
    }
    if (resize) {
      view.resize();
      resize = false;
      dirty = true;
    }
    if (dirty) {
      build(tile);
      for (const item of tiles) item.distance = relative(item.index, position);
      view.draw(tiles);
      dirty = false;
    } else if (rotating) {
      view.rotate(tile);
    }
    rotating = false;
    if (!still) frame = requestAnimationFrame(animate);
  }

  function invalidate(layout = true) {
    if (layout) dirty = true;
    else rotating = true;
    if (!frame && dialog.open && view && !contextLost) {
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
      const loaded = await pending;
      view = createDestinationStage(models);
      records = loaded;
      view.canvas.addEventListener('webglcontextlost', () => {
        contextLost = true;
        showStatus();
      });
      view.canvas.addEventListener('webglcontextrestored', () => {
        contextLost = false;
        resize = true;
        showStatus();
        invalidate();
        warmPreviews();
      });
      invalidate();
      warmPreviews();
    } catch (error) {
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
    resize = true;
    select(selected);
    ensurePreviews();
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
    const button = event.target.closest?.('.destination-tile');
    if (button && !button.hidden) return places.findIndex(place => place.id === button.dataset.destination);
    return contextLost ? -1 : view?.hit(event.clientX, event.clientY) ?? -1;
  }

  stage.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || pointer || rotatePreview.contains(event.target)) return;
    suppressClick = false;
    const kind = event.pointerType;
    const rotate = kind !== 'touch' && hitTile(event) === selected && !event.target.closest?.('.destination-tile');
    pointer = {
      id: event.pointerId, kind, rotate, x: event.clientX, y: event.clientY, axis: 'x',
      angle: tiles[selected].angle, moved: false, turn: 0, start: position,
    };
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
      tiles[selected].angle = (pointer.angle + dx * .011) % TAU;
      tiles[selected].angleGoal = undefined;
    } else {
      const distance = pointer.axis === 'y' ? dy : dx;
      const span = pointer.axis === 'y' ? stage.clientHeight : stage.clientWidth;
      pointer.turn = Math.max(-2, Math.min(2, -distance / Math.min(245, span * .51)));
      position = pointer.start + pointer.turn;
    }
    invalidate(!pointer.rotate || position !== target);
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
      invalidate();
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
  reduceMotion.addEventListener('change', () => invalidate());
  new ResizeObserver(() => {
    resize = true;
    invalidate();
  }).observe(models);

  populatePicker(picker, places);
  picker.addEventListener('change', () => select(places.findIndex(place => place.id === picker.value)));
  $('destination-close').addEventListener('click', close);
  $('destination-previous').addEventListener('click', () => select(selected - 1));
  $('destination-next').addEventListener('click', () => select(selected + 1));
  function rotateStep() {
    const tile = tiles[selected];
    tile.angleGoal = (tile.angleGoal ?? tile.angle) + Math.PI / 4;
    idleUntil = performance.now() + 1600;
    invalidate(position !== target);
  }
  let rotateTap, lastRotateTap = -Infinity;
  rotatePreview.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch' && event.isPrimary) {
      rotateTap = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }
  });
  rotatePreview.addEventListener('pointerup', event => {
    if (rotateTap?.id !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - rotateTap.x, event.clientY - rotateTap.y);
    rotateTap = undefined;
    if (moved > 8 || !rotatePreview.contains(document.elementFromPoint(event.clientX, event.clientY))) return;
    lastRotateTap = performance.now();
    rotateStep();
  });
  rotatePreview.addEventListener('pointercancel', () => { rotateTap = undefined; });
  rotatePreview.addEventListener('click', event => {
    // Touch browsers can omit the click after a carousel swipe or dispatch it
    // separately from the pointer release. The tap handler covers both cases.
    if (event.detail && event.pointerType !== 'mouse' && performance.now() - lastRotateTap < 450) return;
    rotateStep();
  });
  travel.addEventListener('click', go);
  document.addEventListener('click', event => {
    if (event.target.closest?.('[data-destination-open]')) open();
  });
  if (standalone) $('destination-close').setAttribute('aria-label', 'Back to game');
  return { open };
}
