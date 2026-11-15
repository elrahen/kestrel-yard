// Visual effects: tracers, impact sparks, muzzle flash and explosions.
// All pools are pre-allocated; the hot loop creates no objects.

import * as THREE from 'three';
import { PALETTE } from './palette.js';

const MAX_TRACERS = 24;
const MAX_SPARKS = 160;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    // tracer pool: thin stretched boxes, reused
    this.tracers = [];
    const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < MAX_TRACERS; i++) {
      const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: PALETTE.tracer, transparent: true, opacity: 0 }));
      m.visible = false;
      scene.add(m);
      this.tracers.push({ mesh: m, life: 0 });
    }
    this.tracerIdx = 0;
    // spark pool: small points
    const sparkGeo = new THREE.BufferGeometry();
    this.sparkPos = new Float32Array(MAX_SPARKS * 3);
    this.sparkVel = new Float32Array(MAX_SPARKS * 3);
    this.sparkLife = new Float32Array(MAX_SPARKS);
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: 0xffc46b, size: 0.14, transparent: true, opacity: 0.95 }));
    this.sparks.frustumCulled = false;
    scene.add(this.sparks);
    this.sparkIdx = 0;
    // muzzle flash: a sprite at the gun, flashed for one frame
    const flashTex = radialTexture();
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false }));
    this.flash.scale.set(0.7, 0.7, 1);
    this.flashLife = 0;
    scene.add(this.flash);
    // explosion flash light
    this.boomLight = new THREE.PointLight(0xff8a3c, 0, 18, 1.6);
    scene.add(this.boomLight);
    this.boomLife = 0;
  }

  tracer(from, to, color = PALETTE.tracer) {
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % MAX_TRACERS;
    const dir = to.clone().sub(from);
    const len = dir.length();
    t.mesh.position.copy(from).addScaledVector(dir, 0.5);
    t.mesh.lookAt(to);
    t.mesh.scale.set(0.02, 0.02, len);
    t.mesh.material.color.setHex(color);
    t.mesh.material.opacity = 0.9;
    t.mesh.visible = true;
    t.life = 0.07;
  }

  impact(point, normal) {
    for (let n = 0; n < 6; n++) {
      const i = this.sparkIdx;
      this.sparkIdx = (this.sparkIdx + 1) % MAX_SPARKS;
      this.sparkPos[i * 3] = point.x; this.sparkPos[i * 3 + 1] = point.y; this.sparkPos[i * 3 + 2] = point.z;
      const s = 2.2;
      this.sparkVel[i * 3] = normal.x * 1.5 + (Math.random() - 0.5) * s;
      this.sparkVel[i * 3 + 1] = Math.abs(normal.y) * 1.5 + Math.random() * s;
      this.sparkVel[i * 3 + 2] = normal.z * 1.5 + (Math.random() - 0.5) * s;
      this.sparkLife[i] = 0.35 + Math.random() * 0.25;
    }
    this.sparks.geometry.attributes.position.needsUpdate = true;
  }

  muzzle(pos, dir) {
    this.flash.position.copy(pos).addScaledVector(dir, 0.55);
    this.flash.material.opacity = 0.95;
    this.flashLife = 0.05;
  }

  explosion(point) {
    this.boomLight.position.copy(point);
    this.boomLight.position.y += 1;
    this.boomLight.intensity = 60;
    this.boomLife = 0.5;
    for (let n = 0; n < 40; n++) {
      const i = this.sparkIdx;
      this.sparkIdx = (this.sparkIdx + 1) % MAX_SPARKS;
      this.sparkPos[i * 3] = point.x; this.sparkPos[i * 3 + 1] = point.y + 0.3; this.sparkPos[i * 3 + 2] = point.z;
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * 5;
      this.sparkVel[i * 3] = Math.cos(a) * r;
      this.sparkVel[i * 3 + 1] = 2 + Math.random() * 6;
      this.sparkVel[i * 3 + 2] = Math.sin(a) * r;
      this.sparkLife[i] = 0.6 + Math.random() * 0.5;
    }
    this.sparks.geometry.attributes.position.needsUpdate = true;
  }

  update(dt) {
    for (const t of this.tracers) {
      if (t.life > 0) {
        t.life -= dt;
        if (t.life <= 0) t.mesh.visible = false;
        else t.mesh.material.opacity = t.life / 0.07 * 0.9;
      }
    }
    let any = false;
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (this.sparkLife[i] > 0) {
        any = true;
        this.sparkLife[i] -= dt;
        this.sparkVel[i * 3 + 1] -= 9.8 * dt;
        this.sparkPos[i * 3] += this.sparkVel[i * 3] * dt;
        this.sparkPos[i * 3 + 1] += this.sparkVel[i * 3 + 1] * dt;
        this.sparkPos[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt;
        if (this.sparkPos[i * 3 + 1] < 0.02) { this.sparkPos[i * 3 + 1] = 0.02; this.sparkVel[i * 3 + 1] = 0; }
        if (this.sparkLife[i] <= 0) this.sparkPos[i * 3 + 1] = -100;
      }
    }
    if (any) this.sparks.geometry.attributes.position.needsUpdate = true;
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      this.flash.material.opacity = Math.max(0, this.flashLife / 0.05) * 0.95;
    }
    if (this.boomLife > 0) {
      this.boomLife -= dt;
      this.boomLight.intensity = Math.max(0, this.boomLife / 0.5) * 60;
    }
  }
}

function radialTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,240,180,1)');
  grad.addColorStop(0.4, 'rgba(255,180,60,0.8)');
  grad.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
