const screen = document.getElementById('loading-screen');
const carriage = screen.querySelector('.snowball-carriage');
const ball = screen.querySelector('.forming-snowball');
const bar = document.getElementById('load-bar');
const status = document.getElementById('load-status');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let milestone = 0, completion;

const interrupted = () => screen.dataset.recovering || screen.dataset.loadingFailed;

function moveTo(value, finishing = false) {
  const transform = getComputedStyle(carriage).transform;
  const distance = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m41;
  const remaining = Math.max(0, value - distance / Math.max(1, carriage.offsetWidth));
  const minimum = finishing ? 360 : 220, maximum = finishing ? 880 : 3000;
  const duration = reduced.matches ? 0 : Math.min(maximum, Math.max(minimum, remaining * 5700));
  screen.style.setProperty('--loader-travel-duration', `${duration}ms`);
  // Keep the transform lists stable. The browser retargets the transitions
  // from their interpolated positions, including after a long terrain task.
  carriage.style.transform = `translateX(${value * 100}%)`;
  ball.style.transform = `translateY(${43 * .86 * (1 - value)}%) scale(${.14 + .86 * value}) rotate(${reduced.matches ? 0 : 650 * value - 16}deg)`;
  bar.style.transform = `scaleX(${value})`;
  bar.parentElement.setAttribute('aria-valuenow', String(Math.round(value * 100)));
}

export function loadingProgress(progress, label) {
  if (interrupted() || completion || !Number.isFinite(progress)) return;
  const next = Math.max(0, Math.min(.98, progress));
  if (next < milestone) return;
  if (label && label !== status.textContent) status.textContent = label;
  if (next === milestone) return;
  milestone = next;
  moveTo(next);
}

export function failMountainLoading(message) {
  if (screen.dataset.recovering) return;
  screen.dataset.loadingFailed = 'true';
  status.textContent = message;
  screen.classList.remove('hidden');
  document.getElementById('load-destinations').hidden = false;
}

function whileVisible(promise) {
  if (document.hidden) return Promise.resolve();
  return new Promise(resolve => {
    function done() {
      document.removeEventListener('visibilitychange', check);
      resolve();
    }
    function check() {
      if (document.hidden) done();
    }
    document.addEventListener('visibilitychange', check);
    promise.then(done, done);
  });
}

async function finish() {
  status.textContent = 'Ready when you are.';
  moveTo(1, true);
  const travel = carriage.getAnimations().find(animation => animation.transitionProperty === 'transform');
  if (travel) await whileVisible(travel.finished);
  if (!document.hidden && !interrupted()) {
    // Let the final position paint before revealing the live world.
    await whileVisible(new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  if (!interrupted()) screen.classList.add('hidden');
}

export function finishMountainLoading() {
  if (interrupted()) return Promise.resolve();
  completion ??= finish();
  return completion;
}
