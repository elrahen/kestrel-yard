// Touch controls for Kestrel Yard — shown only on touch devices.
// Wires into the exact same input the keyboard/mouse feed:
//   - virtual joystick (bottom-left) -> input.joyX / input.joyY (analog move)
//   - drag on the right side of the screen -> player.yaw / player.pitch
//   - on-screen buttons -> input.fire, player.startReload, crouch toggle,
//     player.throwGrenade, and the buy menu toggle.
// Desktop behaviour is untouched: this module is only initialised when the
// device reports touch, and it never requests pointer lock.

import * as THREE from 'three';
import { PHASE } from './game.js';

export const IS_TOUCH =
  'ontouchstart' in window ||
  (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) ||
  (navigator.maxTouchPoints || 0) > 0;

const AIM_SENS = 0.0042; // radians per pixel of drag — touch needs more than the mouse

export function initTouch({ input, player, hud, game, spawnGrenade, now, canvas }) {
  document.body.classList.add('touch');
  hud.hint('Left stick to move · drag right side to aim · hold FIRE to shoot');

  // The menu's control list describes the keyboard; say the touch version.
  const menuItem = document.querySelector('#menu ul li:last-child');
  if (menuItem) {
    menuItem.innerHTML =
      '<b>Left stick</b> move · <b>drag right side</b> aim · <b>FIRE</b> shoot · ' +
      '<b>RELOAD</b> reload · <b>CROUCH</b> crouch · <b>G</b>renade · <b>BUY</b> shop.';
  }

  // ---- virtual joystick (bottom-left) ----
  const stick = document.getElementById('stick');
  const knob = document.getElementById('stick-knob');
  const RADIUS = 48; // px of stick travel
  let stickId = null;
  let stickCenter = { x: 0, y: 0 };

  function stickMove(t) {
    let dx = t.clientX - stickCenter.x;
    let dy = t.clientY - stickCenter.y;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) { dx = dx / len * RADIUS; dy = dy / len * RADIUS; }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    // Up on the stick is forward: screen-up is -y, so forward is -joyY.
    input.joyX = dx / RADIUS;
    input.joyY = dy / RADIUS;
  }
  function stickEnd() {
    stickId = null;
    input.joyX = 0;
    input.joyY = 0;
    knob.style.transform = 'translate(-50%, -50%)';
  }
  stick.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    stickId = t.identifier;
    const r = stick.getBoundingClientRect();
    stickCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    stickMove(t);
  }, { passive: false });
  stick.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === stickId) stickMove(t);
  }, { passive: false });
  const stickCancel = (e) => {
    for (const t of e.changedTouches) if (t.identifier === stickId) stickEnd();
  };
  stick.addEventListener('touchend', stickCancel);
  stick.addEventListener('touchcancel', stickCancel);

  // ---- aim drag: any touch that starts on the canvas (not on a control) ----
  let aimId = null;
  let aimLast = { x: 0, y: 0 };
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (aimId !== null) return;
    const t = e.changedTouches[0];
    aimId = t.identifier;
    aimLast = { x: t.clientX, y: t.clientY };
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== aimId) continue;
      const dx = t.clientX - aimLast.x;
      const dy = t.clientY - aimLast.y;
      aimLast = { x: t.clientX, y: t.clientY };
      if (!player.alive) return;
      player.yaw -= dx * AIM_SENS;
      player.pitch = THREE.MathUtils.clamp(player.pitch - dy * AIM_SENS, -1.45, 1.45);
    }
  }, { passive: false });
  const aimEnd = (e) => {
    for (const t of e.changedTouches) if (t.identifier === aimId) aimId = null;
  };
  canvas.addEventListener('touchend', aimEnd);
  canvas.addEventListener('touchcancel', aimEnd);

  // ---- on-screen buttons ----
  function holdButton(id, on, off) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('touchstart', (e) => { e.preventDefault(); on(); }, { passive: false });
    el.addEventListener('touchend', (e) => { e.preventDefault(); if (off) off(); }, { passive: false });
    el.addEventListener('touchcancel', () => { if (off) off(); });
  }
  function tapButton(id, on) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('touchstart', (e) => { e.preventDefault(); on(); }, { passive: false });
  }

  // FIRE: hold to shoot — same flag the mouse button sets.
  holdButton('btn-fire', () => { input.fire = true; }, () => { input.fire = false; });

  tapButton('btn-reload', () => { player.startReload(now()); });

  tapButton('btn-crouch', () => {
    player.crouching = !player.crouching;
    document.getElementById('btn-crouch').classList.toggle('active', player.crouching);
  });

  tapButton('btn-grenade', () => { player.throwGrenade(now(), spawnGrenade); });

  tapButton('btn-buy', () => {
    if (game.phase === PHASE.BUY) {
      if (hud.buyOpen) hud.closeBuy(); else hud.openBuy(player);
    }
  });
}
