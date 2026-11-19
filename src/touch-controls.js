export function installTouchButtons({ keys, queueJump, cycleCamera, openMountain, pause }) {
  const hud = document.getElementById('hud');
  const surface = document.createElement('div');
  surface.className = 'mapped-touch';
  surface.setAttribute('role', 'group');
  surface.setAttribute('aria-label', 'Ski touch controls');

  const prompt = document.getElementById('board-lift');
  const tap = document.createElement('span');
  tap.className = 'touch-tap-label';
  tap.setAttribute('aria-hidden', 'true');
  tap.textContent = 'Tap';
  prompt.prepend(tap);
  prompt.setAttribute('aria-labelledby', 'prompt-title');

  for (const [group, buttons] of [
    ['move', [['Left', 'KeyA'], ['Right', 'KeyD'], ['Go', 'KeyW'], ['Brake', 'KeyS'], ['Jump', 'Space']]],
    ['actions', [['View', cycleCamera], ['Mountain', openMountain], ['Pause', pause]]],
  ]) {
    const cluster = document.createElement('div');
    cluster.className = `mapped-touch-${group}`;
    for (const [name, action] of buttons) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = name;
      button.dataset.control = name.toLowerCase();
      if (typeof action === 'function') button.addEventListener('click', action);
      else {
        const held = new Set();
        const update = () => { keys[action] = held.size > 0; };
        button.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          button.setPointerCapture(event.pointerId);
          held.add(event.pointerId);
          update();
          if (action === 'Space') queueJump();
        });
        const release = (event) => { if (held.delete(event.pointerId)) update(); };
        button.addEventListener('pointerup', release);
        button.addEventListener('pointercancel', release);
        button.addEventListener('lostpointercapture', release);
        button.addEventListener('click', (event) => {
          if (event.detail) return;
          if (action === 'Space') queueJump();
          else {
            const pulse = Symbol();
            held.add(pulse);
            update();
            setTimeout(() => { held.delete(pulse); update(); }, 160);
          }
        });
      }
      cluster.append(button);
    }
    surface.append(cluster);
  }
  hud.append(surface);
}
