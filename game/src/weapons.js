// Weapons. Five guns and a grenade, each with its own price, damage, spread
// and recoil so stopping to aim pays and spraying on the move does not.
// Damage falls off with range; headshots multiply it.

export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', price: 0, kind: 'pistol',
    damage: 34, headMult: 3.0, range: 40, falloff: 0.55,
    rpm: 360, mag: 12, reserve: 72, reloadTime: 1.5,
    spread: 0.011, moveSpread: 0.030, recoil: 0.011, auto: false,
    tracer: 0xffe9a8,
  },
  vk9: {
    id: 'vk9', name: 'VK-9 Ripper', price: 1200, kind: 'smg',
    damage: 26, headMult: 3.2, range: 32, falloff: 0.5,
    rpm: 720, mag: 28, reserve: 112, reloadTime: 1.9,
    spread: 0.016, moveSpread: 0.042, recoil: 0.009, auto: true,
    tracer: 0xffd27a,
  },
  ar7: {
    id: 'ar7', name: 'AR-7 Kestrel', price: 2700, kind: 'rifle',
    damage: 33, headMult: 4.0, range: 60, falloff: 0.75,
    rpm: 600, mag: 25, reserve: 100, reloadTime: 2.3,
    spread: 0.006, moveSpread: 0.034, recoil: 0.014, auto: true,
    tracer: 0xffc46b,
  },
  scatter: {
    id: 'scatter', name: 'Scattergun 12', price: 1050, kind: 'shotgun',
    damage: 11, headMult: 2.5, range: 16, falloff: 0.3,
    rpm: 70, mag: 6, reserve: 24, reloadTime: 2.8,
    spread: 0.045, moveSpread: 0.06, recoil: 0.05, auto: false,
    pellets: 8, tracer: 0xffe9a8,
  },
  longbow: {
    id: 'longbow', name: 'Longbow DMR', price: 4750, kind: 'dmr',
    damage: 88, headMult: 4.0, range: 90, falloff: 0.9,
    rpm: 55, mag: 5, reserve: 15, reloadTime: 3.0,
    spread: 0.0015, moveSpread: 0.05, recoil: 0.06, auto: false,
    tracer: 0x9fd8ff,
  },
  frag: {
    id: 'frag', name: 'HE Grenade', price: 300, kind: 'grenade',
    damage: 110, headMult: 1, range: 6, falloff: 1,
    rpm: 60, mag: 1, reserve: 0, reloadTime: 0.8,
    spread: 0, moveSpread: 0, recoil: 0, auto: false,
    tracer: 0xff5a3c,
  },
};

// Buy-menu order: key 1..6.
export const BUY_ORDER = ['p9', 'vk9', 'scatter', 'ar7', 'longbow', 'frag'];
export const ARMOR_PRICE = 650;
export const ARMOR_ABSORB = 0.5; // half of damage goes to armour while it lasts

// Damage at a distance, with falloff past half the weapon's range.
export function damageAt(def, dist, head) {
  let d = def.damage;
  const half = def.range / 2;
  if (dist > half) {
    const t = Math.min(1, (dist - half) / half);
    d *= 1 - (1 - def.falloff) * t;
  }
  if (head) d *= def.headMult;
  return d;
}
