const halfTurn = Math.PI;
const fullTurn = 2 * halfTurn;
const landingTolerance = Math.PI / 12;
const grabThreshold = .22;
export const minimumScoringAir = .42;

export class TrickCombo {
  constructor() {
    this.reset();
  }

  reset() {
    this.phase = 'idle';
    this.spin = 0;
    this.flips = 0;
    this.backflip = false;
    this.grabPoints = 0;
    this.airPoints = 0;
    this.points = 0;
    this.multiplier = 1;
    this.bonus = 1;
    this.previousPoints = 0;
    this.scratchTime = 0;
    this.resultTime = 0;
  }

  begin() {
    this.reset();
    this.phase = 'air';
  }

  advance(dt) {
    this.scratchTime = Math.max(0, this.scratchTime - dt);
    this.resultTime = Math.max(0, this.resultTime - dt);
  }

  update({ spin, flip, grabTime, airTime }, bonus = 1, landing = false) {
    if (this.phase !== 'air') return;
    const tolerance = landing ? landingTolerance : 0;
    const nextSpin = Math.floor((Math.abs(spin) + tolerance) / halfTurn) * 180;
    if (this.spin && nextSpin > this.spin) {
      this.previousPoints = this.points;
      this.scratchTime = .16;
    }
    this.spin = nextSpin;
    this.flips = Math.floor((Math.abs(flip) + tolerance) / fullTurn);
    this.backflip = flip < 0;
    this.grabPoints = grabTime >= grabThreshold ? Math.round(grabTime * 95) : 0;
    this.airPoints = Math.round(airTime * 72);
    this.multiplier = 1 + Number(this.spin > 0) + this.flips + Number(this.grabPoints > 0);
    this.bonus = bonus;
    const base = this.airPoints + spinPoints(this.spin) + flipPoints(this.flips) + this.grabPoints;
    this.points = Math.round(base * this.multiplier * this.bonus);
  }

  bank(pose, bonus) {
    if (this.phase !== 'air') return 0;
    if (pose.airTime <= minimumScoringAir) {
      this.reset();
      return 0;
    }
    this.update(pose, bonus, true);
    this.phase = 'banked';
    this.resultTime = 1.65;
    return this.points;
  }

  bail() {
    if (this.phase !== 'air') return;
    if (this.points === 0) {
      this.reset();
      return;
    }
    this.phase = 'bailed';
    this.scratchTime = 0;
    this.resultTime = 1.65;
  }
}

export function spinPoints(degrees) {
  return degrees / 180 * 95;
}

export function flipPoints(count) {
  return count * 320;
}

export function flipLabel(count, backflip) {
  const direction = backflip ? 'Backflip' : 'Frontflip';
  return count > 1 ? `${count} ${direction.toLowerCase()}s` : direction;
}
