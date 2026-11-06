// Parser for community rhythm-map packages (BeatSaver zip format).
// Supports Info.dat v2.x and v4.x, difficulty files v2.x, v3.x and v4.x.
// Pure functions (no DOM) so they can be unit-tested in Node.

export const CUT_ANY = 8;

// Rotation (radians, around Z) for each cut direction, for an arrow texture pointing DOWN.
// Directions: 0 up, 1 down, 2 left, 3 right, 4 up-left, 5 up-right, 6 down-left, 7 down-right, 8 any.
const Q = Math.PI / 4;
export const CUT_ANGLE = [Math.PI, 0, -2 * Q, 2 * Q, -3 * Q, 3 * Q, -Q, Q, 0];
// Unit swing direction (x, y) for each cut direction.
export const CUT_VECTOR = CUT_ANGLE.map(function (a, i) {
  if (i === CUT_ANY) return [0, 0];
  return [Math.sin(a), -Math.cos(a)];
});

function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

// Mapping-extensions "precise" coordinates (|v| >= 1000) -> fractional lane/layer.
function precise(v) {
  if (v >= 1000) return v / 1000 - 1;
  if (v <= -1000) return v / 1000 + 1;
  return v;
}

export function parseInfo(info) {
  if (!info || typeof info !== 'object') throw new Error('Info.dat inválido');
  const version = String(info.version || info._version || '2.0.0');
  if (version.charAt(0) === '4') {
    const song = info.song || {};
    const audio = info.audio || {};
    const sets = {};
    (info.difficultyBeatmaps || []).forEach(function (d) {
      const ch = d.characteristic || 'Standard';
      if (!sets[ch]) sets[ch] = [];
      sets[ch].push({
        difficulty: d.difficulty,
        label: d.difficulty,
        file: d.beatmapDataFilename,
        njs: num(d.noteJumpMovementSpeed, 0),
        offset: num(d.noteJumpStartBeatOffset, 0),
        rank: 0,
      });
    });
    return {
      version: version,
      title: song.title || 'Sem título',
      subTitle: song.subTitle || '',
      artist: song.author || '',
      mapper: '',
      bpm: num(audio.bpm, 120),
      songFile: audio.songFilename,
      coverFile: info.coverImageFilename,
      songTimeOffset: 0,
      previewStart: num(audio.previewStartTime, 0),
      sets: Object.keys(sets).map(function (k) { return { characteristic: k, diffs: sets[k] }; }),
    };
  }
  // v2 (and legacy v1 which uses the same keys)
  const sets = (info._difficultyBeatmapSets || []).map(function (s) {
    return {
      characteristic: s._beatmapCharacteristicName || 'Standard',
      diffs: (s._difficultyBeatmaps || []).map(function (d) {
        const cd = d._customData || {};
        return {
          difficulty: d._difficulty,
          label: cd._difficultyLabel || d._difficulty,
          file: d._beatmapFilename,
          njs: num(d._noteJumpMovementSpeed, 0),
          offset: num(d._noteJumpStartBeatOffset, 0),
          rank: num(d._difficultyRank, 0),
        };
      }),
    };
  });
  return {
    version: version,
    title: info._songName || 'Sem título',
    subTitle: info._songSubName || '',
    artist: info._songAuthorName || '',
    mapper: info._levelAuthorName || '',
    bpm: num(info._beatsPerMinute, 120),
    songFile: info._songFilename,
    coverFile: info._coverImageFilename,
    songTimeOffset: num(info._songTimeOffset, 0),
    previewStart: num(info._previewStartTime, 0),
    sets: sets,
  };
}

// Builds a beat -> seconds converter honoring v3 BPM events.
export function makeBeatClock(baseBpm, bpmEvents) {
  const events = (bpmEvents || [])
    .filter(function (e) { return e && num(e.b, -1) >= 0 && num(e.m, 0) > 0; })
    .sort(function (a, b) { return a.b - b.b; });
  // segments: [{beat, time, bpm}]
  const segs = [{ beat: 0, time: 0, bpm: baseBpm }];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const last = segs[segs.length - 1];
    if (e.b === last.beat) { last.bpm = e.m; continue; }
    const time = last.time + (e.b - last.beat) * 60 / last.bpm;
    segs.push({ beat: e.b, time: time, bpm: e.m });
  }
  return function toSeconds(beat) {
    let s = segs[0];
    for (let i = segs.length - 1; i >= 0; i--) {
      if (beat >= segs[i].beat) { s = segs[i]; break; }
    }
    return s.time + (beat - s.beat) * 60 / s.bpm;
  };
}

function validLane(x) { return x >= -0.5 && x <= 3.5; }
function validLayer(y) { return y >= -0.5 && y <= 2.5; }

// Returns { notes:[{t,x,y,c,d}], bombs:[{t,x,y}], walls:[{t,dur,x,w,y,h}] } with t in seconds.
// x/w in lanes (0..4), y/h in layers (walls: 0..5 where 5 ~ ceiling).
export function parseDifficulty(json, bpm, songTimeOffset) {
  if (!json || typeof json !== 'object') throw new Error('Arquivo de dificuldade inválido');
  const offset = num(songTimeOffset, 0);
  const version = String(json.version || json._version || '2.0.0');
  const notes = [];
  const bombs = [];
  const walls = [];

  if (version.charAt(0) === '4') {
    const sec = makeBeatClock(bpm, null);
    const cnd = json.colorNotesData || [];
    (json.colorNotes || []).forEach(function (n) {
      const d = cnd[n.i || 0];
      if (!d) return;
      const x = num(d.x, 0), y = num(d.y, 0);
      if (!validLane(x) || !validLayer(y)) return;
      notes.push({ t: sec(num(n.b, 0)) + offset, x: x, y: y, c: num(d.c, 0) ? 1 : 0, d: clampDir(d.d) });
    });
    const bnd = json.bombNotesData || [];
    (json.bombNotes || []).forEach(function (n) {
      const d = bnd[n.i || 0];
      if (!d) return;
      const x = num(d.x, 0), y = num(d.y, 0);
      if (!validLane(x) || !validLayer(y)) return;
      bombs.push({ t: sec(num(n.b, 0)) + offset, x: x, y: y });
    });
    const od = json.obstaclesData || [];
    (json.obstacles || []).forEach(function (o) {
      const d = od[o.i || 0];
      if (!d) return;
      pushWall(walls, sec, num(o.b, 0), num(d.d, 0), num(d.x, 0), num(d.w, 1), num(d.y, 0), num(d.h, 5), offset);
    });
  } else if (version.charAt(0) === '3') {
    const sec = makeBeatClock(bpm, json.bpmEvents);
    (json.colorNotes || []).forEach(function (n) {
      const x = num(n.x, 0), y = num(n.y, 0);
      if (!validLane(x) || !validLayer(y)) return;
      notes.push({ t: sec(num(n.b, 0)) + offset, x: x, y: y, c: num(n.c, 0) ? 1 : 0, d: clampDir(n.d) });
    });
    (json.bombNotes || []).forEach(function (n) {
      const x = num(n.x, 0), y = num(n.y, 0);
      if (!validLane(x) || !validLayer(y)) return;
      bombs.push({ t: sec(num(n.b, 0)) + offset, x: x, y: y });
    });
    (json.obstacles || []).forEach(function (o) {
      pushWall(walls, sec, num(o.b, 0), num(o.d, 0), num(o.x, 0), num(o.w, 1), num(o.y, 0), num(o.h, 5), offset);
    });
  } else {
    // v2 / v1: times are in beats of the base BPM.
    const sec = makeBeatClock(bpm, null);
    (json._notes || []).forEach(function (n) {
      const x = precise(num(n._lineIndex, 0));
      const y = precise(num(n._lineLayer, 0));
      if (!validLane(x) || !validLayer(y)) return;
      const t = sec(num(n._time, 0)) + offset;
      const type = num(n._type, 0);
      if (type === 3) bombs.push({ t: t, x: x, y: y });
      else if (type === 0 || type === 1) notes.push({ t: t, x: x, y: y, c: type, d: clampDir(n._cutDirection) });
    });
    (json._obstacles || []).forEach(function (o) {
      const type = num(o._type, 0);
      // 0 = full height, 1 = crouch (top) wall. Mapping-extension types (>=1000) treated as full.
      const y = type === 1 ? 2 : 0;
      const h = type === 1 ? 3 : 5;
      pushWall(walls, sec, num(o._time, 0), num(o._duration, 0), precise(num(o._lineIndex, 0)), precise(num(o._width, 1)), y, h, offset);
    });
  }

  const byT = function (a, b) { return a.t - b.t; };
  notes.sort(byT); bombs.sort(byT); walls.sort(byT);
  return { notes: notes, bombs: bombs, walls: walls };
}

function clampDir(d) {
  const v = Math.round(num(d, CUT_ANY));
  if (v >= 1000) return CUT_ANY; // mapping-extension precise directions -> any
  return v >= 0 && v <= 8 ? v : CUT_ANY;
}

function pushWall(walls, sec, beat, durBeats, x, w, y, h, offset) {
  if (!(durBeats > 0) || !(w > 0)) return;
  const t = sec(beat);
  const dur = sec(beat + durBeats) - t;
  if (dur <= 0.01) return;
  walls.push({ t: t + offset, dur: dur, x: x, w: w, y: y, h: h });
}

// Adapts a (usually two-handed) map for a single saber and a 3DoF headset.
//  - simultaneous notes collapse into one (prefers color 1, the "right hand" note)
//  - notes closer than minGap seconds are thinned
//  - bombs that sit right where the kept notes force the saber are removed
//  - walls that cannot be dodged sideways (full width) are removed; walls are flagged
//    harmful only if they cover head height.
export function adaptMap(map, options) {
  const opts = Object.assign({ oneSaber: true, minGap: 0.11, lateralLanes: 2.7 }, options || {});
  let notes = map.notes.slice();
  let bombs = map.bombs.slice();

  if (opts.oneSaber) {
    const kept = [];
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      const last = kept[kept.length - 1];
      if (last && n.t - last.t < 0.045) {
        if (last.c === 0 && n.c === 1) kept[kept.length - 1] = n;
        continue;
      }
      if (last && n.t - last.t < opts.minGap) continue;
      kept.push(n);
    }
    notes = kept;
    // Remove bombs crowding kept notes.
    bombs = bombs.filter(function (b) {
      for (let i = binarySearchT(notes, b.t - 0.3); i < notes.length && notes[i].t <= b.t + 0.3; i++) {
        const n = notes[i];
        if (Math.abs(n.x - b.x) <= 1.01 && Math.abs(n.y - b.y) <= 1.01) return false;
      }
      return true;
    });
  }

  const minL = 2 - opts.lateralLanes + 0.4;
  const maxL = 2 + opts.lateralLanes - 0.4;
  const walls = [];
  for (let i = 0; i < map.walls.length; i++) {
    const w = map.walls[i];
    const x0 = w.x, x1 = w.x + w.w;
    if (x0 <= minL && x1 >= maxL) continue; // no escape route at all
    if (x0 <= 0.05 && x1 >= 3.95) continue;  // spans the whole track (meant to be ducked: impossible in 3DoF)
    walls.push(Object.assign({}, w));
  }

  return { notes: notes, bombs: bombs, walls: walls };
}

export function binarySearchT(arr, t) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].t < t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// Beat Saber-style half jump duration (beats) -> how long before its beat a note appears.
export function spawnAheadSeconds(bpm, njs, startBeatOffset) {
  const beatSec = 60 / Math.max(1, bpm);
  let hjd = 4;
  while (njs * beatSec * hjd > 17.999) hjd /= 2;
  hjd += startBeatOffset || 0;
  if (hjd < 0.25) hjd = 0.25;
  return Math.min(2.2, Math.max(0.85, hjd * beatSec));
}
