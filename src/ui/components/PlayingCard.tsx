import { type Card, rankOf, RANK_CHARS, suitOf, SUIT_NAMES, SUIT_SYMBOLS } from '@/shared/cards/card';
import { useSettings } from '../useSettings';
import { cx } from './core';

// Two-colour: red/black. Four-colour: ♣ green, ♦ blue, ♥ red, ♠ black.
const TWO = ['#1d1d1f', '#c8323a', '#c8323a', '#1d1d1f'];
const FOUR = ['#17804a', '#2160c4', '#c8323a', '#1d1d1f'];

const SIZES = {
  xs: { w: 30, h: 42, rank: 13, pip: 12 },
  sm: { w: 40, h: 56, rank: 16, pip: 16 },
  md: { w: 54, h: 76, rank: 20, pip: 24 },
  lg: { w: 70, h: 98, rank: 26, pip: 34 },
} as const;

export type CardSize = keyof typeof SIZES;

export function PlayingCard({
  card,
  size = 'md',
  faceDown,
  dim,
  highlight,
  className,
  animate,
}: {
  card?: Card | null;
  size?: CardSize;
  faceDown?: boolean;
  dim?: boolean;
  highlight?: boolean;
  className?: string;
  animate?: boolean;
}): JSX.Element {
  const [settings] = useSettings();
  const s = SIZES[size];
  const style = { width: s.w, height: s.h };
  if (faceDown || card === undefined || card === null) {
    return (
      <div
        aria-label="face-down card"
        className={cx('rounded-md shadow-card border border-black/40 shrink-0', animate && 'animate-deal', className)}
        style={{
          ...style,
          background: 'repeating-linear-gradient(45deg, #1f3556 0 4px, #1a2d4a 4px 8px)',
          boxShadow: 'inset 0 0 0 3px #e9e5da, inset 0 0 0 4px #22324a, 0 1px 2px rgba(0,0,0,.5)',
        }}
      />
    );
  }
  const r = rankOf(card), su = suitOf(card);
  const color = (settings.fourColourDeck ? FOUR : TWO)[su];
  const rank = RANK_CHARS[r] === 'T' ? '10' : RANK_CHARS[r];
  return (
    <div
      role="img"
      aria-label={`${rank} of ${SUIT_NAMES[su]}`}
      className={cx(
        'relative rounded-md shrink-0 select-none font-sans',
        animate && 'animate-deal',
        highlight && 'ring-2 ring-signal ring-offset-1 ring-offset-transparent',
        dim && 'opacity-45',
        className,
      )}
      style={{ ...style, background: '#f7f5ef', boxShadow: '0 1px 2px rgba(0,0,0,.55), inset 0 0 0 1px rgba(0,0,0,.18)', color }}
    >
      <span className="absolute left-[7%] top-[3%] font-semibold leading-none tracking-[-0.04em]" style={{ fontSize: s.rank }}>
        {rank}
      </span>
      <span className="absolute left-[8%] leading-none" style={{ fontSize: s.rank * 0.8, top: s.rank * 1.02 }}>
        {SUIT_SYMBOLS[su]}
      </span>
      <span className="absolute right-[10%] bottom-[6%] leading-none" style={{ fontSize: s.pip }}>
        {SUIT_SYMBOLS[su]}
      </span>
    </div>
  );
}

/** Inline text rendering of a card, e.g. in coach notes: "A♠". */
export function CardText({ card }: { card: Card }): JSX.Element {
  const [settings] = useSettings();
  const su = suitOf(card);
  const color = settings.fourColourDeck ? ['#3fbf7a', '#5b9cf0', '#ef6b72', '#E6EBF2'][su] : ['#E6EBF2', '#ef6b72', '#ef6b72', '#E6EBF2'][su];
  return (
    <span className="font-semibold whitespace-nowrap" style={{ color }}>
      {RANK_CHARS[rankOf(card)]}
      {SUIT_SYMBOLS[su]}
    </span>
  );
}

export function CardRow({ cards, size = 'md', gap = 6 }: { cards: readonly Card[]; size?: CardSize; gap?: number }): JSX.Element {
  return (
    <div className="flex" style={{ gap }}>
      {cards.map((c) => (
        <PlayingCard key={c} card={c} size={size} />
      ))}
    </div>
  );
}
