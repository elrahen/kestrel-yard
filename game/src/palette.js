// Kestrel Yard — a tactical three.js FPS. Palette and shared materials.
// One chosen palette, used by every module: dusk-industrial teal and amber
// over concrete grey, with team colours that never clash with the map.

export const PALETTE = {
  sky: 0x46586a,        // dusk blue-grey sky / fog
  fog: 0x46586a,
  ground: 0x5c564c,     // worn concrete
  groundDark: 0x3a3733,
  wall: 0x8a7f6a,       // sun-bleached concrete
  wallDark: 0x6e675c,
  crate: 0xb07a2e,      // amber shipping crates
  crateDark: 0x8a5f22,
  containerA: 0x2e6f7a, // teal container
  containerB: 0x7a3a2e, // rust container
  accent: 0xf0a830,     // amber accent (HUD, lights)
  falcon: 0x3a86ff,     // player team (Falcons)
  viper: 0xff5a3c,      // enemy team (Vipers)
  ink: 0xe9e6df,
  muted: 0x98a0a8,
  tracer: 0xffd27a,
};

// Reusable materials, built once so the hot loop allocates nothing.
import * as THREE from 'three';

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = `${color}|${opts.roughness ?? 0.9}|${opts.metalness ?? 0}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.9, metalness: opts.metalness ?? 0 }));
  }
  return matCache.get(key);
}

export function box(w, h, d, color, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
