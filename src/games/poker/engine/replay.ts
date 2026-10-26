/**
 * Replays a finished hand by re-running the engine on the recorded deck and
 * actions. Every step is an exact engine state, so Hand Review shows precisely
 * what happened (with all cards revealed), and the coach can be asked about
 * the hero's view at any decision point.
 */
import type { Card } from '@/shared/cards/card';
import { Hand, type HandHistory } from './hand';
import type { ActionRecord, PlayerView } from './types';

export interface ReplayStep {
  /** The action just taken (null for the initial state after blinds). */
  action: ActionRecord | null;
  /** Spectator view with every hole card revealed (review only). */
  full: PlayerView;
  /** The hero's own view *before* this action, when the hero was to act. */
  heroDecision: PlayerView | null;
}

export function replay(h: HandHistory, heroSeat: number): ReplayStep[] {
  const cards = h.dealt.map((d) => d.card);
  let i = 0;
  const deck = { draw: (): Card => cards[i++] };
  const maxSeats = Math.max(...h.players.map((p) => p.seat)) + 1;
  const hand = new Hand({
    handId: h.handId, sb: h.sb, bb: h.bb, ante: h.ante, button: h.button, maxSeats,
    seats: h.players.map((p) => ({ seat: p.seat, playerId: p.playerId, name: p.name, stack: p.stackStart })),
    deck,
  });
  const holes = new Map(h.players.map((p) => [p.seat, p.hole]));
  const reveal = (v: PlayerView): PlayerView => ({ ...v, seats: v.seats.map((s) => ({ ...s, shown: holes.get(s.seat) ?? null })) });
  const steps: ReplayStep[] = [{ action: null, full: reveal(hand.viewFor(-1)), heroDecision: null }];
  for (const a of h.actions) {
    if (a.type.startsWith('post') || a.type === 'uncalled') continue;
    const heroDecision = hand.toAct === heroSeat ? hand.viewFor(heroSeat) : null;
    hand.act(a.seat, a.type === 'bet' || a.type === 'raise' ? { type: a.type, to: a.to } : { type: a.type as 'fold' | 'check' | 'call' });
    steps.push({ action: hand.actions.filter((x) => x.type !== 'uncalled').at(-1)!, full: reveal(hand.viewFor(-1)), heroDecision });
  }
  // Voluntary shows after the hand: reflect them for completeness.
  for (const p of h.players) if (p.shown && !p.folded) try { hand.show(p.seat); } catch { /* ignore */ }
  return steps;
}
