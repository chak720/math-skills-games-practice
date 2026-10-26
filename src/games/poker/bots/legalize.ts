import type { LegalActions, PlayerAction } from '../engine/types';

/** Coerce any intended action into the nearest legal one. */
export function legalize(L: LegalActions, a: PlayerAction): PlayerAction {
  if (a.type === 'bet' || a.type === 'raise') {
    if (!L.canRaise) return L.canCheck ? { type: 'check' } : { type: 'call' };
    const to = Math.round(Math.min(L.maxTo, Math.max(L.minTo, a.to ?? L.minTo)));
    return { type: L.raiseKind, to };
  }
  if (a.type === 'fold') return L.canCheck ? { type: 'check' } : { type: 'fold' };
  if (a.type === 'check') return L.canCheck ? { type: 'check' } : { type: 'fold' };
  if (a.type === 'call') return L.canCall ? { type: 'call' } : { type: 'check' };
  return L.canCheck ? { type: 'check' } : { type: 'fold' };
}
