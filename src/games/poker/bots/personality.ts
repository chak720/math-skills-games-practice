/**
 * Bot personalities. Each archetype is a set of parameters that every
 * decision reads; individual players jitter around the archetype (so two
 * "TAG regulars" are not identical) and moods shift them further during a
 * session.
 */
import { Rng, hashString } from '@/shared/random/prng';

export type Archetype = 'tag' | 'lag' | 'station' | 'nit' | 'maniac' | 'beginner' | 'trapper';

export const ARCHETYPE_LABEL: Record<Archetype, string> = {
  tag: 'TAG regular',
  lag: 'Loose-aggressive',
  station: 'Calling station',
  nit: 'Nit',
  maniac: 'Maniac',
  beginner: 'Nervous beginner',
  trapper: 'Tricky trapper',
};

export const ARCHETYPE_BLURB: Record<Archetype, string> = {
  tag: 'Solid, positional, balanced bet sizes. Hard to exploit.',
  lag: 'Opens wide, 3-bets light, barrels. Balanced but pushes thin edges.',
  station: 'Calls far too much and rarely raises. Value-bet relentlessly; never bluff.',
  nit: 'Plays very few hands. A bet usually means a strong hand. Steal their blinds.',
  maniac: 'Raises and overbets constantly. Call down lighter and let them bluff.',
  beginner: 'Limps, chases draws, sizes bets by hand strength. Big bet = big hand.',
  trapper: 'Slow-plays strong hands and check-raises. Be careful when checked to.',
};

export type SizingStyle = 'balanced' | 'tells' | 'overbets' | 'steady' | 'small';
export type ChatStyle = 'friendly' | 'salty' | 'quiet' | 'needler';

export interface Personality {
  archetype: Archetype;
  /** Multiplier on the chart opening range. */
  looseness: number;
  /** Probability of limping a hand it chose to play first-in. */
  limpFreq: number;
  /** Multiplier on chart 3-bet frequency. */
  threeBet: number;
  /** Multiplier on chart flat-call frequency. */
  coldCall: number;
  /** Probability to fold to a 3-bet with a non-premium opening hand (vs chart ~0.55). */
  foldTo3Bet: number;
  openSizeBB: number;
  /** 0..1 tendency to bet/raise rather than check/call. */
  aggression: number;
  bluffFreq: number;
  semiBluffFreq: number;
  cbetFreq: number;
  /** Added to the equity needed to call (negative = calls lighter). */
  callAdj: number;
  /** 0..1: how much large bets make it fold marginal hands. */
  foldToPressure: number;
  slowplayFreq: number;
  // Realistic mistakes (probabilities)
  overvalueTopPair: number;
  chaseDraws: number;
  minRaiseOddly: number;
  missValue: number;
  sizing: SizingStyle;
  /** 0..1: how well it narrows ranges and uses reads. */
  readSkill: number;
  /** Speed of updating opponent stats (prior strength ∝ 1/adaptRate). */
  adaptRate: number;
  // Humanisation
  thinkBaseMs: number;
  /** 0..1: how strongly think time leaks hand strength (weak players). */
  timingTell: number;
  /** Probability of deliberately inconsistent timing ("Hollywood"). */
  timingNoise: number;
  tankProb: number;
  tiltProne: number;
  winReaction: 'tighten' | 'cocky' | 'none';
  chattiness: number;
  chatStyle: ChatStyle;
  /** Per-hand base probability of leaving the table. */
  leaveProb: number;
  rebuyProb: number;
  buyInBB: [number, number];
  /** Effective stack (bb) below which it plays push/fold. */
  shortStackBB: number;
}

const BASE: Record<Archetype, Personality> = {
  tag: {
    archetype: 'tag', looseness: 1.0, limpFreq: 0, threeBet: 1.0, coldCall: 0.9, foldTo3Bet: 0.55, openSizeBB: 2.5,
    aggression: 0.62, bluffFreq: 0.28, semiBluffFreq: 0.45, cbetFreq: 0.6, callAdj: 0.0, foldToPressure: 0.45, slowplayFreq: 0.12,
    overvalueTopPair: 0.03, chaseDraws: 0.02, minRaiseOddly: 0, missValue: 0.05, sizing: 'balanced', readSkill: 0.85, adaptRate: 1.0,
    thinkBaseMs: 1700, timingTell: 0.1, timingNoise: 0.1, tankProb: 0.08, tiltProne: 0.25, winReaction: 'none', chattiness: 0.25, chatStyle: 'quiet',
    leaveProb: 0.006, rebuyProb: 0.95, buyInBB: [100, 100], shortStackBB: 14,
  },
  lag: {
    archetype: 'lag', looseness: 1.45, limpFreq: 0, threeBet: 1.7, coldCall: 1.0, foldTo3Bet: 0.42, openSizeBB: 2.3,
    aggression: 0.78, bluffFreq: 0.4, semiBluffFreq: 0.65, cbetFreq: 0.72, callAdj: -0.02, foldToPressure: 0.3, slowplayFreq: 0.1,
    overvalueTopPair: 0.05, chaseDraws: 0.05, minRaiseOddly: 0, missValue: 0.04, sizing: 'balanced', readSkill: 0.8, adaptRate: 1.2,
    thinkBaseMs: 1400, timingTell: 0.05, timingNoise: 0.25, tankProb: 0.07, tiltProne: 0.45, winReaction: 'cocky', chattiness: 0.4, chatStyle: 'needler',
    leaveProb: 0.007, rebuyProb: 0.95, buyInBB: [100, 100], shortStackBB: 12,
  },
  station: {
    archetype: 'station', looseness: 1.9, limpFreq: 0.55, threeBet: 0.3, coldCall: 2.6, foldTo3Bet: 0.25, openSizeBB: 3,
    aggression: 0.2, bluffFreq: 0.04, semiBluffFreq: 0.08, cbetFreq: 0.35, callAdj: -0.13, foldToPressure: 0.15, slowplayFreq: 0.3,
    overvalueTopPair: 0.6, chaseDraws: 0.7, minRaiseOddly: 0.3, missValue: 0.3, sizing: 'tells', readSkill: 0.2, adaptRate: 0.3,
    thinkBaseMs: 1500, timingTell: 0.6, timingNoise: 0.05, tankProb: 0.04, tiltProne: 0.4, winReaction: 'cocky', chattiness: 0.5, chatStyle: 'friendly',
    leaveProb: 0.012, rebuyProb: 0.8, buyInBB: [60, 100], shortStackBB: 6,
  },
  nit: {
    archetype: 'nit', looseness: 0.6, limpFreq: 0.05, threeBet: 0.6, coldCall: 0.6, foldTo3Bet: 0.78, openSizeBB: 3,
    aggression: 0.42, bluffFreq: 0.06, semiBluffFreq: 0.18, cbetFreq: 0.45, callAdj: 0.07, foldToPressure: 0.85, slowplayFreq: 0.05,
    overvalueTopPair: 0.02, chaseDraws: 0.02, minRaiseOddly: 0.05, missValue: 0.15, sizing: 'steady', readSkill: 0.55, adaptRate: 0.6,
    thinkBaseMs: 2100, timingTell: 0.35, timingNoise: 0.05, tankProb: 0.1, tiltProne: 0.2, winReaction: 'tighten', chattiness: 0.15, chatStyle: 'quiet',
    leaveProb: 0.008, rebuyProb: 0.9, buyInBB: [80, 100], shortStackBB: 12,
  },
  maniac: {
    archetype: 'maniac', looseness: 2.4, limpFreq: 0.05, threeBet: 3.2, coldCall: 1.2, foldTo3Bet: 0.2, openSizeBB: 4,
    aggression: 0.92, bluffFreq: 0.62, semiBluffFreq: 0.85, cbetFreq: 0.9, callAdj: -0.06, foldToPressure: 0.12, slowplayFreq: 0.04,
    overvalueTopPair: 0.4, chaseDraws: 0.4, minRaiseOddly: 0.05, missValue: 0.02, sizing: 'overbets', readSkill: 0.3, adaptRate: 0.4,
    thinkBaseMs: 900, timingTell: 0.2, timingNoise: 0.2, tankProb: 0.02, tiltProne: 0.7, winReaction: 'cocky', chattiness: 0.6, chatStyle: 'salty',
    leaveProb: 0.015, rebuyProb: 0.97, buyInBB: [100, 100], shortStackBB: 4,
  },
  beginner: {
    archetype: 'beginner', looseness: 1.6, limpFreq: 0.6, threeBet: 0.4, coldCall: 2.0, foldTo3Bet: 0.6, openSizeBB: 3.5,
    aggression: 0.3, bluffFreq: 0.08, semiBluffFreq: 0.12, cbetFreq: 0.4, callAdj: -0.06, foldToPressure: 0.6, slowplayFreq: 0.35,
    overvalueTopPair: 0.5, chaseDraws: 0.65, minRaiseOddly: 0.45, missValue: 0.35, sizing: 'tells', readSkill: 0.15, adaptRate: 0.2,
    thinkBaseMs: 2600, timingTell: 0.8, timingNoise: 0.05, tankProb: 0.12, tiltProne: 0.55, winReaction: 'cocky', chattiness: 0.45, chatStyle: 'friendly',
    leaveProb: 0.014, rebuyProb: 0.6, buyInBB: [40, 100], shortStackBB: 5,
  },
  trapper: {
    archetype: 'trapper', looseness: 1.1, limpFreq: 0.08, threeBet: 1.1, coldCall: 1.3, foldTo3Bet: 0.5, openSizeBB: 2.5,
    aggression: 0.55, bluffFreq: 0.3, semiBluffFreq: 0.4, cbetFreq: 0.45, callAdj: -0.02, foldToPressure: 0.4, slowplayFreq: 0.5,
    overvalueTopPair: 0.05, chaseDraws: 0.05, minRaiseOddly: 0, missValue: 0.06, sizing: 'balanced', readSkill: 0.8, adaptRate: 1.0,
    thinkBaseMs: 1900, timingTell: 0.05, timingNoise: 0.35, tankProb: 0.1, tiltProne: 0.3, winReaction: 'tighten', chattiness: 0.3, chatStyle: 'needler',
    leaveProb: 0.007, rebuyProb: 0.9, buyInBB: [100, 100], shortStackBB: 12,
  },
};

/** Personality for one individual: archetype parameters with ±12% jitter. */
export function personalityFor(archetype: Archetype, seed: string): Personality {
  const rng = new Rng(hashString(seed));
  const p = { ...BASE[archetype] };
  const jitter = (x: number, amt = 0.12): number => x * (1 + (rng.next() * 2 - 1) * amt);
  const keys: (keyof Personality)[] = ['looseness', 'threeBet', 'coldCall', 'aggression', 'bluffFreq', 'semiBluffFreq', 'cbetFreq', 'slowplayFreq', 'thinkBaseMs', 'tiltProne', 'chattiness'];
  for (const k of keys) (p[k] as number) = jitter(p[k] as number);
  p.openSizeBB = Math.round(jitter(p.openSizeBB, 0.08) * 2) / 2;
  p.callAdj += (rng.next() * 2 - 1) * 0.015;
  return p;
}

export interface PoolPlayer {
  playerId: string;
  name: string;
  archetype: Archetype;
  /** Avatar hue (0..360). */
  hue: number;
}

/**
 * The recurring player pool. Fixed identities mean you meet "vik_nordic"
 * again next session and your notes still apply — like regulars online.
 */
const POOL_DEF: [string, Archetype][] = [
  ['vik_nordic', 'tag'], ['Ostrava88', 'tag'], ['calm_kestrel', 'tag'], ['pmar_grinds', 'tag'], ['ridgeline', 'tag'],
  ['Mira3bets', 'lag'], ['dr_vorpal', 'lag'], ['SpicyRange', 'lag'], ['fourbetfiona', 'lag'],
  ['DaveCallsAll', 'station'], ['bigsmoke_tx', 'station'], ['Neville_74', 'station'], ['lucky_lou22', 'station'],
  ['gr4nite', 'nit'], ['foldmaster_k', 'nit'], ['OldOakTree', 'nit'], ['patience_pays', 'nit'],
  ['shovestorm', 'maniac'], ['BLAZE_IT_ALL', 'maniac'], ['yolo_kaiser', 'maniac'],
  ['first_time_tom', 'beginner'], ['pokerkitten', 'beginner'], ['learning2fold', 'beginner'], ['sunny_dale_11', 'beginner'],
  ['quietriver', 'trapper'], ['sly_otter', 'trapper'], ['the_long_game', 'trapper'], ['velvet_hammer', 'trapper'],
];

export const POOL: PoolPlayer[] = POOL_DEF.map(([name, archetype]) => ({ playerId: `bot:${name}`, name, archetype, hue: hashString(name) % 360 }));

export type Difficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTY_MIX: Record<Difficulty, Partial<Record<Archetype, number>>> = {
  easy: { beginner: 0.3, station: 0.25, maniac: 0.15, nit: 0.2, tag: 0.1 },
  medium: { tag: 0.24, lag: 0.14, station: 0.15, nit: 0.14, beginner: 0.11, maniac: 0.08, trapper: 0.14 },
  hard: { tag: 0.4, lag: 0.26, trapper: 0.2, nit: 0.09, station: 0.05 },
};

/** Difficulty adjusts skill inside an archetype (reads, adaptation, mistakes). */
export function applyDifficulty(p: Personality, d: Difficulty): Personality {
  if (d === 'medium') return p;
  const q = { ...p };
  if (d === 'hard') {
    q.readSkill = Math.min(0.95, p.readSkill + 0.15);
    q.adaptRate = p.adaptRate * 1.4;
    q.overvalueTopPair *= 0.5;
    q.chaseDraws *= 0.5;
    q.missValue *= 0.5;
    q.timingTell *= 0.4;
  } else {
    q.readSkill = Math.max(0.1, p.readSkill - 0.2);
    q.adaptRate = p.adaptRate * 0.6;
    q.timingTell = Math.min(1, p.timingTell + 0.2);
  }
  return q;
}

/** Choose a pool player for an empty seat, weighted by the difficulty mix. */
export function pickPoolPlayer(d: Difficulty, exclude: Set<string>, rng: Rng): PoolPlayer | null {
  const avail = POOL.filter((p) => !exclude.has(p.playerId));
  if (!avail.length) return null;
  const mix = DIFFICULTY_MIX[d];
  return rng.weighted(avail, avail.map((p) => mix[p.archetype] ?? 0.01));
}
