export function installTouchButtons({ keys, queueJump, clearJump, releaseKey, cycleCamera, openMountain, pause }) {
  const surface = document.getElementById('touch-controls');
  const pressed = new Map();
  const pulseTimers = new Map();
  const actions = { cycleCamera, openMountain, pause };

  function sync(button) {
    const held = [...pressed.values()].includes(button);
    const code = button.dataset.skiKey;
    keys[code] = held;
    button.toggleAttribute('data-held', held);
    if (!held) releaseKey(code);
  }

  function press(button, token) {
    const alreadyHeld = button.hasAttribute('data-held');
    pressed.set(token, button);
    sync(button);
    if (!alreadyHeld && button.dataset.skiKey === 'Space') queueJump();
  }

  function release(token) {
    const button = pressed.get(token);
    if (!button) return;
    pressed.delete(token);
    sync(button);
  }

  function releaseAll() {
    if (pressed.size) clearJump();
    for (const timer of pulseTimers.values()) clearTimeout(timer);
    pulseTimers.clear();
    for (const token of pressed.keys()) release(token);
  }

  for (const button of surface.querySelectorAll('[data-ski-key]')) {
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      if (event.isTrusted) button.setPointerCapture(event.pointerId);
      press(button, event.pointerId);
    });
    button.addEventListener('click', event => {
      if (event.detail || event.pointerType) return;
      // Native keyboard and accessibility activations have no held pointer.
      const token = button.dataset.skiKey;
      clearTimeout(pulseTimers.get(token));
      press(button, token);
      pulseTimers.set(token, setTimeout(() => {
        pulseTimers.delete(token);
        release(token);
      }, 160));
    });
  }

  for (const button of surface.querySelectorAll('[data-ski-action]')) {
    button.addEventListener('click', actions[button.dataset.skiAction]);
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    window.addEventListener(type, event => release(event.pointerId), true);
  }
  for (const type of ['blur', 'resize', 'orientationchange', 'pagehide']) {
    window.addEventListener(type, releaseAll);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseAll();
  });

  // Keep iOS long presses on the live game surface from opening system menus.
  const coarsePointer = matchMedia('(pointer: coarse)');
  for (const id of ['hud', 'webgl', 'gear-mode']) {
    const element = document.getElementById(id);
    for (const type of ['contextmenu', 'selectstart', 'dragstart']) {
      element.addEventListener(type, event => {
        if (coarsePointer.matches || event.pointerType === 'touch') event.preventDefault();
      });
    }
  }
  return { releaseAll };
}
