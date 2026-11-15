// The player: first-person controller with acceleration, crouching and
// map collision, plus the shooting model — spread and recoil punish firing
// on the move, headshots pay, and stopping to aim is the winning move.

import * as THREE from 'three';
import { collideCircle } from './world.js';
import { WEAPONS, damageAt, ARMOR_ABSORB } from './weapons.js';
import { sfx } from './audio.js';

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.05;
export const RADIUS = 0.38;
const WALK_SPEED = 4.4;
const CROUCH_SPEED = 2.1;
const ACCEL = 42;
const FRICTION = 10;

export class Player {
  constructor(scene, effects, onShot) {
    this.scene = scene;
    this.effects = effects;
    this.onShot = onShot; // (shooter, origin, dir, def) => hit resolution
    this.pos = new THREE.Vector3(-27, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = -Math.PI / 2; // facing east, down mid
    this.pitch = 0;
    this.crouching = false;
    this.health = 100;
    this.armor = 0;
    this.money = 800;
    this.alive = true;
    this.team = 'falcon';
    this.name = 'You';
    this.kills = 0;
    this.deaths = 0;
    // weapon state
    this.weapons = { p9: { mag: 12, reserve: 72 } };
    this.current = 'p9';
    this.grenades = 0;
    this.reloading = false;
    this.reloadEnd = 0;
    this.nextShot = 0;
    this.bloom = 0;          // spread growth from sustained fire
    this.recoilPitch = 0;    // accumulated kick, recovered over time
    this.moving = false;
    this.lastDamageFrom = null;
    this.lastDamageAt = 0;
    // view model: a simple gun built from boxes, attached to the camera
    this.viewModel = buildViewModel();
    this.flashAnchor = new THREE.Object3D();
    this.flashAnchor.position.set(0.28, -0.22, -0.9);
    this.viewModel.add(this.flashAnchor);
  }

  get def() { return WEAPONS[this.current]; }
  get ammo() { return this.weapons[this.current]; }
  get eyeHeight() { return this.crouching ? EYE_CROUCH : EYE_STAND; }
  eyePos(out) {
    out.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
    return out;
  }

  reset(spawn) {
    this.pos.set(spawn[0], 0, spawn[1]);
    this.vel.set(0, 0, 0);
    this.yaw = spawn[0] < 0 ? -Math.PI / 2 : Math.PI / 2;
    this.pitch = 0;
    this.health = 100;
    this.alive = true;
    this.reloading = false;
    this.bloom = 0;
    this.recoilPitch = 0;
    // keep weapons bought between rounds; refill reserve on round start
    for (const id of Object.keys(this.weapons)) {
      const def = WEAPONS[id];
      this.weapons[id].reserve = def.reserve;
      this.weapons[id].mag = def.mag;
    }
  }

  giveWeapon(id) {
    const def = WEAPONS[id];
    if (!def) return false;
    if (id === 'frag') { this.grenades += 1; return true; }
    if (!this.weapons[id]) this.weapons[id] = { mag: def.mag, reserve: def.reserve };
    this.current = id;
    return true;
  }

  buy(id) {
    const def = WEAPONS[id];
    if (!def || this.money < def.price) return false;
    if (id !== 'frag' && this.weapons[id]) return false; // already owned
    this.money -= def.price;
    this.giveWeapon(id);
    return true;
  }

  buyArmor() {
    if (this.armor >= 100 || this.money < 650) return false;
    this.money -= 650;
    this.armor = 100;
    return true;
  }

  switchWeapon(id) {
    if (this.weapons[id] && id !== this.current) {
      this.current = id;
      this.reloading = false;
      return true;
    }
    return false;
  }

  // --- movement: fixed step, acceleration + friction, per-axis collision ---
  step(dt, input, now) {
    if (!this.alive) return;
    const speed = this.crouching ? CROUCH_SPEED : WALK_SPEED;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const wish = new THREE.Vector3();
    if (input.forward) wish.add(fwd);
    if (input.back) wish.sub(fwd);
    if (input.right) wish.add(right);
    if (input.left) wish.sub(right);
    // Touch joystick: analog — push up is forward, magnitude sets speed.
    if (input.joyX || input.joyY) {
      wish.addScaledVector(fwd, -input.joyY);
      wish.addScaledVector(right, input.joyX);
    }
    this.moving = wish.lengthSq() > 0;
    if (this.moving) {
      const mag = Math.min(1, wish.length());
      wish.normalize().multiplyScalar(speed * mag);
      this.vel.x += (wish.x - this.vel.x) * Math.min(1, ACCEL * dt / speed * 4);
      this.vel.z += (wish.z - this.vel.z) * Math.min(1, ACCEL * dt / speed * 4);
    } else {
      const f = Math.max(0, 1 - FRICTION * dt);
      this.vel.x *= f;
      this.vel.z *= f;
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    collideCircle(this.pos, RADIUS, this.eyeHeight);
    // recoil recovery and bloom decay
    this.recoilPitch *= Math.max(0, 1 - 6 * dt);
    this.bloom = Math.max(0, this.bloom - dt * 0.05);
    if (this.reloading && now >= this.reloadEnd) {
      const def = this.def;
      const need = def.mag - this.ammo.mag;
      const take = Math.min(need, this.ammo.reserve);
      this.ammo.mag += take;
      this.ammo.reserve -= take;
      this.reloading = false;
    }
  }

  currentSpread() {
    const def = this.def;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const moveFactor = Math.min(1, speed / WALK_SPEED);
    let s = def.spread + def.moveSpread * moveFactor + this.bloom;
    if (this.crouching) s *= 0.7;
    return s;
  }

  canShoot(now) {
    return this.alive && !this.reloading && now >= this.nextShot;
  }

  shoot(now) {
    if (!this.canShoot(now)) return false;
    const def = this.def;
    const ammo = this.ammo;
    if (ammo.mag <= 0) {
      sfx.dryFire();
      this.nextShot = now + 0.25;
      return false;
    }
    ammo.mag -= 1;
    this.nextShot = now + 60 / def.rpm;
    this.bloom = Math.min(0.05, this.bloom + def.recoil * 0.35);
    this.recoilPitch += def.recoil;
    const spread = this.currentSpread();
    const pellets = def.pellets || 1;
    const origin = this.eyePos(new THREE.Vector3());
    const baseDir = new THREE.Vector3();
    this.camera.getWorldDirection(baseDir);
    baseDir.y += this.recoilPitch * 0.4;
    for (let p = 0; p < pellets; p++) {
      const dir = baseDir.clone();
      dir.x += (Math.random() - 0.5) * 2 * spread;
      dir.y += (Math.random() - 0.5) * 2 * spread;
      dir.z += (Math.random() - 0.5) * 2 * spread;
      dir.normalize();
      this.onShot(this, origin, dir, def);
    }
    sfx.shot(def.kind);
    const flashPos = new THREE.Vector3();
    this.flashAnchor.getWorldPosition(flashPos);
    this.effects.muzzle(flashPos, baseDir);
    return true;
  }

  startReload(now) {
    const def = this.def;
    if (this.reloading || this.ammo.mag >= def.mag || this.ammo.reserve <= 0) return false;
    this.reloading = true;
    this.reloadEnd = now + def.reloadTime;
    sfx.reload();
    return true;
  }

  throwGrenade(now, spawnGrenade) {
    if (this.grenades <= 0 || !this.alive) return false;
    this.grenades -= 1;
    const origin = this.eyePos(new THREE.Vector3());
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    spawnGrenade(this, origin, dir);
    return true;
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
    this.lastDamageFrom = from;
    this.lastDamageAt = now;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.deaths += 1;
    }
    return remaining;
  }
}

// A low-poly gun view model: receiver, barrel, grip, sight. No textures.
function buildViewModel() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.5, metalness: 0.6 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xf0a830, roughness: 0.5, metalness: 0.4 });
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.55), dark);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.42), dark);
  barrel.position.set(0, 0.03, -0.45);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.1), dark);
  grip.position.set(0, -0.15, 0.16);
  grip.rotation.x = 0.35;
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.12), accent);
  mag.position.set(0, -0.15, -0.05);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.03), accent);
  sight.position.set(0, 0.1, -0.1);
  g.add(receiver, barrel, grip, mag, sight);
  g.position.set(0.28, -0.24, -0.55);
  return g;
}
