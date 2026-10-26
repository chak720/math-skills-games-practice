/**
 * Headless bot-vs-bot simulation (tests and calibration). Bots receive views
 * from the engine exactly as in the app; `onView` lets tests inspect every
 * view a bot is given.
 */
import { Table } from '../engine/table';
import type { PlayerView } from '../engine/types';
import { BotBrain, type BotDecision, type BotSpec } from './brain';
import type { Archetype, Difficulty } from './personality';

export interface SimResult {
  brains: BotBrain[];
  table: Table;
  hands: number;
}

export function simulate(
  archetypes: Archetype[],
  hands: number,
  opts: { difficulty?: Difficulty; seed?: string; onView?: (botIdx: number, v: PlayerView, trueHole: number[] | null) => void; onDecision?: (botIdx: number, v: PlayerView, d: BotDecision) => void } = {},
): SimResult {
  const table = new Table({ maxSeats: archetypes.length, sb: 5, bb: 10, ante: 0, startingStack: 1000 });
  const brains = archetypes.map((a, i) => {
    const spec: BotSpec = { botId: `b${i}`, playerId: `bot${i}-${a}`, name: `${a}${i}`, archetype: a, difficulty: opts.difficulty ?? 'medium', seed: `${opts.seed ?? 's'}-${i}` };
    table.sit(i, { playerId: spec.playerId, name: spec.name, stack: 1000, isHuman: false });
    return new BotBrain(spec);
  });
  for (let h = 0; h < hands; h++) {
    for (let s = 0; s < archetypes.length; s++) if (table.seats[s]!.stack < 300) table.rebuy(s, 1000);
    const hand = table.startHand('sim');
    let guard = 0;
    while (!hand.finished) {
      const seat = hand.toAct!;
      const v = hand.viewFor(seat);
      opts.onView?.(seat, v, null);
      const d = brains[seat].decide(structuredClone(v));
      opts.onDecision?.(seat, v, d);
      hand.act(seat, d.action);
      if (++guard > 400) throw new Error('runaway hand');
    }
    for (let s = 0; s < archetypes.length; s++) {
      const fv = hand.viewFor(s);
      if (brains[s].wantsToShow(fv)) hand.show(s);
    }
    const pub = hand.viewFor(-1);
    for (const b of brains) b.observe(structuredClone(pub));
    table.settle();
  }
  return { brains, table, hands };
}
