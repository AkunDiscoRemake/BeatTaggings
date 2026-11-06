// Canvas-backed 3D panel with an immediate-mode widget API and ray hit-testing.
// One texture per panel, redrawn only when something changes.
import * as THREE from '../../vendor/three.module.js';
import { CSS_COLORS } from '../core/config.js';
import { drawRoundRect } from '../render/textures.js';

export const FONT = '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export class CanvasPanel {
  constructor(pxW, pxH, worldW, opts) {
    this.pxW = pxW; this.pxH = pxH;
    this.worldW = worldW;
    this.worldH = worldW * pxH / pxW;
    this.canvas = document.createElement('canvas');
    this.canvas.width = pxW; this.canvas.height = pxH;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    const transparent = !!(opts && opts.transparent);
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(this.worldW, this.worldH),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: transparent, depthWrite: !transparent, fog: false })
    );
    this.mesh.renderOrder = transparent ? 30 : 0;
    this.regions = [];
    this.hoverId = null;
    this.dirty = true;
    this.drawFn = null;
    this.interactive = !(opts && opts.passive);
    this._inv = new THREE.Matrix4();
    this._o = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this.hit = { u: 0, v: 0, point: new THREE.Vector3(), distance: 0 };
  }

  setDraw(fn) { this.drawFn = fn; this.dirty = true; }
  invalidate() { this.dirty = true; }

  redrawIfDirty() {
    if (!this.dirty || !this.drawFn) return false;
    this.dirty = false;
    this.regions.length = 0;
    this.ctx.clearRect(0, 0, this.pxW, this.pxH);
    this.drawFn(this);
    this.texture.needsUpdate = true;
    return true;
  }

  // Ray (world) -> {u,v} in pixels or null.
  raycast(origin, dir) {
    if (!this.mesh.visible) return null;
    let p = this.mesh;
    while (p) { if (!p.visible) return null; p = p.parent; }
    this.mesh.updateMatrixWorld();
    this._inv.copy(this.mesh.matrixWorld).invert();
    this._o.copy(origin).applyMatrix4(this._inv);
    this._d.copy(dir).transformDirection(this._inv);
    if (Math.abs(this._d.z) < 1e-6) return null;
    const t = -this._o.z / this._d.z;
    if (t <= 0) return null;
    const x = this._o.x + this._d.x * t;
    const y = this._o.y + this._d.y * t;
    if (Math.abs(x) > this.worldW / 2 || Math.abs(y) > this.worldH / 2) return null;
    this.hit.u = (x / this.worldW + 0.5) * this.pxW;
    this.hit.v = (0.5 - y / this.worldH) * this.pxH;
    this.hit.point.set(x, y, 0).applyMatrix4(this.mesh.matrixWorld);
    this.hit.distance = this.hit.point.distanceTo(origin);
    return this.hit;
  }

  regionAt(u, v) {
    for (let i = this.regions.length - 1; i >= 0; i--) {
      const r = this.regions[i];
      if (!r.disabled && u >= r.x && u <= r.x + r.w && v >= r.y && v <= r.y + r.h) return r;
    }
    return null;
  }

  // Updates the hover state; returns true if hover changed.
  setPointer(u, v) {
    const r = u === null ? null : this.regionAt(u, v);
    const id = r ? r.id : null;
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.dirty = true;
      return true;
    }
    return false;
  }

  click(u, v) {
    const r = this.regionAt(u, v);
    if (r && r.onClick) { r.onClick(); return true; }
    return false;
  }

  // ---------------- drawing helpers ----------------
  bg(alpha) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.pxH);
    g.addColorStop(0, 'rgba(22,8,40,' + (alpha === undefined ? 0.94 : alpha) + ')');
    g.addColorStop(1, 'rgba(8,3,16,' + (alpha === undefined ? 0.94 : alpha) + ')');
    ctx.fillStyle = g;
    drawRoundRect(ctx, 4, 4, this.pxW - 8, this.pxH - 8, 28);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = CSS_COLORS.purple;
    ctx.shadowColor = CSS_COLORS.purple;
    ctx.shadowBlur = 16;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  text(str, x, y, size, color, align, weight, maxW) {
    const ctx = this.ctx;
    ctx.font = (weight || '600') + ' ' + size + 'px ' + FONT;
    ctx.fillStyle = color || CSS_COLORS.white;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    let s = String(str);
    if (maxW && ctx.measureText(s).width > maxW) {
      while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
      s += '…';
    }
    ctx.fillText(s, x, y);
  }

  glowText(str, x, y, size, color, glow, align) {
    const ctx = this.ctx;
    ctx.font = 'italic 900 ' + size + 'px "Arial Black", ' + FONT;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = glow;
    ctx.shadowBlur = size * 0.35;
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
    ctx.shadowBlur = 0;
    ctx.fillText(str, x, y);
  }

  rect(x, y, w, h, fill, r) {
    this.ctx.fillStyle = fill;
    drawRoundRect(this.ctx, x, y, w, h, r || 0);
    this.ctx.fill();
  }

  bar(x, y, w, h, frac, color, back) {
    this.rect(x, y, w, h, back || 'rgba(255,255,255,0.12)', h / 2);
    const f = Math.max(0, Math.min(1, frac));
    if (f > 0) this.rect(x, y, Math.max(h, w * f), h, color, h / 2);
  }

  // Interactive button. opts: {selected, disabled, size, accent, sub, align}
  button(id, x, y, w, h, label, onClick, opts) {
    opts = opts || {};
    const ctx = this.ctx;
    const hover = this.hoverId === id && !opts.disabled;
    const sel = !!opts.selected;
    const accent = opts.accent || CSS_COLORS.purple;
    ctx.save();
    if (hover || sel) { ctx.shadowColor = accent; ctx.shadowBlur = hover ? 22 : 12; }
    ctx.fillStyle = opts.disabled ? 'rgba(255,255,255,0.05)' : sel ? accent : hover ? 'rgba(155,48,255,0.55)' : 'rgba(255,255,255,0.08)';
    drawRoundRect(ctx, x, y, w, h, Math.min(18, h / 3));
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = hover ? 4 : 2;
    ctx.strokeStyle = opts.disabled ? 'rgba(255,255,255,0.12)' : hover || sel ? '#ffffff' : 'rgba(199,125,255,0.6)';
    ctx.stroke();
    ctx.restore();
    const size = opts.size || Math.round(h * 0.42);
    const color = opts.disabled ? 'rgba(255,255,255,0.3)' : '#ffffff';
    if (opts.sub) {
      this.text(label, x + w / 2, y + h * 0.38, size, color, 'center', '800', w - 16);
      this.text(opts.sub, x + w / 2, y + h * 0.72, Math.round(size * 0.6), 'rgba(255,255,255,0.75)', 'center', '500', w - 16);
    } else if (opts.align === 'left') {
      this.text(label, x + 20, y + h / 2, size, color, 'left', '700', w - 30);
    } else {
      this.text(label, x + w / 2, y + h / 2 + 1, size, color, 'center', '800', w - 16);
    }
    this.regions.push({ id: id, x: x, y: y, w: w, h: h, onClick: onClick, disabled: !!opts.disabled });
    return hover;
  }

  // Generic clickable area (caller draws content).
  area(id, x, y, w, h, onClick) {
    this.regions.push({ id: id, x: x, y: y, w: w, h: h, onClick: onClick });
    return this.hoverId === id;
  }

  image(img, x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.save();
    drawRoundRect(ctx, x, y, w, h, r || 0);
    ctx.clip();
    if (img) {
      try { ctx.drawImage(img, x, y, w, h); } catch (e) { this._placeholder(x, y, w, h); }
    } else {
      this._placeholder(x, y, w, h);
    }
    ctx.restore();
  }

  _placeholder(x, y, w, h) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, '#3c096c'); g.addColorStop(1, '#ff2fd6');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'italic 900 ' + Math.round(h * 0.4) + 'px "Arial Black", ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BT', x + w / 2, y + h / 2);
  }
}
