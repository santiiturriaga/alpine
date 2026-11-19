// Use compositor transforms so the ball can keep rolling while a terrain tile is built.
const screen = document.getElementById('loading-screen');
const carriage = screen.querySelector('.snowball-carriage');
const ball = screen.querySelector('.forming-snowball');
const bar = document.getElementById('load-bar');
const status = document.getElementById('load-status');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let start = 0, target = 0, animations = [];

function pose(value) {
  return [
    `translateX(${100 * value}%)`,
    `translateY(${43 * .86 * (1 - value)}%) scale(${.14 + .86 * value}) rotate(${reduced.matches ? 0 : 650 * value - 16}deg)`,
    `scaleX(${value})`,
  ];
}

export function loadingProgress(progress, label) {
  if (screen.dataset.recovering) return;
  if (label && label !== status.textContent) status.textContent = label;
  const actual = Math.max(0, Math.min(1, progress));
  bar.parentElement.setAttribute('aria-valuenow', String(Math.round(actual * 100)));
  // Reserve the finish line for a ready world. A little travel between reports
  // avoids the long stationary intervals when the current stage does most of the work.
  const next = actual === 1 ? 1 : Math.min(.985, actual + .065);
  if (next <= target) return;
  const portion = animations[0]?.effect.getComputedTiming().progress ?? 0;
  start += (target - start) * portion;
  for (const animation of animations) animation.cancel();
  target = next;
  const before = pose(start), after = pose(next);
  const duration = reduced.matches ? 0 : Math.min(next === 1 ? 900 : 3600, Math.max(300, (next - start) * 7800));
  animations = [carriage, ball, bar].map((element, i) => element.animate(
    [{ transform: before[i] }, { transform: after[i] }],
    { duration, easing: 'cubic-bezier(.27,.15,.34,1)', fill: 'forwards' },
  ));
}

export async function finishMountainLoading() {
  loadingProgress(1, 'Ready when you are.');
  if (!document.hidden && animations.length) await animations[0].finished;
  if (!screen.dataset.recovering) screen.classList.add('hidden');
  animations.forEach(animation => animation.cancel());
  animations = [];
}
