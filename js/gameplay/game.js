// Core gameplay: object timeline synced to the audio clock, spawning, swept saber collision,
// judgement, obstacle (bomb / wall) handling and song completion.
import { LAYOUT, SCORING } from '../core/config.js';
import { CUT_ANGLE, CUT_VECTOR, CUT_ANY, spawnAheadSeconds } from '../songs/mapparser.js';
import { ScoreKeeper } from './scoring.js';

const SWEEP_SAMPLES = 4;
const NOTE_HALF = LAYOUT.noteSize / 2 + 0.07;  // generous hitbox for 3DoF play
const BOMB_HALF = LAYOUT.noteSize * 0.45 + 0.02;

function laneX(x) { return (x - 1.5) * LAYOUT.laneWidth; }
function layerY(y) { return LAYOUT.layerBase + y * LAYOUT.layerHeight; }
function wallY(layer) { return layer <= 0 ? 0 : LAYOUT.layerBase + (layer - 0.5) * LAYOUT.layerHeight; }

// Segment (a->b) vs AABB centered at c with half-size h. Returns entry fraction or -1.
function segmentAABB(ax, ay, az, bx, by, bz, cx, cy, cz, h) {
  let tmin = 0, tmax = 1;
  const d = [bx - ax, by - ay, bz - az];
  const o = [ax - cx, ay - cy, az - cz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < -h || o[i] > h) return -1;
    } else {
      let t1 = (-h - o[i]) / d[i];
      let t2 = (h - o[i]) / d[i];
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

function pointSegmentDistance(px, py, pz, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const l2 = dx * dx + dy * dy + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + dx * t - px, qy = ay + dy * t - py, qz = az + dz * t - pz;
  return Math.sqrt(qx * qx + qy * qy + qz * qz);
}

export class Game {
  constructor(deps) {
    this.objects = deps.objects;
    this.particles = deps.particles;
    this.audio = deps.audio;
    this.saber = deps.saber;
    this.env = deps.env;
    this.settings = deps.settings;
    this.input = deps.input;
    this.score = new ScoreKeeper();
    this.notes = []; this.bombs = []; this.walls = [];
    this.activeNotes = []; this.activeBombs = []; this.activeWalls = [];
    this.running = false;
    this.finished = false;
    this.songTime = 0;
    this.onFinish = null;
    this.events = []; // feedback events for the HUD: {type}
    this._lastBeat = -1;
    this._inWall = false;
    this._wallSfxT = 0;
    this.hitLog = null; // set to [] to record per-hit details (debug/tests)
    this.pending = [];
    for (let i = 0; i < 16; i++) this.pending.push({ active: false, n: null, x: 0, y: 0, z: 0, t0: 0, best: 0, peak: 0, dirOk: true });
  }

  // song = { audioBuffer, bpm, map:{notes,bombs,walls}, njs, startBeatOffset }
  load(song) {
    this.song = song;
    this.notes = song.map.notes.map(function (n) { return { t: n.t, x: n.x, y: n.y, c: n.c, d: n.d, done: false }; });
    this.bombs = song.map.bombs.map(function (b) { return { t: b.t, x: b.x, y: b.y, done: false }; });
    this.walls = song.map.walls.map(function (w) {
      const y0 = wallY(w.y), y1 = wallY(w.y) + w.h * 0.6;
      return {
        t: w.t, dur: w.dur,
        x0: (w.x - 2) * LAYOUT.laneWidth, x1: (w.x + w.w - 2) * LAYOUT.laneWidth,
        y0: y0, y1: y1,
        harmful: y0 < LAYOUT.headHeight + 0.05 && y1 > LAYOUT.headHeight - 0.25,
        overhead: w.y >= 2,
      };
    });
    const njs = Math.max(8, Math.min(22, song.njs > 0 ? song.njs : 10));
    this.speed = njs * this.settings.get('noteSpeed');
    let ahead = spawnAheadSeconds(song.bpm, njs, song.startBeatOffset || 0);
    ahead = Math.min(ahead, LAYOUT.maxSpawnDistance / this.speed);
    this.spawnAhead = ahead;
    let last = 0;
    for (const n of this.notes) last = Math.max(last, n.t);
    for (const b of this.bombs) last = Math.max(last, b.t);
    for (const w of this.walls) last = Math.max(last, w.t + w.dur);
    this.lastObjectTime = last;
    const audioDur = song.audioBuffer ? song.audioBuffer.duration : last + 3;
    this.endTime = Math.max(last + 1.5, Math.min(audioDur, last + 4));
    this.duration = audioDur;
  }

  start() {
    this.score.reset();
    this.score.totalNotes = this.notes.length;
    for (const n of this.notes) n.done = false;
    for (const b of this.bombs) b.done = false;
    this.ni = 0; this.bi = 0; this.wi = 0;
    this.activeNotes.length = 0; this.activeBombs.length = 0; this.activeWalls.length = 0;
    for (const p of this.pending) p.active = false;
    this.objects.clearTransient();
    this.particles.clear();
    this.finished = false;
    this.running = true;
    this.events.length = 0;
    this._lastBeat = -1;
    this._inWall = false;
    // Lead-in so the first objects have time to travel.
    const first = this.notes.length ? this.notes[0].t : 0;
    const leadIn = Math.max(1.5, this.spawnAhead + 0.8 - first);
    this.audio.playMusic(this.song.audioBuffer, -leadIn, 0.1);
    this.songTime = -leadIn;
  }

  pause() {
    if (!this.running) return;
    this.pausedTime = this.songTime;
    this.audio.stopMusic();
    this.running = false;
  }

  resume() {
    if (this.finished) return;
    this.audio.playMusic(this.song.audioBuffer, this.pausedTime, 0.05);
    this.songTime = this.pausedTime;
    this.running = true;
  }

  stop() {
    this.running = false;
    this.audio.stopMusic();
    this.objects.clearTransient();
  }

  get progress() { return this.duration ? Math.max(0, Math.min(1, this.songTime / this.endTime)) : 0; }

  // head: {x, y, z} world-space head position.
  update(dt, head) {
    if (!this.running) { this._render(); return; }
    const offset = this.settings.get('audioOffsetMs') / 1000;
    this.songTime = this.audio.songTime() - offset;
    const t = this.songTime;
    const v = this.speed;
    const hitZ = LAYOUT.hitZ;

    // beat pulse for the environment
    const beat = Math.floor(t * this.song.bpm / 60);
    if (beat !== this._lastBeat && t > 0) { this._lastBeat = beat; this.env.beat(0.25); }

    // ---- spawn ----
    const horizon = t + this.spawnAhead;
    while (this.ni < this.notes.length && this.notes[this.ni].t <= horizon) this.activeNotes.push(this.notes[this.ni++]);
    while (this.bi < this.bombs.length && this.bombs[this.bi].t <= horizon) this.activeBombs.push(this.bombs[this.bi++]);
    while (this.wi < this.walls.length && this.walls[this.wi].t <= horizon) this.activeWalls.push(this.walls[this.wi++]);

    const s = this.saber;
    const strict = this.settings.get('strictDirection');

    // ---- notes ----
    let w = 0;
    for (let i = 0; i < this.activeNotes.length; i++) {
      const n = this.activeNotes[i];
      const z = hitZ + (t - n.t) * v;
      const x = laneX(n.x), y = layerY(n.y);
      if (!n.done && z > -3.2 && z < LAYOUT.missZ) {
        const res = this._sweep(x, y, z, v * dt, NOTE_HALF);
        if (res >= 0 && s.tipSpeed > 0.5) {
          this._cut(n, x, y, z, strict);
          continue;
        }
      }
      if (!n.done && z >= LAYOUT.missZ) {
        n.done = true;
        this.score.miss();
        this.audio.play('miss', 1, 0.8);
        this.objects.popup('miss', x, y + 0.3, -1.2);
        this.events.push('miss');
        continue;
      }
      if (n.done) continue;
      this.activeNotes[w++] = n;
    }
    this.activeNotes.length = w;
    this._updatePending(dt, false);

    // ---- bombs / black blocks ----
    w = 0;
    for (let i = 0; i < this.activeBombs.length; i++) {
      const b = this.activeBombs[i];
      const z = hitZ + (t - b.t) * v;
      const x = laneX(b.x), y = layerY(b.y);
      if (z > LAYOUT.despawnZ) continue;
      if (z > -3.2 && z < 0.6 && this._sweep(x, y, z, v * dt, BOMB_HALF) >= 0) {
        this.score.bomb();
        this.audio.play('bomb');
        this.particles.burst(x, y, z, 26, 3.2, 1.0, 0.25, 0.6, 0.6);
        this.particles.burst(x, y, z, 10, 1.5, 0.3, 0.3, 0.3, 0.8);
        this.objects.popup('bomb', x, y + 0.3, -1.2);
        this.input.haptic(1, 120);
        this.events.push('bomb');
        continue;
      }
      this.activeBombs[w++] = b;
    }
    this.activeBombs.length = w;

    // ---- walls ----
    w = 0;
    let inWall = false;
    const r = LAYOUT.headRadius;
    for (let i = 0; i < this.activeWalls.length; i++) {
      const wl = this.activeWalls[i];
      const zNear = hitZ + (t - wl.t) * v;
      const zFar = zNear - wl.dur * v;
      if (zFar > LAYOUT.despawnZ) continue;
      if (wl.harmful && zFar - r <= head.z && zNear + r >= head.z &&
          head.x + r > wl.x0 && head.x - r < wl.x1 && head.y + r > wl.y0 && head.y - r < wl.y1) inWall = true;
      this.activeWalls[w++] = wl;
    }
    this.activeWalls.length = w;
    if (inWall) {
      if (!this._inWall) { this.score.wallEnter(); this.events.push('wall'); }
      this.score.wallDrain(dt);
      this._wallSfxT -= dt;
      if (this._wallSfxT <= 0) { this.audio.play('wall'); this._wallSfxT = 0.18; this.input.haptic(0.5, 60); }
    }
    this._inWall = inWall;
    this.inWall = inWall;

    // ---- fail / finish ----
    if (this.score.energy <= 0) {
      if (this.settings.get('noFail')) this.score.energy = 0;
      else { this._end(true); return; }
    }
    if (t >= this.endTime && this.activeNotes.length === 0) this._end(false);
    this._render();
  }

  // Swept test of the blade between last frame and this frame against a moving box.
  // On contact also records the closest approach of the blade to the box center.
  _sweep(cx, cy, cz, travel, half) {
    const s = this.saber;
    let hit = -1;
    let best = 1e9;
    for (let k = 0; k <= SWEEP_SAMPLES; k++) {
      const f = k / SWEEP_SAMPLES;
      const ax = s.prevBase.x + (s.base.x - s.prevBase.x) * f;
      const ay = s.prevBase.y + (s.base.y - s.prevBase.y) * f;
      const az = s.prevBase.z + (s.base.z - s.prevBase.z) * f;
      const bx = s.prevTip.x + (s.tip.x - s.prevTip.x) * f;
      const by = s.prevTip.y + (s.tip.y - s.prevTip.y) * f;
      const bz = s.prevTip.z + (s.tip.z - s.prevTip.z) * f;
      const z = cz - travel * (1 - f);
      const d = pointSegmentDistance(cx, cy, z, ax, ay, az, bx, by, bz);
      if (d < best) best = d;
      if (hit < 0 && segmentAABB(ax, ay, az, bx, by, bz, cx, cy, z, half) >= 0) hit = f;
    }
    this._hitCenterDist = best;
    return hit;
  }

  _cut(n, x, y, z, strict) {
    n.done = true;
    const s = this.saber;
    // swing direction in the XY plane: this frame's tip displacement (falls back to smoothed velocity)
    let sx = s.tip.x - s.prevTip.x, sy = s.tip.y - s.prevTip.y;
    if (Math.hypot(sx, sy) < 0.01) { sx = s.tipVel.x; sy = s.tipVel.y; }
    const sl = Math.hypot(sx, sy);
    let dirOk = true;
    if (n.d !== CUT_ANY && sl > 1e-3) {
      const cv = CUT_VECTOR[n.d];
      dirOk = (sx * cv[0] + sy * cv[1]) / sl >= 0.35;
    }
    if (sl > 1e-4) { sx /= sl; sy /= sl; } else { sx = 0; sy = -1; }
    if (strict && !dirOk) {
      this.score.badCut();
      this.audio.play('miss', 1.2, 0.7);
      this.objects.popup('direction', x, y + 0.3, -1.2);
      this.objects.spawnDebris(x, y, z, sx, sy, n.c, s.tipSpeed * 0.5);
      this.events.push('badcut');
      return;
    }
    // Immediate feedback; the score is finalized after the follow-through (see _updatePending).
    this.objects.spawnDebris(x, y, z, sx, sy, n.c, s.tipSpeed);
    const col = n.c === 0 ? [1.0, 0.25, 0.85] : [0.6, 0.4, 1.0];
    this.particles.burst(x, y, z, 14, 2.6, col[0], col[1], col[2], 0.5, [sx * 1.2, sy * 1.2, 0.8]);
    this.particles.burst(x, y, z, 6, 1.4, 1, 1, 1, 0.35);
    this.audio.play('hit', 0.92 + Math.random() * 0.16);
    this.saber.hitFlash(0.7);
    this.env.beat(0.45);
    this.input.haptic(0.6, 30);
    this.events.push('hit');
    let p = null;
    for (let i = 0; i < this.pending.length; i++) if (!this.pending[i].active) { p = this.pending[i]; break; }
    if (!p) { this._finalize({ n: n, x: x, y: y, z: z, best: this._hitCenterDist, peak: Math.max(s.tipSpeed, s.swingPeak), dirOk: dirOk }); return; }
    p.active = true; p.n = n; p.x = x; p.y = y; p.z = z; p.t0 = this.songTime;
    p.best = this._hitCenterDist; p.peak = Math.max(s.tipSpeed, s.swingPeak); p.dirOk = dirOk;
  }

  // Follow-through tracking: closest approach of the blade to where the note would be.
  _updatePending(dt, flushAll) {
    const v = this.speed;
    for (let i = 0; i < this.pending.length; i++) {
      const p = this.pending[i];
      if (!p.active) continue;
      if (!flushAll) {
        const z = LAYOUT.hitZ + (this.songTime - p.n.t) * v;
        this._sweep(p.x, p.y, z, v * dt, 0);
        if (this._hitCenterDist < p.best) p.best = this._hitCenterDist;
        p.peak = Math.max(p.peak, this.saber.tipSpeed);
      }
      if (flushAll || this.songTime - p.t0 >= 0.07) { this._finalize(p); p.active = false; }
    }
  }

  _finalize(p) {
    const center = 1 - Math.min(1, p.best / NOTE_HALF);
    const pts = ScoreKeeper.cutPoints(p.peak, center, p.dirOk);
    this.score.hit(pts);
    if (this.hitLog) this.hitLog.push({ pts: pts, speed: +p.peak.toFixed(2), center: +center.toFixed(2), dirOk: p.dirOk });
    const j = p.dirOk ? ScoreKeeper.judgement(pts) : 'direction';
    this.objects.popup(j, p.x, p.y + 0.32, Math.min(p.z + 0.2, -0.6));
  }

  _end(failed) {
    if (this.finished) return;
    this._updatePending(0, true);
    this.finished = true;
    this.running = false;
    this.score.failed = failed;
    if (failed) { this.audio.fadeOutMusic(1.2); this.audio.play('fail'); }
    else { this.audio.fadeOutMusic(1.5); if (this.score.result().fullCombo) this.audio.play('clear'); }
    if (this.onFinish) this.onFinish(this.score.result());
  }

  // Draw all active objects at the current song time.
  _render() {
    const t = this.songTime;
    const v = this.speed || 10;
    const hitZ = LAYOUT.hitZ;
    const o = this.objects;
    o.beginFrame();
    for (let i = 0; i < this.activeNotes.length; i++) {
      const n = this.activeNotes[i];
      const z = hitZ + (t - n.t) * v;
      const age = t - (n.t - this.spawnAhead);
      const a = Math.min(1, Math.max(0, age / 0.32));
      const e = 1 - (1 - a) * (1 - a);
      const isDot = n.d === CUT_ANY;
      o.addNote(laneX(n.x), layerY(n.y) - (1 - e) * 0.9, z, (isDot ? 0 : CUT_ANGLE[n.d]) + (1 - e) * 1.2, 0.25 + 0.75 * e, n.c, isDot, (1 - e) * 2.0);
    }
    for (let i = 0; i < this.activeBombs.length; i++) {
      const b = this.activeBombs[i];
      const z = hitZ + (t - b.t) * v;
      const age = t - (b.t - this.spawnAhead);
      const a = Math.min(1, Math.max(0, age / 0.32));
      o.addBomb(laneX(b.x), layerY(b.y) - (1 - a) * 0.9, z, t * 1.3 + b.t, 0.3 + 0.7 * a);
    }
    o.endFrame();
    let wi = 0;
    for (let i = 0; i < this.activeWalls.length && wi < o.maxWalls; i++) {
      const wl = this.activeWalls[i];
      const zNear = hitZ + (t - wl.t) * v;
      const zFar = zNear - wl.dur * v;
      const age = t - (wl.t - this.spawnAhead);
      const a = Math.min(1, Math.max(0, age / 0.4));
      o.setWall(wi++, wl.x0, wl.x1, wl.y0, wl.y0 + (wl.y1 - wl.y0) * a, Math.min(zNear, 4), Math.max(zFar, -60));
    }
    o.hideWallsFrom(wi);
  }

  // ---------- debug autoplay helpers ----------
  // Writes a rig-space aim point for the saber; returns false when idle.
  autoAim(out, rigX) {
    const t = this.songTime;
    let best = null;
    for (let i = 0; i < this.activeNotes.length; i++) {
      const n = this.activeNotes[i];
      const dt = n.t - t;
      if (!n.done && dt > -0.08 && dt < 0.5 && (!best || n.t < best.t)) best = n;
    }
    if (!best) { out.set(0.25, 1.1, -1.5); return true; }
    const dt = best.t - t;
    const z = LAYOUT.hitZ - dt * this.speed;
    const d = best.d === CUT_ANY ? 1 : best.d;
    const cv = CUT_VECTOR[d];
    const k = Math.max(-1, Math.min(1, dt / 0.09)) * 0.7;
    out.set(laneX(best.x) - rigX - cv[0] * k, layerY(best.y) - cv[1] * k, z);
    return true;
  }

  // Next barrier the player must react to: 'crouch' | 'side' | null (HUD warning).
  upcomingBarrier() {
    const t = this.songTime;
    for (let i = 0; i < this.activeWalls.length; i++) {
      const wl = this.activeWalls[i];
      if (!wl.harmful) continue;
      const until = wl.t - t;
      if (until < 1.4 && wl.t + wl.dur + 0.2 > t) return wl.overhead ? 'crouch' : 'side';
    }
    return null;
  }

  // Debug autoplay: crouch while an overhead barrier passes the head.
  autoCrouch() {
    const t = this.songTime;
    for (let i = 0; i < this.walls.length; i++) {
      const wl = this.walls[i];
      if (wl.overhead && wl.t - 0.35 < t && wl.t + wl.dur + 0.25 > t) return 1;
      if (wl.t > t + 1) break;
    }
    return 0;
  }

  autoDodge(headX) {
    const t = this.songTime;
    for (let i = 0; i < this.walls.length; i++) {
      const wl = this.walls[i];
      if (!wl.harmful || wl.overhead || wl.t + wl.dur < t - 0.2 || wl.t > t + 1.2) continue;
      const r = LAYOUT.headRadius + 0.1;
      if (headX + r > wl.x0 && headX - r < wl.x1) {
        const left = wl.x0 - r, right = wl.x1 + r;
        const target = Math.abs(left - headX) < Math.abs(right - headX) ? left : right;
        return Math.max(-LAYOUT.lateralRange, Math.min(LAYOUT.lateralRange, target)) / LAYOUT.lateralRange;
      }
      if (headX + r + 0.1 > wl.x0 && headX - r - 0.1 < wl.x1) return headX / LAYOUT.lateralRange;
    }
    return 0;
  }
}
