import { compactDevice } from './device-budget.js';

// Browsers can restart a killed renderer without dispatching an error or pagehide.
// Leave the map chooser accessible on that navigation. Retry only on a user gesture.
const key = 'alpine.active-renderer';
let active = false;
export let rendererUnavailable = false;
function remember(value) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch { /* Private browsing may disable session storage. */ }
}

function recoveryScreen(message, retry) {
  const screen = document.getElementById('loading-screen');
  screen.dataset.recovering = 'true';
  screen.classList.remove('hidden');
  document.getElementById('load-status').textContent = message;
  document.getElementById('load-destinations').hidden = false;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'destination-recover';
  button.textContent = 'Retry in Budget graphics';
  button.onclick = () => {
    button.remove();
    delete screen.dataset.recovering;
    retry();
  };
  document.getElementById('load-destinations').before(button);
}

export async function enterRenderer(id) {
  if (!compactDevice) return;
  let prior;
  try { prior = sessionStorage.getItem(key); } catch {}
  if (prior === id) {
    await new Promise(resolve => recoveryScreen('The browser interrupted this mountain. Choose another or try again.', () => {
      const url = new URL(location.href);
      url.searchParams.set('quality', 'budget');
      url.searchParams.set('resolution', 'scaled');
      history.replaceState(null, '', url);
      document.getElementById('load-destinations').hidden = true;
      resolve();
    }));
  }
  active = true;
  remember(id);
  window.addEventListener('pagehide', () => remember(null));
  window.addEventListener('pageshow', event => { if (event.persisted && active) remember(id); });
}

export function watchRenderer(canvas) {
  let lost = false;
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    if (lost) return;
    lost = true;
    rendererUnavailable = true;
    if (document.pointerLockElement) document.exitPointerLock();
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    recoveryScreen('The browser released the graphics surface.', () => {
      active = false;
      remember(null);
      const url = new URL(location.href);
      url.searchParams.set('quality', 'budget');
      url.searchParams.set('resolution', 'scaled');
      location.replace(url);
    });
  });
}
