// Procedural canvas textures — every visual asset in the game is generated here (no external images).
import * as THREE from '../../vendor/three.module.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tex(c, opts) {
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 1;
  if (opts && opts.repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(opts.repeat[0], opts.repeat[1]);
  }
  if (opts && opts.noMips) {
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
  }
  return t;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Base block face: tinted by instance color (white areas become the note color).
function blockBase(ctx, s) {
  const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.1, s / 2, s / 2, s * 0.75);
  g.addColorStop(0, '#5a5a5a');
  g.addColorStop(1, '#242424');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  // glowing bevel edge
  ctx.lineWidth = s * 0.07;
  ctx.strokeStyle = '#ffffff';
  roundRect(ctx, s * 0.05, s * 0.05, s * 0.9, s * 0.9, s * 0.12);
  ctx.stroke();
  ctx.lineWidth = s * 0.02;
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  roundRect(ctx, s * 0.14, s * 0.14, s * 0.72, s * 0.72, s * 0.08);
  ctx.stroke();
}

export function makeTextures() {
  const T = {};

  // ---- Note faces ----
  {
    const s = 128, c = canvas(s, s), ctx = c.getContext('2d');
    blockBase(ctx, s);
    T.noteSide = tex(c);
  }
  {
    const s = 128, c = canvas(s, s), ctx = c.getContext('2d');
    blockBase(ctx, s);
    // Chevron arrow pointing DOWN (cut direction), with a white glow.
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(s * 0.24, s * 0.36);
    ctx.lineTo(s * 0.76, s * 0.36);
    ctx.lineTo(s * 0.5, s * 0.66);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(s * 0.24, s * 0.26, s * 0.52, s * 0.05);
    T.noteArrow = tex(c);
  }
  {
    const s = 128, c = canvas(s, s), ctx = c.getContext('2d');
    blockBase(ctx, s);
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.13, 0, Math.PI * 2);
    ctx.fill();
    T.noteDot = tex(c);
  }

  // ---- Obstacle block (black, purple cracks) ----
  {
    const s = 128, c = canvas(s, s), ctx = c.getContext('2d');
    ctx.fillStyle = '#050308';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#b44cff';
    ctx.shadowColor = '#b44cff';
    ctx.shadowBlur = 8;
    ctx.lineWidth = 5;
    roundRect(ctx, 6, 6, s - 12, s - 12, 14);
    ctx.stroke();
    // warning X
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#ff3df2';
    ctx.beginPath();
    ctx.moveTo(s * 0.32, s * 0.32); ctx.lineTo(s * 0.68, s * 0.68);
    ctx.moveTo(s * 0.68, s * 0.32); ctx.lineTo(s * 0.32, s * 0.68);
    ctx.stroke();
    T.bomb = tex(c);
  }

  // ---- Floor grid ----
  {
    const s = 256, c = canvas(s, s), ctx = c.getContext('2d');
    ctx.fillStyle = '#06020c';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(155,48,255,0.55)';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(155,48,255,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s / 2, 0); ctx.lineTo(s / 2, s);
    ctx.moveTo(0, s / 2); ctx.lineTo(s, s / 2);
    ctx.stroke();
    T.floor = tex(c, { repeat: [20, 40] });
  }

  // ---- Runway with 4 lanes ----
  {
    const w = 256, h = 64, c = canvas(w, h), ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#120424'); g.addColorStop(0.5, '#0a0214'); g.addColorStop(1, '#120424');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(199,125,255,0.25)';
    for (let i = 1; i < 4; i++) ctx.fillRect(Math.round(w * (0.1 + i * 0.2)) - 1, 0, 2, h);
    ctx.fillStyle = 'rgba(199,125,255,0.9)';
    ctx.fillRect(0, 0, 5, h); ctx.fillRect(w - 5, 0, 5, h);
    T.runway = tex(c, { repeat: [1, 30] });
  }

  // ---- Soft glow sprite ----
  {
    const s = 64, c = canvas(s, s), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    T.glow = tex(c);
  }
  {
    const s = 32, c = canvas(s, s), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    T.particle = tex(c, { noMips: true });
  }

  // ---- Reticle ring ----
  {
    const s = 64, c = canvas(s, s), ctx = c.getContext('2d');
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.32, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.08, 0, Math.PI * 2); ctx.fill();
    T.reticle = tex(c);
  }

  // ---- Matcaps for the hilt (cheap "PBR look" with zero lights) ----
  T.matcapChrome = makeMatcap(['#ffffff', '#d9d2ea', '#7d6f99', '#2a2238', '#0c0812'], [0.32, 0.28]);
  T.matcapDark = makeMatcap(['#6b6478', '#3a3445', '#1d1924', '#0d0b11', '#050407'], [0.35, 0.3]);
  T.matcapPurple = makeMatcap(['#ffffff', '#e2b8ff', '#9b30ff', '#4a0f80', '#13031f'], [0.32, 0.28]);

  // ---- Retro sun / portal on the horizon ----
  {
    const s = 256, c = canvas(s, s), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, s, s);
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, '#ffd1ff'); g.addColorStop(0.45, '#ff3df2'); g.addColorStop(1, '#5b10b8');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.46, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 7; i++) {
      const y = s * (0.55 + i * 0.065);
      ctx.fillRect(0, y, s, 2 + i * 1.6);
    }
    ctx.globalCompositeOperation = 'source-over';
    T.sun = tex(c);
  }

  // ---- Graffiti tag billboards ----
  T.tagLeft = makeTag('BEAT', '#ff3df2', '#9b30ff');
  T.tagRight = makeTag('TAGS', '#c77dff', '#ff3df2');
  return T;
}

function makeMatcap(stops, center) {
  const s = 128, c = canvas(s, s), ctx = c.getContext('2d');
  ctx.fillStyle = stops[stops.length - 1];
  ctx.fillRect(0, 0, s, s);
  const g = ctx.createRadialGradient(s * center[0], s * center[1], 2, s / 2, s / 2, s / 2);
  for (let i = 0; i < stops.length; i++) g.addColorStop(i / (stops.length - 1), stops[i]);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); ctx.fill();
  // rim light
  ctx.strokeStyle = 'rgba(199,125,255,0.6)';
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2 - 4, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
  return tex(c);
}

function makeTag(word, c1, c2) {
  const w = 512, h = 256, c = canvas(w, h), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-0.08);
  ctx.font = 'italic 900 150px "Arial Black", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.shadowColor = c2;
  ctx.shadowBlur = 30;
  ctx.lineWidth = 16;
  ctx.strokeStyle = c2;
  ctx.strokeText(word, 0, 0);
  ctx.shadowBlur = 0;
  ctx.fillStyle = c1;
  ctx.fillText(word, 0, 0);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText(word, 0, 0);
  // drips
  ctx.fillStyle = c1;
  for (let i = 0; i < 9; i++) {
    const x = -200 + i * 50 + (i * 37) % 23;
    const len = 20 + (i * 53) % 60;
    ctx.fillRect(x, 50, 6, len);
    ctx.beginPath(); ctx.arc(x + 3, 50 + len, 5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  return tex(c);
}

export function drawRoundRect(ctx, x, y, w, h, r) { roundRect(ctx, x, y, w, h, r); }
