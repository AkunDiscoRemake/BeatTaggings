// Persistent player settings (localStorage, guarded for private mode / blocked storage).

const KEY = 'beattaggings.settings.v1';
const SCORES_KEY = 'beattaggings.scores.v1';

export const DEFAULT_SETTINGS = {
  quality: 'medium',        // low | medium | high
  noteSpeed: 1.0,           // multiplier on the map's note jump speed
  strictDirection: false,   // true: wrong cut direction = miss
  noFail: false,
  oneSaberFilter: true,     // thin two-handed maps for a single saber
  audioOffsetMs: 0,         // positive = notes later
  musicVolume: 0.8,
  sfxVolume: 0.7,
  moveMode: 'absolute',     // absolute (touch position = body position) | velocity
  showFps: false,
  posture: 'auto',          // auto (accelerometer + head tilt) | tilt | touchpad | off
  postureSens: 1.0,         // 0.7 low .. 1.4 high
  extraBarriers: true,      // generate barrier courses in note-free stretches
};

function safeGet(key) {
  try { return window.localStorage.getItem(key); } catch (e) { return null; }
}
function safeSet(key, value) {
  try { window.localStorage.setItem(key, value); } catch (e) { /* ignore */ }
}

export class Settings {
  constructor() {
    this.values = Object.assign({}, DEFAULT_SETTINGS);
    const raw = safeGet(KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        for (const k in DEFAULT_SETTINGS) {
          if (Object.prototype.hasOwnProperty.call(parsed, k) && typeof parsed[k] === typeof DEFAULT_SETTINGS[k]) {
            this.values[k] = parsed[k];
          }
        }
      } catch (e) { /* corrupted, keep defaults */ }
    }
    this.listeners = [];
  }
  get(k) { return this.values[k]; }
  set(k, v) {
    this.values[k] = v;
    safeSet(KEY, JSON.stringify(this.values));
    for (const fn of this.listeners) fn(k, v);
  }
  onChange(fn) { this.listeners.push(fn); }
}

export class HighScores {
  constructor() {
    this.data = {};
    const raw = safeGet(SCORES_KEY);
    if (raw) { try { this.data = JSON.parse(raw) || {}; } catch (e) { this.data = {}; } }
  }
  key(songId, characteristic, difficulty) { return songId + '|' + characteristic + '|' + difficulty; }
  get(songId, characteristic, difficulty) { return this.data[this.key(songId, characteristic, difficulty)] || null; }
  submit(songId, characteristic, difficulty, result) {
    const k = this.key(songId, characteristic, difficulty);
    const prev = this.data[k];
    const isBest = !prev || result.score > prev.score;
    if (isBest) {
      this.data[k] = { score: result.score, accuracy: result.accuracy, rank: result.rank, date: Date.now() };
      safeSet(SCORES_KEY, JSON.stringify(this.data));
    }
    return isBest;
  }
}
