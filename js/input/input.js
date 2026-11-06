// Input: Oculus Go 3DoF controller via WebXR (orientation only — positional data is ignored on
// purpose), touchpad, trigger, back button; plus mouse/keyboard fallback for flat-screen play.
//
// Outputs (read by the game every frame):
//   orientation  THREE.Quaternion   controller orientation in rig space
//   pointerOrigin/pointerDir         world-space ray for menus
//   trigger / triggerPressed / triggerReleased
//   touchActive, touchX, touchY      touchpad (-1..1)
//   touchClickPressed, backPressed, swipe (-1 / 0 / +1 vertical swipe this frame)
import * as THREE from '../../vendor/three.module.js';
import { LAYOUT } from '../core/config.js';

export class Input {
  constructor(renderer, camera, rig, domElement) {
    this.renderer = renderer;
    this.camera = camera;
    this.rig = rig;
    this.dom = domElement;

    this.orientation = new THREE.Quaternion();
    this.pointerOrigin = new THREE.Vector3();
    this.pointerDir = new THREE.Vector3(0, 0, -1);

    this.trigger = false;
    this.triggerPressed = false;
    this.triggerReleased = false;
    this.triggerHeld = 0;
    this.touchActive = false;
    this.touchX = 0;
    this.touchY = 0;
    this.touchClickPressed = false;
    this.backPressed = false;
    this.swipe = 0;
    this.moveAxis = 0; // keyboard lateral axis
    this.crouchKey = false; // flat mode: S / C / Ctrl
    this.leanKey = 0;       // flat mode: Q (-1) / E (+1)

    this.inputSource = null;
    this.controller = null;
    this._xrSelect = false;
    this._prevButtons = [];
    this._touchStartY = null;
    this._touchStartT = 0;

    // desktop state
    this.mouse = new THREE.Vector2(0, 0);
    this._mouseDown = false;
    this._clickLatch = false; // a press shorter than one frame still counts
    this._xrSelectLatch = false;
    this._prevTrigger = false;
    this._keys = {};
    this._keyPressed = {};
    this._wheel = 0;
    this._raycaster = new THREE.Raycaster();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._tmp3 = new THREE.Vector3();
    this._fwd = new THREE.Vector3(0, 0, -1);
    this._m = new THREE.Matrix4();
    this._rigInv = new THREE.Matrix4();
    this._q = new THREE.Quaternion();

    this.autoAim = null; // optional function(outPointRigSpace) -> bool (debug autoplay)

    this._setupXRController();
    this._setupDesktop();
  }

  get isXR() { return this.renderer.xr.isPresenting; }

  _setupXRController() {
    const self = this;
    // Track the first two controller slots; the Go only exposes one.
    for (let i = 0; i < 2; i++) {
      const c = this.renderer.xr.getController(i);
      this.rig.add(c);
      c.addEventListener('connected', function (e) {
        const src = e.data;
        // Prefer a right-handed / tracked-pointer source; Go reports handedness per system setting.
        if (!self.inputSource || (src && src.handedness === 'right')) {
          self.inputSource = src;
          self.controller = c;
        }
      });
      c.addEventListener('disconnected', function () {
        if (self.controller === c) { self.inputSource = null; self.controller = null; }
      });
      c.addEventListener('selectstart', function () { if (self.controller === c || !self.controller) { self._xrSelect = true; self._xrSelectLatch = true; } });
      c.addEventListener('selectend', function () { if (self.controller === c || !self.controller) self._xrSelect = false; });
    }
  }

  _setupDesktop() {
    const self = this;
    const el = this.dom;
    el.addEventListener('mousemove', function (e) {
      const r = el.getBoundingClientRect();
      self.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      self.mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    });
    el.addEventListener('mousedown', function (e) { if (e.button === 0) { self._mouseDown = true; self._clickLatch = true; } });
    window.addEventListener('mouseup', function (e) { if (e.button === 0) self._mouseDown = false; });
    el.addEventListener('wheel', function (e) { self._wheel += e.deltaY; e.preventDefault(); }, { passive: false });
    // touch screens (phones) act as a mouse
    el.addEventListener('touchstart', function (e) {
      const t = e.touches[0]; if (!t) return;
      const r = el.getBoundingClientRect();
      self.mouse.x = ((t.clientX - r.left) / r.width) * 2 - 1;
      self.mouse.y = -((t.clientY - r.top) / r.height) * 2 + 1;
      self._mouseDown = true;
      self._clickLatch = true;
    }, { passive: true });
    el.addEventListener('touchmove', function (e) {
      const t = e.touches[0]; if (!t) return;
      const r = el.getBoundingClientRect();
      self.mouse.x = ((t.clientX - r.left) / r.width) * 2 - 1;
      self.mouse.y = -((t.clientY - r.top) / r.height) * 2 + 1;
    }, { passive: true });
    el.addEventListener('touchend', function () { self._mouseDown = false; }, { passive: true });
    window.addEventListener('keydown', function (e) {
      if (!self._keys[e.code]) self._keyPressed[e.code] = true;
      self._keys[e.code] = true;
    });
    window.addEventListener('keyup', function (e) { self._keys[e.code] = false; });
    window.addEventListener('blur', function () { self._keys = {}; self._mouseDown = false; });
  }

  // Reads buttons/axes from the WebXR gamepad (Oculus Go: buttons[0]=trigger,
  // touchpad press at [2] (xr-standard) or [1]; touchpad axes at [0,1] or [2,3]).
  _readGamepad() {
    const src = this.inputSource;
    const gp = src && src.gamepad;
    let trig = this._xrSelect || this._xrSelectLatch, tClick = false, back = false, touched = false, ax = 0, ay = 0;
    if (gp) {
      const b = gp.buttons;
      if (b[0] && (b[0].pressed || b[0].value > 0.5)) trig = true;
      const padIndex = gp.mapping === 'xr-standard' ? 2 : (b.length > 2 ? 2 : 1);
      if (b[padIndex]) {
        tClick = b[padIndex].pressed;
        touched = b[padIndex].touched;
      }
      // Any other exposed button acts as "back" (the Go's back button when the browser exposes it).
      for (let i = 1; i < b.length; i++) {
        if (i === padIndex) continue;
        if (b[i] && b[i].pressed && !this._prevButtons[i]) back = true;
      }
      for (let i = 0; i < b.length; i++) this._prevButtons[i] = b[i] ? b[i].pressed : false;
      const a = gp.axes || [];
      const m01 = Math.abs(a[0] || 0) + Math.abs(a[1] || 0);
      const m23 = Math.abs(a[2] || 0) + Math.abs(a[3] || 0);
      if (m23 > m01) { ax = a[2] || 0; ay = a[3] || 0; } else { ax = a[0] || 0; ay = a[1] || 0; }
      if (ax !== 0 || ay !== 0) touched = true;
    }
    return { trig: trig, tClick: tClick, back: back, touched: touched, ax: ax, ay: ay };
  }

  update(dt, inGame) {
    let trig = false, tClick = false, back = false;
    this.swipe = 0;

    if (this.isXR) {
      const g = this._readGamepad();
      trig = g.trig; tClick = g.tClick; back = g.back;
      // touchpad + swipe detection
      if (g.touched) {
        if (!this.touchActive) { this._touchStartY = g.ay; this._touchStartT = 0; }
        this._touchStartT += dt;
        this.touchActive = true;
        this.touchX = g.ax; this.touchY = g.ay;
      } else {
        if (this.touchActive && this._touchStartY !== null && this._touchStartT < 0.6) {
          const dy = this.touchY - this._touchStartY;
          if (Math.abs(dy) > 0.6) this.swipe = dy > 0 ? 1 : -1;
        }
        this.touchActive = false; this.touchX = 0; this.touchY = 0; this._touchStartY = null;
      }
      if (this.controller) {
        // Orientation only: the browser's arm-model position is deliberately ignored (3DoF).
        this.orientation.copy(this.controller.quaternion);
      }
      // pointer ray from the saber pivot along the controller's forward
      this._tmp.set(LAYOUT.saberPivot.x, LAYOUT.saberPivot.y, LAYOUT.saberPivot.z);
      this.rig.localToWorld(this.pointerOrigin.copy(this._tmp));
      this.pointerDir.copy(this._fwd).applyQuaternion(this.orientation);
      this.rig.getWorldQuaternion(this._q);
      this.pointerDir.applyQuaternion(this._q).normalize();
    } else {
      // Desktop: mouse ray from the camera
      trig = this._mouseDown || this._clickLatch || !!this._keys.Space;
      back = !!(this._keyPressed.Escape || this._keyPressed.KeyP || this._keyPressed.Backspace);
      let axis = 0;
      if (this._keys.KeyA || this._keys.ArrowLeft) axis -= 1;
      if (this._keys.KeyD || this._keys.ArrowRight) axis += 1;
      this.crouchKey = !!(this._keys.KeyS || this._keys.KeyC || this._keys.ControlLeft);
      this.leanKey = (this._keys.KeyE ? 1 : 0) - (this._keys.KeyQ ? 1 : 0);
      this.touchActive = axis !== 0;
      this.touchX = axis;
      this.touchY = 0;
      if (this._wheel > 60) { this.swipe = 1; this._wheel = 0; } else if (this._wheel < -60) { this.swipe = -1; this._wheel = 0; }
      if (this._keyPressed.ArrowDown || this._keyPressed.PageDown) this.swipe = 1;
      if (this._keyPressed.ArrowUp || this._keyPressed.PageUp) this.swipe = -1;
      this._raycaster.setFromCamera(this.mouse, this.camera);
      this.pointerOrigin.copy(this._raycaster.ray.origin);
      this.pointerDir.copy(this._raycaster.ray.direction);
      // Saber aims at the point under the mouse on a plane in front of the player.
      const target = this._tmp;
      const planeZ = inGame ? -1.6 : -2.2;
      this.rig.updateMatrixWorld();
      this._rigInv.copy(this.rig.matrixWorld).invert();
      const o = this._tmp2.copy(this.pointerOrigin).applyMatrix4(this._rigInv);
      const d = this._q.copy(this.rig.quaternion).invert();
      const dir = this._tmp3.copy(this.pointerDir).applyQuaternion(d);
      const t = (planeZ - o.z) / (dir.z || -1e-3);
      target.copy(o).addScaledVector(dir, Math.max(0.1, t));
      this._aimAt(target);
    }

    if (this.autoAim) {
      const p = this._tmp;
      if (this.autoAim(p)) this._aimAt(p);
    }

    this.triggerPressed = trig && !this._prevTrigger;
    this.triggerReleased = !trig && this._prevTrigger;
    this._prevTrigger = trig;
    this.trigger = trig;
    this.triggerHeld = trig ? this.triggerHeld + dt : 0;
    this.touchClickPressed = tClick && !this._prevTClick;
    this._prevTClick = tClick;
    this.backPressed = back;
    this._keyPressed = {};
    this._clickLatch = false;
    this._xrSelectLatch = false;
  }

  // Orient the saber so the blade points from the pivot to `p` (rig space).
  _aimAt(p) {
    const dir = p.sub(this._tmp2.set(LAYOUT.saberPivot.x, LAYOUT.saberPivot.y, LAYOUT.saberPivot.z));
    if (dir.lengthSq() < 1e-6) return;
    dir.normalize();
    this.orientation.setFromUnitVectors(this._fwd, dir);
  }

  haptic(intensity, ms) {
    const gp = this.inputSource && this.inputSource.gamepad;
    if (!gp || !gp.hapticActuators || !gp.hapticActuators[0]) return;
    try { gp.hapticActuators[0].pulse(intensity, ms); } catch (e) { /* not supported (Go has no rumble) */ }
  }
}
