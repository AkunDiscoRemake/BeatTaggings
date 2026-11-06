// Global constants for Beat Taggings. All distances are in meters, times in seconds.

export const GAME_NAME = 'BEAT TAGGINGS';
export const VERSION = '1.0.0';

export const COLORS = {
  purple: 0x9b30ff,
  purpleHot: 0xc77dff,
  purpleDeep: 0x3c096c,
  white: 0xffffff,
  black: 0x000000,
  // Block colors. Index 0 = "left" notes in community maps, index 1 = "right" notes.
  // With a single saber both colors are cuttable.
  note0: 0xff2fd6, // magenta
  note1: 0x8f5bff, // violet
  bomb: 0x0a0a0f,
  wall: 0x07050c,
  fog: 0x0b0414,
};

export const CSS_COLORS = {
  purple: '#9b30ff',
  purpleHot: '#c77dff',
  purpleDeep: '#3c096c',
  bg: '#07030d',
  panel: 'rgba(14,6,26,0.92)',
  white: '#ffffff',
  dim: '#a99bc4',
  note0: '#ff2fd6',
  note1: '#8f5bff',
  good: '#7dffb3',
  bad: '#ff4d6d',
};

// Play-space layout (floor-relative, player looking down -Z).
export const LAYOUT = {
  headHeight: 1.6,
  laneWidth: 0.5,         // horizontal spacing between the 4 lanes
  layerHeight: 0.45,      // vertical spacing between the 3 layers
  layerBase: 0.8,         // height of the bottom layer
  noteSize: 0.4,
  hitZ: -1.05,            // z where a note is "on beat"
  missZ: 0.45,            // z past which an un-hit note is a miss
  despawnZ: 2.0,
  maxSpawnDistance: 28,
  lateralRange: 1.35,     // how far the touchpad can move the player sideways
  crouchDrop: 0.6,        // how much the head/saber go down when fully crouched
  leanMax: 0.32,          // sideways head offset when fully leaning
  headRadius: 0.16,
  // 3DoF "arm model": the saber pivots around this rig-relative point.
  saberPivot: { x: 0.22, y: 1.05, z: -0.28 },
  bladeLength: 1.1,
  hiltLength: 0.26,
};

export const SCORING = {
  baseHit: 40,
  swingMax: 40,
  centerMax: 35,
  maxPerNote: 115,
  directionPenalty: 0.55,   // multiplier on hit score when direction is wrong (non-strict)
  minSwingSpeed: 1.2,       // m/s at the tip to count as a full swing
  fullSwingSpeed: 5.0,
  multiplierSteps: [2, 4, 8], // hits needed at each multiplier level to go up
  energyStart: 0.5,
  energyHit: 0.012,
  energyMiss: 0.1,
  energyBomb: 0.15,
  energyWallPerSec: 0.9,
};

export const RANKS = [
  { min: 0.95, rank: 'SS' },
  { min: 0.9, rank: 'S' },
  { min: 0.8, rank: 'A' },
  { min: 0.65, rank: 'B' },
  { min: 0.5, rank: 'C' },
  { min: 0, rank: 'D' },
];

export const QUALITY_PRESETS = {
  low: { framebufferScale: 0.85, foveation: 1.0, particles: 96, trailSegments: 10, stars: 0, pixelRatio: 1 },
  medium: { framebufferScale: 1.0, foveation: 0.66, particles: 160, trailSegments: 14, stars: 300, pixelRatio: 1 },
  high: { framebufferScale: 1.15, foveation: 0.33, particles: 240, trailSegments: 18, stars: 600, pixelRatio: 1.5 },
};

export const BEATSAVER = {
  apiBase: 'https://api.beatsaver.com',
  pageSize: 20,
};

export const DIFFICULTY_ORDER = ['Easy', 'Normal', 'Hard', 'Expert', 'ExpertPlus'];
export const DIFFICULTY_LABEL = {
  Easy: 'Fácil',
  Normal: 'Normal',
  Hard: 'Difícil',
  Expert: 'Expert',
  ExpertPlus: 'Expert+',
};
