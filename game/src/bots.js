// Bots: five per team. Each bot follows the waypoint graph, holds angles,
// pushes a site, plants or defuses the spike, and shoots back with a
// reaction time and aim error that reward the player for peeking well.
// Bots hear nearby gunfire and converge on it; the spike carrier heads for
// the site its team chose at round start.

import * as THREE from 'three';
import { WAYPOINTS, EDGES, collideCircle, hasLineOfSight, SITES } from './world.js';
import { WEAPONS, damageAt, ARMOR_ABSORB } from './weapons.js';
import { sfx } from './audio.js';
import { PALETTE, box } from './palette.js';

const ADJ = new Map();
for (const [a, b] of EDGES) {
  if (!ADJ.has(a)) ADJ.set(a, []);
  if (!ADJ.has(b)) ADJ.set(b, []);
  ADJ.get(a).push(b);
  ADJ.get(b).push(a);
}

export function nearestWaypoint(x, z) {
  let best = 0; let bd = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i++) {
    const dx = WAYPOINTS[i][1] - x; const dz = WAYPOINTS[i][2] - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// Breadth-first path on the waypoint graph.
export function findPath(from, to) {
  if (from === to) return [to];
  const prev = new Map([[from, -1]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const nb of ADJ.get(cur) ?? []) {
      if (prev.has(nb)) continue;
      prev.set(nb, cur);
      if (nb === to) {
        const path = [to];
        let n = to;
        while (prev.get(n) !== -1) { n = prev.get(n); path.unshift(n); }
        return path;
      }
      queue.push(nb);
    }
  }
  return [to];
}

const BOT_NAMES = {
  falcon: ['Juno', 'Mara', 'Ibis', 'Kip'],
  viper: ['Rook', 'Vex', 'Hale', 'Onyx', 'Dusk'],
};

let botSeq = 0;

export class Bot {
  constructor(scene, effects, team, index, onShot) {
    this.id = botSeq++;
    this.team = team;
    this.name = BOT_NAMES[team][index % BOT_NAMES[team].length];
    this.scene = scene;
    this.effects = effects;
    this.onShot = onShot;
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.health = 100;
    this.armor = 0;
    this.alive = true;
    this.kills = 0;
    this.deaths = 0;
    this.money = 800;
    this.weaponId = 'p9';
    this.ammo = { mag: 12, reserve: 36 };
    this.nextShot = 0;
    this.reloading = false;
    this.reloadEnd = 0;
    this.bloom = 0;
    // AI state
    this.state = 'idle';       // idle | move | hold | plant | defuse
    this.mission = null;       // 'plant' | 'defuse' | null — survives movement
    this.path = [];
    this.pathIdx = 0;
    this.holdUntil = 0;
    this.target = null;        // current enemy (player or bot)
    this.seenAt = 0;           // when the target was last visible
    this.aimError = 0.05;      // grows with distance, shrinks while aiming
    this.reactAt = 0;          // earliest time it may fire after spotting
    this.plantProgress = 0;
    this.defuseProgress = 0;
    this.carrier = false;      // carries the spike
    this.heardAt = 0;
    this.heardPos = null;
    this.stuckAt = 0;
    this.lastPos = new THREE.Vector3();
    this.group = buildBotMesh(team);
    scene.add(this.group);
  }

  get def() { return WEAPONS[this.weaponId]; }

  eyePos(out) {
    out.set(this.pos.x, this.pos.y + 1.5, this.pos.z);
    return out;
  }

  reset(spawn, weaponId) {
    this.pos.set(spawn[0], 0, spawn[1]);
    this.vel.set(0, 0, 0);
    this.yaw = spawn[0] < 0 ? -Math.PI / 2 : Math.PI / 2;
    this.health = 100;
    this.alive = true;
    this.weaponId = weaponId;
    const def = WEAPONS[weaponId];
    this.ammo = { mag: def.mag, reserve: def.reserve };
    this.state = 'idle';
    this.mission = null;
    this.path = [];
    this.target = null;
    this.plantProgress = 0;
    this.defuseProgress = 0;
    this.reloading = false;
    this.group.visible = true;
    this.syncMesh();
  }

  buyWeapon() {
    // Bots spend like players: rifle when rich, SMG mid, pistol when broke.
    const pick = this.money >= 2700 ? 'ar7' : this.money >= 1200 ? 'vk9' : 'p9';
    const def = WEAPONS[pick];
    if (this.money >= def.price) {
      this.money -= def.price;
      this.weaponId = pick;
    } else this.weaponId = 'p9';
    if (this.money >= 650 && Math.random() < 0.5) { this.money -= 650; this.armor = 100; }
    else this.armor = 0;
  }

  setDestination(wp) {
    const from = nearestWaypoint(this.pos.x, this.pos.z);
    this.path = findPath(from, wp);
    this.pathIdx = 0;
    this.state = 'move';
  }

  takeDamage(amount, from, now) {
    if (!this.alive) return 0;
    let remaining = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, remaining * ARMOR_ABSORB);
      this.armor -= absorbed;
      remaining -= absorbed;
    }
    this.health -= remaining;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.deaths += 1;
      this.group.visible = false;
    }
    return remaining;
  }

  hear(pos, now) {
    this.heardAt = now;
    this.heardPos = pos;
  }

  // --- per-tick AI ---
  update(dt, now, ctx) {
    if (!this.alive) return;
    const { player, bots, spike, round } = ctx;
    // find nearest visible enemy
    const enemy = this.acquireTarget(player, bots, now);
    if (enemy) {
      this.target = enemy;
      if (this.seenAt === 0) this.reactAt = now + 0.35 + Math.random() * 0.35;
      this.seenAt = now;
      this.aimError = Math.max(0.008, this.aimError - dt * 0.05);
    } else {
      if (this.target && now - this.seenAt > 1.2) this.target = null;
      this.aimError = Math.min(0.07, this.aimError + dt * 0.03);
    }

    if (this.target) this.engage(dt, now, ctx);
    else this.navigate(dt, now, ctx);

    if (this.reloading && now >= this.reloadEnd) {
      const def = this.def;
      const need = def.mag - this.ammo.mag;
      const take = Math.min(need, this.ammo.reserve);
      this.ammo.mag += take;
      this.ammo.reserve -= take;
      this.reloading = false;
    }
    this.bloom = Math.max(0, this.bloom - dt * 0.05);
    this.syncMesh();
  }

  acquireTarget(player, bots, now) {
    const eye = this.eyePos(new THREE.Vector3());
    let best = null; let bd = Infinity;
    const candidates = [];
    if (player.alive && player.team !== this.team) candidates.push(player);
    for (const b of bots) if (b.alive && b.team !== this.team) candidates.push(b);
    for (const c of candidates) {
      const cEye = c.eyePos ? c.eyePos(new THREE.Vector3()) : new THREE.Vector3(c.pos.x, c.pos.y + 1.2, c.pos.z);
      const d = eye.distanceTo(cEye);
      if (d > 32) continue; // beyond this, bots do not spot each other: they push, then fight
      // field of view: only what is roughly ahead of the bot
      const dx = cEye.x - eye.x; const dz = cEye.z - eye.z;
      const ang = Math.atan2(-dx, -dz);
      let diff = ang - this.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > 1.35) continue;
      if (!hasLineOfSight(eye, cEye)) continue;
      // closer enemies are spotted first; crouched ones harder to see
      const spot = d * (c.crouching ? 1.25 : 1);
      if (spot < bd) { bd = spot; best = c; }
    }
    return best;
  }

  engage(dt, now, ctx) {
    const t = this.target;
    const tPos = t.pos.clone();
    tPos.y += t.crouching ? 1.0 : 1.35;
    // face the target, with aim error
    const dx = tPos.x - this.pos.x;
    const dz = tPos.z - this.pos.z;
    const wantYaw = Math.atan2(-dx, -dz);
    this.yaw = turnToward(this.yaw, wantYaw, dt * 6);
    this.pitch = THREE.MathUtils.clamp(Math.atan2(tPos.y - (this.pos.y + 1.5), Math.hypot(dx, dz)), -0.6, 0.6);
    // far off? keep pushing along the mission path while facing the enemy
    const dist = Math.hypot(dx, dz);
    if (dist > 18) {
      if (!this.path.length || this.pathIdx >= this.path.length) {
        this.setDestination(nearestWaypoint(tPos.x, tPos.z));
      } else {
        const savedYaw = this.yaw;
        this.moveAlongPath(dt, now);
        this.yaw = savedYaw;
      }
    }
    if (now < this.reactAt) return;
    if (this.reloading) return;
    if (this.ammo.mag <= 0) {
      this.startReload(now);
      return;
    }
    const def = this.def;
    if (now < this.nextShot) return;
    this.nextShot = now + 60 / def.rpm * (1.0 + Math.random() * 0.35);
    // burst discipline: rifles fire in short bursts
    if (def.auto && Math.random() < 0.3) this.nextShot += 0.2;
    this.ammo.mag -= 1;
    this.bloom = Math.min(0.05, this.bloom + def.recoil * 0.4);
    const origin = this.eyePos(new THREE.Vector3());
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const err = this.aimError + this.bloom + (def.spread * 1.4);
    const distErr = Math.min(0.05, dist * 0.0008);
    dir.x += (Math.random() - 0.5) * 2 * (err + distErr);
    dir.y += (Math.random() - 0.5) * 2 * (err + distErr);
    dir.z += (Math.random() - 0.5) * 2 * (err + distErr);
    dir.normalize();
    this.onShot(this, origin, dir, def);
    if (dist < 40) sfx.distantShot();
  }

  navigate(dt, now, ctx) {
    const { spike, round } = ctx;
    if (this.state === 'idle') {
      // rotate to a fresh position instead of standing still all round
      if (Math.random() < dt * 0.2) this.setDestination(Math.floor(Math.random() * WAYPOINTS.length));
      return;
    }
    if (this.state === 'hold') {
      if (now >= this.holdUntil) this.state = 'idle';
      return;
    }
    if (this.state === 'plant') {
      // stand on the site and plant
      const site = SITES[round.site];
      const d = Math.hypot(this.pos.x - site.x, this.pos.z - site.z);
      if (d > site.r * 0.8) {
        if (!this.path.length || this.pathIdx >= this.path.length) this.setDestination(nearestWaypoint(site.x, site.z));
        else this.moveAlongPath(dt, now);
        return;
      }
      this.plantProgress += dt / 3.2;
      if (this.plantProgress >= 1) {
        ctx.onPlanted(this);
        this.mission = null;
        this.state = 'hold';
        this.holdUntil = now + 4;
      }
      return;
    }
    if (this.state === 'defuse') {
      const d = Math.hypot(this.pos.x - spike.x, this.pos.z - spike.z);
      if (d > 1.6) {
        if (!this.path.length || this.pathIdx >= this.path.length) this.setDestination(nearestWaypoint(spike.x, spike.z));
        else this.moveAlongPath(dt, now);
        return;
      }
      this.defuseProgress += dt / 4.5;
      if (this.defuseProgress >= 1) ctx.onDefused(this);
      return;
    }
    if (this.state === 'move') this.moveAlongPath(dt, now);
  }

  moveAlongPath(dt, now) {
    if (!this.path.length) { this.state = 'idle'; return; }
    const wp = WAYPOINTS[this.path[this.pathIdx]];
    if (!wp) { this.state = 'idle'; return; }
    const dx = wp[1] - this.pos.x;
    const dz = wp[2] - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.8) {
      this.pathIdx++;
      if (this.pathIdx >= this.path.length) {
        if (this.mission === 'plant') { this.state = 'plant'; return; }
        if (this.mission === 'defuse') { this.state = 'defuse'; return; }
        this.state = 'idle';
        // hold the angle briefly, then pick a new spot
        if (Math.random() < 0.35) { this.state = 'hold'; this.holdUntil = now + 1 + Math.random() * 1.5; }
      }
      return;
    }
    const wantYaw = Math.atan2(-dx, -dz);
    this.yaw = turnToward(this.yaw, wantYaw, dt * 8);
    const speed = 4.2;
    this.vel.set(-Math.sin(this.yaw) * speed, 0, -Math.cos(this.yaw) * speed);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    collideCircle(this.pos, 0.38, 1.7);
    // stuck detection: no progress in 2 s -> pick a new waypoint
    if (this.pos.distanceToSquared(this.lastPos) < 0.04) {
      if (this.stuckAt === 0) this.stuckAt = now;
      else if (now - this.stuckAt > 2) {
        this.stuckAt = 0;
        this.setDestination(Math.floor(Math.random() * WAYPOINTS.length));
      }
    } else { this.stuckAt = 0; this.lastPos.copy(this.pos); }
  }

  startReload(now) {
    if (this.reloading || this.ammo.mag >= this.def.mag || this.ammo.reserve <= 0) return;
    this.reloading = true;
    this.reloadEnd = now + this.def.reloadTime;
  }

  syncMesh() {
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.group.rotation.y = this.yaw + Math.PI;
    // walk bob
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const bob = Math.sin(performance.now() * 0.012) * 0.04 * Math.min(1, speed / 3);
    this.group.children[0].position.y = 0.95 + bob;
  }
}

function turnToward(cur, want, maxStep) {
  let d = want - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + THREE.MathUtils.clamp(d, -maxStep, maxStep);
}

// A bot is a stylised agent: torso, head with visor, gun barrel, team ring.
function buildBotMesh(team) {
  const g = new THREE.Group();
  const teamColor = team === 'falcon' ? PALETTE.falcon : PALETTE.viper;
  const body = box(0.62, 0.95, 0.34, 0x2c2f36, { roughness: 0.8 });
  body.position.y = 0.95;
  const vest = box(0.66, 0.5, 0.38, teamColor, { roughness: 0.6 });
  vest.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), new THREE.MeshStandardMaterial({ color: 0xd8c9a8, roughness: 0.7 }));
  head.position.y = 1.62;
  head.castShadow = true;
  head.userData.botPart = 'head';
  const visor = box(0.3, 0.08, 0.05, teamColor, { roughness: 0.3, metalness: 0.4 });
  visor.position.set(0, 1.64, -0.18);
  const gun = box(0.07, 0.09, 0.85, 0x1c1e22, { roughness: 0.5, metalness: 0.5 });
  gun.position.set(0.18, 1.15, -0.4);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 24), new THREE.MeshBasicMaterial({ color: teamColor, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  for (const m of [body, vest, head, visor, gun]) m.userData.botPart = m === head ? 'head' : 'body';
  g.add(body, vest, head, visor, gun, ring);
  g.userData.isBot = true;
  return g;
}
