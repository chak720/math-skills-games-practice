import { useEffect, useMemo, useState } from 'react';
import { cardsToString, cardToString } from '@/shared/cards/card';
import { hashString } from '@/shared/random/prng';
import { replay } from '@/games/poker/engine/replay';
import type { CoachAnalysis } from '@/games/poker/coach/coach';
import type { MultiResult } from '@/games/poker/equity/multi';
import { classOf, className } from '@/games/poker/ranges/combos';
import { equityWorker } from '@/workers/clients';
import { Badge, Button, cx, EmptyState, Modal, Panel } from '../../components/core';
import { VerifyPanel } from '../../components/Fairness';
import { useHotkeys, usePersistent } from '../../hooks';
import { navigate, useRoute } from '../../router';
import { useSettings } from '../../useSettings';
import type { Mistake } from './CoachView';
import { actionLabel, actionSentence, fmtAmt } from './format';
import type { StoredHand } from './session';
import { TableView, type TableModel } from './TableView';

export function ReviewView(): JSX.Element {
  const [hands] = usePersistent<StoredHand[]>('poker.hands', []);
  const [mistakes] = usePersistent<Mistake[]>('poker.mistakes', []);
  const { query } = useRoute();
  const list = useMemo(() => [...hands].reverse(), [hands]);
  const selected = list.find((h) => h.id === query.get('id')) ?? list[0];
  const [filter, setFilter] = useState<'all' | 'won' | 'lost' | 'mistakes'>('all');
  const mistakeIds = new Set(mistakes.map((m) => m.handKey));
  const shown = list.filter((h) => (filter === 'won' ? h.heroNetBB > 0 : filter === 'lost' ? h.heroNetBB < 0 : filter === 'mistakes' ? mistakeIds.has(h.id) : true));

  if (!list.length) return <EmptyState title="No hands yet" action={<Button variant="primary" onClick={() => navigate('/poker')}>Play some hands</Button>}>Every hand you play is saved here (the last 200), with all cards revealed afterwards.</EmptyState>;

  return (
    <div className="grid xl:grid-cols-[300px_minmax(0,1fr)] gap-6">
      <Panel title="Hands" pad={false}>
        <div className="px-3 pt-3 flex flex-wrap gap-1">
          {(['all', 'won', 'lost', 'mistakes'] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} className={cx('h-7 px-2 rounded text-sm capitalize', filter === f ? 'bg-ink-raised text-paper' : 'text-paper-muted hover:text-paper')}>
              {f}
            </button>
          ))}
        </div>
        <ul className="max-h-[70vh] overflow-y-auto divide-y divide-ink-line/60 mt-2">
          {shown.map((h) => {
            const hero = h.record.history.players.find((p) => p.seat === h.heroSeat);
            return (
              <li key={h.id}>
                <button type="button" onClick={() => navigate(`/poker/review?id=${h.id}`)} className={cx('w-full text-left px-3 py-2 hover:bg-ink-raised/60', selected?.id === h.id && 'bg-ink-raised')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{hero ? cardsToString(hero.hole) : '—'}</span>
                    <span className={cx('num text-sm', h.heroNetBB > 0 ? 'text-bid' : h.heroNetBB < 0 ? 'text-ask' : 'text-paper-muted')}>
                      {h.heroNetBB > 0 ? '+' : h.heroNetBB < 0 ? '−' : ''}
                      {Math.abs(h.heroNetBB).toFixed(1)} bb
                    </span>
                  </div>
                  <div className="text-xs text-paper-dim flex gap-2">
                    <span>#{h.record.history.handId}</span>
                    <span>{h.mode}</span>
                    <span>{new Date(h.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {mistakeIds.has(h.id) && <span className="text-ask">mistake</span>}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>
      {selected && <Replayer key={selected.id} hand={selected} mistakes={mistakes.filter((m) => m.handKey === selected.id)} />}
    </div>
  );
}

function Replayer({ hand, mistakes }: { hand: StoredHand; mistakes: Mistake[] }): JSX.Element {
  const [settings] = useSettings();
  const h = hand.record.history;
  const steps = useMemo(() => replay(h, hand.heroSeat), [h, hand.heroSeat]);
  const [i, setI] = useState(steps.length - 1);
  const [analysis, setAnalysis] = useState<CoachAnalysis | null>(null);
  const [hindsight, setHindsight] = useState<MultiResult | null>(null);
  const [verify, setVerify] = useState(false);
  const [copied, setCopied] = useState(false);
  useHotkeys({ ArrowLeft: () => setI((x) => Math.max(0, x - 1)), ArrowRight: () => setI((x) => Math.min(steps.length - 1, x + 1)) });
  useEffect(() => {
    setAnalysis(null);
    setHindsight(null);
  }, [i]);

  const step = steps[i];
  const nextHeroDecision = steps[i + 1]?.heroDecision ?? null;
  const maxSeats = hand.maxSeats ?? Math.max(...h.players.map((p) => p.seat)) + 1;
  const model: TableModel = {
    view: step.full,
    seats: Array.from({ length: maxSeats }, (_, s) => {
      const p = h.players.find((x) => x.seat === s);
      if (!p) return null;
      const meta = hand.names[s];
      return { meta: { playerId: p.playerId, name: meta?.name ?? p.name, hue: meta?.isHuman ? 210 : hashString(meta?.name ?? p.name) % 360, isHuman: !!meta?.isHuman, archetype: meta?.archetype }, stack: p.stackStart };
    }),
    maxSeats,
    bb: h.bb,
    showLabels: true,
    heroSeat: hand.heroSeat,
    thinking: null,
    bubbles: step.action ? { [step.action.seat]: actionLabel(step.action, h.bb, settings.showBB) } : {},
    chatBubbles: {},
    revealAll: true,
  };

  const analyse = async (): Promise<void> => {
    if (!nextHeroDecision) return;
    const names = Object.fromEntries(Object.entries(hand.names).map(([k, v]) => [Number(k), v.name]));
    const a = await equityWorker.call('coach', { view: nextHeroDecision, tendencies: {}, names, iterations: 12000 });
    setAnalysis(a);
    const live = h.players.filter((p) => !step.full.seats.find((s) => s.seat === p.seat)?.folded);
    if (live.length >= 2) {
      const order = [hand.heroSeat, ...live.map((p) => p.seat).filter((s) => s !== hand.heroSeat)];
      const r = await equityWorker.call('equity', { players: order.map((s) => ({ kind: 'hand' as const, cards: h.players.find((p) => p.seat === s)!.hole })), board: nextHeroDecision.board, iterations: 50000 });
      setHindsight(r);
    }
  };

  const text = handHistoryText(hand);
  return (
    <div className="space-y-4 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg">Hand #{h.handId}</h2>
        <Badge tone={hand.heroNetBB > 0 ? 'pos' : hand.heroNetBB < 0 ? 'neg' : 'neutral'}>
          {hand.heroNetBB > 0 ? '+' : ''}
          {hand.heroNetBB.toFixed(1)} bb
        </Badge>
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => setVerify(true)}>
            Verify deck
          </Button>
          <Button
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? 'Copied' : 'Copy hand history'}
          </Button>
        </div>
      </div>
      <TableView model={model} showBB={settings.showBB} compact={false} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setI(0)} aria-label="First step">
          ⏮
        </Button>
        <Button size="sm" onClick={() => setI(Math.max(0, i - 1))} aria-label="Previous step">
          ◀
        </Button>
        <input type="range" min={0} max={steps.length - 1} value={i} onChange={(e) => setI(Number(e.target.value))} className="flex-1 accent-signal" aria-label="Step" />
        <Button size="sm" onClick={() => setI(Math.min(steps.length - 1, i + 1))} aria-label="Next step">
          ▶
        </Button>
        <Button size="sm" onClick={() => setI(steps.length - 1)} aria-label="Last step">
          ⏭
        </Button>
        <span className="text-sm text-paper-dim num w-16 text-right">
          {i}/{steps.length - 1}
        </span>
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title="Actions">
          <ol className="text-sm space-y-0.5 max-h-80 overflow-y-auto">
            {steps.map((s, k) =>
              s.action ? (
                <li key={k}>
                  <button type="button" onClick={() => setI(k)} className={cx('text-left w-full rounded px-1', k === i ? 'bg-ink-raised text-paper' : 'text-paper-muted hover:text-paper', s.heroDecision && 'font-medium')}>
                    <span className="text-paper-dim text-xs w-12 inline-block capitalize">{s.action.street}</span>
                    {actionSentence(s.action, hand.names[s.action.seat]?.name ?? '?', h.bb, settings.showBB)}
                  </button>
                </li>
              ) : null,
            )}
          </ol>
          {(h.winners ?? []).map((w, k) => (
            <p key={k} className="text-sm text-signal mt-2">
              {hand.names[w.seat]?.name} won {fmtAmt(w.amount, h.bb, settings.showBB)}
              {w.hand ? ` with ${w.hand}` : ''}
            </p>
          ))}
        </Panel>
        <Panel title="Coach">
          {mistakes.length > 0 && (
            <ul className="mb-3 space-y-1 text-sm">
              {mistakes.map((m) => (
                <li key={m.id} className="border-l-2 border-ask/60 pl-2">
                  <span className="capitalize">{m.street}</span>: you {m.did}; better {m.best.toLowerCase()}
                  {m.evLostBB !== null ? ` (−${m.evLostBB.toFixed(1)} bb)` : ''}
                </li>
              ))}
            </ul>
          )}
          {nextHeroDecision ? (
            <div className="space-y-3 text-sm">
              <p className="text-paper-muted">The next action is your decision. Analyse it with only the information you had then.</p>
              <Button size="sm" variant="primary" onClick={analyse}>
                Analyse this decision
              </Button>
              {analysis && (
                <div className="space-y-2">
                  <p>
                    <span className="font-medium">{analysis.recommendation.label}</span>{' '}
                    <Badge tone={analysis.recommendation.closeness === 'clear' ? 'pos' : 'info'}>{analysis.recommendation.closeness}</Badge>
                  </p>
                  <p className="text-paper-muted">
                    Equity vs their likely range {(analysis.equity.value * 100).toFixed(1)}% (±{((analysis.equity.hi - analysis.equity.lo) * 50).toFixed(1)})
                    {analysis.potOdds !== null && `, needed ${(analysis.potOdds * 100).toFixed(1)}%`}.
                  </p>
                  <ul className="list-disc pl-5 text-paper-muted">
                    {analysis.recommendation.reasons.slice(0, 4).map((r, k) => (
                      <li key={k}>{r}</li>
                    ))}
                  </ul>
                  <p className="text-xs text-paper-dim">Uses average-player tendencies; in Coach mode the live analysis also uses what you had observed about each opponent.</p>
                </div>
              )}
              {hindsight && (
                <div className="border border-ink-line rounded p-2">
                  <p className="font-medium">Hindsight (all cards known)</p>
                  <p className="text-paper-muted">
                    Your actual equity was {(hindsight.players[0].equity * 100).toFixed(1)}%. Judge decisions by the range you faced, not the cards you later saw: results vary, good decisions win over time.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-paper-muted">Step to a point just before one of your decisions (bold in the action list) to analyse it.</p>
          )}
        </Panel>
      </div>
      <Modal open={verify} onClose={() => setVerify(false)} title={`Verify hand #${h.handId}`} wide>
        <VerifyPanel
          reveal={hand.record.reveal}
          observed={h.dealt.map((d) => d.card)}
          positionLabel={(k) => {
            const d = h.dealt[k];
            if (!d) return 'not dealt';
            return d.kind === 'hole' ? `hole card: ${hand.names[d.seat!]?.name}` : d.kind === 'burn' ? 'burn' : `board ${cardToString(d.card)}`;
          }}
        />
      </Modal>
    </div>
  );
}

/** Plain-text hand history in a familiar layout. */
export function handHistoryText(hand: StoredHand): string {
  const h = hand.record.history;
  const name = (s: number): string => hand.names[s]?.name ?? `Seat ${s + 1}`;
  const L: string[] = [];
  L.push(`Quant Trainer hand #${h.handId} · NLHE ${h.sb}/${h.bb} · ${new Date(hand.t).toISOString()}`);
  L.push(`Seed commitment ${hand.record.reveal.commit}; server seed ${hand.record.reveal.serverSeed}; client seed ${hand.record.reveal.clientSeed}; nonce ${hand.record.reveal.nonce}`);
  L.push(`Button: ${name(h.button)}`);
  for (const p of h.players) L.push(`Seat ${p.seat + 1}: ${name(p.seat)} (${p.stackStart} in chips) [${cardsToString(p.hole)}] ${className(classOf(p.hole[0], p.hole[1]))}`);
  let street = '';
  for (const a of h.actions) {
    if (a.street !== street) {
      street = a.street;
      const n = { preflop: 0, flop: 3, turn: 4, river: 5 }[a.street];
      L.push(`*** ${a.street.toUpperCase()} ***${n ? ` [${cardsToString(h.board.slice(0, n))}]` : ''}`);
    }
    L.push(actionSentence(a, name(a.seat), h.bb, false));
  }
  L.push('*** SUMMARY ***');
  for (const w of h.winners) L.push(`${name(w.seat)} collected ${w.amount}${w.hand ? ` with ${w.hand}` : ''}`);
  return L.join('\n');
}
