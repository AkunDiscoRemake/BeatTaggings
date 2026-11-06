// The purple saber: detailed lathe-modelled metal hilt (matcap shading, no lights), layered
// energy blade with a fresnel glow shader (fake bloom without post-processing), luminous trail,
// floor glow, emitter/tip flares and motion particles.
import * as THREE from '../../vendor/three.module.js';
import { LAYOUT, COLORS } from '../core/config.js';

const V2 = THREE.Vector2;

const BLADE_VERT = [
  'uniform float uLen;',
  'varying vec3 vN;',
  'varying vec3 vV;',
  'varying float vY;',
  'void main() {',
  '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
  '  vN = normalize(normalMatrix * normal);',
  '  vV = -mv.xyz;',
  '  vY = position.y / uLen;',
  '  gl_Position = projectionMatrix * mv;',
  '}',
].join('\n');

const BLADE_FRAG = [
  'uniform vec3 uColor;',
  'uniform float uIntensity;',
  'uniform float uPower;',
  'uniform float uTime;',
  'uniform float uExtend;',
  'varying vec3 vN;',
  'varying vec3 vV;',
  'varying float vY;',
  'void main() {',
  '  if (vY > uExtend + 0.02) discard;',
  '  float f = abs(dot(normalize(vN), normalize(vV)));',
  '  float a = pow(f, uPower);',
  '  float flow = 0.82 + 0.18 * sin(vY * 42.0 - uTime * 16.0) * sin(vY * 13.0 + uTime * 5.0);',
  '  float base = smoothstep(0.0, 0.04, vY);',
  '  gl_FragColor = vec4(uColor * a * uIntensity * flow * base, 1.0);',
  '}',
].join('\n');

function bladeShell(radius, length, segs) {
  const pts = [
    new V2(radius * 0.55, 0),
    new V2(radius, 0.025),
    new V2(radius, length),
    new V2(radius * 0.75, length + radius * 0.45),
    new V2(radius * 0.3, length + radius * 0.8),
    new V2(0.0001, length + radius * 0.9),
  ];
  return new THREE.LatheGeometry(pts, segs);
}

function shellMaterial(color, intensity, power, length) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
      uPower: { value: power },
      uTime: { value: 0 },
      uLen: { value: length },
      uExtend: { value: 1 },
    },
    vertexShader: BLADE_VERT,
    fragmentShader: BLADE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
}

export class Saber {
  constructor(parent, textures, particles, quality) {
    this.particles = particles;
    this.group = new THREE.Group();          // oriented by the controller
    this.group.position.set(LAYOUT.saberPivot.x, LAYOUT.saberPivot.y, LAYOUT.saberPivot.z);
    parent.add(this.group);
    this.model = new THREE.Group();          // modelled with +Y along the blade
    this.model.rotation.x = -Math.PI / 2;    // +Y -> -Z (controller forward)
    this.group.add(this.model);

    this.bladeLength = LAYOUT.bladeLength;
    this.emitterY = 0.13;
    this.extend = 0;           // 0..1 ignition
    this.extendTarget = 1;
    this.flash = 0;
    this.time = 0;

    this._buildHilt(textures);
    this._buildBlade(textures);
    this._buildTrail(quality.trailSegments);
    this._buildFloorGlow(textures);

    // world-space sampling state
    this.base = new THREE.Vector3();
    this.tip = new THREE.Vector3();
    this.prevBase = new THREE.Vector3();
    this.prevTip = new THREE.Vector3();
    this.tipVel = new THREE.Vector3();
    this.tipSpeed = 0;
    this.swingPeak = 0;      // peak tip speed over the last ~150 ms (fairer swing scoring)
    this.forward = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._first = true;
  }

  _buildHilt(T) {
    const chrome = new THREE.MeshMatcapMaterial({ matcap: T.matcapChrome });
    const dark = new THREE.MeshMatcapMaterial({ matcap: T.matcapDark });
    const purple = new THREE.MeshMatcapMaterial({ matcap: T.matcapPurple });
    const glowMat = new THREE.MeshBasicMaterial({ color: COLORS.purpleHot });

    // Pommel (chrome) with a faceted cap
    const pommel = new THREE.LatheGeometry([
      new V2(0.0001, -0.138), new V2(0.010, -0.138), new V2(0.017, -0.134), new V2(0.021, -0.127),
      new V2(0.021, -0.118), new V2(0.018, -0.114), new V2(0.0175, -0.108),
    ], 14);
    // Grip (dark rubber) with ridges
    const gp = [new V2(0.0175, -0.108)];
    for (let y = -0.104, i = 0; y < 0.046; y += 0.0075, i++) gp.push(new V2(i % 2 ? 0.0172 : 0.0188, y));
    gp.push(new V2(0.0175, 0.05));
    const grip = new THREE.LatheGeometry(gp, 14);
    // Upper body + emitter shroud (chrome)
    const upper = new THREE.LatheGeometry([
      new V2(0.0175, 0.05), new V2(0.019, 0.056), new V2(0.019, 0.088), new V2(0.0175, 0.092),
      new V2(0.0215, 0.103), new V2(0.0245, 0.118), new V2(0.0245, 0.126), new V2(0.021, 0.131),
      new V2(0.013, 0.131), new V2(0.011, 0.124), new V2(0.0001, 0.124),
    ], 16);

    const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); this.model.add(m); return m; };
    add(pommel, chrome);
    add(grip, dark);
    add(upper, chrome);

    // Purple accent rings
    const ringGeo = new THREE.TorusGeometry(0.0195, 0.0028, 6, 18);
    [-0.111, 0.053, 0.09].forEach((y) => {
      const r = add(ringGeo, glowMat);
      r.rotation.x = Math.PI / 2;
      r.position.y = y;
    });
    // Emitter claws (3 prongs)
    const prongGeo = new THREE.BoxGeometry(0.006, 0.026, 0.01);
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3 + 0.3;
      const p = add(prongGeo, purple);
      p.position.set(Math.cos(a) * 0.024, 0.128, Math.sin(a) * 0.024);
      p.rotation.y = -a;
      p.rotation.z = 0.25;
    }
    // Activation switch + energy cell window
    const sw = add(new THREE.BoxGeometry(0.009, 0.016, 0.008), purple);
    sw.position.set(0, 0.072, -0.02);
    const cell = add(new THREE.BoxGeometry(0.006, 0.022, 0.004), glowMat);
    cell.position.set(0, 0.072, 0.0195);
    this.cellMat = glowMat;
  }

  _buildBlade(T) {
    const L = this.bladeLength;
    this.blade = new THREE.Group();
    this.blade.position.y = this.emitterY;
    this.model.add(this.blade);

    this.coreMat = shellMaterial(0xffffff, 1.6, 0.6, L);
    this.innerMat = shellMaterial(COLORS.purpleHot, 1.2, 1.4, L);
    this.outerMat = shellMaterial(COLORS.purple, 0.85, 2.6, L);
    this.shellMats = [this.coreMat, this.innerMat, this.outerMat];
    const core = new THREE.Mesh(bladeShell(0.011, L, 10), this.coreMat);
    const inner = new THREE.Mesh(bladeShell(0.024, L, 12), this.innerMat);
    const outer = new THREE.Mesh(bladeShell(0.058, L, 12), this.outerMat);
    core.renderOrder = 12; inner.renderOrder = 11; outer.renderOrder = 10;
    this.blade.add(outer, inner, core);
    this.bladeMeshes = [core, inner, outer];

    const spriteMat = new THREE.SpriteMaterial({ map: T.glow, color: COLORS.purpleHot, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    this.emitterGlow = new THREE.Sprite(spriteMat);
    this.emitterGlow.scale.set(0.16, 0.16, 1);
    this.emitterGlow.position.y = this.emitterY + 0.01;
    this.emitterGlow.renderOrder = 13;
    this.model.add(this.emitterGlow);
    this.tipGlow = new THREE.Sprite(spriteMat.clone());
    this.tipGlow.material.color.set(COLORS.purple);
    this.tipGlow.scale.set(0.22, 0.22, 1);
    this.tipGlow.position.y = this.emitterY + L;
    this.tipGlow.renderOrder = 13;
    this.model.add(this.tipGlow);
  }

  _buildTrail(n) {
    this.trailN = n;
    this.trailPos = new Float32Array(n * 2 * 3);
    this.trailCol = new Float32Array(n * 2 * 3);
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    this.trailPosAttr = new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.trailColAttr = new THREE.BufferAttribute(this.trailCol, 3);
    g.setAttribute('position', this.trailPosAttr);
    g.setAttribute('color', this.trailColAttr);
    g.setIndex(idx);
    const purple = new THREE.Color(COLORS.purple);
    const hot = new THREE.Color(COLORS.purpleHot);
    for (let i = 0; i < n; i++) {
      const f = Math.pow(1 - i / (n - 1), 1.6);
      // base edge dim, tip edge bright
      this.trailCol[i * 6] = purple.r * f * 0.35; this.trailCol[i * 6 + 1] = purple.g * f * 0.35; this.trailCol[i * 6 + 2] = purple.b * f * 0.35;
      this.trailCol[i * 6 + 3] = (hot.r * 0.7 + 0.3) * f; this.trailCol[i * 6 + 4] = (hot.g * 0.7 + 0.3) * f; this.trailCol[i * 6 + 5] = (hot.b * 0.7 + 0.3) * f;
    }
    this.trail = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    }));
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 9;
    this.trailParent = null;
  }

  _buildFloorGlow(T) {
    this.floorGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: T.glow, color: COLORS.purple, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
    );
    this.floorGlow.rotation.x = -Math.PI / 2;
    this.floorGlow.renderOrder = 1;
  }

  // The trail and floor glow live in world space.
  attachWorld(scene) {
    scene.add(this.trail);
    scene.add(this.floorGlow);
  }

  setVisible(v) {
    this.group.visible = v;
    this.trail.visible = v;
    this.floorGlow.visible = v;
  }

  ignite(on) {
    this.extendTarget = on ? 1 : 0;
  }

  hitFlash(amount) { this.flash = Math.min(1.5, this.flash + amount); }

  resetTrail() { this._first = true; }

  // Call after the rig/controller transforms are final for this frame.
  update(dt, quaternion) {
    this.time += dt;
    if (quaternion) this.group.quaternion.copy(quaternion);
    // ignition
    const k = Math.min(1, dt * 6);
    this.extend += (this.extendTarget - this.extend) * k;
    const ext = Math.max(0.001, this.extend);
    this.blade.scale.set(1, ext, 1);
    this.tipGlow.position.y = this.emitterY + this.bladeLength * ext;
    this.flash = Math.max(0, this.flash - dt * 4);
    const fl = this.flash;
    const flick = 1 + Math.sin(this.time * 61) * 0.025 + Math.sin(this.time * 23) * 0.02;
    this.coreMat.uniforms.uIntensity.value = (1.6 + fl * 0.8) * flick;
    this.innerMat.uniforms.uIntensity.value = (1.2 + fl * 0.9) * flick;
    this.outerMat.uniforms.uIntensity.value = (0.85 + fl * 0.8) * flick;
    for (let i = 0; i < 3; i++) this.shellMats[i].uniforms.uTime.value = this.time;
    const gs = 0.2 + fl * 0.15 + Math.sin(this.time * 9) * 0.015;
    this.tipGlow.scale.set(gs, gs, 1);

    // world positions of the blade
    this.group.updateMatrixWorld(true);
    const m = this.model.matrixWorld;
    this.prevBase.copy(this.base);
    this.prevTip.copy(this.tip);
    this.base.set(0, this.emitterY + 0.02, 0).applyMatrix4(m);
    this.tip.set(0, this.emitterY + this.bladeLength * ext, 0).applyMatrix4(m);
    this.forward.copy(this.tip).sub(this.base).normalize();
    if (this._first) {
      this.prevBase.copy(this.base); this.prevTip.copy(this.tip);
      for (let i = 0; i < this.trailN; i++) this._writeTrail(i);
      this._first = false;
    }
    if (dt > 0) {
      this._v.copy(this.tip).sub(this.prevTip).multiplyScalar(1 / dt);
      this.tipVel.lerp(this._v, 0.6);
      this.tipSpeed = this.tipVel.length();
      this.swingPeak = Math.max(this.tipSpeed, this.swingPeak - dt * 30);
    }

    // Trail: shift history and write the newest sample at index 0.
    const tp = this.trailPos;
    tp.copyWithin(6, 0, (this.trailN - 1) * 6);
    this._writeTrail(0);
    this.trailPosAttr.needsUpdate = true;
    const trailAlpha = Math.min(1, Math.max(0, (this.tipSpeed - 0.6) / 3)) * ext;
    this.trail.material.opacity = trailAlpha;
    this.trail.visible = this.group.visible && trailAlpha > 0.02;

    // Floor glow under the tip
    const h = Math.max(0, this.tip.y);
    this.floorGlow.position.set(this.tip.x, 0.012, this.tip.z);
    const fs = 0.6 + h * 0.5;
    this.floorGlow.scale.set(fs, fs, 1);
    this.floorGlow.material.opacity = Math.max(0, 0.9 - h * 0.4) * ext;

    // Motion particles
    if (this.particles && this.tipSpeed > 2.5 && ext > 0.9) {
      const n = this.tipSpeed > 6 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const t = 0.45 + Math.random() * 0.55;
        const x = this.base.x + (this.tip.x - this.base.x) * t;
        const y = this.base.y + (this.tip.y - this.base.y) * t;
        const z = this.base.z + (this.tip.z - this.base.z) * t;
        this.particles.emit(x, y, z,
          (Math.random() - 0.5) * 0.6 - this.tipVel.x * 0.05,
          (Math.random() - 0.5) * 0.6 - this.tipVel.y * 0.05,
          (Math.random() - 0.5) * 0.6 - this.tipVel.z * 0.05,
          0.75, 0.45, 1.0, 0.3 + Math.random() * 0.25, 3, -0.5);
      }
    }
  }

  _writeTrail(i) {
    const tp = this.trailPos;
    const k = i * 6;
    // inner edge at 25% of the blade, outer edge at the tip
    tp[k] = this.base.x + (this.tip.x - this.base.x) * 0.25;
    tp[k + 1] = this.base.y + (this.tip.y - this.base.y) * 0.25;
    tp[k + 2] = this.base.z + (this.tip.z - this.base.z) * 0.25;
    tp[k + 3] = this.tip.x; tp[k + 4] = this.tip.y; tp[k + 5] = this.tip.z;
  }
}
