import { Vector3 } from 'three';
import { clamp, smoothstep } from './math.js';

const GRAVITY = 9.81;
const frameLinks = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];

export class SkierRagdoll {
  constructor(pose, velocity, normal, spinVelocity, flipVelocity, impact, snowGrip) {
    this.points = pose.points;
    this.runners = pose.runners;
    this.snowGrip = clamp(snowGrip, .23, 1.15);
    this.shift = new Vector3();
    this.delta = new Vector3();
    this.pelvis = this.points.pelvis.at;
    this.nodes = Object.values(this.points);
    const speed = Math.hypot(velocity.x, velocity.z);
    const motion = velocity.clone().addScaledVector(normal, impact * 1.11);
    motion.multiplyScalar(.78);
    const tumble = new Vector3(velocity.z, 0, -velocity.x);
    if (tumble.lengthSq() < .04) {
      tumble.subVectors(this.points.hip1.at, this.points.hip0.at);
      tumble.y = 0;
    }
    tumble.normalize().multiplyScalar(2.5 + Math.min(4, speed * .16 + impact * .15) + flipVelocity * .40)
      .addScaledVector(normal, spinVelocity * .55 + .55);

    for (const [name, point] of Object.entries(this.points)) {
      const reach = this.shift.subVectors(point.at, this.pelvis);
      const kick = name.startsWith('wrist') ? 1.32 : name.startsWith('foot') ? .71 : 1;
      point.velocity = new Vector3().crossVectors(tumble, reach).multiplyScalar(kick).add(motion);
      point.before = point.at.clone();
    }

    this.links = pose.links.map(([a, b, stiffness = 1]) => this.link(a, b, stiffness));
    for (const frame of pose.frames) {
      for (const [a, b] of frameLinks) this.links.push(this.link(frame[a], frame[b], 1));
    }
  }

  link(a, b, stiffness) {
    const first = this.points[a], second = this.points[b];
    return { first, second, length: first.at.distanceTo(second.at), stiffness };
  }

  solve(heightAt) {
    for (const { first, second, length, stiffness } of this.links) {
      const d = this.delta.subVectors(second.at, first.at);
      const distance = d.length();
      if (distance < 1e-5) continue;
      d.multiplyScalar((1 - length / distance) * stiffness / (first.weight + second.weight));
      first.at.addScaledVector(d, first.weight);
      second.at.addScaledVector(d, -second.weight);
    }
    for (const point of this.nodes) {
      const floor = heightAt(point.at.x, point.at.z) + point.radius;
      point.touching ||= point.at.y <= floor;
      point.at.y = Math.max(floor, point.at.y);
    }
  }

  step(dt, heightAt) {
    for (const point of this.nodes) {
      point.before.copy(point.at);
      point.touching = false;
      point.velocity.y -= GRAVITY * dt;
      point.at.addScaledVector(point.velocity, dt);
    }
    for (let pass = 0; pass < 8; pass++) this.solve(heightAt);
    let motion = 0;
    for (const point of this.nodes) {
      const oldY = point.velocity.y;
      point.velocity.subVectors(point.at, point.before).divideScalar(dt);
      if (point.touching) {
        // Lose tangential speed at body contacts and absorb nearly all bounce.
        point.velocity.multiplyScalar(Math.exp(-dt * (3 + this.snowGrip * 11)));
        const rebound = oldY < -2.2 ? -oldY * .11 : Math.max(0, oldY) * .55;
        point.velocity.y = Math.min(point.velocity.y, rebound);
      } else point.velocity.multiplyScalar(Math.exp(-.28 * dt));
      motion += point.velocity.lengthSq();
    }
    return Math.sqrt(motion / this.nodes.length);
  }

  beginRecovery(target) {
    for (const [name, point] of Object.entries(this.points)) {
      point.before.copy(point.at);
      point.target = target.points[name].at;
    }
  }

  recoverToward(progress, heightAt) {
    const t = smoothstep(0, 1, progress);
    for (const point of this.nodes) {
      point.at.copy(point.before).lerp(point.target, t);
      point.touching = false;
    }
    if (progress < 1) for (let pass = 0; pass < 7; pass++) this.solve(heightAt);
  }
}
