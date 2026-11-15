// Kestrel Yard — the map. An original industrial yard: Falcons spawn west,
// Vipers spawn east, two spike sites (A north-east, B south-east) joined by
// three lanes: A Long along the north wall, Mid through the crane yard, and
// B Lane along the south wall. Every solid is an axis-aligned box; the same
// list drives rendering, movement collision and bullet raycasts.

import * as THREE from 'three';
import { PALETTE, box, mat } from './palette.js';

// A solid: { x, z, w, d, h, y } — centre x/z, footprint w/d, height h,
// base y (0 = ground). Colliders are the same boxes.
export const SOLIDS = [];
function solid(x, z, w, d, h, y = 0, color = PALETTE.wall) {
  const s = { x, z, w, d, h, y, color };
  SOLIDS.push(s);
  return s;
}

// ---- perimeter (3.2 m high walls) ----
solid(0, -23, 64, 2, 3.2, 0, PALETTE.wallDark);   // north
solid(0, 23, 64, 2, 3.2, 0, PALETTE.wallDark);    // south
solid(-31, 0, 2, 48, 3.2, 0, PALETTE.wallDark);   // west
solid(31, 0, 2, 48, 3.2, 0, PALETTE.wallDark);    // east

// ---- site A warehouse (north-east): big teal container + office block ----
solid(20, -16, 10, 6, 3.0, 0, PALETTE.containerA);
solid(20, -16, 10, 6, 0.4, 3.0, PALETTE.wallDark); // roof lip
solid(26, -10, 4, 4, 2.4, 0, PALETTE.containerB);
solid(12, -19, 6, 3, 2.6, 0, PALETTE.wall);

// ---- site B container yard (south-east): stacked rust containers ----
solid(20, 16, 9, 5, 2.6, 0, PALETTE.containerB);
solid(20, 16, 9, 5, 2.6, 2.6, PALETTE.containerA); // stacked second level
solid(27, 11, 4, 4, 2.4, 0, PALETTE.crate);
solid(13, 19, 5, 3, 2.2, 0, PALETTE.wallDark);

// ---- mid: crane yard crates forming cover and a crossfire lane ----
solid(-6, -4, 3, 3, 1.3, 0, PALETTE.crate);       // low crate, can shoot over
solid(-6, -4, 3, 3, 1.3, 1.3, PALETTE.crateDark); // stacked
solid(2, 3, 4, 2, 1.2, 0, PALETTE.crate);
solid(6, -7, 2, 2, 1.2, 0, PALETTE.crateDark);
solid(-2, 9, 3, 3, 1.3, 0, PALETTE.crate);
solid(12, 6, 2, 4, 2.4, 0, PALETTE.wall);        // mid wall, splits B lane
solid(14, 6, 2, 2, 1.2, 0, PALETTE.crate);       // connector crate
solid(-18, 0, 4, 2, 1.2, 0, PALETTE.crateDark);  // falcon-side cover
solid(24, 6, 3, 3, 1.3, 0, PALETTE.crate);       // viper-side cover
solid(-24, -8, 3, 2, 1.2, 0, PALETTE.crate);
solid(-24, 8, 3, 2, 1.2, 0, PALETTE.crate);

// ---- bomb sites (plant zones, radius in metres) ----
export const SITES = {
  A: { x: 20, z: -11, r: 4.5, label: 'A' },
  B: { x: 20, z: 11, r: 4.5, label: 'B' },
};

export const SPAWNS = {
  falcon: [
    [-27, -6], [-27, -2], [-27, 2], [-27, 6], [-24, 0],
  ],
  viper: [
    [27, -6], [27, -2], [27, 2], [27, 6], [24, 0],
  ],
};

// ---- waypoint graph for bots: nodes along the three lanes ----
export const WAYPOINTS = [
  // id, x, z — every lane segment between neighbours is clear of solids
  [0, -27, 0], [1, -20, -3], [2, -12, 0], [3, -4, 0], [4, 4, 0], [5, 12, 0], [6, 20, 0], [7, 26, 0],
  [8, -20, -12], [9, -8, -12], [10, 4, -12], [11, 12, -12], [12, 20, -11], // A long
  [13, -20, 12], [14, -8, 12], [15, 4, 12], [16, 12, 12], [17, 20, 11],    // B lane
  [18, -3, -8], [19, 6, -4], [20, -5, 12], [21, 8, 4],
];
export const EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7],
  [1, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 6],
  [1, 13], [13, 14], [14, 15], [15, 16], [16, 17], [17, 6],
  [3, 18], [18, 19], [19, 4], [3, 20], [20, 21], [21, 5],
  [10, 18], [15, 21], [2, 8], [2, 13], [9, 3], [14, 3],
];

// ---- collision: AABB vs circle (x/z), resolved per axis ----
export function collideCircle(pos, radius, height) {
  // pos: {x, y, z}; moves it out of any solid it overlaps. Returns true if hit.
  let hit = false;
  for (const s of SOLIDS) {
    const top = s.y + s.h;
    if (pos.y + height <= s.y + 0.02 || pos.y >= top - 0.02) continue;
    const dx = pos.x - Math.max(s.x - s.w / 2, Math.min(pos.x, s.x + s.w / 2));
    const dz = pos.z - Math.max(s.z - s.d / 2, Math.min(pos.z, s.z + s.d / 2));
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    hit = true;
    if (d2 > 1e-6) {
      const d = Math.sqrt(d2);
      const push = (radius - d) / d;
      pos.x += dx * push;
      pos.z += dz * push;
    } else {
      // centre inside the box: push out along the smallest penetration axis
      const px = s.w / 2 + radius - Math.abs(pos.x - s.x);
      const pz = s.d / 2 + radius - Math.abs(pos.z - s.z);
      if (px < pz) pos.x += pos.x >= s.x ? px : -px;
      else pos.z += pos.z >= s.z ? pz : -pz;
    }
  }
  // clamp to the yard
  pos.x = Math.max(-29.6, Math.min(29.6, pos.x));
  pos.z = Math.max(-21.6, Math.min(21.6, pos.z));
  return hit;
}

export function pointInSolid(x, y, z) {
  for (const s of SOLIDS) {
    if (Math.abs(x - s.x) <= s.w / 2 && Math.abs(z - s.z) <= s.d / 2 && y >= s.y && y <= s.y + s.h) return true;
  }
  return false;
}

// Line of sight between two eye points: sample the segment; true when clear.
export function hasLineOfSight(a, b) {
  const steps = Math.ceil(a.distanceTo(b) / 0.5);
  const p = new THREE.Vector3();
  for (let i = 1; i < steps; i++) {
    p.lerpVectors(a, b, i / steps);
    if (pointInSolid(p.x, p.y, p.z)) return false;
  }
  return true;
}

// ---- rendering ----
export function buildWorld(scene) {
  const group = new THREE.Group();
  group.name = 'world';

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(64, 48), mat(PALETTE.ground, { roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // painted yard markings: centre line and site circles (flat, slightly above ground)
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xd8c98a });
  const mid = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 40), lineMat);
  mid.rotation.x = -Math.PI / 2; mid.position.set(0, 0.02, 0);
  group.add(mid);
  for (const site of Object.values(SITES)) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.r - 0.35, site.r, 40),
      new THREE.MeshBasicMaterial({ color: PALETTE.accent, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.02, site.z);
    group.add(ring);
    const label = makeLabel(site.label);
    label.position.set(site.x, 3.6, site.z);
    group.add(label);
  }

  for (const s of SOLIDS) {
    const m = box(s.w, s.h, s.d, s.color);
    m.position.set(s.x, s.y + s.h / 2, s.z);
    m.userData.solid = true;
    group.add(m);
    // amber edge trim on tall walls so lanes read at a glance
    if (s.h >= 2.4) {
      const trim = new THREE.Mesh(new THREE.BoxGeometry(s.w + 0.06, 0.12, s.d + 0.06), mat(PALETTE.accent, { roughness: 0.6 }));
      trim.position.set(s.x, s.y + s.h - 0.06, s.z);
      group.add(trim);
    }
  }

  // crane silhouette at mid, purely visual, high above play
  const crane = new THREE.Group();
  const mast = box(0.8, 14, 0.8, PALETTE.wallDark);
  mast.position.set(-2, 7, -20);
  const jib = box(16, 0.7, 0.7, PALETTE.accent, { roughness: 0.6 });
  jib.position.set(4, 13.4, -20);
  crane.add(mast, jib);
  group.add(crane);

  scene.add(group);
  return group;
}

function makeLabel(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f0a830';
  ctx.font = 'bold 84px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 68);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(3, 3, 1);
  return sprite;
}
