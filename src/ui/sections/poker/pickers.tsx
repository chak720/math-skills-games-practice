import { useRef, useState } from 'react';
import { type Card, makeCard, RANK_CHARS, SUIT_SYMBOLS } from '@/shared/cards/card';
import { className, combosInClass, NUM_COMBOS, parseRange, formatRange } from '@/games/poker/ranges/combos';
import { positionsFor, rfiPercent, topRange } from '@/games/poker/ranges/preflop';
import { cx } from '../../components/core';
import { divergingColor } from '../../components/charts';
import { PlayingCard } from '../../components/PlayingCard';
import { useSettings } from '../../useSettings';

const SUIT_COLORS_2 = ['#E6EBF2', '#ef6b72', '#ef6b72', '#E6EBF2'];
const SUIT_COLORS_4 = ['#3fbf7a', '#5b9cf0', '#ef6b72', '#E6EBF2'];

/** 4 × 13 grid of all cards; used cards are disabled. */
export function CardPicker({ used, onPick }: { used: Set<Card>; onPick: (c: Card) => void }): JSX.Element {
  const [settings] = useSettings();
  const colors = settings.fourColourDeck ? SUIT_COLORS_4 : SUIT_COLORS_2;
  return (
    <div className="inline-grid gap-1" style={{ gridTemplateColumns: 'repeat(13, minmax(0, 1fr))' }} role="grid" aria-label="Card picker">
      {[3, 2, 1, 0].flatMap((suit) =>
        Array.from({ length: 13 }, (_, k) => {
          const rank = 12 - k;
          const c = makeCard(rank, suit);
          const isUsed = used.has(c);
          return (
            <button
              key={c}
              type="button"
              disabled={isUsed}
              onClick={() => onPick(c)}
              aria-label={`${RANK_CHARS[rank]}${SUIT_SYMBOLS[suit]}`}
              className={cx('w-7 h-8 sm:w-8 sm:h-9 rounded text-xs font-semibold border border-ink-line bg-ink-raised hover:border-signal disabled:opacity-20 disabled:hover:border-ink-line')}
              style={{ color: colors[suit] }}
            >
              {RANK_CHARS[rank]}
              {SUIT_SYMBOLS[suit]}
            </button>
          );
        }),
      )}
    </div>
  );
}

export function CardSlots({ cards, focus, onFocus, onClear, size = 'sm', label }: { cards: (Card | null)[]; focus: number | null; onFocus: (i: number) => void; onClear: (i: number) => void; size?: 'xs' | 'sm' | 'md'; label: string }): JSX.Element {
  return (
    <div className="flex gap-1.5" role="group" aria-label={label}>
      {cards.map((c, i) => (
        <button
          key={i}
          type="button"
          onClick={() => (c !== null && focus === i ? onClear(i) : onFocus(i))}
          onContextMenu={(e) => {
            e.preventDefault();
            onClear(i);
          }}
          title={c !== null ? 'Click again to clear' : 'Choose a card'}
          className={cx('rounded-md', focus === i && 'ring-2 ring-signal ring-offset-2 ring-offset-ink-panel')}
        >
          {c !== null ? <PlayingCard card={c} size={size} /> : <div className={cx('rounded-md border border-dashed border-ink-strong', size === 'xs' ? 'w-[30px] h-[42px]' : size === 'sm' ? 'w-10 h-14' : 'w-[54px] h-[76px]')} />}
        </button>
      ))}
    </div>
  );
}

/**
 * 13×13 range grid. Drag to paint; the first cell decides select vs deselect.
 * With `heat`, cells are coloured by the hero's equity against that class.
 */
export function RangeGrid({ weights, onChange, heat, size = 'md' }: { weights: number[]; onChange?: (w: number[]) => void; heat?: Map<number, number>; size?: 'sm' | 'md' }): JSX.Element {
  const painting = useRef<null | number>(null);
  const [hover, setHover] = useState<number | null>(null);
  const set = (cls: number): void => {
    if (!onChange || painting.current === null) return;
    if (weights[cls] === painting.current) return;
    const w = [...weights];
    w[cls] = painting.current;
    onChange(w);
  };
  const cell = size === 'sm' ? 'w-[22px] h-[22px] text-[8px]' : 'w-[clamp(22px,5.4vw,34px)] h-[clamp(22px,5.4vw,30px)] text-[9px] sm:text-[10px]';
  const combos = weights.reduce((a, w, c) => a + w * combosInClass(c), 0);
  return (
    <div>
      <div
        className="inline-grid gap-px bg-ink-line p-px rounded select-none touch-none"
        style={{ gridTemplateColumns: 'repeat(13, auto)' }}
        onPointerUp={() => (painting.current = null)}
        onPointerLeave={() => {
          painting.current = null;
          setHover(null);
        }}
        role="grid"
        aria-label="Range grid"
      >
        {Array.from({ length: 169 }, (_, cls) => {
          const w = weights[cls];
          const h = heat?.get(cls);
          const bg = heat ? (h === undefined ? '#121B2A' : divergingColor((0.5 - h) * 2.2)) : w > 0 ? `rgba(232,169,58,${0.25 + 0.75 * w})` : '#121B2A';
          return (
            <div
              key={cls}
              role="gridcell"
              aria-selected={w > 0}
              title={heat && h !== undefined ? `${className(cls)}: your equity ${(h * 100).toFixed(0)}%` : className(cls)}
              onPointerDown={(e) => {
                if (!onChange) return;
                (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
                painting.current = w > 0 ? 0 : 1;
                set(cls);
              }}
              onPointerEnter={() => {
                setHover(cls);
                set(cls);
              }}
              className={cx('flex items-center justify-center font-medium cursor-pointer', cell, (w > 0 && !heat) || (heat && h !== undefined) ? 'text-ink' : 'text-paper-dim')}
              style={{ background: bg }}
            >
              {className(cls)}
            </div>
          );
        })}
      </div>
      <div className="text-xs text-paper-muted mt-1 num h-4">
        {heat
          ? hover !== null && heat.get(hover) !== undefined
            ? `${className(hover)}: your equity ${(heat.get(hover)! * 100).toFixed(1)}%`
            : 'Orange: you are behind that hand class; blue: you are ahead.'
          : `${combos} combos · ${((combos / NUM_COMBOS) * 100).toFixed(1)}% of hands`}
      </div>
    </div>
  );
}

/** Range editor: grid + text + presets. */
export function RangeEditor({ weights, onChange }: { weights: number[]; onChange: (w: number[]) => void }): JSX.Element {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [pct, setPct] = useState(20);
  return (
    <div className="space-y-3">
      <RangeGrid weights={weights} onChange={onChange} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          Top
          <input type="range" min={1} max={100} value={pct} onChange={(e) => setPct(Number(e.target.value))} onPointerUp={() => onChange(Array.from(topRange(pct / 100)))} onKeyUp={() => onChange(Array.from(topRange(pct / 100)))} className="accent-signal w-28" aria-label="Top percent of hands" />
          <span className="num w-10">{pct}%</span>
        </label>
        {positionsFor(6)
          .filter((p) => p !== 'BB')
          .map((p) => (
            <button key={p} type="button" className="h-7 px-2 rounded border border-ink-line text-paper-muted hover:text-paper" onClick={() => onChange(Array.from(topRange(rfiPercent(p, 6))))} title={`${p} open, 6-max (top ${Math.round(rfiPercent(p, 6) * 100)}%)`}>
              {p} open
            </button>
          ))}
        <button type="button" className="h-7 px-2 rounded border border-ink-line text-paper-muted hover:text-paper" onClick={() => onChange(new Array(169).fill(0))}>
          Clear
        </button>
      </div>
      <div className="flex gap-2">
        <input className="input flex-1 font-mono text-xs" placeholder="e.g. TT+, AQs+, KQs, AKo" value={text} onChange={(e) => setText(e.target.value)} aria-label="Range text" />
        <button
          type="button"
          className="h-9 px-3 rounded border border-ink-line text-sm hover:border-ink-strong"
          onClick={() => {
            try {
              onChange(Array.from(parseRange(text)));
              setErr('');
            } catch (e) {
              setErr(`${(e as Error).message}. Use notation like QQ+, A2s+, KTo+, 76s.`);
            }
          }}
        >
          Apply
        </button>
        <button type="button" className="h-9 px-3 rounded border border-ink-line text-sm hover:border-ink-strong" onClick={() => setText(formatRange(weights))}>
          Copy from grid
        </button>
      </div>
      {err && <p className="text-xs text-ask">{err}</p>}
    </div>
  );
}
