/**
 * Think times and chat.
 *
 * Think time = base × lognormal noise × (difficulty and size factors), with
 * occasional long "tanks" on big decisions. Weak players leak strength through
 * timing (snap-calls with draws, long pauses before folding); strong players
 * don't, and some are deliberately inconsistent (tanking with the nuts,
 * snapping with air).
 */
import type { Rng } from '@/shared/random/prng';
import type { ChatStyle, Personality } from './personality';

export interface ThinkInput {
  /** 'trivial' = auto-pilot (clear preflop fold, free check with air). */
  kind: 'trivial' | 'routine' | 'decision';
  /** 0 (obvious) … 1 (razor-close). */
  difficulty: number;
  /** Fraction of stack at risk in this decision, 0..1. */
  bigness: number;
  /** Hand strength 0..1 as the bot perceives it. */
  strength: number;
  /** The chosen action is aggressive (bet/raise). */
  aggressive: boolean;
  tilt: number;
}

export function thinkTime(p: Personality, t: ThinkInput, rng: Rng): number {
  let ms: number;
  if (t.kind === 'trivial') {
    ms = rng.logNormal(p.thinkBaseMs * 0.35, 0.4);
  } else {
    const factor = (t.kind === 'routine' ? 0.6 : 0.9) + 1.1 * t.difficulty + 0.9 * t.bigness;
    ms = rng.logNormal(p.thinkBaseMs * factor, 0.45);
    // Timing tells: weak players act fast with draws/medium hands when calling,
    // and pause before big aggressive actions with monsters.
    if (p.timingTell > 0) {
      const tellShift = t.aggressive ? (t.strength > 0.8 ? 1.5 : 0.8) : t.strength < 0.5 ? 0.6 : 1.2;
      ms *= 1 + p.timingTell * (tellShift - 1);
    }
    if (rng.chance(p.timingNoise)) ms *= rng.chance(0.5) ? rng.uniform(2, 4) : rng.uniform(0.25, 0.5); // Hollywood / snap
    if (t.bigness > 0.35 && rng.chance(p.tankProb * (0.5 + t.difficulty))) ms += rng.uniform(5000, 13000);
  }
  ms *= 1 - 0.35 * Math.min(1, t.tilt); // tilted players act faster
  return Math.max(250, Math.min(20000, ms));
}

export type ChatEvent = 'join' | 'leave' | 'badBeat' | 'bigLoss' | 'bigWin' | 'niceHand' | 'sawBluff' | 'ownBluffShown' | 'rebuy';

const LINES: Record<ChatStyle, Partial<Record<ChatEvent, string[]>>> = {
  friendly: {
    join: ['hi all', 'gl all', 'hey'],
    leave: ['gtg, gl all', 'ty all, gl', 'cya'],
    badBeat: ['ugh', 'so close', 'unlucky me', 'oh well'],
    bigLoss: ['ouch', 'there goes that'],
    bigWin: ['ty', 'phew', 'finally'],
    niceHand: ['nh', 'nice hand', 'wp'],
    sawBluff: ['lol', 'gutsy'],
    rebuy: ['one more go', 'reloading'],
  },
  salty: {
    leave: ['done', 'this site lol', 'ok im out'],
    badBeat: ['ugh, again', 'unreal', 'every single time', 'of course', 'how'],
    bigLoss: ['sure', 'lol ok', 'cool cool'],
    bigWin: ['ship it', 'finally'],
    niceHand: ['nh i guess'],
    sawBluff: ['knew it', 'lol'],
    rebuy: ['reload', 'again'],
  },
  quiet: {
    join: ['gl'],
    leave: ['gl'],
    badBeat: ['nh'],
    niceHand: ['nh'],
  },
  needler: {
    join: ['gl'],
    leave: ['gg'],
    badBeat: ['nice catch', 'sick'],
    bigWin: ['ty ty'],
    niceHand: ['nh'],
    sawBluff: ['knew it', 'nice try', 'thought so'],
    ownBluffShown: ['had it', 'just a little one', 'had to'],
  },
};

/** Base probability that an event produces a line (before chattiness). */
const EVENT_RATE: Record<ChatEvent, number> = {
  join: 0.35, leave: 0.5, badBeat: 0.35, bigLoss: 0.12, bigWin: 0.12, niceHand: 0.06, sawBluff: 0.2, ownBluffShown: 0.5, rebuy: 0.2,
};

export function chatLine(p: Personality, ev: ChatEvent, rng: Rng, tilt = 0): string | null {
  const style: ChatStyle = tilt > 0.5 && (ev === 'badBeat' || ev === 'bigLoss') ? 'salty' : p.chatStyle;
  const lines = LINES[style][ev] ?? LINES.friendly[ev];
  if (!lines?.length) return null;
  return rng.chance(EVENT_RATE[ev] * p.chattiness * 2) ? rng.pick(lines) : null;
}
