import { useMemo, useState } from 'react';
import type { Card } from '@/shared/cards/card';
import type { EqPlayer, MultiResult } from '@/games/poker/equity/multi';
import { topRange } from '@/games/poker/ranges/preflop';
import { rangePercent } from '@/games/poker/ranges/combos';
import { equityWorker } from '@/workers/clients';
import { Button, Panel, ProgressBar, Segmented, cx } from '../../components/core';
import { SERIES } from '../../components/charts';
import { CardPicker, CardSlots, RangeEditor, RangeGrid } from './pickers';

interface PState {
  mode: 'hand' | 'range';
  cards: (Card | null)[];
  range: number[];
}

type Focus = { kind: 'player'; i: number; slot: number } | { kind: 'board'; slot: number } | null;

export function EquityCalc(): JSX.Element {
  const [players, setPlayers] = useState<PState[]>([
    { mode: 'hand', cards: [null, null], range: Array.from(topRange(0.15)) },
    { mode: 'range', cards: [null, null], range: Array.from(topRange(0.15)) },
  ]);
  const [board, setBoard] = useState<(Card | null)[]>([null, null, null, null, null]);
  const [focus, setFocus] = useState<Focus>({ kind: 'player', i: 0, slot: 0 });
  const [result, setResult] = useState<MultiResult | null>(null);
  const [heat, setHeat] = useState<Map<number, number> | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(1);

  const used = useMemo(() => new Set<Card>([...board, ...players.flatMap((p) => (p.mode === 'hand' ? p.cards : []))].filter((c): c is Card => c !== null)), [board, players]);

  const pick = (c: Card): void => {
    if (!focus) return;
    if (focus.kind === 'board') {
      const b = [...board];
      b[focus.slot] = c;
      setBoard(b);
      const next = b.findIndex((x) => x === null);
      setFocus(next >= 0 ? { kind: 'board', slot: next } : null);
    } else {
      const ps = players.map((p) => ({ ...p, cards: [...p.cards] }));
      ps[focus.i].cards[focus.slot] = c;
      setPlayers(ps);
      const s = ps[focus.i].cards.findIndex((x) => x === null);
      setFocus(s >= 0 ? { ...focus, slot: s } : { kind: 'board', slot: Math.max(0, board.findIndex((x) => x === null)) });
    }
    setResult(null);
    setHeat(null);
  };

  const run = async (): Promise<void> => {
    setError('');
    const b = board.filter((c): c is Card => c !== null);
    if (![0, 3, 4, 5].includes(b.length)) return setError('The board needs 0, 3, 4 or 5 cards.');
    const eqp: EqPlayer[] = [];
    for (const [i, p] of players.entries()) {
      if (p.mode === 'hand') {
        if (p.cards.some((c) => c === null)) return setError(`Choose both cards for player ${i + 1}, or switch them to a range.`);
        eqp.push({ kind: 'hand', cards: p.cards as Card[] });
      } else {
        if (!p.range.some((w) => w > 0)) return setError(`Player ${i + 1}'s range is empty: select some hands on the grid.`);
        eqp.push({ kind: 'range', classW: p.range });
      }
    }
    setProgress(0);
    setResult(null);
    setHeat(null);
    try {
      const r = await equityWorker.call('equity', { players: eqp, board: b, iterations: 80000 }, (x) => setProgress(x as number));
      setResult(r);
      if (players.length === 2 && players[0].mode === 'hand' && players[1].mode === 'range') {
        const bd = await equityWorker.call('breakdown', { hero: players[0].cards as Card[], classW: players[1].range, board: b });
        setHeat(new Map(bd.map((x) => [x.cls, x.equity])));
      }
    } catch (e) {
      setError(`${(e as Error).message}.`);
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6">
      <div className="space-y-4">
        <Panel title="Players">
          <div className="space-y-4">
            {players.map((p, i) => (
              <div key={i} className="flex flex-wrap items-center gap-3">
                <span className="w-2 h-8 rounded-sm" style={{ background: SERIES[i] }} aria-hidden />
                <span className="w-20 text-sm">Player {i + 1}</span>
                <Segmented
                  size="sm"
                  value={p.mode}
                  onChange={(m) => {
                    const ps = [...players];
                    ps[i] = { ...p, mode: m };
                    setPlayers(ps);
                    if (m === 'range') setEditing(i);
                    setResult(null);
                  }}
                  options={[
                    { value: 'hand', label: 'Hand' },
                    { value: 'range', label: 'Range' },
                  ]}
                />
                {p.mode === 'hand' ? (
                  <CardSlots
                    label={`Player ${i + 1} cards`}
                    cards={p.cards}
                    focus={focus?.kind === 'player' && focus.i === i ? focus.slot : null}
                    onFocus={(slot) => setFocus({ kind: 'player', i, slot })}
                    onClear={(slot) => {
                      const ps = players.map((x) => ({ ...x, cards: [...x.cards] }));
                      ps[i].cards[slot] = null;
                      setPlayers(ps);
                    }}
                  />
                ) : (
                  <button type="button" className={cx('text-sm underline-offset-2 hover:underline', editing === i ? 'text-signal' : 'text-paper-muted')} onClick={() => setEditing(i)}>
                    {Math.round(rangePercent(p.range) * 100)}% of hands · edit
                  </button>
                )}
                {players.length > 2 && (
                  <button type="button" className="ml-auto text-sm text-paper-dim hover:text-paper" onClick={() => setPlayers(players.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                )}
              </div>
            ))}
            {players.length < 4 && (
              <Button size="sm" variant="ghost" onClick={() => setPlayers([...players, { mode: 'range', cards: [null, null], range: Array.from(topRange(0.3)) }])}>
                Add player
              </Button>
            )}
          </div>
        </Panel>
        <Panel title="Board">
          <div className="flex flex-wrap items-center gap-4">
            <CardSlots
              label="Board"
              cards={board}
              focus={focus?.kind === 'board' ? focus.slot : null}
              onFocus={(slot) => setFocus({ kind: 'board', slot })}
              onClear={(slot) => {
                const b = [...board];
                b[slot] = null;
                setBoard(b);
              }}
            />
            <Button size="sm" variant="ghost" onClick={() => setBoard([null, null, null, null, null])}>
              Clear board
            </Button>
          </div>
        </Panel>
        <Panel title="Cards">
          <p className="text-sm text-paper-muted mb-3">Select a slot, then a card. Click a filled slot twice to clear it.</p>
          <CardPicker used={used} onPick={pick} />
        </Panel>
      </div>
      <div className="space-y-4">
        {players[editing]?.mode === 'range' && (
          <Panel title={`Player ${editing + 1} range`}>
            <RangeEditor
              weights={players[editing].range}
              onChange={(w) => {
                const ps = [...players];
                ps[editing] = { ...ps[editing], range: w };
                setPlayers(ps);
                setResult(null);
                setHeat(null);
              }}
            />
          </Panel>
        )}
        <Panel title="Equity" actions={<Button variant="primary" size="sm" onClick={run} disabled={progress !== null}>Calculate</Button>}>
          {progress !== null && <ProgressBar value={progress} className="mb-3" />}
          {error && <p className="text-sm text-ask mb-2">{error}</p>}
          {result ? (
            <div className="space-y-3">
              {result.players.map((r, i) => (
                <div key={i}>
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm">Player {i + 1}</span>
                    <span className="num text-xl font-semibold">{(r.equity * 100).toFixed(2)}%</span>
                  </div>
                  <div className="h-2 rounded bg-ink-line overflow-hidden">
                    <div className="h-full" style={{ width: `${r.equity * 100}%`, background: SERIES[i] }} />
                  </div>
                  <div className="text-xs text-paper-muted num mt-0.5">
                    win {(r.win * 100).toFixed(2)}% · tie {(r.tie * 100).toFixed(2)}%{!result.exact && ` · ±${(1.96 * r.se * 100).toFixed(2)} (95%)`}
                  </div>
                </div>
              ))}
              <p className="text-xs text-paper-dim">
                {result.exact ? `Exact: all ${result.samples.toLocaleString()} possible boards enumerated.` : `Monte Carlo: ${result.samples.toLocaleString()} random deals. The ± is 1.96 standard errors.`}
              </p>
            </div>
          ) : (
            <p className="text-sm text-paper-muted">Set up hands, ranges and a board, then calculate. Hand vs hand is exact when the board count allows.</p>
          )}
        </Panel>
        {heat && (
          <Panel title="Player 1 vs each hand in player 2's range">
            <RangeGrid weights={players[1].range} heat={heat} />
          </Panel>
        )}
      </div>
    </div>
  );
}
