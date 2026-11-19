import { Vector3 } from 'three';
import { clamp, formatNumber } from './util.js';

export function createTrickHud(number, announcement) {
  const anchor = new Vector3();
  function text(node, value) {
    if (node.textContent !== value) node.textContent = value;
  }

  return function updateTrickHud(player, camera, active) {
    const combo = player.trickCombo;
    const airborne = combo.phase === 'air';
    number.hidden = !active || (!airborne && combo.resultTime <= 0);
    if (number.hidden) {
      text(announcement, '');
      return;
    }

    const upgrading = airborne && combo.scratchTime > 0;
    const value = upgrading ? combo.previousPoints : combo.points;
    number.dataset.state = upgrading ? 'upgrade' : combo.phase;
    text(number, formatNumber(value));
    text(announcement, airborne ? '' : combo.phase === 'banked'
      ? `Banked ${formatNumber(combo.points)} trick points`
      : `Bailed. Lost ${formatNumber(combo.points)} unbanked trick points`);

    const width = window.innerWidth, height = window.innerHeight;
    camera.updateMatrixWorld();
    anchor.copy(player.pos).y += 1.15;
    anchor.project(camera);
    const inView = player.cameraMode !== 2 && anchor.z > -1 && anchor.z < 1
      && Math.abs(anchor.x) < 1 && Math.abs(anchor.y) < 1;
    const x = width * (inView ? .5 + anchor.x * .5 : .5);
    const y = height * (inView ? .5 - anchor.y * .5 : .5);
    const offset = clamp(width * .055, 25, 58);
    const right = x + offset < width - 72;
    const left = clamp(right ? x + offset : x - offset, 12, width - 12);
    const top = clamp(y - 16, 16, height - 44);
    number.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px) translateX(${right ? 0 : -100}%)`;
  };
}
