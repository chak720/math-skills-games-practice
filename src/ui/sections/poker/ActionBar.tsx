import { useEffect, useMemo, useState } from 'react';
import type { PlayerAction, PlayerView } from '@/games/poker/engine/types';
import { Button, cx } from '../../components/core';
import { useHotkeys } from '../../hooks';
import { fmtAmt } from './format';

interface Preset {
  label: string;
  to: number;
  key: string;
}

/** Sizing presets: pot fractions postflop; multiples of the blind/raise preflop. */
function presets(v: PlayerView): Preset[] {
  const L = v.legal!;
  const toCall = L.callAmount;
  const out: Preset[] = [];
  const clampTo = (x: number): number => Math.round(Math.min(L.maxTo, Math.max(L.minTo, x)));
  if (v.street === 'preflop') {
    if (v.currentBet <= v.bb) {
      out.push({ label: '2.2×', to: clampTo(2.2 * v.bb), key: '1' }, { label: '2.5×', to: clampTo(2.5 * v.bb), key: '2' }, { label: '3×', to: clampTo(3 * v.bb), key: '3' });
    } else {
      out.push({ label: '2.5×', to: clampTo(2.5 * v.currentBet), key: '1' }, { label: '3×', to: clampTo(3 * v.currentBet), key: '2' }, { label: '4×', to: clampTo(4 * v.currentBet), key: '3' });
    }
  } else {
    for (const [f, label, key] of [[1 / 3, '⅓', '1'], [1 / 2, '½', '2'], [2 / 3, '⅔', '3']] as const) out.push({ label, to: clampTo(v.currentBet + f * (v.pot + toCall)), key });
  }
  out.push({ label: 'Pot', to: clampTo(v.currentBet + (v.pot + toCall)), key: '4' });
  return out;
}

export function ActionBar({ view, active, showBB, onAct }: { view: PlayerView | null; active: boolean; showBB: boolean; onAct: (a: PlayerAction) => void }): JSX.Element {
  const L = active ? view?.legal ?? null : null;
  const ps = useMemo(() => (L && view ? presets(view) : []), [L, view]);
  const [to, setTo] = useState(0);
  const decisionKey = view ? `${view.handId}-${view.actions.length}` : '';
  useEffect(() => {
    if (!L || !view) return;
    setTo(view.street === 'preflop' ? ps[1]?.to ?? L.minTo : ps[1]?.to ?? L.minTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decisionKey, !!L]);

  const unit = showBB && view ? view.bb : 1;
  const [typed, setTyped] = useState('');
  useEffect(() => setTyped(view ? String(+(to / unit).toFixed(2)) : ''), [to, unit, view]);

  const doRaise = (amount = to): void => {
    if (!L?.canRaise) return;
    onAct({ type: L.raiseKind, to: Math.round(Math.min(L.maxTo, Math.max(L.minTo, amount))) });
  };
  const step = view ? (view.street === 'preflop' ? view.bb / 2 : Math.max(view.bb / 2, Math.round(view.pot * 0.05))) : 1;
  useHotkeys(
    {
      f: () => L?.canFold && onAct({ type: 'fold' }),
      c: () => L && onAct(L.canCheck ? { type: 'check' } : { type: 'call' }),
      k: () => L?.canCheck && onAct({ type: 'check' }),
      r: () => doRaise(),
      a: () => L?.canRaise && setTo(L.maxTo),
      '1': () => ps[0] && setTo(ps[0].to),
      '2': () => ps[1] && setTo(ps[1].to),
      '3': () => ps[2] && setTo(ps[2].to),
      '4': () => ps[3] && setTo(ps[3].to),
      ArrowUp: () => L && setTo((t) => Math.min(L.maxTo, t + step)),
      ArrowDown: () => L && setTo((t) => Math.max(L.minTo, t - step)),
    },
    !!L,
  );

  if (!L || !view) {
    return <div className="h-[104px] flex items-center justify-center text-paper-dim text-sm">{view?.handOver ? '' : 'Waiting for other players…'}</div>;
  }
  const allIn = to >= L.maxTo;
  return (
    <div className="flex flex-col gap-3 py-3">
      {L.canRaise && (
        <div className="flex flex-wrap items-center gap-2">
          {ps.map((p) => (
            <button key={p.label} type="button" onClick={() => setTo(p.to)} className={cx('h-8 px-3 rounded border text-sm transition-colors', to === p.to ? 'border-signal text-signal' : 'border-ink-line text-paper-muted hover:text-paper hover:border-ink-strong')}>
              {p.label}
              <span className="ml-1.5 text-[10px] text-paper-dim hidden md:inline">{p.key}</span>
            </button>
          ))}
          <button type="button" onClick={() => setTo(L.maxTo)} className={cx('h-8 px-3 rounded border text-sm', allIn ? 'border-signal text-signal' : 'border-ink-line text-paper-muted hover:text-paper')}>
            All-in <span className="ml-1 text-[10px] text-paper-dim hidden md:inline">A</span>
          </button>
          <input
            type="range"
            min={L.minTo}
            max={L.maxTo}
            step={1}
            value={to}
            onChange={(e) => setTo(Number(e.target.value))}
            className="flex-1 min-w-[140px] accent-signal"
            aria-label="Raise amount"
          />
          <label className="flex items-center gap-1.5">
            <input
              className="input w-24 h-8 py-0 num text-right"
              inputMode="decimal"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onBlur={() => {
                const x = Number(typed);
                if (Number.isFinite(x)) setTo(Math.round(Math.min(L.maxTo, Math.max(L.minTo, x * unit))));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const x = Number(typed);
                  if (Number.isFinite(x)) doRaise(Math.round(x * unit));
                }
              }}
              aria-label={`Raise to (${showBB ? 'big blinds' : 'chips'})`}
            />
            <span className="text-sm text-paper-dim">{showBB ? 'bb' : ''}</span>
          </label>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <Button variant="secondary" size="lg" disabled={!L.canFold} onClick={() => onAct({ type: 'fold' })} kbd="F">
          Fold
        </Button>
        <Button variant="secondary" size="lg" onClick={() => onAct(L.canCheck ? { type: 'check' } : { type: 'call' })} kbd="C">
          {L.canCheck ? 'Check' : `Call ${fmtAmt(L.callAmount, view.bb, showBB)}`}
        </Button>
        <Button variant="primary" size="lg" disabled={!L.canRaise} onClick={() => doRaise()} kbd="R">
          {allIn ? 'All-in' : `${L.raiseKind === 'bet' ? 'Bet' : 'Raise to'} ${fmtAmt(Math.min(L.maxTo, Math.max(L.minTo, to)), view.bb, showBB)}`}
        </Button>
      </div>
    </div>
  );
}
