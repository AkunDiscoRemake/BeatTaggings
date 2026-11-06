// Audio engine: Web Audio context, music playback with a precise song clock, synthesized SFX.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.musicSource = null;
    this.musicBuffer = null;
    this.musicStartCtx = 0; // context time at which song time 0 is heard
    this.pausedAt = 0;
    this.playing = false;
    this.sfx = {};
    this.lastSongTime = -1e9;
    this.preview = null;
    this.musicVolume = 0.8;
    this.sfxVolume = 0.7;
  }

  // Must be called from a user gesture at least once.
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('Web Audio não suportado neste navegador');
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.musicVolume;
      this.musicGain.connect(this.master);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.sfxVolume;
      this.sfxGain.connect(this.master);
      this._buildSfx();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(function () { /* ignore */ });
    return this.ctx;
  }

  setVolumes(music, sfx) {
    this.musicVolume = music; this.sfxVolume = sfx;
    if (this.musicGain) this.musicGain.gain.value = music;
    if (this.sfxGain) this.sfxGain.gain.value = sfx;
    if (this.preview) this.preview.volume = Math.min(1, music);
  }

  decode(arrayBuffer) {
    const ctx = this.ensure();
    // Copy: decodeAudioData detaches the buffer.
    const copy = arrayBuffer.slice ? arrayBuffer.slice(0) : arrayBuffer;
    return new Promise(function (resolve, reject) {
      let done = false;
      const ok = function (b) { if (!done) { done = true; resolve(b); } };
      const fail = function () { if (!done) { done = true; reject(new Error('Não foi possível decodificar o áudio')); } };
      try {
        const p = ctx.decodeAudioData(copy, ok, fail);
        if (p && p.then) p.then(ok, fail);
      } catch (e) { fail(); }
    });
  }

  bufferFromChannels(channels, sampleRate) {
    const ctx = this.ensure();
    const buf = ctx.createBuffer(channels.length, channels[0].length, sampleRate);
    for (let c = 0; c < channels.length; c++) {
      if (buf.copyToChannel) buf.copyToChannel(channels[c], c);
      else buf.getChannelData(c).set(channels[c]);
    }
    return buf;
  }

  // Precise "what is being heard right now" context time.
  outputTime() {
    const ctx = this.ctx;
    if (!ctx) return 0;
    if (ctx.getOutputTimestamp) {
      const ts = ctx.getOutputTimestamp();
      if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
        return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
      }
    }
    return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
  }

  // Starts the music so that song time `fromTime` is heard after `leadIn` seconds.
  // fromTime may be negative (silence before the song starts).
  playMusic(buffer, fromTime, leadIn) {
    this.stopMusic();
    const ctx = this.ensure();
    this.musicBuffer = buffer;
    const startAt = ctx.currentTime + Math.max(0.05, leadIn || 0);
    const latency = ctx.currentTime - this.outputTime(); // ~ output latency
    this.musicStartCtx = startAt - fromTime;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.musicGain);
    if (fromTime >= 0) src.start(startAt, Math.min(fromTime, buffer.duration));
    else src.start(startAt - fromTime, 0);
    this.musicSource = src;
    this.playing = true;
    this.lastSongTime = -1e9;
    this._latency = Math.max(0, latency);
  }

  stopMusic() {
    if (this.musicSource) {
      try { this.musicSource.stop(); } catch (e) { /* already stopped */ }
      try { this.musicSource.disconnect(); } catch (e) { /* ignore */ }
      this.musicSource = null;
    }
    this.playing = false;
  }

  fadeOutMusic(seconds) {
    if (!this.musicSource || !this.ctx) return;
    const g = this.musicGain.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + seconds);
    const self = this;
    setTimeout(function () {
      self.stopMusic();
      g.cancelScheduledValues(0);
      g.value = self.musicVolume;
    }, seconds * 1000 + 50);
  }

  // Current song time in seconds (monotonic while playing).
  songTime() {
    if (!this.ctx) return 0;
    let t = this.outputTime() - this.musicStartCtx;
    if (t < this.lastSongTime && this.lastSongTime - t < 0.06) t = this.lastSongTime;
    this.lastSongTime = t;
    return t;
  }

  // ---------------- Preview (library) ----------------
  playPreview(url) {
    this.stopPreview();
    if (!url) return;
    try {
      // Plain <audio> playback needs no CORS (the preview CDN does not send CORS headers).
      const a = new Audio();
      a.src = url;
      a.volume = Math.min(1, this.musicVolume);
      a.loop = true;
      const p = a.play();
      if (p && p.catch) p.catch(function () { /* autoplay blocked: ignore */ });
      this.preview = a;
    } catch (e) { this.preview = null; }
  }
  stopPreview() {
    if (this.preview) {
      try { this.preview.pause(); this.preview.src = ''; } catch (e) { /* ignore */ }
      this.preview = null;
    }
  }

  // ---------------- SFX ----------------
  play(name, rate, gain) {
    if (!this.ctx || !this.sfx[name]) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.sfx[name];
    if (rate) src.playbackRate.value = rate;
    if (gain !== undefined && gain !== 1) {
      const g = this.ctx.createGain();
      g.gain.value = gain;
      src.connect(g); g.connect(this.sfxGain);
    } else {
      src.connect(this.sfxGain);
    }
    src.start();
  }

  _buildSfx() {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const make = function (dur, fn) {
      const len = Math.max(1, Math.floor(dur * sr));
      const buf = ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      let state = { lp: 0, seed: 12345 };
      for (let i = 0; i < len; i++) d[i] = fn(i / sr, state);
      return buf;
    };
    const noise = function (s) {
      s.seed = (s.seed * 1664525 + 1013904223) >>> 0;
      return s.seed / 2147483648 - 1;
    };
    // Bright slicing "tssk" with a tonal ping.
    this.sfx.hit = make(0.16, function (t, s) {
      const n = noise(s);
      const hp = n - s.lp; s.lp = s.lp * 0.6 + n * 0.4;
      const env = Math.exp(-t * 38);
      const ping = Math.sin(2 * Math.PI * (1900 - t * 3000) * t) * Math.exp(-t * 30);
      return (hp * 0.55 * env + ping * 0.35) * 0.9;
    });
    this.sfx.miss = make(0.22, function (t) {
      const f = 170 - t * 300;
      return Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 14) * 0.6 + Math.sign(Math.sin(2 * Math.PI * 85 * t)) * 0.08 * Math.exp(-t * 18);
    });
    this.sfx.bomb = make(0.45, function (t, s) {
      const n = noise(s);
      s.lp = s.lp * 0.94 + n * 0.06;
      return (s.lp * 3.0 * Math.exp(-t * 7) + Math.sin(2 * Math.PI * (70 - t * 60) * t) * Math.exp(-t * 6) * 0.7) * 0.8;
    });
    this.sfx.wall = make(0.12, function (t) {
      return (Math.sin(2 * Math.PI * 95 * t) + 0.5 * Math.sin(2 * Math.PI * 190 * t)) * 0.3 * Math.min(1, t * 80) * Math.exp(-t * 10);
    });
    this.sfx.click = make(0.06, function (t) {
      return Math.sin(2 * Math.PI * 1320 * t) * Math.exp(-t * 70) * 0.45;
    });
    this.sfx.hover = make(0.03, function (t) {
      return Math.sin(2 * Math.PI * 2400 * t) * Math.exp(-t * 160) * 0.15;
    });
    this.sfx.beep = make(0.15, function (t) {
      return Math.sin(2 * Math.PI * 880 * t) * Math.min(1, t * 200) * Math.exp(-t * 12) * 0.4;
    });
    this.sfx.go = make(0.3, function (t) {
      return Math.sin(2 * Math.PI * 1320 * t) * Math.min(1, t * 200) * Math.exp(-t * 7) * 0.4;
    });
    this.sfx.fail = make(1.1, function (t) {
      const f = 330 * Math.pow(0.5, t * 1.4);
      return (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t)) * Math.exp(-t * 2.5) * 0.4;
    });
    this.sfx.clear = make(1.0, function (t) {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      const i = Math.min(3, Math.floor(t / 0.12));
      const lt = t - i * 0.12;
      return Math.sin(2 * Math.PI * notes[i] * t) * Math.exp(-lt * 6) * 0.35;
    });
  }
}
