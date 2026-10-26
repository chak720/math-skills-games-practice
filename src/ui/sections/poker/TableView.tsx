import type { Card } from '@/shared/cards/card';
import type { PlayerView, SeatView } from '@/games/poker/engine/types';
import { ARCHETYPE_LABEL } from '@/games/poker/bots/personality';
import { hudLine } from '@/games/poker/analysis/stats';
import { bestFive, evaluate } from '@/games/poker/eval/evaluator';
import { PlayingCard } from '../../components/PlayingCard';
import { cx } from '../../components/core';
import type { SeatMeta, Snapshot } from './session';
import { fmtAmt } from './format';
import { NOTE_COLORS, useNotes } from './notes';

function initials(name: string): string {
  const parts = name.replace(/[^a-zA-Z0-9 _.]/g, '').split(/[ _.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? parts[0]?.[1] ?? '')).toUpperCase();
}

/** Seat centre on an ellipse; seat 0 (hero) at the bottom, clockwise. */
function seatPos(i: number, n: number, rx: number, ry: number): { x: number; y: number } {
  const a = Math.PI / 2 + (i * 2 * Math.PI) / n;
  return { x: 50 + rx * Math.cos(a), y: 50 + ry * Math.sin(a) };
}

/** Everything the felt needs to draw one moment of a hand. */
export interface TableModel {
  view: PlayerView | null;
  seats: ({ meta: SeatMeta; stack: number } | null)[];
  maxSeats: number;
  bb: number;
  showLabels: boolean;
  heroSeat: number;
  thinking: number | null;
  bubbles: Record<number, string>;
  chatBubbles: Record<number, string>;
  /** HUD text per playerId (optional). */
  hud?: (playerId: string) => string | undefined;
  /** Review: show every hole card, folded ones dimmed. */
  revealAll?: boolean;
}

export function modelFromSnapshot(snap: Snapshot, hud: boolean): TableModel {
  return {
    view: snap.view,
    seats: snap.seats,
    maxSeats: snap.config.maxSeats,
    bb: snap.config.bb,
    showLabels: snap.config.difficulty === 'easy',
    heroSeat: snap.heroSeat,
    thinking: snap.thinking,
    bubbles: snap.bubbles,
    chatBubbles: snap.chatBubbles,
    hud: hud ? (id) => hudSummary(snap, id) : undefined,
  };
}

export function TableView({ model, showBB, onSeatClick, compact }: { model: TableModel; showBB: boolean; onSeatClick?: (seat: number) => void; compact: boolean }): JSX.Element {
  const { view, seats } = model;
  const n = model.maxSeats;
  const [notes] = useNotes();
  const bb = model.bb;
  const handOver = view?.handOver ?? false;
  const winners = new Set((view?.winners ?? []).map((w) => w.seat));
  const heroHole = view?.hole ?? view?.seats.find((s) => s.seat === model.heroSeat)?.shown ?? null;
  const heroBest = heroHole && view && view.board.length >= 3 ? new Set(bestFive([...heroHole, ...view.board])) : null;
  const rx = compact ? 40 : 44, ry = compact ? 41 : 39;

  return (
    <div className={cx('relative w-full select-none', compact ? 'aspect-[3/4] mt-10' : 'aspect-[16/9] max-h-[640px] mt-4')}>
      {/* Rail and felt */}
      <div className="absolute inset-[6%_4%] rounded-[50%] bg-felt-rail shadow-[0_20px_60px_rgba(0,0,0,.55)]" />
      <div className="absolute inset-[8%_6%] rounded-[50%] felt shadow-[inset_0_0_0_2px_rgba(255,255,255,.04),inset_0_10px_60px_rgba(0,0,0,.45)]" />

      {/* Board, pot and results (results sit above the board so they never cover the hero's cards) */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2 w-[min(92%,420px)]">
        <div className="min-h-[22px] flex flex-col items-center justify-end">
          {view && !handOver && <div className="text-sm text-white/80 num">Pot {fmtAmt(view.pot, bb, showBB)}</div>}
          {handOver && view?.winners && (
            <div className="text-center text-sm text-white/90 bg-black/35 rounded px-3 py-1 animate-pop">
              {view.winners.slice(0, 3).map((w, i) => (
                <div key={i}>
                  <span className="font-semibold">{seats[w.seat]?.meta.name ?? '—'}</span> {seats[w.seat]?.meta.isHuman ? 'win' : 'wins'} {fmtAmt(w.amount, bb, showBB)}
                  {(view.pots?.length ?? 0) > 1 ? <span className="text-white/60"> ({w.potIndex === 0 ? 'main pot' : `side pot ${w.potIndex}`})</span> : null}
                  {w.hand ? <span className="text-white/70"> · {w.hand}</span> : null}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-1.5 min-h-[56px] md:min-h-[76px]">
          {view?.board.map((c) => (
            <PlayingCard key={`${view.handId}-${c}`} card={c} size={compact ? 'sm' : 'md'} animate highlight={handOver && !!heroBest?.has(c) && winners.has(model.heroSeat)} />
          ))}
        </div>
      </div>

      {/* Seats */}
      {Array.from({ length: n }, (_, i) => {
        const pos = seatPos(i, n, rx, ry);
        const st = seats[i];
        const sv = view?.seats.find((s) => s.seat === i);
        if (!st) {
          return (
            <div key={i} className="absolute -translate-x-1/2 -translate-y-1/2 text-xs text-white/30 border border-dashed border-white/15 rounded-md px-3 py-2" style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
              Empty seat
            </div>
          );
        }
        const isHero = i === model.heroSeat;
        const note = notes[st.meta.name];
        // The hero's cards sit between the seat and the centre, so their bet goes further in.
        const betPos = isHero ? { x: 50 + rx * 0.3, y: 50 + ry * 0.3 } : seatPos(i, n, rx * 0.62, ry * 0.58);
        return (
          <div key={i}>
            <Seat
              x={pos.x}
              y={pos.y}
              name={st.meta.name}
              hue={st.meta.hue}
              stack={sv ? sv.stack : st.stack}
              bb={bb}
              showBB={showBB}
              sv={sv}
              hole={isHero ? view?.hole ?? null : null}
              isHero={isHero}
              thinking={model.thinking === i}
              button={view?.button === i}
              bubble={model.bubbles[i]}
              chat={model.chatBubbles[i]}
              winner={handOver && winners.has(i)}
              label={model.showLabels && st.meta.archetype ? ARCHETYPE_LABEL[st.meta.archetype] : undefined}
              noteColor={note?.color ? NOTE_COLORS[note.color] : undefined}
              hudText={!isHero ? model.hud?.(st.meta.playerId) : undefined}
              onClick={() => onSeatClick?.(i)}
              compact={compact}
              highlightCards={isHero && heroBest && handOver ? heroBest : null}
              handId={view?.handId ?? 0}
              handOver={handOver}
              revealAll={!!model.revealAll}
            />
            {sv && sv.betStreet > 0 && !handOver && (
              <div className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center gap-1 text-xs text-white num" style={{ left: `${betPos.x}%`, top: `${betPos.y}%` }}>
                <Chip />
                {fmtAmt(sv.betStreet, bb, showBB)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function hudSummary(snap: Snapshot, playerId: string): string {
  const a = snap.hud.get(playerId);
  if (!a.hands) return 'no hands yet';
  const h = hudLine(a);
  return `${h.VPIP}/${h.PFR}/${h['3B']} · ${a.hands}h`;
}

function Chip(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden>
      <circle cx="10" cy="10" r="9" fill="#d9a441" stroke="#7a5a1c" strokeWidth="1" />
      <circle cx="10" cy="10" r="5.5" fill="none" stroke="#fff6" strokeWidth="1.5" strokeDasharray="2 2" />
    </svg>
  );
}

function Seat(props: {
  x: number;
  y: number;
  name: string;
  hue: number;
  stack: number;
  bb: number;
  showBB: boolean;
  sv?: SeatView;
  hole: Card[] | null;
  isHero: boolean;
  thinking: boolean;
  button: boolean;
  bubble?: string;
  chat?: string;
  winner: boolean;
  label?: string;
  noteColor?: string;
  hudText?: string;
  onClick: () => void;
  compact: boolean;
  highlightCards: Set<Card> | null;
  handId: number;
  handOver: boolean;
  revealAll: boolean;
}): JSX.Element {
  const { sv } = props;
  const folded = sv?.folded ?? false;
  const inHand = !!sv;
  const shown = sv?.shown;
  const cardSize = props.isHero ? (props.compact ? 'md' : 'lg') : props.compact ? 'xs' : 'sm';
  return (
    <div className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center" style={{ left: `${props.x}%`, top: `${props.y}%`, zIndex: props.isHero ? 5 : 2 }}>
      {props.chat && (
        <div className="absolute -top-9 whitespace-nowrap bg-paper text-ink text-xs px-2 py-1 rounded-md shadow-card animate-pop">
          {props.chat}
          <span className="absolute left-1/2 -bottom-1 w-2 h-2 bg-paper rotate-45 -translate-x-1/2" />
        </div>
      )}
      {/* Cards */}
      <div className={cx('flex -mb-2', props.isHero ? 'gap-1' : '-space-x-3')} style={{ minHeight: props.isHero ? undefined : 20 }}>
        {inHand && (!folded || props.revealAll) && (props.hole || shown)
          ? (props.hole ?? shown!).map((c) => <PlayingCard key={`${props.handId}-${c}`} card={c} size={cardSize} animate={!props.revealAll} dim={folded} highlight={!!props.highlightCards?.has(c)} />)
          : inHand && !folded && !sv?.mucked
            ? [0, 1].map((k) => <PlayingCard key={`${props.handId}-b${k}`} faceDown size={cardSize} animate />)
            : null}
      </div>
      <button
        type="button"
        onClick={props.onClick}
        title={`${props.name}: notes and stats`}
        className={cx(
          'relative flex items-center gap-2 rounded-lg pl-1.5 pr-3 py-1.5 bg-ink/90 border text-left transition-colors',
          props.compact ? 'min-w-[96px]' : 'min-w-[132px]',
          props.winner ? 'border-signal shadow-[0_0_0_2px_theme(colors.signal.DEFAULT)]' : props.thinking ? 'border-paper/60' : 'border-white/10',
          folded && 'opacity-50',
        )}
      >
        <span
          className={cx('relative shrink-0 rounded-full flex items-center justify-center font-semibold text-xs text-white', props.compact ? 'w-7 h-7' : 'w-9 h-9', props.thinking && 'animate-pulse')}
          style={{ background: `linear-gradient(135deg, hsl(${props.hue} 45% 42%), hsl(${(props.hue + 40) % 360} 40% 28%))` }}
        >
          {initials(props.name)}
          {props.noteColor && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-ink" style={{ background: props.noteColor }} />}
        </span>
        <span className="min-w-0">
          <span className={cx('block truncate font-medium', props.compact ? 'text-xs max-w-[64px]' : 'text-sm max-w-[96px]')}>{props.name}</span>
          <span className="block text-xs text-paper-muted num">{sv?.allIn && !props.handOver ? 'All-in' : fmtAmt(props.stack, props.bb, props.showBB)}</span>
        </span>
        {props.button && <span className="absolute -right-2.5 -top-2.5 w-6 h-6 rounded-full bg-paper text-ink text-[11px] font-bold flex items-center justify-center shadow-card">D</span>}
      </button>
      {props.label && <span className="mt-1 text-[11px] text-white/70 bg-black/30 rounded px-1.5">{props.label}</span>}
      {props.hudText && <span className="mt-1 text-[11px] text-info num bg-black/40 rounded px-1.5">{props.hudText}</span>}
      {props.bubble && !props.chat && (
        <span className={cx('mt-1 text-[11px] px-1.5 rounded num whitespace-nowrap', /Raise|Bet|All-in/.test(props.bubble) ? 'bg-signal text-ink font-semibold' : 'bg-black/45 text-white/85')}>{props.bubble}</span>
      )}
      {sv?.mucked && <span className="mt-1 text-[11px] text-white/50">mucked</span>}
    </div>
  );
}

export function seatName(view: PlayerView | null, seat: number): string {
  return view?.seats.find((s) => s.seat === seat)?.name ?? `Seat ${seat + 1}`;
}

export { evaluate };
