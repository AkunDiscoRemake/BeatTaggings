// Fixed-size additive particle system (single draw call, zero allocations per frame).
import * as THREE from '../../vendor/three.module.js';

export class Particles {
  constructor(scene, texture, max) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.base = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.next = 0;
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -1000;
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3);
    this.colAttr = new THREE.BufferAttribute(this.col, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('color', this.colAttr);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.06,
      map: texture,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      fog: false,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.alive = 0;
  }

  emit(x, y, z, vx, vy, vz, r, g, b, life, drag, gravity) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    const k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.base[k] = r; this.base[k + 1] = g; this.base[k + 2] = b;
    this.life[i] = life; this.maxLife[i] = life;
    this.drag[i] = drag || 0;
    this.grav[i] = gravity || 0;
  }

  burst(x, y, z, count, speed, r, g, b, life, spread) {
    for (let i = 0; i < count; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const sp = speed * (0.4 + Math.random() * 0.6);
      this.emit(x, y, z,
        Math.cos(th) * s * sp + (spread ? spread[0] : 0),
        u * sp + (spread ? spread[1] : 0),
        Math.sin(th) * s * sp + (spread ? spread[2] : 0),
        r, g, b, life * (0.6 + Math.random() * 0.4), 2.5, -4);
    }
  }

  clear() {
    for (let i = 0; i < this.max; i++) { this.life[i] = 0; this.pos[i * 3 + 1] = -1000; this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0; }
    this.posAttr.needsUpdate = true; this.colAttr.needsUpdate = true;
  }

  update(dt) {
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      const l = this.life[i];
      if (l <= 0) continue;
      const k = i * 3;
      const nl = l - dt;
      if (nl <= 0) {
        this.life[i] = 0;
        this.pos[k + 1] = -1000;
        this.col[k] = this.col[k + 1] = this.col[k + 2] = 0;
        continue;
      }
      alive++;
      this.life[i] = nl;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[k] *= d; this.vel[k + 1] = this.vel[k + 1] * d + this.grav[i] * dt; this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const f = nl / this.maxLife[i];
      this.col[k] = this.base[k] * f; this.col[k + 1] = this.base[k + 1] * f; this.col[k + 2] = this.base[k + 2] * f;
    }
    if (alive > 0 || this.alive > 0) {
      this.posAttr.needsUpdate = true;
      this.colAttr.needsUpdate = true;
    }
    this.alive = alive;
  }
}
