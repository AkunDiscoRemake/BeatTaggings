// Built-in original song "Neon Tag" — synthesized procedurally (no external assets) plus its
// hand-designed maps for a single saber. Works fully offline and is used as the tutorial track.
// Pure JS (no DOM) so it can be tested in Node.

export const DEMO_BPM = 128;
export const DEMO_BARS = 38;
const BEAT = 60 / DEMO_BPM;

// A minor: Am - F - C - G
const CHORD_ROOTS = [45, 41, 48, 43];
const CHORDS = [
  [69, 72, 76, 81],
  [65, 69, 72, 77],
  [67, 72, 76, 79],
  [67, 71, 74, 79],
];
const ARP_PATTERN = [0, 1, 2, 3, 2, 1, 2, 3];

function section(bar) {
  if (bar < 4) return 'intro';
  if (bar < 12) return 'build';
  if (bar < 24) return 'drop';
  if (bar < 28) return 'break';
  if (bar < 36) return 'drop2';
  return 'outro';
}

function midiHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

function rng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Returns { sampleRate, channels:[Float32Array, Float32Array], duration, bpm }
export function synthesizeDemoSong(sampleRate) {
  const sr = sampleRate || 32000;
  const duration = DEMO_BARS * 4 * BEAT + 2.0;
  const len = Math.ceil(duration * sr);
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  const duck = new Float32Array(len); // sidechain envelope (0 = no duck)
  const rand = rng(1337);

  function addEvent(start, dur, gainL, gainR, fn) {
    const i0 = Math.max(0, Math.floor(start * sr));
    const i1 = Math.min(len, Math.floor((start + dur) * sr));
    const st = { a: 0, b: 0, c: 0, p0: 0, p1: 0, p2: 0 };
    for (let i = i0; i < i1; i++) {
      const v = fn((i - i0) / sr, st);
      L[i] += v * gainL;
      R[i] += v * gainR;
    }
  }

  function kick(t) {
    addEvent(t, 0.4, 0.9, 0.9, function (x, s) {
      const f = 46 + 130 * Math.exp(-x * 32);
      s.p0 += 2 * Math.PI * f / sr;
      return Math.sin(s.p0) * Math.exp(-x * 6.5) + (x < 0.004 ? (rand() * 2 - 1) * 0.3 : 0);
    });
    const i0 = Math.floor(t * sr), n = Math.floor(0.3 * sr);
    for (let i = 0; i < n && i0 + i < len; i++) duck[i0 + i] = Math.max(duck[i0 + i], Math.exp(-i / sr * 11));
  }
  function hat(t, g) {
    addEvent(t, 0.07, g * 0.8, g, function (x, s) {
      const n = rand() * 2 - 1;
      const hp = n - s.a; s.a = n;
      return hp * Math.exp(-x * 55) * 0.25;
    });
  }
  function clap(t) {
    addEvent(t, 0.25, 0.5, 0.5, function (x, s) {
      const n = rand() * 2 - 1;
      s.a += (n - s.a) * 0.35; // lowpass
      s.b += (s.a - s.b) * 0.08;
      const band = s.a - s.b;
      const bursts = (x < 0.01 || (x > 0.012 && x < 0.02) || x > 0.024) ? 1 : 0.2;
      return band * bursts * Math.exp(-x * 16) * 1.4;
    });
  }
  function bass(t, midi, dur) {
    const f = midiHz(midi);
    addEvent(t, dur, 0.5, 0.5, function (x, s) {
      s.p0 += f / sr; if (s.p0 >= 1) s.p0 -= 1;
      const saw = s.p0 * 2 - 1;
      const cutoff = 0.05 + 0.18 * Math.exp(-x * 14);
      s.a += (saw - s.a) * cutoff;
      const env = Math.min(1, x * 300) * Math.exp(-x * 3) * (x > dur - 0.01 ? (dur - x) / 0.01 : 1);
      return Math.tanh(s.a * 2.2) * env * 0.55;
    });
  }
  function pad(t, chord, dur, bright) {
    for (let k = 0; k < 3; k++) {
      const f = midiHz(chord[k] - 12);
      const det = [0.996, 1.0, 1.004];
      addEvent(t, dur + 0.3, k === 0 ? 0.9 : 0.6, k === 2 ? 0.9 : 0.6, function (x, s) {
        s.p0 += f * det[0] / sr; if (s.p0 >= 1) s.p0 -= 1;
        s.p1 += f * det[1] / sr; if (s.p1 >= 1) s.p1 -= 1;
        s.p2 += f * det[2] / sr; if (s.p2 >= 1) s.p2 -= 1;
        const saw = (s.p0 + s.p1 + s.p2) * (2 / 3) - 1;
        s.a += (saw - s.a) * (0.02 + bright * 0.05);
        const env = Math.min(1, x / 0.25) * (x > dur ? Math.max(0, 1 - (x - dur) / 0.3) : 1);
        return s.a * env * 0.16;
      });
    }
  }
  function pluck(t, midi, pan, bright) {
    const f = midiHz(midi);
    addEvent(t, 0.3, 1 - pan * 0.5, 0.5 + pan * 0.5, function (x, s) {
      s.p0 += f / sr; if (s.p0 >= 1) s.p0 -= 1;
      const sq = s.p0 < 0.35 ? 1 : -1;
      s.a += (sq - s.a) * (0.08 + bright * 0.3 * Math.exp(-x * 12));
      return s.a * Math.exp(-x * 9) * 0.18;
    });
  }

  for (let bar = 0; bar < DEMO_BARS; bar++) {
    const sec = section(bar);
    const t0 = bar * 4 * BEAT;
    const ci = bar % 4;
    const chord = CHORDS[ci];
    const root = CHORD_ROOTS[ci];

    if (sec !== 'drop' && sec !== 'drop2') pad(t0, chord, 4 * BEAT, sec === 'break' ? 1 : 0.4);
    else pad(t0, chord, 4 * BEAT, 0.6);

    for (let b = 0; b < 4; b++) {
      const tb = t0 + b * BEAT;
      if (sec === 'intro') { if (b === 0) kick(tb); continue; }
      if (sec === 'outro') { if (bar === 36 && b === 0) kick(tb); continue; }
      if (sec === 'break') continue;
      kick(tb);
      hat(tb + BEAT / 2, 1.0);
      if (sec !== 'build') {
        hat(tb + BEAT / 4, 0.35);
        hat(tb + 3 * BEAT / 4, 0.35);
        if (b === 1 || b === 3) clap(tb);
      } else if (bar >= 10 && (b === 1 || b === 3)) clap(tb);
      // bass on 8ths, offbeat-accented
      bass(tb, root, BEAT / 2 - 0.02);
      bass(tb + BEAT / 2, root + 12, BEAT / 2 - 0.02);
    }

    if (sec === 'drop' || sec === 'drop2' || sec === 'break' || (sec === 'build' && bar >= 8)) {
      for (let s = 0; s < 8; s++) {
        const m = chord[ARP_PATTERN[s]] + (sec === 'drop2' && s % 4 === 3 ? 12 : 0);
        pluck(t0 + s * BEAT / 2, m, s % 2 ? 0.8 : 0.2, sec === 'break' ? 0.3 : 1);
      }
    }
  }

  // Sidechain pumping on everything but transients + soft clip.
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const d = 1 - 0.45 * duck[i];
    let l = L[i] * d, r = R[i] * d;
    l = l / (1 + Math.abs(l));
    r = r / (1 + Math.abs(r));
    L[i] = l; R[i] = r;
    const a = Math.max(Math.abs(l), Math.abs(r));
    if (a > peak) peak = a;
  }
  const norm = peak > 0 ? 0.92 / peak : 1;
  const fadeStart = Math.floor((duration - 2.5) * sr);
  for (let i = 0; i < len; i++) {
    const f = i > fadeStart ? Math.max(0, 1 - (i - fadeStart) / (2.5 * sr)) : 1;
    L[i] *= norm * f; R[i] *= norm * f;
  }
  return { sampleRate: sr, channels: [L, R], duration: duration, bpm: DEMO_BPM };
}

// Map generation: returns a parsed map {notes, bombs, walls} in seconds for 'Easy' | 'Normal' | 'Hard'.
export function generateDemoMap(difficulty) {
  const notes = [], bombs = [], walls = [];
  const level = difficulty === 'Easy' ? 0 : difficulty === 'Hard' ? 2 : 1;
  let down = true; // alternate down/up swings for natural one-saber flow
  const laneSeq = [1, 2, 2, 1, 1, 2, 0, 3];
  let k = 0;

  function note(beat, lane, extra) {
    const d = extra && extra.d !== undefined ? extra.d : (down ? 1 : 0);
    const y = extra && extra.y !== undefined ? extra.y : (d === 1 ? (level === 0 ? 1 : 1 + (k % 2)) : 0);
    notes.push({ t: beat * BEAT, x: lane, y: Math.min(2, y), c: d === 1 || d === 6 || d === 7 ? 1 : 0, d: d });
    down = !down;
    k++;
  }

  for (let bar = 0; bar < DEMO_BARS; bar++) {
    const sec = section(bar);
    const b0 = bar * 4;
    if (sec === 'intro') {
      if (bar >= 2 && level > 0) note(b0, 1 + (bar % 2));
      continue;
    }
    if (sec === 'outro') {
      if (bar === 36) note(b0, 1, { d: 8, y: 1 });
      continue;
    }
    if (sec === 'build') {
      const step = level === 0 ? 2 : 1;
      for (let b = 0; b < 4; b += step) {
        if (level === 0 && bar < 6 && b !== 0) continue;
        note(b0 + b, laneSeq[(k) % 4]);
      }
      continue;
    }
    if (sec === 'break') {
      // Dodge section: alternate walls; notes appear on the safe side.
      const pattern = [
        { x: 0, w: 2, safe: 3 },
        { x: 2, w: 2, safe: 0 },
        { x: 1, w: 2, safe: 3 },
        { x: 0, w: 2, safe: 3 },
      ][bar - 24];
      walls.push({ t: (b0 + 0.5) * BEAT, dur: 2.5 * BEAT, x: pattern.x, w: pattern.w, y: 0, h: 5 });
      if (level > 0) {
        note(b0 + 2, pattern.safe, { d: 1, y: 1 });
        note(b0 + 3, pattern.safe, { d: 0, y: 0 });
      } else {
        note(b0 + 2, pattern.safe, { d: 8, y: 1 });
      }
      continue;
    }
    // drop / drop2
    if (level === 0) {
      for (let b = 0; b < 4; b += 2) note(b0 + b, laneSeq[k % 4]);
    } else if (level === 1) {
      for (let b = 0; b < 4; b++) {
        const lane = laneSeq[k % 8];
        // diagonals at phrase ends
        if (b === 3 && bar % 4 === 3) note(b0 + b, lane, { d: down ? 7 : 4 });
        else note(b0 + b, lane);
      }
      if (sec === 'drop2' && bar % 2 === 0) bombs.push({ t: (b0 + 2.5) * BEAT, x: bar % 4 === 0 ? 0 : 3, y: 0 });
    } else {
      for (let h = 0; h < 8; h++) {
        if (h % 2 === 1 && (bar % 2 === 1 && h > 4)) continue;
        note(b0 + h / 2, laneSeq[k % 8]);
      }
      if (bar % 2 === 0) bombs.push({ t: (b0 + 1.25) * BEAT, x: bar % 4 === 0 ? 0 : 3, y: 2 });
      if (sec === 'drop2' && bar % 4 === 1) {
        walls.push({ t: (b0 + 2) * BEAT, dur: 1.5 * BEAT, x: bar % 8 === 1 ? 0 : 3, w: 1, y: 0, h: 5 });
      }
    }
  }
  notes.sort(function (a, b) { return a.t - b.t; });
  return { notes: notes, bombs: bombs, walls: walls };
}

export const DEMO_INFO = {
  source: 'demo',
  id: 'demo-neon-tag',
  hash: 'demo',
  title: 'Neon Tag',
  subTitle: '(tutorial)',
  artist: 'Beat Taggings Synth',
  mapper: 'Beat Taggings',
  bpm: DEMO_BPM,
  duration: Math.round(DEMO_BARS * 4 * BEAT),
  coverURL: '',
  previewURL: '',
  downloadURL: '',
  diffs: [
    { characteristic: 'OneSaber', difficulty: 'Easy', label: 'Fácil', njs: 10 },
    { characteristic: 'OneSaber', difficulty: 'Normal', label: 'Normal', njs: 12 },
    { characteristic: 'OneSaber', difficulty: 'Hard', label: 'Difícil', njs: 14 },
  ],
};
