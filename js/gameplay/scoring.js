// Score / combo / multiplier / energy bookkeeping. Pure logic.
import { SCORING, RANKS } from '../core/config.js';

const LEVELS = [1, 2, 4, 8];

export class ScoreKeeper {
  constructor() { this.reset(); }

  reset() {
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.level = 0;
    this.progress = 0;
    this.energy = SCORING.energyStart;
    this.hits = 0;
    this.misses = 0;
    this.badCuts = 0;
    this.bombsHit = 0;
    this.wallHits = 0;
    this.rawPoints = 0;
    this.judged = 0;
    this.totalNotes = 0;
    this.failed = false;
  }

  get multiplier() { return LEVELS[this.level]; }
  get multiplierProgress() {
    if (this.level >= LEVELS.length - 1) return 1;
    return this.progress / SCORING.multiplierSteps[this.level];
  }
  get accuracy() { return this.judged ? this.rawPoints / (this.judged * SCORING.maxPerNote) : 1; }

  // Computes the cut score from swing speed, centering (0..1) and direction correctness.
  static cutPoints(tipSpeed, center, directionOk) {
    const s = Math.max(0, Math.min(1, (tipSpeed - SCORING.minSwingSpeed * 0.4) / (SCORING.fullSwingSpeed - SCORING.minSwingSpeed * 0.4)));
    let pts = SCORING.baseHit + SCORING.swingMax * s + SCORING.centerMax * Math.max(0, Math.min(1, center));
    if (!directionOk) pts *= SCORING.directionPenalty;
    return Math.round(Math.min(SCORING.maxPerNote, pts));
  }

  static judgement(points) {
    if (points >= 105) return 'perfect';
    if (points >= 90) return 'great';
    if (points >= 70) return 'good';
    return 'ok';
  }

  hit(points) {
    this.hits++;
    this.judged++;
    this.rawPoints += points;
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    if (this.level < LEVELS.length - 1) {
      this.progress++;
      if (this.progress >= SCORING.multiplierSteps[this.level]) { this.level++; this.progress = 0; }
    }
    this.score += points * this.multiplier;
    this.energy = Math.min(1, this.energy + SCORING.energyHit);
  }

  _break() {
    this.combo = 0;
    if (this.level > 0) this.level--;
    this.progress = 0;
  }

  miss() {
    this.misses++;
    this.judged++;
    this._break();
    this.energy -= SCORING.energyMiss;
  }

  badCut() {
    this.badCuts++;
    this.judged++;
    this._break();
    this.energy -= SCORING.energyMiss;
  }

  bomb() {
    this.bombsHit++;
    this._break();
    this.energy -= SCORING.energyBomb;
  }

  wallEnter() {
    this.wallHits++;
    this._break();
  }

  wallDrain(dt) { this.energy -= SCORING.energyWallPerSec * dt; }

  rank() {
    const acc = this.accuracy;
    for (let i = 0; i < RANKS.length; i++) if (acc >= RANKS[i].min) return RANKS[i].rank;
    return 'D';
  }

  result() {
    return {
      score: this.score,
      accuracy: this.accuracy,
      rank: this.failed ? 'F' : this.rank(),
      maxCombo: this.maxCombo,
      hits: this.hits,
      misses: this.misses,
      badCuts: this.badCuts,
      bombsHit: this.bombsHit,
      wallHits: this.wallHits,
      totalNotes: this.totalNotes,
      failed: this.failed,
      fullCombo: !this.failed && this.misses === 0 && this.badCuts === 0 && this.bombsHit === 0 && this.hits === this.totalNotes && this.totalNotes > 0,
    };
  }
}
