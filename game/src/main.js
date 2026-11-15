// Kestrel Yard — bootstrap, input and the fixed-step game loop.
// The simulation steps at 60 Hz, apart from rendering, and allocates
// nothing in the hot loop: raycaster, vectors and timers are reused.

import * as THREE from 'three';
import { buildWorld, SITES, SPAWNS, hasLineOfSight, WAYPOINTS } from './world.js';
import { Player, EYE_STAND } from './player.js';
import { Bot, nearestWaypoint } from './bots.js';
import { Game, PHASE } from './game.js';
import { HUD } from './hud.js';
import { Effects } from './effects.js';
import { WEAPONS, BUY_ORDER, ARMOR_PRICE, damageAt } from './weapons.js';
import { ensureAudio, sfx } from './audio.js';
import { PALETTE } from './palette.js';

const params = new URLSearchParams(location.search);
const DEMO = params.get('demo') === '1';
const WARMUP = Number(params.get('warmup') || 0);

// ---- renderer / scene ----
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(PALETTE.fog, 30, 95);

const camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.08, 200);
camera.rotation.order = 'YXZ';
scene.add(camera);

const sun = new THREE.DirectionalLight(0xffd9a0, 3.0);
sun.position.set(18, 26, -12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
sun.shadow.camera.far = 80;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xa8bdd0, 0x5a5044, 1.5));
// small fill light on the camera so the view-model gun never goes black
const fill = new THREE.PointLight(0xfff2d8, 1.2, 4, 1.5);
fill.position.set(0.3, 0.2, 0.3);
camera.add(fill);

// ---- world, effects, entities ----
buildWorld(scene);
const effects = new Effects(scene);
const hud = new HUD();
const player = new Player(scene, effects, resolveShot);
player.camera = camera;
camera.add(player.viewModel);

const bots = [];
for (let i = 0; i < 4; i++) {
  const b = new Bot(scene, effects, 'falcon', i, resolveShot);
  b.group.traverse((m) => { m.userData.botRef = b; });
  bots.push(b);
}
for (let i = 0; i < 5; i++) {
  const b = new Bot(scene, effects, 'viper', i, resolveShot);
  b.group.traverse((m) => { m.userData.botRef = b; });
  bots.push(b);
}

const game = new Game(player, bots, hud, {
  onGrenade: (shooter, pos, damage, radius, except) => explode(pos, damage, radius, except),
});
game.demo = DEMO;

// ---- shooting: one raycast, nearest hit wins (bot body, head, or wall) ----
const raycaster = new THREE.Raycaster();
const shootTargets = [];
scene.traverse((o) => {
  if (o.isMesh && (o.userData.solid || o.userData.botRef)) shootTargets.push(o);
});
// keep the list fresh as bots die (visibility toggles, meshes stay)
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpV3 = new THREE.Vector3();

function resolveShot(shooter, origin, dir, def) {
  raycaster.set(origin, dir);
  raycaster.far = def.range + 20;
  const hits = raycaster.intersectObjects(shootTargets, false);
  let end = tmpV.copy(origin).addScaledVector(dir, def.range + 20);
  let endPoint = end;
  for (const hit of hits) {
    const obj = hit.object;
    if (obj.userData.botRef) {
      const bot = obj.userData.botRef;
      if (!bot.alive || bot === shooter) continue;
      if (bot.team === shooter.team) continue; // no friendly fire: shots pass teammates
      const head = obj.userData.botPart === 'head';
      const dmg = damageAt(def, hit.distance, head);
      const dealt = bot.takeDamage(dmg, shooter, nowSec);
      endPoint = hit.point;
      effects.tracer(origin, hit.point, def.tracer);
      if (shooter === player) {
        hud.hit(head);
        if (head) sfx.headshot(); else sfx.hit();
      }
      if (!bot.alive) game.onKill(bot, shooter);
      return;
    }
    if (obj.userData.solid) {
      endPoint = hit.point;
      effects.tracer(origin, hit.point, def.tracer);
      effects.impact(hit.point, hit.face ? hit.face.normal : new THREE.Vector3(0, 1, 0));
      return;
    }
  }
  effects.tracer(origin, endPoint, def.tracer);
}

// ---- grenades ----
const grenades = [];
const grenadeMesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.09, 10, 8),
  new THREE.MeshStandardMaterial({ color: 0x2e7a2e, roughness: 0.5, metalness: 0.4 }),
);
function spawnGrenade(shooter, origin, dir) {
  const mesh = grenadeMesh.clone();
  mesh.position.copy(origin);
  scene.add(mesh);
  grenades.push({
    mesh, vel: dir.clone().multiplyScalar(16).add(new THREE.Vector3(0, 4.5, 0)),
    fuse: 1.7, shooter,
  });
  sfx.shot('pistol');
}

function explode(pos, damage, radius, except) {
  effects.explosion(pos);
  sfx.explosion();
  const victims = [player, ...bots];
  for (const v of victims) {
    if (!v.alive || v === except) continue;
    const d = Math.hypot(v.pos.x - pos.x, v.pos.z - pos.z);
    if (d > radius) continue;
    const dmg = damage * (1 - d / radius * 0.7);
    const dealt = v.takeDamage(dmg, except, nowSec);
    if (v === player) sfx.hurt();
    if (!v.alive) game.onKill(v, except);
  }
}

function updateGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i];
    g.fuse -= dt;
    g.vel.y -= 14 * dt;
    g.mesh.position.addScaledVector(g.vel, dt);
    if (g.mesh.position.y < 0.09) { g.mesh.position.y = 0.09; g.vel.y = Math.abs(g.vel.y) * 0.45; g.vel.x *= 0.7; g.vel.z *= 0.7; }
    if (g.fuse <= 0) {
      explode(g.mesh.position.clone(), 110, 7, g.shooter);
      scene.remove(g.mesh);
      grenades.splice(i, 1);
    }
  }
}

// ---- input ----
const input = { forward: false, back: false, left: false, right: false, fire: false };
let pointerLocked = false;
let paused = false;

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  ensureAudio();
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': input.forward = true; break;
    case 'KeyS': case 'ArrowDown': input.back = true; break;
    case 'KeyA': case 'ArrowLeft': input.left = true; break;
    case 'KeyD': case 'ArrowRight': input.right = true; break;
    case 'ControlLeft': case 'KeyC': player.crouching = !player.crouching; break;
    case 'KeyR': player.startReload(nowSec); break;
    case 'KeyB': if (game.phase === PHASE.BUY) { hud.buyOpen ? hud.closeBuy() : hud.openBuy(player); } break;
    case 'KeyG': player.throwGrenade(nowSec, spawnGrenade); break;
    case 'KeyP': paused = !paused; hud.hint(paused ? 'Paused — press P to resume' : ''); break;
    case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5': case 'Digit6': {
      const id = BUY_ORDER[Number(e.code.slice(5)) - 1];
      if (game.phase === PHASE.BUY && hud.buyOpen) {
        if (player.buy(id)) sfx.buy(); else sfx.denied();
        hud.openBuy(player);
      } else if (id) player.switchWeapon(id);
      break;
    }
    case 'Digit7':
      if (game.phase === PHASE.BUY && hud.buyOpen) {
        if (player.buyArmor()) sfx.buy(); else sfx.denied();
        hud.openBuy(player);
      }
      break;
    case 'Enter':
      if (game.phase === PHASE.MATCH) { game.startMatch(); }
      else if (document.getElementById('menu').style.display !== 'none') startPlaying();
      break;
  }
});
addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': input.forward = false; break;
    case 'KeyS': case 'ArrowDown': input.back = false; break;
    case 'KeyA': case 'ArrowLeft': input.left = false; break;
    case 'KeyD': case 'ArrowRight': input.right = false; break;
  }
});
addEventListener('mousemove', (e) => {
  if (!pointerLocked || !player.alive || paused) return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch = THREE.MathUtils.clamp(player.pitch - e.movementY * 0.0022, -1.45, 1.45);
});
addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  ensureAudio();
  if (DEMO) return;
  if (!pointerLocked) { renderer.domElement.requestPointerLock(); return; }
  input.fire = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) input.fire = false; });
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// error trap: headless checks read this
window.addEventListener('error', (e) => {
  const el = document.getElementById('errlog');
  if (el) el.textContent += `${e.message} @ ${e.filename}:${e.lineno}\n`;
});

// ---- demo autopilot: plays the player so headless renders show real play ----
// It walks the waypoint graph toward the contested site (never straight
// through walls) and stops to shoot any enemy it can see within 30 m.
import { findPath } from './bots.js';
const autopilot = { path: [], pathIdx: 0, destAt: 0 };
function autopilotStep(dt, now) {
  if (!player.alive) return;
  // find a visible enemy
  const eye = player.eyePos(tmpV);
  let best = null; let bd = Infinity;
  for (const b of bots) {
    if (!b.alive || b.team === 'falcon') continue;
    const be = b.eyePos(tmpV2);
    const d = eye.distanceTo(be);
    if (d < 30 && d < bd && hasLineOfSight(eye, be)) { bd = d; best = b; }
  }
  if (best) {
    const bp = tmpV3.set(best.pos.x, best.pos.y + 1.3, best.pos.z);
    const dx = bp.x - player.pos.x;
    const dz = bp.z - player.pos.z;
    player.yaw = Math.atan2(-dx, -dz);
    player.pitch = THREE.MathUtils.clamp(Math.atan2(bp.y - eye.y, Math.hypot(dx, dz)), -0.5, 0.5);
    input.fire = true;
    input.forward = false;
  } else {
    input.fire = false;
    if (!autopilot.path.length || now > autopilot.destAt) {
      const siteWps = game.site === 'A' ? [10, 11, 12, 19] : [15, 16, 17, 21];
      const dest = siteWps[Math.floor(Math.random() * siteWps.length)];
      autopilot.path = findPath(nearestWaypoint(player.pos.x, player.pos.z), dest);
      autopilot.pathIdx = 0;
      autopilot.destAt = now + 15;
    }
    const wp = WAYPOINTS[autopilot.path[autopilot.pathIdx]];
    if (!wp) { autopilot.path = []; return; }
    const dx = wp[1] - player.pos.x;
    const dz = wp[2] - player.pos.z;
    if (Math.hypot(dx, dz) < 1.0) { autopilot.pathIdx++; return; }
    player.yaw = Math.atan2(-dx, -dz);
    input.forward = true;
  }
  if (player.ammo.mag === 0) player.startReload(now);
}

// ---- start / menu ----
function startPlaying() {
  hud.showMenu(false);
  game.startMatch();
  if (!DEMO) renderer.domElement.requestPointerLock();
  if (game.phase === PHASE.BUY) hud.openBuy(player);
}
document.getElementById('play-btn').addEventListener('click', () => { ensureAudio(); startPlaying(); });

// ---- fixed-step loop ----
let nowSec = 0;
let last = performance.now() / 1000;
let acc = 0;
const STEP = 1 / 60;
let frames = 0;

function step(dt) {
  nowSec += dt;
  game.update(dt, nowSec);
  if (game.phase === PHASE.BUY) {
    // Freeze time: the player can move and look around and buy, but the
    // bots hold at spawn — no walking to the site, no planting, no shooting.
    player.step(dt, input, nowSec);
  } else if (game.phase === PHASE.LIVE) {
    if (DEMO) autopilotStep(dt, nowSec);
    player.step(dt, input, nowSec);
    if (input.fire && player.def.auto) player.shoot(nowSec);
    else if (input.fire && !player.def.auto) {
      // semi-auto: holding the trigger re-fires a few times a second
      if (!player._semiFired || nowSec - (player._semiAt || 0) > 0.28) {
        if (player.shoot(nowSec)) { player._semiFired = true; player._semiAt = nowSec; }
      }
    }
    if (!input.fire) player._semiFired = false;
    const ctx = { player, bots, spike: game.spike, round: game, onPlanted: (b) => game.onPlanted(b), onDefused: (b) => game.onDefused(b) };
    for (const b of bots) b.update(dt, nowSec, ctx);
    updateGrenades(dt);
    // bots hear nearby shots
    if (player._lastShotAt !== nowSec && input.fire) {
      player._lastShotAt = nowSec;
      for (const b of bots) {
        if (b.alive && b.team === 'viper' && b.pos.distanceTo(player.pos) < 30) b.hear(player.pos, nowSec);
      }
    }
  }
  effects.update(dt);
  // camera follows the player, with recoil kick
  camera.position.set(player.pos.x, player.pos.y + player.eyeHeight, player.pos.z);
  camera.rotation.set(player.pitch + player.recoilPitch, player.yaw, 0);
}

function frame() {
  requestAnimationFrame(frame);
  const t = performance.now() / 1000;
  let dt = Math.min(0.1, t - last);
  last = t;
  if (!paused) {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 5) { step(STEP); acc -= STEP; n++; }
  }
  hud.update(game, player, t);
  renderer.render(scene, camera);
  if (++frames === 5) window.__ready = true;
}

// auto-start in demo mode (no pointer lock, no click needed)
if (DEMO) {
  hud.showMenu(false);
  game.startMatch();
  game.startLive();
  document.getElementById('demo-tag').style.display = 'block';
} else {
  hud.showMenu(true);
}
// warmup: fast-forward the sim so screenshots can catch mid-round play
for (let i = 0; i < WARMUP * 60; i++) step(STEP);

window.__kestrel = { game, player, bots, hud, scene, camera };
// Debug hook: advance the fixed-step simulation n steps (used by headless play-tests).
window.__kestrel.debugStep = (n) => { for (let i = 0; i < n; i++) step(STEP); };
frame();
