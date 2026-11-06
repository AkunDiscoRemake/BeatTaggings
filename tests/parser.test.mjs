// Run: node tests/parser.test.mjs   (optionally: node tests/parser.test.mjs path/to/unzipped/map)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseInfo, parseDifficulty, adaptMap, makeBeatClock, spawnAheadSeconds, CUT_VECTOR, generateBarriers } from '../js/songs/mapparser.js';
import { PostureTracker } from '../js/input/posture.js';
import { Game } from '../js/gameplay/game.js';
import { synthesizeDemoSong, generateDemoMap } from '../js/songs/demo.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n', e); process.exitCode = 1; }
}

test('info v2', () => {
  const info = parseInfo({
    _version: '2.0.0', _songName: 'A', _songAuthorName: 'B', _levelAuthorName: 'C', _beatsPerMinute: 120,
    _songFilename: 'song.egg', _coverImageFilename: 'cover.jpg',
    _difficultyBeatmapSets: [{ _beatmapCharacteristicName: 'Standard', _difficultyBeatmaps: [
      { _difficulty: 'Expert', _beatmapFilename: 'Expert.dat', _noteJumpMovementSpeed: 16, _noteJumpStartBeatOffset: 0 }] }],
  });
  assert.equal(info.title, 'A'); assert.equal(info.bpm, 120); assert.equal(info.songFile, 'song.egg');
  assert.equal(info.sets[0].diffs[0].file, 'Expert.dat'); assert.equal(info.sets[0].diffs[0].njs, 16);
});

test('info v4', () => {
  const info = parseInfo({
    version: '4.0.0', song: { title: 'T', author: 'Au' }, audio: { songFilename: 's.ogg', bpm: 150 },
    coverImageFilename: 'c.png',
    difficultyBeatmaps: [{ characteristic: 'Standard', difficulty: 'Hard', beatmapDataFilename: 'Hard.dat', noteJumpMovementSpeed: 14 }],
  });
  assert.equal(info.title, 'T'); assert.equal(info.bpm, 150); assert.equal(info.sets[0].diffs[0].file, 'Hard.dat');
});

test('difficulty v2 notes/bombs/walls in seconds', () => {
  const m = parseDifficulty({ _version: '2.0.0',
    _notes: [{ _time: 2, _lineIndex: 1, _lineLayer: 0, _type: 0, _cutDirection: 1 },
             { _time: 4, _lineIndex: 2, _lineLayer: 2, _type: 3, _cutDirection: 0 },
             { _time: 1, _lineIndex: 9, _lineLayer: 0, _type: 1, _cutDirection: 1 }],
    _obstacles: [{ _time: 4, _lineIndex: 0, _type: 0, _duration: 2, _width: 1 }] }, 120, 0);
  assert.equal(m.notes.length, 1, 'out-of-range lane dropped');
  assert.equal(m.notes[0].t, 1); assert.equal(m.bombs.length, 1); assert.equal(m.bombs[0].t, 2);
  assert.equal(m.walls[0].dur, 1); assert.equal(m.walls[0].h, 5);
});

test('difficulty v3 with bpm change', () => {
  const m = parseDifficulty({ version: '3.2.0', bpmEvents: [{ b: 0, m: 60 }, { b: 4, m: 120 }],
    colorNotes: [{ b: 6, x: 1, y: 1, c: 1, d: 3 }], bombNotes: [{ b: 2, x: 0, y: 0 }],
    obstacles: [{ b: 4, x: 0, y: 0, d: 2, w: 2, h: 5 }] }, 100, 0);
  // beats 0-4 at 60bpm = 4s, then 2 beats at 120 = 1s
  assert.equal(m.notes[0].t, 5); assert.equal(m.bombs[0].t, 2);
  assert.equal(m.walls[0].t, 4); assert.equal(m.walls[0].dur, 1);
});

test('difficulty v4 indexed data', () => {
  const m = parseDifficulty({ version: '4.0.0',
    colorNotes: [{ b: 4, i: 0 }, { b: 8, i: 1 }], colorNotesData: [{ x: 0, y: 0, c: 0, d: 1 }, { x: 3, y: 2, c: 1, d: 8 }],
    bombNotes: [{ b: 2, i: 0 }], bombNotesData: [{ x: 1, y: 1 }],
    obstacles: [{ b: 1, i: 0 }], obstaclesData: [{ d: 1, x: 1, y: 0, w: 1, h: 5 }] }, 120, 0);
  assert.equal(m.notes.length, 2); assert.equal(m.notes[1].t, 4); assert.equal(m.notes[1].d, 8);
  assert.equal(m.bombs[0].t, 1); assert.equal(m.walls[0].dur, 0.5);
});

test('beat clock', () => {
  const s = makeBeatClock(120, [{ b: 8, m: 240 }]);
  assert.equal(s(8), 4); assert.equal(s(12), 5);
});

test('one-saber adaptation', () => {
  const map = { notes: [
    { t: 1, x: 1, y: 0, c: 0, d: 1 }, { t: 1.01, x: 2, y: 0, c: 1, d: 1 },
    { t: 1.05, x: 2, y: 0, c: 1, d: 0 }, { t: 1.5, x: 2, y: 1, c: 0, d: 0 }],
    bombs: [{ t: 1.5, x: 2, y: 2 }, { t: 3, x: 0, y: 0 }],
    walls: [{ t: 2, dur: 1, x: 0, w: 4, y: 0, h: 5 }, { t: 3, dur: 1, x: 1, w: 2, y: 0, h: 5 }] };
  const a = adaptMap(map, { oneSaber: true });
  assert.equal(a.notes.length, 2); assert.equal(a.notes[0].c, 1);
  assert.equal(a.bombs.length, 1); assert.equal(a.walls.length, 1, 'full-width wall removed');
});

test('spawn ahead bounds', () => {
  const s = spawnAheadSeconds(120, 16, 0);
  assert.ok(s >= 0.85 && s <= 2.2);
  assert.equal(CUT_VECTOR[1][1], -1); // down cut swings down
  assert.ok(Math.abs(CUT_VECTOR[3][0] - 1) < 1e-9); // right cut swings right
});

test('demo song synthesis + maps', () => {
  const song = synthesizeDemoSong(8000);
  assert.equal(song.channels.length, 2);
  let peak = 0, nan = false;
  for (const v of song.channels[0]) { if (Number.isNaN(v)) nan = true; peak = Math.max(peak, Math.abs(v)); }
  assert.ok(!nan, 'no NaN'); assert.ok(peak > 0.3 && peak <= 1, 'peak ' + peak);
  for (const d of ['Easy', 'Normal', 'Hard']) {
    const m = generateDemoMap(d);
    assert.ok(m.notes.length > 20, d + ' notes ' + m.notes.length);
    for (const n of m.notes) assert.ok(n.t > 0 && n.t < song.duration && n.x >= 0 && n.x <= 3 && n.y >= 0 && n.y <= 2 && n.d >= 0 && n.d <= 8);
    assert.ok(m.walls.length >= 4);
    console.log('       ' + d + ': ' + m.notes.length + ' notes, ' + m.bombs.length + ' bombs, ' + m.walls.length + ' walls');
  }
});

test('overhead barriers kept only when crouching is allowed', () => {
  const map = { notes: [], bombs: [], walls: [{ t: 1, dur: 1, x: 0, w: 4, y: 2, h: 3 }, { t: 3, dur: 1, x: 0, w: 4, y: 0, h: 5 }] };
  assert.equal(adaptMap(map, { allowCrouch: false }).walls.length, 0);
  const a = adaptMap(map, { allowCrouch: true });
  assert.equal(a.walls.length, 1); assert.equal(a.walls[0].y, 2);
});

test('barrier course generator fills gaps on the beat grid', () => {
  const notes = [{ t: 2, x: 1, y: 0, c: 1, d: 1 }, { t: 3, x: 1, y: 0, c: 1, d: 1 }, { t: 14, x: 1, y: 0, c: 1, d: 1 }];
  const g = generateBarriers({ notes, bombs: [], walls: [] }, { bpm: 120, allowCrouch: true, endTime: 20, seed: 3 });
  assert.ok(g.added >= 3, 'added ' + g.added);
  for (const w of g.walls) {
    assert.ok((w.t > 3.9 && w.t + w.dur < 13.1) || (w.t >= 15 && w.t + w.dur <= 17.5), 'inside a gap: ' + w.t);
    assert.ok(Math.abs(w.t / 0.5 - Math.round(w.t / 0.5)) < 1e-6, 'on beat');
    assert.ok(w.y === 0 ? w.w <= 2 : w.w === 4, 'dodgeable pattern');
  }
  const noCrouch = generateBarriers({ notes, bombs: [], walls: [] }, { bpm: 120, allowCrouch: false, endTime: 20 });
  assert.ok(noCrouch.walls.every(w => w.y === 0));
});

test('accelerometer duck -> crouch, then back to standing', () => {
  globalThis.performance = globalThis.performance || { now: () => Date.now() };
  let now = 0; const realNow = performance.now; performance.now = () => now;
  const p = new PostureTracker();
  const feed = (ay, secs) => { for (let t = 0; t < secs; t += 1 / 60) { now += 1000 / 60; p._onMotion({ accelerationIncludingGravity: { x: 0.05, y: ay, z: 0.1 }, interval: 16.7 }); p.update(1 / 60, null, 'auto', 1, null); } };
  feed(9.81, 1.0);                       // standing still
  assert.ok(p.crouch < 0.1, 'standing ' + p.crouch);
  feed(9.81 - 5, 0.3);                   // duck: accelerate down (~45 cm total)
  feed(9.81 + 5, 0.3);                   // brake at the bottom
  let peak = 0; for (let i = 0; i < 20; i++) { feed(9.81, 1 / 60 * 3); peak = Math.max(peak, p.crouch); }
  assert.ok(peak > 0.5, 'crouch detected ' + peak.toFixed(2));
  feed(9.81, 4);
  assert.ok(p.crouch < 0.2, 'recovers to standing ' + p.crouch.toFixed(2));
  performance.now = realNow;
});

test('head tilt fallback: bow -> crouch, roll -> lean', () => {
  const p = new PostureTracker();
  const q = (pitchDeg, rollDeg) => { // YXZ with yaw 0: q = qx(pitch) * qz(roll)
    const hp = pitchDeg * Math.PI / 360, hr = rollDeg * Math.PI / 360;
    return { x: Math.sin(hp) * Math.cos(hr), y: -Math.sin(hp) * Math.sin(hr), z: Math.cos(hp) * Math.sin(hr), w: Math.cos(hp) * Math.cos(hr) };
  };
  for (let i = 0; i < 60; i++) p.update(1 / 60, q(-65, 0), 'tilt', 1, null);
  assert.ok(p.crouch > 0.9, 'bowed ' + p.crouch);
  for (let i = 0; i < 60; i++) p.update(1 / 60, q(-10, 0), 'tilt', 1, null);
  assert.ok(p.crouch < 0.05);
  for (let i = 0; i < 60; i++) p.update(1 / 60, q(0, 30), 'tilt', 1, null);
  assert.ok(p.lean < -0.8, 'roll left -> lean left ' + p.lean);
});

test('overhead barrier: crouched at entry passes, standing gets hit', () => {
  const noop = new Proxy({}, { get: () => () => {} });
  const run = (crouchAt) => {
    let clock = 0;
    const audio = { playMusic() {}, stopMusic() {}, play() {}, fadeOutMusic() {}, songTime: () => clock };
    const settings = { get: (k) => ({ noteSpeed: 1, audioOffsetMs: 0, strictDirection: false, noFail: true }[k]) };
    const saber = { base: { x: 0, y: 0, z: 9 }, tip: { x: 0, y: 0, z: 9 }, prevBase: { x: 0, y: 0, z: 9 }, prevTip: { x: 0, y: 0, z: 9 }, tipSpeed: 0, swingPeak: 0, tipVel: { x: 0, y: 0, z: 0 }, hitFlash() {} };
    const g = new Game({ objects: Object.assign(noop, { maxWalls: 12 }), particles: noop, audio, saber, env: noop, settings, input: noop });
    g.load({ title: 't', audioBuffer: { duration: 10 }, bpm: 120, njs: 10, map: { notes: [], bombs: [], walls: [{ t: 3, dur: 0.5, x: 0, w: 4, y: 2, h: 3 }] } });
    g.start();
    for (clock = 0; clock < 6; clock += 1 / 60) { g.playerCrouch = crouchAt(clock); g.update(1 / 60, { x: 0, y: 1.0, z: 0 }); }
    return g.score.wallHits;
  };
  assert.equal(run(() => 1), 0, 'fully crouched passes');
  assert.equal(run(() => 0), 1, 'standing is hit (even with a low head y)');
  assert.equal(run((t) => (t < 3.2 ? 1 : 0.3)), 0, 'half rising under the bar is forgiven');
  assert.equal(run((t) => (t < 3.2 ? 1 : 0)), 1, 'standing up fully under the bar is hit');
});

// Optional: parse a real unzipped map directory.
const dir = process.argv[2];
if (dir) {
  test('real map ' + dir, () => {
    const files = fs.readdirSync(dir);
    const infoName = files.find(f => f.toLowerCase() === 'info.dat');
    const info = parseInfo(JSON.parse(fs.readFileSync(path.join(dir, infoName), 'utf8').replace(/^﻿/, '')));
    for (const set of info.sets) for (const d of set.diffs) {
      const m = parseDifficulty(JSON.parse(fs.readFileSync(path.join(dir, d.file), 'utf8').replace(/^﻿/, '')), info.bpm, info.songTimeOffset);
      const a = adaptMap(m, { oneSaber: true });
      console.log(`       ${set.characteristic}/${d.difficulty}: ${m.notes.length} notes -> ${a.notes.length} one-saber, ${m.bombs.length}->${a.bombs.length} bombs, ${m.walls.length}->${a.walls.length} walls, last t=${m.notes.length ? m.notes[m.notes.length - 1].t.toFixed(1) : '-'}s`);
      assert.ok(m.notes.length > 0);
    }
  });
}

console.log(passed + ' tests passed');
