// Renders gameplay objects with instancing: colored blocks (arrow / dot), black obstacle blocks,
// cut debris, black walls (pooled, shader-drawn neon edges) and judgement popups.
import * as THREE from '../../vendor/three.module.js';
import { LAYOUT, COLORS } from '../core/config.js';

const MAX_NOTES = 64;
const MAX_BOMBS = 32;
const MAX_DEBRIS = 48;
const MAX_WALLS = 12;
const MAX_POPUPS = 10;

const WALL_VERT = [
  'uniform vec3 uScale;',
  'varying vec3 vP;',
  'varying float vDepth;',
  'void main() {',
  '  vP = position * uScale;',
  '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
  '  vDepth = -mv.z;',
  '  gl_Position = projectionMatrix * mv;',
  '}',
].join('\n');

const WALL_FRAG = [
  'uniform vec3 uScale;',
  'uniform vec3 uEdge;',
  'uniform vec3 uFog;',
  'uniform float uPulse;',
  'varying vec3 vP;',
  'varying float vDepth;',
  'void main() {',
  '  vec3 h = uScale * 0.5;',
  '  vec3 d = h - abs(vP);',              // distance to each pair of faces
  '  // the smallest component is the face we are on; edge distance = second smallest',
  '  float a = d.x, b = d.y, c = d.z;',
  '  float mn = min(a, min(b, c));',
  '  float mx = max(a, max(b, c));',
  '  float mid = a + b + c - mn - mx;',
  '  float edge = 1.0 - smoothstep(0.0, 0.045, mid);',
  '  float inner = 1.0 - smoothstep(0.0, 0.18, mid);',
  '  vec3 col = vec3(0.02, 0.008, 0.035) + uEdge * (edge * 1.4 + inner * 0.25) * (0.8 + uPulse * 0.6);',
  '  float f = smoothstep(10.0, 46.0, vDepth);',
  '  gl_FragColor = vec4(mix(col, uFog, f), 1.0);',
  '}',
].join('\n');

const JUDGEMENTS = {
  perfect: { text: 'PERFEITO', color: '#ffffff', glow: '#c77dff' },
  great: { text: 'ÓTIMO', color: '#e2b8ff', glow: '#9b30ff' },
  good: { text: 'BOM', color: '#c77dff', glow: '#6a1bb8' },
  ok: { text: 'OK', color: '#a99bc4', glow: '#3c096c' },
  miss: { text: 'ERROU', color: '#ff4d6d', glow: '#7a0020' },
  direction: { text: 'DIREÇÃO!', color: '#ffb347', glow: '#7a3b00' },
  bomb: { text: 'BOMBA!', color: '#ff4d6d', glow: '#000000' },
};

function popupTexture(j) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'italic 900 44px "Arial Black", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = j.glow;
  ctx.shadowBlur = 14;
  ctx.fillStyle = j.color;
  ctx.fillText(j.text, 128, 34);
  ctx.shadowBlur = 0;
  ctx.fillText(j.text, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  return t;
}

export class ObjectRenderer {
  constructor(scene, textures) {
    this.scene = scene;
    const size = LAYOUT.noteSize;
    const box = new THREE.BoxGeometry(size, size, size);
    const side = new THREE.MeshBasicMaterial({ map: textures.noteSide });
    const arrowFace = new THREE.MeshBasicMaterial({ map: textures.noteArrow });
    const dotFace = new THREE.MeshBasicMaterial({ map: textures.noteDot });
    // BoxGeometry groups: +x, -x, +y, -y, +z (faces the player), -z
    this.arrowMesh = new THREE.InstancedMesh(box, [side, side, side, side, arrowFace, side], MAX_NOTES);
    this.dotMesh = new THREE.InstancedMesh(box, [side, side, side, side, dotFace, side], MAX_NOTES);
    const bombGeo = new THREE.BoxGeometry(size * 0.9, size * 0.9, size * 0.9);
    this.bombMesh = new THREE.InstancedMesh(bombGeo, new THREE.MeshBasicMaterial({ map: textures.bomb }), MAX_BOMBS);
    const half = new THREE.BoxGeometry(size, size / 2, size);
    half.translate(0, size / 4, 0);
    this.debrisMesh = new THREE.InstancedMesh(half, side, MAX_DEBRIS);
    [this.arrowMesh, this.dotMesh, this.bombMesh, this.debrisMesh].forEach(function (m) {
      // Allocate per-instance colors at full capacity (setColorAt would size it from `count`).
      const cap = m.instanceMatrix.count;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      scene.add(m);
    });
    // instance colors
    this.colors = [new THREE.Color(COLORS.note0), new THREE.Color(COLORS.note1)];

    // Walls
    this.walls = [];
    const unit = new THREE.BoxGeometry(1, 1, 1);
    this.wallPulse = 0;
    for (let i = 0; i < MAX_WALLS; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uScale: { value: new THREE.Vector3(1, 1, 1) },
          uEdge: { value: new THREE.Color(COLORS.purple) },
          uFog: { value: new THREE.Color(COLORS.fog) },
          uPulse: { value: 0 },
        },
        vertexShader: WALL_VERT,
        fragmentShader: WALL_FRAG,
      });
      const mesh = new THREE.Mesh(unit, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.walls.push(mesh);
    }

    // Debris simulation state
    this.debris = [];
    for (let i = 0; i < MAX_DEBRIS; i++) {
      this.debris.push({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), axis: new THREE.Vector3(), spin: 0, age: 0, life: 0.7, c: 0 });
    }
    this.debrisNext = 0;

    // Popups
    this.popupTex = {};
    for (const k in JUDGEMENTS) this.popupTex[k] = popupTexture(JUDGEMENTS[k]);
    this.popups = [];
    const pgeo = new THREE.PlaneGeometry(0.6, 0.15);
    for (let i = 0; i < MAX_POPUPS; i++) {
      const m = new THREE.Mesh(pgeo, new THREE.MeshBasicMaterial({ map: this.popupTex.perfect, transparent: true, depthWrite: false, fog: false }));
      m.visible = false;
      m.renderOrder = 20;
      scene.add(m);
      this.popups.push({ mesh: m, age: 0, life: 0.8 });
    }
    this.popupNext = 0;

    // scratch
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._e = new THREE.Euler();
    this._z = new THREE.Vector3(0, 0, 1);
    this._arrowCount = 0;
    this._dotCount = 0;
    this._bombCount = 0;
  }

  // ---- per-frame note batching ----
  beginFrame() { this._arrowCount = 0; this._dotCount = 0; this._bombCount = 0; }

  addNote(x, y, z, rotZ, scale, colorIndex, isDot, spin) {
    const mesh = isDot ? this.dotMesh : this.arrowMesh;
    const i = isDot ? this._dotCount++ : this._arrowCount++;
    if (i >= MAX_NOTES) return;
    this._e.set(spin * 0.6, spin, rotZ);
    this._q.setFromEuler(this._e);
    this._p.set(x, y, z);
    this._s.set(scale, scale, scale);
    this._m.compose(this._p, this._q, this._s);
    mesh.setMatrixAt(i, this._m);
    mesh.setColorAt(i, this.colors[colorIndex]);
  }

  addBomb(x, y, z, rot, scale) {
    const i = this._bombCount++;
    if (i >= MAX_BOMBS) return;
    this._e.set(rot * 0.7, rot, rot * 0.3);
    this._q.setFromEuler(this._e);
    this._p.set(x, y, z);
    this._s.set(scale, scale, scale);
    this._m.compose(this._p, this._q, this._s);
    this.bombMesh.setMatrixAt(i, this._m);
  }

  endFrame() {
    this.arrowMesh.count = Math.min(MAX_NOTES, this._arrowCount);
    this.dotMesh.count = Math.min(MAX_NOTES, this._dotCount);
    this.bombMesh.count = Math.min(MAX_BOMBS, this._bombCount);
    this.arrowMesh.instanceMatrix.needsUpdate = true;
    this.dotMesh.instanceMatrix.needsUpdate = true;
    this.bombMesh.instanceMatrix.needsUpdate = true;
    if (this.arrowMesh.instanceColor) this.arrowMesh.instanceColor.needsUpdate = true;
    if (this.dotMesh.instanceColor) this.dotMesh.instanceColor.needsUpdate = true;
  }

  // ---- walls ----
  setWall(i, x0, x1, y0, y1, zNear, zFar) {
    const w = this.walls[i];
    if (!w) return;
    const sx = Math.max(0.01, x1 - x0), sy = Math.max(0.01, y1 - y0), sz = Math.max(0.01, zNear - zFar);
    w.position.set((x0 + x1) / 2, (y0 + y1) / 2, (zNear + zFar) / 2);
    w.scale.set(sx, sy, sz);
    w.material.uniforms.uScale.value.set(sx, sy, sz);
    w.material.uniforms.uPulse.value = this.wallPulse;
    w.visible = true;
  }
  hideWallsFrom(i) { for (; i < this.walls.length; i++) this.walls[i].visible = false; }
  get maxWalls() { return MAX_WALLS; }

  // ---- debris ----
  spawnDebris(x, y, z, swingX, swingY, colorIndex, speed) {
    // split normal is perpendicular to the swing in the XY plane
    let nx = -swingY, ny = swingX;
    const len = Math.hypot(nx, ny);
    if (len < 1e-4) { nx = 1; ny = 0; } else { nx /= len; ny /= len; }
    const phi = Math.atan2(-nx, ny);
    for (let s = 0; s < 2; s++) {
      const d = this.debris[this.debrisNext];
      this.debrisNext = (this.debrisNext + 1) % MAX_DEBRIS;
      const sign = s === 0 ? 1 : -1;
      d.alive = true;
      d.age = 0;
      d.life = 0.75;
      d.c = colorIndex;
      d.p.set(x, y, z);
      const push = 1.2 + speed * 0.12;
      d.v.set(nx * sign * push + swingX * 0.6, ny * sign * push + swingY * 0.6 + 0.6, 1.5 + Math.random());
      d.q.setFromAxisAngle(this._z, phi + (s === 0 ? 0 : Math.PI));
      d.axis.set(nx, ny, 0.3).normalize();
      d.spin = (4 + Math.random() * 6) * sign;
    }
  }

  // ---- popups ----
  popup(kind, x, y, z) {
    const p = this.popups[this.popupNext];
    this.popupNext = (this.popupNext + 1) % MAX_POPUPS;
    p.mesh.material.map = this.popupTex[kind] || this.popupTex.ok;
    p.mesh.material.opacity = 1;
    p.mesh.position.set(x, y, z);
    p.mesh.scale.set(0.6, 0.6, 1);
    p.mesh.visible = true;
    p.age = 0;
  }

  clearTransient() {
    for (const d of this.debris) d.alive = false;
    for (const p of this.popups) p.mesh.visible = false;
    this.debrisMesh.count = 0;
    this.beginFrame(); this.endFrame();
    this.hideWallsFrom(0);
  }

  update(dt) {
    this.wallPulse = Math.max(0, this.wallPulse - dt * 3);
    // debris
    let n = 0;
    for (let i = 0; i < MAX_DEBRIS; i++) {
      const d = this.debris[i];
      if (!d.alive) continue;
      d.age += dt;
      if (d.age >= d.life) { d.alive = false; continue; }
      d.v.y -= 9.0 * dt;
      d.p.x += d.v.x * dt; d.p.y += d.v.y * dt; d.p.z += d.v.z * dt;
      this._q.setFromAxisAngle(d.axis, d.spin * dt);
      d.q.premultiply(this._q);
      const sc = 1 - Math.pow(d.age / d.life, 2);
      this._s.set(sc, sc, sc);
      this._m.compose(d.p, d.q, this._s);
      this.debrisMesh.setMatrixAt(n, this._m);
      this.debrisMesh.setColorAt(n, this.colors[d.c]);
      n++;
    }
    this.debrisMesh.count = n;
    if (n > 0) {
      this.debrisMesh.instanceMatrix.needsUpdate = true;
      if (this.debrisMesh.instanceColor) this.debrisMesh.instanceColor.needsUpdate = true;
    }
    // popups
    for (let i = 0; i < MAX_POPUPS; i++) {
      const p = this.popups[i];
      if (!p.mesh.visible) continue;
      p.age += dt;
      if (p.age >= p.life) { p.mesh.visible = false; continue; }
      const f = p.age / p.life;
      p.mesh.position.y += dt * 0.35;
      const s = 0.6 + Math.min(1, f * 6) * 0.4;
      p.mesh.scale.set(s, s, 1);
      p.mesh.material.opacity = 1 - f * f;
    }
  }
}
