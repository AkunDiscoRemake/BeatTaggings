// Posture tracking for crouching (ducking under barriers) and leaning sideways.
//
// Sources, combined:
//  1. Accelerometer — DeviceMotionEvent (the Oculus Go has an IMU; the browser may expose it).
//     Orientation-independent: gravity is estimated with a low-pass filter, the vertical
//     linear acceleration is the projection on that gravity direction, and a leaky double
//     integration turns it into a short-term vertical/lateral displacement (a "duck" or a lean).
//  2. Head tilt — WebXR head orientation: bowing the head down = crouch, rolling it = lean.
//     Always available, used alone when no accelerometer data arrives.
//  3. Touchpad (optional mode) — bottom of the pad = crouch.

const G = 9.81;

export class PostureTracker {
  constructor() {
    this.crouch = 0;          // 0 standing .. 1 fully crouched
    this.lean = 0;            // -1 left .. 1 right
    this.source = 'nenhum';
    // accelerometer state
    this.motionEvents = 0;
    this.lastMotionAt = 0;
    this.hasAccel = false;
    this.g = [0, 0, 0];       // gravity estimate (device frame)
    this.gMag = 9.81;         // gravity magnitude estimate (slow)
    this.gInit = false;
    this.vy = 0; this.dy = 0; // vertical velocity / displacement (m), + = up
    this.vx = 0; this.dx = 0; // lateral velocity / displacement (m), + = right
    this.accelCrouch = 0;
    this.accelLean = 0;
    this.rawVert = 0;
    this.rawLat = 0;
    // tilt state
    this.pitchDeg = 0;
    this.rollDeg = 0;
    this.tiltCrouch = 0;
    this.tiltLean = 0;
    this._listening = false;
  }

  // Must be called from a user gesture (iOS needs a permission prompt; Chromium does not).
  start() {
    if (this._listening || typeof window === 'undefined' || !('DeviceMotionEvent' in window)) return;
    const self = this;
    const listen = function () {
      if (self._listening) return;
      self._listening = true;
      window.addEventListener('devicemotion', function (e) { self._onMotion(e); });
    };
    try {
      if (typeof DeviceMotionEvent.requestPermission === 'function') {
        DeviceMotionEvent.requestPermission().then(function (r) { if (r === 'granted') listen(); }, function () { /* denied */ });
      } else {
        listen();
      }
    } catch (e) { /* ignore */ }
  }

  _onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null || a.x === undefined) return;
    const ax = a.x || 0, ay = a.y || 0, az = a.z || 0;
    const mag = Math.sqrt(ax * ax + ay * ay + az * az);
    if (mag < 1) return; // no real data
    const now = performance.now();
    let dt = this.lastMotionAt ? (now - this.lastMotionAt) / 1000 : 0.016;
    if (e.interval) dt = e.interval > 1 ? e.interval / 1000 : e.interval; // ms or s depending on browser
    dt = Math.min(0.05, Math.max(0.004, dt));
    this.lastMotionAt = now;
    this.motionEvents++;
    this.hasAccel = true;
    const g = this.g;
    if (!this.gInit) { g[0] = ax; g[1] = ay; g[2] = az; this.gMag = mag; this.gInit = true; }
    // gravity low-pass (~0.6 s)
    const k = Math.min(1, dt / 0.6);
    g[0] += (ax - g[0]) * k; g[1] += (ay - g[1]) * k; g[2] += (az - g[2]) * k;
    const gl = Math.sqrt(g[0] * g[0] + g[1] * g[1] + g[2] * g[2]) || G;
    const ux = g[0] / gl, uy = g[1] / gl, uz = g[2] / gl;     // "up" in device frame
    const lx = ax - g[0], ly = ay - g[1], lz = az - g[2];    // linear acceleration
    // Vertical linear acceleration from the MAGNITUDE of the measured vector: invariant to head
    // rotation (turning or nodding the head does not look like a duck).
    this.gMag += (mag - this.gMag) * Math.min(1, dt / 3);
    const vert = mag - this.gMag;                             // + = accelerating upward
    // device X axis with the gravity component removed = lateral direction
    let sx = 1 - ux * ux, sy = -ux * uy, sz = -ux * uz;
    const sl = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
    sx /= sl; sy /= sl; sz /= sl;
    const lat = lx * sx + ly * sy + lz * sz;
    this.rawVert = vert;
    this.rawLat = lat;
    // dead-zone against sensor noise
    const dv = Math.abs(vert) < 0.25 ? 0 : vert;
    const dl = Math.abs(lat) < 0.3 ? 0 : lat;
    // leaky double integration -> short-term displacement that returns to 0 when still
    this.vy = (this.vy + dv * dt) * Math.exp(-dt * 2.2);
    this.dy = (this.dy + this.vy * dt) * Math.exp(-dt * 0.45);
    this.vx = (this.vx + dl * dt) * Math.exp(-dt * 2.2);
    this.dx = (this.dx + this.vx * dt) * Math.exp(-dt * 0.6);
  }

  get accelActive() { return this.hasAccel && performance.now() - this.lastMotionAt < 500; }

  // headQuat: head orientation (THREE.Quaternion) or null; mode: auto | tilt | touchpad | off
  // sens: 0.7 (low) .. 1.4 (high); touch: {active, x, y}
  // assist: an overhead barrier is coming -> much easier thresholds.
  // touch.press: touchpad clicked (held) -> crouch in every mode except 'off'.
  update(dt, headQuat, mode, sens, touch, assist) {
    sens = sens || 1;
    // --- head tilt ---
    if (headQuat) {
      // Euler YXZ: pitch = rotation about X, roll = about Z
      const q = headQuat;
      const sinp = 2 * (q.w * q.x - q.y * q.z);
      const pitch = Math.asin(Math.max(-1, Math.min(1, sinp)));
      const roll = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.x * q.x + q.z * q.z));
      this.pitchDeg = pitch * 180 / Math.PI;
      this.rollDeg = roll * 180 / Math.PI;
      const start = (assist ? 17 : 42) / sens, full = start + (assist ? 12 : 18);
      this.tiltCrouch = clamp01((-this.pitchDeg - start) / (full - start));
      const r = Math.abs(this.rollDeg);
      this.tiltLean = clamp01((r - 9 / sens) / 18) * (this.rollDeg > 0 ? -1 : 1);
    } else {
      this.tiltCrouch = 0; this.tiltLean = 0;
    }
    // --- accelerometer ---
    if (this.accelActive) {
      this.accelCrouch = clamp01((-this.dy - (assist ? 0.025 : 0.05)) / ((assist ? 0.08 : 0.15) / sens));
      this.accelLean = Math.max(-1, Math.min(1, this.dx / (0.2 / sens)));
    } else {
      this.accelCrouch = 0; this.accelLean = 0;
    }

    let c = 0, l = 0, src = 'desligado';
    if (mode === 'auto') {
      c = Math.max(this.accelCrouch, this.tiltCrouch);
      l = Math.abs(this.accelLean) > Math.abs(this.tiltLean) ? this.accelLean : this.tiltLean;
      src = this.accelActive ? 'acelerômetro + inclinação da cabeça' : 'inclinação da cabeça';
    } else if (mode === 'tilt') {
      c = this.tiltCrouch; l = this.tiltLean; src = 'inclinação da cabeça';
    } else if (mode === 'touchpad') {
      c = touch && touch.active && touch.y > 0.45 ? 1 : 0; src = 'touchpad (parte de baixo)';
    }
    if (mode !== 'off' && touch && touch.press) c = 1; // clicking the touchpad always crouches
    this.source = src;
    const k = Math.min(1, dt * 12);
    this.crouch += (c - this.crouch) * k;
    this.lean += (l - this.lean) * k;
    return this;
  }

  // forced values (debug autoplay / keyboard)
  force(crouch, lean, dt) {
    const k = Math.min(1, dt * 12);
    this.crouch += (crouch - this.crouch) * k;
    this.lean += (lean - this.lean) * k;
  }
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
