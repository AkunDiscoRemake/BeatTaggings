// In-game HUD: two small angled panels (score/combo/multiplier, song progress/energy) and a
// damage vignette attached to the camera. Redrawn at most ~10 times per second.
import * as THREE from '../../vendor/three.module.js';
import { CanvasPanel } from './panel.js';
import { CSS_COLORS } from '../core/config.js';

function fmtTime(s) {
  s = Math.max(0, Math.floor(s));
  return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
}

export class Hud {
  constructor(rig, camera) {
    this.group = new THREE.Group();
    rig.add(this.group);
    this.left = new CanvasPanel(512, 320, 0.72, { transparent: true, passive: true });
    this.right = new CanvasPanel(512, 320, 0.72, { transparent: true, passive: true });
    this.left.mesh.position.set(-1.05, 0.72, -1.9);
    this.left.mesh.rotation.set(-0.35, 0.42, 0);
    this.right.mesh.position.set(1.05, 0.72, -1.9);
    this.right.mesh.rotation.set(-0.35, -0.42, 0);
    this.group.add(this.left.mesh, this.right.mesh);
    this.left.setDraw(this._drawLeft.bind(this));
    this.right.setDraw(this._drawRight.bind(this));
    this.state = { score: 0, combo: 0, mult: 1, multProg: 0, energy: 0.5, progress: 0, time: 0, total: 0, title: '', fps: 0, showFps: false, acc: 1 };
    this._acc = 0;
    this.comboFlash = 0;

    // Damage vignette (wall / miss) in front of the camera.
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 20, 64, 64, 90);
    g.addColorStop(0, 'rgba(255,40,120,0)');
    g.addColorStop(1, 'rgba(255,40,120,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    this.vignette = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }));
    this.vignette.position.z = -0.2;
    this.vignette.renderOrder = 100;
    this.vignette.visible = false;
    camera.add(this.vignette);
    this.damage = 0;
  }

  setVisible(v) { this.group.visible = v; if (!v) { this.vignette.visible = false; this.damage = 0; } }

  flashDamage(a) { this.damage = Math.min(0.8, this.damage + a); }

  update(dt, game, fps, showFps) {
    const sc = game.score;
    const st = this.state;
    const changedL = st.score !== sc.score || st.combo !== sc.combo || st.mult !== sc.multiplier || st.multProg !== sc.multiplierProgress || (showFps && Math.round(fps) !== st.fps);
    const prog = game.progress;
    const changedR = Math.abs(st.energy - sc.energy) > 0.004 || Math.abs(st.progress - prog) > 0.004;
    st.score = sc.score; st.combo = sc.combo; st.mult = sc.multiplier; st.multProg = sc.multiplierProgress;
    st.energy = Math.max(0, sc.energy); st.progress = prog; st.time = Math.max(0, game.songTime); st.total = game.endTime || 0;
    st.fps = Math.round(fps); st.showFps = showFps; st.acc = sc.accuracy;
    st.title = game.song ? game.song.title : '';
    st.inWall = game.inWall;
    if (changedL) this.left.invalidate();
    if (changedR) this.right.invalidate();
    this._acc += dt;
    if (this._acc > 0.1) {
      this._acc = 0;
      this.left.redrawIfDirty();
      this.right.redrawIfDirty();
    }
    // damage vignette
    if (game.inWall) this.damage = Math.max(this.damage, 0.55);
    this.damage = Math.max(0, this.damage - dt * 1.8);
    this.vignette.visible = this.damage > 0.01;
    this.vignette.material.opacity = this.damage;
  }

  _drawLeft(p) {
    const s = this.state;
    const ctx = p.ctx;
    p.rect(0, 0, 512, 320, 'rgba(10,3,20,0.55)', 24);
    p.text('PONTOS', 30, 40, 26, CSS_COLORS.dim, 'left', '700');
    p.glowText(String(s.score).replace(/\B(?=(\d{3})+(?!\d))/g, '.'), 30, 100, 60, '#ffffff', CSS_COLORS.purple, 'left');
    p.text('COMBO', 30, 170, 26, CSS_COLORS.dim, 'left', '700');
    p.glowText(String(s.combo), 30, 228, 64, s.combo >= 50 ? '#ffd1ff' : '#ffffff', CSS_COLORS.note0, 'left');
    p.text('Precisão ' + (s.acc * 100).toFixed(1) + '%', 30, 290, 26, CSS_COLORS.purpleHot, 'left', '700');
    // multiplier ring
    const cx = 410, cy = 175, r = 72;
    ctx.lineWidth = 14;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = CSS_COLORS.purpleHot;
    ctx.shadowColor = CSS_COLORS.purple; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * s.multProg); ctx.stroke();
    ctx.shadowBlur = 0;
    p.glowText('x' + s.mult, cx, cy + 4, 58, '#ffffff', CSS_COLORS.purple, 'center');
    if (s.showFps) p.text(s.fps + ' FPS', 482, 34, 24, s.fps >= 68 ? CSS_COLORS.good : CSS_COLORS.bad, 'right', '700');
  }

  _drawRight(p) {
    const s = this.state;
    p.rect(0, 0, 512, 320, 'rgba(10,3,20,0.55)', 24);
    p.text(s.title, 30, 44, 30, '#ffffff', 'left', '800', 452);
    p.text(fmtTime(s.time) + ' / ' + fmtTime(s.total), 30, 96, 28, CSS_COLORS.dim, 'left', '600');
    p.bar(30, 124, 452, 18, s.progress, CSS_COLORS.purpleHot);
    p.text('ENERGIA', 30, 190, 26, CSS_COLORS.dim, 'left', '700');
    const ec = s.energy > 0.3 ? CSS_COLORS.good : CSS_COLORS.bad;
    p.bar(30, 214, 452, 30, s.energy, ec);
    if (s.inWall) p.glowText('DESVIE!', 256, 284, 40, '#ffffff', CSS_COLORS.bad, 'center');
  }
}
