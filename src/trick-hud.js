import { Vector3 } from 'three';
import { clamp, formatNumber } from './util.js';
import { flipLabel, flipPoints, spinPoints } from './trick-combo.js';

const labels = { air: 'In the air', banked: 'Banked', bailed: 'Bailed' };

export function createTrickHud(panel, announcement) {
  const [state, score, multiplier, bonus] = panel.querySelectorAll('[data-trick-value]');
  const [scratchedSpin, spin, flip, grab, air] = panel.querySelectorAll('[data-trick-row]');
  const anchor = new Vector3();

  function text(node, value) {
    if (node.textContent !== value) node.textContent = value;
  }

  function row(node, label, points) {
    node.hidden = points === 0;
    if (points === 0) return;
    text(node.firstElementChild, label);
    text(node.lastElementChild, `+${formatNumber(points)}`);
  }

  return function updateTrickHud(player, camera, active) {
    const combo = player.trickCombo;
    const inAir = combo.phase === 'air';
    const visible = active && (inAir ? combo.multiplier > 1 : combo.resultTime > 0);
    panel.hidden = !visible;
    if (!visible) {
      if (active) text(announcement, '');
      return;
    }

    const phase = combo.phase;
    const banked = phase === 'banked';
    const bailed = phase === 'bailed';
    panel.dataset.state = phase;
    text(state, labels[phase]);
    text(score, `${banked ? '+' : ''}${formatNumber(combo.points)}`);
    text(multiplier, `${combo.multiplier}×`);
    bonus.hidden = combo.bonus === 1;
    if (!bonus.hidden) text(bonus, `${combo.bonus}× bonus`);
    row(scratchedSpin, `${combo.scratchedSpin}° spin`, combo.scratchTime > 0 ? spinPoints(combo.scratchedSpin) : 0);
    row(spin, `${combo.spin}° spin`, spinPoints(combo.spin));
    row(flip, flipLabel(combo.flips, combo.backflip), flipPoints(combo.flips));
    row(grab, 'Mute grab', combo.grabPoints);
    row(air, combo.multiplier === 1 ? 'Clean air' : 'Air time', combo.airPoints);
    text(announcement, banked ? `Banked ${formatNumber(combo.points)} trick points`
      : bailed ? `Bailed. Lost ${formatNumber(combo.points)} unbanked trick points` : '');

    const width = window.innerWidth;
    const height = window.innerHeight;
    const panelWidth = clamp(width * .38, 126, 176);
    const offset = clamp(width * .08, 24, 42);
    // Track the skier's torso in chase view and keep the score just off center in helmet view.
    camera.updateMatrixWorld();
    anchor.copy(player.pos).y += 1.15;
    anchor.project(camera);
    const anchored = player.cameraMode !== 2 && Math.abs(anchor.x) < 1 && Math.abs(anchor.y) < 1
      && anchor.z > -1 && anchor.z < 1;
    const x = anchored ? (anchor.x * .5 + .5) * width : width / 2;
    const y = anchored ? (.5 - anchor.y * .5) * height : height * .5;
    const side = x + offset + panelWidth <= width - 12 ? x + offset : x - offset - panelWidth;
    const left = clamp(side, 12, Math.max(12, width - panelWidth - 12));
    const top = clamp(y - 38, 62, Math.max(62, height - 178));
    panel.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  };
}
