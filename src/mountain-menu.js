const byId = (id) => document.getElementById(id);

function bindOverlayFocus() {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || document.querySelector('dialog[open]')) return;
    const overlay = document.querySelector(':is(#pause-screen, #guide-screen):not(.hidden)');
    if (!overlay) return;
    const controls = [...overlay.querySelectorAll('button, summary, input, select')]
      .filter((control) => control.tabIndex >= 0 && !control.disabled && control.getClientRects().length);
    const index = controls.indexOf(document.activeElement);
    const boundary = event.shiftKey ? 0 : controls.length - 1;
    if (index >= 0 && index !== boundary) return;
    event.preventDefault();
    controls[event.shiftKey ? controls.length - 1 : 0]?.focus();
  });
}

export function createMountainMenu({ resortName, lifts, travel }) {
  const dialog = byId('mountain-panel');
  const body = dialog.querySelector('.mountain-body');
  const tablist = dialog.querySelector('.mountain-tabs');
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  const liftTab = byId('mountain-tab-lifts');
  const filter = byId('lift-filter');
  const empty = byId('lift-travel-empty');
  const hasLifts = lifts.length > 0;
  bindOverlayFocus();
  byId('mountain-menu-resort').textContent = resortName;
  byId('pause-lifts').hidden = liftTab.hidden = !hasLifts;
  dialog.querySelector('[data-mountain-section="lifts"]').hidden = !hasLifts;

  function select(section, focus = false) {
    const selected = tabs.find((tab) => tab.id === 'mountain-tab-' + section && !tab.hidden) ?? tabs[0];
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      byId(tab.getAttribute('aria-controls')).hidden = !active;
    }
    body.scrollTop = 0;
    if (focus) selected.focus();
    return selected;
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => select(tab.id.slice('mountain-tab-'.length)));
  }
  tablist.addEventListener('keydown', (event) => {
    const available = tabs.filter((tab) => !tab.hidden);
    const current = available.indexOf(event.target);
    if (current < 0) return;
    let next = current;
    switch (event.key) {
      case 'ArrowLeft': case 'ArrowUp': next = (current + available.length - 1) % available.length; break;
      case 'ArrowRight': case 'ArrowDown': next = (current + 1) % available.length; break;
      case 'Home': next = 0; break;
      case 'End': next = available.length - 1; break;
      default: return;
    }
    event.preventDefault();
    select(available[next].id.slice('mountain-tab-'.length), true);
  });
  dialog.querySelector('[data-mountain-section="lifts"]').addEventListener('click', () => select('lifts', true));

  const liftRows = [...lifts].sort((a, b) => a.name.localeCompare(b.name)).map((lift) => {
    const item = document.createElement('li');
    const title = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = lift.name;
    title.append(name);
    const metadata = [lift.section, lift.visitOnly ? 'Station visits only' : null].filter(Boolean);
    if (metadata.length) {
      const detail = document.createElement('small');
      detail.textContent = metadata.join(' · ');
      title.append(detail);
    }
    const stations = document.createElement('div');
    stations.className = 'lift-station-actions';
    for (const [end, label] of [['base', lift.baseLabel ?? 'Base'], ['top', lift.topLabel ?? 'Top']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.setAttribute('aria-label', `${lift.name}, ${label} station`);
      button.addEventListener('click', () => travel(lift.id, end));
      stations.append(button);
    }
    item.append(title, stations);
    return { item, search: normalize([lift.name, lift.section].join(' ')) };
  });
  byId('lift-travel-list').append(...liftRows.map(({ item }) => item));

  function normalize(value) {
    return value.normalize('NFD').toLowerCase()
      .replace(/\p{Diacritic}|['’]/gu, '')
      .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
      .trim();
  }

  function updateFilter() {
    const words = normalize(filter.value).split(' ');
    let hasResults = false;
    for (const { item, search } of liftRows) {
      item.hidden = !words.every((word) => search.includes(word));
      hasResults ||= !item.hidden;
    }
    empty.hidden = hasResults;
    body.scrollTop = 0;
  }

  filter.addEventListener('input', updateFilter);
  // Escape clears a pending search without closing the menu.
  filter.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && filter.value) {
      event.preventDefault();
      filter.value = '';
      updateFilter();
    }
  });

  return (section = 'travel') => {
    if (dialog.open) return;
    if (section === 'lifts' && filter.value) {
      filter.value = '';
      updateFilter();
    }
    const tab = select(section);
    dialog.showModal();
    if (section !== 'travel') tab.focus({ preventScroll: true });
  };
}

export function initFieldGuide({ resortName, startName, terrainOnly = false } = {}) {
  const coarse = matchMedia('(pointer: coarse)').matches;
  byId('guide-touch').open = coarse;
  byId('guide-keyboard').open = !coarse;
  if (!coarse) byId('guide-touch').before(byId('guide-keyboard'));
  if (!resortName) return;

  const instructions = {
    reset: `Return to ${startName || 'the mountain approach'}.`,
    interact: terrainOnly ? 'Interact when a prompt appears.' : 'Board a nearby lift. Press E again to skip to the unload.',
    camera: 'Change the camera or lift view. Click or drag on the snow to look around.',
    mountain: terrainOnly ? 'Find viewpoints and change conditions in the mountain menu.' : 'Find lift stations, ski or bike trails and conditions in the mountain menu.',
  };
  for (const [id, text] of Object.entries(instructions)) {
    document.querySelector(`[data-guide-action="${id}"] dd`).textContent = text;
  }
  byId('guide-mountain-intro').textContent = terrainOnly
    ? `Explore ${resortName} on foot or choose a viewpoint in the mountain menu.`
    : `Ride the lifts at ${resortName} or choose a trail start in the mountain menu.`;
  byId('guide-mountain-advice').textContent = terrainOnly
    ? 'Use Walk to explore in boots and Ski to put your skis back on.'
    : 'Push off at the unload. Give downhill skiers room and look before you enter a trail.';
  byId('guide-coin-tip').hidden = true;
  byId('guide-trail-key').hidden = terrainOnly;
  for (const item of document.querySelectorAll('[data-whistler-guide]')) item.hidden = true;
  if (terrainOnly) for (const item of document.querySelectorAll('[data-guide-lift]')) item.hidden = true;
}
