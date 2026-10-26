import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Table } from '../engine/table';
import { BotBrain } from './brain';
import { simulate } from './sim';
import type { Archetype } from './personality';
import { POOL } from './personality';

describe('architecture: bots cannot reach hidden information', () => {
  it('bot modules import only views/types and pure helpers — never the engine, deck or fairness code', () => {
    const dir = __dirname;
    const allowed = [
      /^@\/shared\/cards\/card$/, /^@\/shared\/random\/prng$/, /^@\/shared\/math\//,
      /^\.\.\/engine\/types$/, /^\.\.\/ranges\//, /^\.\.\/equity\//, /^\.\.\/analysis\//, /^\.\.\/eval\//, /^\.\//,
    ];
    const offenders: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts') || f.endsWith('.test.ts') || f === 'sim.ts') continue; // sim.ts is a test harness that plays the dealer
      const src = readFileSync(join(dir, f), 'utf8');
      for (const m of src.matchAll(/from\s+'([^']+)'/g)) if (!allowed.some((re) => re.test(m[1]))) offenders.push(`${f}: ${m[1]}`);
      // Engine imports must be type-only.
      for (const m of src.matchAll(/import\s+(type\s+)?\{[^}]*\}\s+from\s+'\.\.\/engine\/types'/g)) if (!m[1]) offenders.push(`${f}: non-type import of engine/types`);
    }
    expect(offenders).toEqual([]);
  });

  it('shared helpers the bots use do not import the engine runtime either', () => {
    const offenders: string[] = [];
    for (const sub of ['ranges', 'equity', 'analysis', 'eval']) {
      const dir = join(__dirname, '..', sub);
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue;
        const src = readFileSync(join(dir, f), 'utf8');
        for (const m of src.matchAll(/from\s+'([^']+)'/g)) if (/engine\/(hand|table|pots)|fairness|storage/.test(m[1])) offenders.push(`${sub}/${f}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every view a bot receives holds only its own cards plus public cards', () => {
    const table = new Table({ maxSeats: 6, sb: 5, bb: 10, ante: 0, startingStack: 1000 });
    const archs: Archetype[] = ['tag', 'lag', 'station', 'nit', 'maniac', 'beginner'];
    const brains = archs.map((a, i) => {
      table.sit(i, { playerId: `p${i}`, name: `p${i}`, stack: 1000, isHuman: false });
      return new BotBrain({ botId: `b${i}`, playerId: `p${i}`, name: `p${i}`, archetype: a, difficulty: 'medium', seed: `x${i}` });
    });
    const allowedKeys = new Set(['handId', 'me', 'hole', 'board', 'street', 'button', 'sbSeat', 'bbSeat', 'sb', 'bb', 'ante', 'seats', 'pot', 'currentBet', 'toAct', 'legal', 'actions', 'handOver', 'pots', 'winners', 'order',
      'seat', 'playerId', 'name', 'stack', 'betStreet', 'committed', 'folded', 'allIn', 'inHand', 'shown', 'mucked',
      'canFold', 'canCheck', 'canCall', 'callAmount', 'canRaise', 'raiseKind', 'minTo', 'maxTo',
      'type', 'amount', 'to', 'potAfter', 'raiseBy', 'eligible', 'potIndex', 'hand']);
    const walkKeys = (o: unknown, out: Set<string>): void => {
      if (Array.isArray(o)) o.forEach((x) => walkKeys(x, out));
      else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { out.add(k); walkKeys(v, out); }
    };
    let views = 0;
    for (let h = 0; h < 60; h++) {
      for (let s = 0; s < 6; s++) if (table.seats[s]!.stack < 200) table.rebuy(s);
      const hand = table.startHand('seed');
      const received: { seat: number; v: ReturnType<typeof hand.viewFor> }[] = [];
      while (!hand.finished) {
        const seat = hand.toAct!;
        const v = structuredClone(hand.viewFor(seat));
        received.push({ seat, v });
        hand.act(seat, brains[seat].decide(v).action);
      }
      const hist = hand.history();
      const holeOf = new Map(hist.players.map((p) => [p.seat, p.hole]));
      for (const { seat, v } of received) {
        views++;
        expect(v.hole).toEqual(holeOf.get(seat));
        expect(hist.board.slice(0, v.board.length)).toEqual(v.board);
        const keys = new Set<string>();
        walkKeys(v, keys);
        for (const k of keys) expect(allowedKeys.has(k), `unexpected key ${k}`).toBe(true);
        for (const s of v.seats) {
          if (s.seat === seat) continue;
          // Others' cards appear only once tabled (all-in), and then they are the true cards.
          if (s.shown) {
            expect(s.allIn || v.seats.filter((x) => !x.folded && !x.allIn).length <= 1).toBe(true);
            expect(s.shown).toEqual(holeOf.get(s.seat));
          }
        }
        // No hidden card of another player appears anywhere in the view's card fields.
        const visible = new Set([...(v.hole ?? []), ...v.board, ...v.seats.flatMap((s) => s.shown ?? [])]);
        for (const p of hist.players) if (p.seat !== seat && !v.seats.find((s) => s.seat === p.seat)?.shown) for (const c of p.hole) expect(visible.has(c)).toBe(false);
      }
      table.settle();
    }
    expect(views).toBeGreaterThan(300);
  });
});

describe('personalities produce distinct, recognisable styles', () => {
  it('VPIP/PFR/aggression order across archetypes over 350 hands', () => {
    const archs: Archetype[] = ['tag', 'lag', 'station', 'nit', 'maniac', 'beginner'];
    const { brains } = simulate(archs, 350, { seed: 'styles' });
    // Use a neutral observer: brain 0's stats on everyone.
    const st = brains[0].stats;
    const s = (i: number) => {
      const a = st.get(`bot${i}-${archs[i]}`);
      return { vpip: a.vpip / a.hands, pfr: a.pfr / a.hands, af: a.postAggr / Math.max(1, a.postCalls) };
    };
    const [tag, lag, station, nit, maniac, beginner] = archs.map((_, i) => s(i));
    expect(maniac.vpip).toBeGreaterThan(lag.vpip);
    expect(station.vpip).toBeGreaterThan(tag.vpip);
    expect(lag.vpip).toBeGreaterThan(tag.vpip);
    expect(tag.vpip).toBeGreaterThan(nit.vpip);
    expect(beginner.vpip).toBeGreaterThan(tag.vpip);
    expect(maniac.pfr).toBeGreaterThan(tag.pfr);
    expect(lag.pfr).toBeGreaterThan(nit.pfr);
    expect(station.pfr).toBeLessThan(station.vpip * 0.5); // passive: calls/limps far more than raises
    expect(maniac.af).toBeGreaterThan(station.af * 2);
    expect(tag.vpip).toBeGreaterThan(0.12);
    expect(tag.vpip).toBeLessThan(0.35);
    expect(nit.vpip).toBeLessThan(0.2);
  }, 120_000);

  it('weak players leak strength through bet sizing; regulars do not', () => {
    const archs: Archetype[] = ['beginner', 'tag', 'beginner', 'tag', 'station', 'lag'];
    const frac: Record<string, { value: number[]; bluff: number[] }> = { beginner: { value: [], bluff: [] }, tag: { value: [], bluff: [] } };
    simulate(archs, 400, {
      seed: 'tells',
      onDecision: (i, v, d) => {
        const a = archs[i];
        if (!(a in frac) || v.street === 'preflop' || d.action.type !== 'bet') return;
        const f = ((d.action.to ?? 0) - v.currentBet) / v.pot;
        if (f > 3) return; // all-in shoves distort the mean
        if (d.reason.startsWith('value bet')) frac[a].value.push(f);
        else if (/bluff|continuation/.test(d.reason)) frac[a].bluff.push(f);
      },
    });
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    expect(frac.beginner.value.length).toBeGreaterThan(5);
    expect(frac.tag.value.length).toBeGreaterThan(5);
    expect(frac.tag.bluff.length).toBeGreaterThan(5);
    expect(mean(frac.beginner.value) - mean(frac.beginner.bluff)).toBeGreaterThan(0.3); // big bet = strong
    expect(Math.abs(mean(frac.tag.value) - mean(frac.tag.bluff))).toBeLessThan(0.15); // balanced
  }, 120_000);
});

describe('memory, tilt and adaptation', () => {
  it('a bad beat or big loss tilts the bot, loosening it; tilt decays', () => {
    const b = new BotBrain({ botId: 'b', playerId: 'me', name: 'me', archetype: 'lag', difficulty: 'medium', seed: 't' });
    const loose0 = b.personality.looseness;
    b.tilt = 0.8;
    expect(b.personality.looseness).toBeGreaterThan(loose0 * 1.3);
    expect(b.personality.aggression).toBeGreaterThan(b.base.aggression);
    for (let i = 0; i < 15; i++) b.tilt *= 0.86;
    expect(b.personality.looseness).toBeLessThan(loose0 * 1.1);
  });

  it('opponent stats update gradually (Bayesian smoothing), faster for strong adapters', () => {
    const fast = new BotBrain({ botId: 'f', playerId: 'f', name: 'f', archetype: 'tag', difficulty: 'hard', seed: 'f' });
    const slow = new BotBrain({ botId: 's', playerId: 's', name: 's', archetype: 'beginner', difficulty: 'easy', seed: 's' });
    const line = { playerId: 'hero', seat: 0, vpip: 1, pfr: 1, threeBetOpp: 0, threeBet: 0, foldTo3BetOpp: 1, foldTo3Bet: 1, cbetOpp: 0, cbet: 0, foldToCbetOpp: 0, foldToCbet: 0, postAggr: 0, postCalls: 0, sawFlop: 0, wtsd: 0, wsd: 0, caughtBluff: 0, showedStrong: 0, netChips: 0 };
    for (let i = 0; i < 10; i++) { fast.stats.add([line]); slow.stats.add([line]); }
    const kf = 14 / fast.base.adaptRate, ks = 14 / slow.base.adaptRate;
    const f3f = fast.stats.foldTo3Bet('hero', kf), f3s = slow.stats.foldTo3Bet('hero', ks);
    expect(f3f).toBeGreaterThan(0.7);
    expect(f3s).toBeLessThan(f3f);
    expect(f3s).toBeGreaterThan(0.55);
  });

  it('the recurring pool has unique names and every archetype', () => {
    expect(new Set(POOL.map((p) => p.name)).size).toBe(POOL.length);
    expect(new Set(POOL.map((p) => p.archetype)).size).toBe(7);
  });
});
