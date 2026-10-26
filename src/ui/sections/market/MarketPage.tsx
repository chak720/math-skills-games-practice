import { useState } from 'react';
import { load, update } from '@/shared/storage/store';
import { recordAttempt, recordSession } from '@/shared/stats/activity';
import { partLabel, type ContractKind } from '@/training/market-making/contracts';
import { COUNTERPARTY_LABEL, newGame, quote, review, round2, validateQuote, type CounterpartyKind, type Difficulty, type GameState } from '@/training/market-making/game';
import { Badge, Button, cx, EmptyState, Field, Panel, Segmented, Stat, Tabs } from '../../components/core';
import { LineChart } from '../../components/charts';
import { Example, F, Lesson } from '../../components/Lesson';
import { useHotkeys, usePersistent, useStorageVersion } from '../../hooks';
import { navigate, useRoute } from '../../router';

const TABS = [
  { value: 'play', label: 'Play' },
  { value: 'history', label: 'History' },
  { value: 'learn', label: 'Learn' },
] as const;

interface GameSummary {
  t: number;
  title: string;
  difficulty: Difficulty;
  pnl: number;
  edge: number;
  trades: number;
}
const HISTORY = 'market.history';

export default function MarketPage(): JSX.Element {
  const { segments } = useRoute();
  const tab = TABS.find((t) => t.value === segments[1])?.value ?? 'play';
  return (
    <div>
      <h1 className="text-2xl mb-2">Market making</h1>
      <Tabs value={tab} onChange={(v) => navigate(v === 'play' ? '/market' : `/market/${v}`)} tabs={TABS} />
      {tab === 'play' && <Play />}
      {tab === 'history' && <History />}
      {tab === 'learn' && <Learn />}
    </div>
  );
}

function seed(): string {
  const b = new Uint32Array(2);
  crypto.getRandomValues(b);
  return `${b[0].toString(16)}${b[1].toString(16)}`;
}

const fmt = (x: number): string => (Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/0$/, ''));

// ------------------------------------------------------------------ play

function Play(): JSX.Element {
  const [g, setG] = usePersistent<GameState | null>('market.game', null);
  const [setup, setSetup] = usePersistent<{ difficulty: Difficulty; kind: ContractKind | 'any' }>('market.setup', { difficulty: 'normal', kind: 'any' });
  if (!g)
    return (
      <div className="panel p-5 max-w-2xl space-y-4">
        <p>You are the market maker on a contract whose value is hidden. Each round you post a bid and an ask; traders buy at your ask or sell at your bid; then part of the answer is revealed. At the end the contract settles and your position is paid out.</p>
        <p className="text-paper-muted">Some traders are random, some know more than you, and arbitrageurs pick off any price that does not contain the fair value. Keep your quotes centred, mind the width limit, and manage your inventory.</p>
        <Field label="Difficulty">
          <Segmented value={setup.difficulty} onChange={(v) => setSetup({ ...setup, difficulty: v })} options={[{ value: 'easy', label: 'Easy' }, { value: 'normal', label: 'Normal' }, { value: 'hard', label: 'Hard' }]} />
        </Field>
        <Field label="Contract">
          <Segmented
            value={setup.kind}
            onChange={(v) => setSetup({ ...setup, kind: v })}
            options={[
              { value: 'any', label: 'Surprise me' },
              { value: 'dice-sum', label: 'Dice sum' },
              { value: 'card-sum', label: 'Card sum' },
              { value: 'coins', label: 'Coin heads' },
              { value: 'dice-max', label: 'Highest die' },
            ]}
          />
        </Field>
        <Button variant="primary" onClick={() => setG(newGame(seed(), setup.difficulty, setup.kind === 'any' ? undefined : setup.kind))}>
          Start trading
        </Button>
      </div>
    );
  if (g.done) return <Settled g={g} onAgain={() => setG(null)} />;
  return <Trading g={g} setG={setG} />;
}

function Parts({ g, revealedOverride }: { g: GameState; revealedOverride?: number }): JSX.Element {
  const shown = revealedOverride ?? g.revealed;
  return (
    <div className="flex flex-wrap gap-2" aria-label="Revealed parts">
      {g.contract.parts.map((v, i) => (
        <div key={i} className={cx('w-12 h-14 rounded border flex items-center justify-center text-lg num', i < shown ? 'border-ink-strong bg-ink-raised text-paper animate-pop' : 'border-dashed border-ink-line text-paper-dim')}>
          {i < shown ? partLabel(g.contract, v) : '?'}
        </div>
      ))}
    </div>
  );
}

function Trading({ g, setG }: { g: GameState; setG: (g: GameState | null) => void }): JSX.Element {
  const last = g.log.at(-1);
  const [bid, setBid] = useState(last ? fmt(last.bid) : '');
  const [ask, setAsk] = useState(last ? fmt(last.ask) : '');
  const [err, setErr] = useState<string | null>(null);
  const b = Number(bid), a = Number(ask);
  const shift = (d: number): void => {
    if (bid.trim() !== '' && ask.trim() !== '') {
      setBid(fmt(b + d));
      setAsk(fmt(a + d));
    }
  };
  const post = (): void => {
    if (bid.trim() === '' || ask.trim() === '') return setErr('Enter a bid and an ask.');
    const e = validateQuote(g, b, a);
    if (e) return setErr(e);
    setErr(null);
    const next = quote(g, b, a);
    const l = next.log.at(-1)!;
    const mid = (b + a) / 2;
    recordAttempt({ section: 'market', skill: 'market:quote', correct: b <= l.fair && a >= l.fair && Math.abs(mid - l.fair) <= Math.max(0.5, 0.5 * l.sd), score: l.sd > 0 ? Math.abs(mid - l.fair) / l.sd : 0 });
    if (next.done) {
      const rv = review(next);
      recordSession({ section: 'market', mode: `mm-${g.difficulty}`, durationMs: 0, score: round2(rv.edge), summary: { pnl: round2(rv.pnl), trades: next.log.reduce((s, x) => s + x.trades.length, 0) } });
      update<GameSummary[]>(HISTORY, [], (xs) => [...xs, { t: Date.now(), title: g.contract.title, difficulty: g.difficulty, pnl: round2(rv.pnl), edge: round2(rv.edge), trades: next.log.reduce((s, x) => s + x.trades.length, 0) }].slice(-500));
    }
    setG(next);
  };
  useHotkeys({ '[': () => shift(-0.5), ']': () => shift(0.5) }, true, ['[', ']']);

  const trades = g.log.flatMap((l) => l.trades);
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-6 items-start">
      <div className="space-y-4 min-w-0">
        <div className="panel p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline gap-3 mb-2">
            <h2 className="text-lg">{g.contract.title}</h2>
            <span className="text-sm text-paper-muted">
              Round {g.round + 1} of {g.contract.parts.length}
            </span>
            <Badge className="ml-auto">{g.difficulty[0].toUpperCase() + g.difficulty.slice(1)}</Badge>
          </div>
          <p className="text-paper-muted text-sm mb-4">{g.contract.description}</p>
          <Parts g={g} />
        </div>

        <form
          className="panel p-5 sm:p-6"
          onSubmit={(e) => {
            e.preventDefault();
            post();
          }}
        >
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label" htmlFor="mm-bid">
                Bid (you buy)
              </label>
              <input id="mm-bid" autoFocus className="input w-28 num text-lg text-right text-bid" inputMode="decimal" value={bid} onChange={(e) => setBid(e.target.value)} autoComplete="off" />
            </div>
            <div>
              <label className="label" htmlFor="mm-ask">
                Ask (you sell)
              </label>
              <input id="mm-ask" className="input w-28 num text-lg text-right text-ask" inputMode="decimal" value={ask} onChange={(e) => setAsk(e.target.value)} autoComplete="off" />
            </div>
            <div className="text-sm text-paper-muted pb-2 num">
              width {bid && ask && Number.isFinite(a - b) ? fmt(a - b) : '–'} / max {fmt(g.maxWidth)}
            </div>
            <div className="flex gap-1 pb-0.5">
              <Button size="sm" variant="ghost" onClick={() => shift(-0.5)} kbd="[">
                −½
              </Button>
              <Button size="sm" variant="ghost" onClick={() => shift(0.5)} kbd="]">
                +½
              </Button>
            </div>
            <Button variant="primary" type="submit" className="ml-auto" kbd="↵">
              Post quote
            </Button>
          </div>
          {err && (
            <p className="text-sm text-ask mt-2" role="alert">
              {err}
            </p>
          )}
          {last && (
            <div className="mt-4 border-t border-ink-line pt-3 text-sm" aria-live="polite">
              <span className="text-paper-muted">
                Last round at {fmt(last.bid)} / {fmt(last.ask)}:{' '}
              </span>
              {last.trades.length === 0
                ? 'no trades.'
                : last.trades.map((t, i) => (
                    <span key={i} className={cx('mr-3', t.side === 1 ? 'text-ask' : 'text-bid')}>
                      {t.side === 1 ? `you sold 1 at ${fmt(t.price)}` : `you bought 1 at ${fmt(t.price)}`}
                    </span>
                  ))}
            </div>
          )}
        </form>
      </div>
      <aside className="space-y-4">
        <Panel title="Your book">
          <div className="grid grid-cols-2 gap-3">
            <Stat size="sm" label="Position" value={`${g.position > 0 ? '+' : ''}${g.position} lots`} sub={`limit ±${g.posLimit}`} tone={Math.abs(g.position) >= 7 ? 'neg' : undefined} />
            <Stat size="sm" label="Cash" value={fmt(round2(g.cash))} />
          </div>
          <p className="text-xs text-paper-dim mt-3">At settlement you receive position × value, plus cash.</p>
        </Panel>
        <Panel title={`Trades (${trades.length})`}>
          {trades.length === 0 ? (
            <p className="text-sm text-paper-dim">No trades yet.</p>
          ) : (
            <ul className="text-sm num space-y-0.5 max-h-60 overflow-y-auto">
              {trades
                .slice()
                .reverse()
                .map((t, i) => (
                  <li key={i} className="flex justify-between">
                    <span className="text-paper-dim">R{t.round + 1}</span>
                    <span className={t.side === 1 ? 'text-ask' : 'text-bid'}>{t.side === 1 ? 'sold' : 'bought'}</span>
                    <span>{fmt(t.price)}</span>
                  </li>
                ))}
            </ul>
          )}
        </Panel>
        <Button size="sm" variant="ghost" onClick={() => setG(null)}>
          Abandon game
        </Button>
      </aside>
    </div>
  );
}

function Settled({ g, onAgain }: { g: GameState; onAgain: () => void }): JSX.Element {
  const rv = review(g);
  const rounds = g.log.map((l) => l.round + 1);
  return (
    <div className="space-y-6">
      <div className="panel p-5">
        <div className="flex flex-wrap items-baseline gap-3 mb-3">
          <h2 className="text-lg">{g.contract.title} settled at {rv.settlement}</h2>
          <Button variant="primary" className="ml-auto" onClick={onAgain}>
            New game
          </Button>
        </div>
        <Parts g={g} revealedOverride={g.contract.parts.length} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="P&L" value={fmt(round2(rv.pnl))} tone={rv.pnl >= 0 ? 'pos' : 'neg'} size="lg" />
        <Stat label="Edge vs fair value" value={fmt(round2(rv.edge))} sub="what your prices earned: skill" tone={rv.edge >= 0 ? 'pos' : 'neg'} />
        <Stat label="Inventory P&L" value={fmt(round2(rv.inventory))} sub="from holding a position as value moved: mostly luck" />
        <Stat label="Final position" value={`${g.position > 0 ? '+' : ''}${g.position}`} />
      </div>
      <Panel title="Your quotes against fair value">
        <LineChart
          x={rounds}
          xLabel="round"
          xFormat={(v) => String(v)}
          series={[
            { name: 'Fair value', values: g.log.map((l) => l.fair) },
            { name: 'Your mid', values: g.log.map((l) => (l.bid + l.ask) / 2), dashed: true },
          ]}
          band={{ lo: g.log.map((l) => l.bid), hi: g.log.map((l) => l.ask), name: 'Your bid–ask' }}
          markers={[{ y: rv.settlement, label: `settled ${rv.settlement}` }]}
          height={230}
        />
      </Panel>
      <div className="grid lg:grid-cols-2 gap-6">
        <Panel title="What to work on">
          <ul className="space-y-2 text-sm">
            {rv.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </Panel>
        <Panel title="Who you traded with">
          <table className="w-full text-sm num">
            <thead className="text-paper-muted">
              <tr>
                <th className="text-left font-normal">Counterparty</th>
                <th className="text-right font-normal">Trades</th>
                <th className="text-right font-normal">Your P&amp;L at settlement</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(rv.byWho) as CounterpartyKind[]).map((k) => (
                <tr key={k} className="border-t border-ink-line/60">
                  <td className="py-1">{COUNTERPARTY_LABEL[k]}</td>
                  <td className="text-right">{rv.byWho[k].n}</td>
                  <td className={cx('text-right', rv.byWho[k].pnl < 0 ? 'text-ask' : rv.byWho[k].pnl > 0 ? 'text-bid' : '')}>{fmt(round2(rv.byWho[k].pnl))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
      <Panel title="Round by round">
        <div className="overflow-x-auto">
          <table className="w-full text-sm num">
            <thead className="text-paper-muted">
              <tr>
                <th className="text-left font-normal py-1">Round</th>
                <th className="text-left font-normal">Known</th>
                <th className="text-right font-normal">Fair ± s.d.</th>
                <th className="text-right font-normal">Your quote</th>
                <th className="text-left font-normal pl-4">Trades</th>
                <th className="text-right font-normal">Position</th>
              </tr>
            </thead>
            <tbody>
              {g.log.map((l) => (
                <tr key={l.round} className="border-t border-ink-line/60 align-top">
                  <td className="py-1.5">{l.round + 1}</td>
                  <td>{g.contract.parts.slice(0, l.round).map((v) => partLabel(g.contract, v)).join(' ') || '–'}</td>
                  <td className="text-right whitespace-nowrap">
                    {fmt(round2(l.fair))} ± {fmt(round2(l.sd))}
                  </td>
                  <td className={cx('text-right whitespace-nowrap', (l.ask < l.fair || l.bid > l.fair) && 'text-ask')}>
                    {fmt(l.bid)} / {fmt(l.ask)}
                  </td>
                  <td className="pl-4">
                    {l.trades.length
                      ? l.trades.map((t, i) => (
                          <div key={i} className="whitespace-nowrap">
                            {COUNTERPARTY_LABEL[t.who]} {t.side === 1 ? 'bought' : 'sold'} at {fmt(t.price)}
                          </div>
                        ))
                      : '–'}
                  </td>
                  <td className="text-right">{l.positionAfter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------------ history

function History(): JSX.Element {
  useStorageVersion();
  const hist = load<GameSummary[]>(HISTORY, []);
  if (!hist.length) return <EmptyState title="No games yet">Finish a game and its P&amp;L and edge are logged here.</EmptyState>;
  const avgEdge = hist.reduce((s, h) => s + h.edge, 0) / hist.length;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <Stat label="Games" value={hist.length} />
        <Stat label="Average edge" value={fmt(round2(avgEdge))} tone={avgEdge >= 0 ? 'pos' : 'neg'} />
        <Stat label="Total P&L" value={fmt(round2(hist.reduce((s, h) => s + h.pnl, 0)))} />
      </div>
      {hist.length >= 2 && (
        <Panel title="Edge and P&L per game">
          <LineChart series={[{ name: 'Edge vs fair', values: hist.map((h) => h.edge) }, { name: 'P&L', values: hist.map((h) => h.pnl), dashed: true }]} xLabel="game" zeroLine height={200} />
        </Panel>
      )}
      <Panel title="Recent games">
        <table className="w-full text-sm num">
          <thead className="text-paper-muted">
            <tr>
              <th className="text-left font-normal py-1">Contract</th>
              <th className="text-left font-normal">Difficulty</th>
              <th className="text-right font-normal">Trades</th>
              <th className="text-right font-normal">Edge</th>
              <th className="text-right font-normal">P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {hist
              .slice(-30)
              .reverse()
              .map((h) => (
                <tr key={h.t} className="border-t border-ink-line/60">
                  <td className="py-1">{h.title}</td>
                  <td>{h.difficulty}</td>
                  <td className="text-right">{h.trades}</td>
                  <td className={cx('text-right', h.edge < 0 && 'text-ask')}>{fmt(h.edge)}</td>
                  <td className={cx('text-right', h.pnl < 0 && 'text-ask')}>{fmt(h.pnl)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------------ learn

function Learn(): JSX.Element {
  return (
    <div className="space-y-3 max-w-3xl">
      <Lesson title="Start from fair value" open>
        <p>Your first job is the expected value of the contract given what is public. For a sum of dice that is the revealed total plus 3.5 for each hidden die; for cards, the revealed total plus the average of what is left in the deck for each hidden card.</p>
        <Example>Five dice, two shown as 6 and 2: fair = 8 + 3 × 3.5 = 18.5.</Example>
      </Lesson>
      <Lesson title="Width should reflect uncertainty">
        <p>A spread pays you for the risk of being wrong. Early on, when the standard deviation is large, a wider market is defensible; as parts are revealed, tighten it. Interviewers usually cap the width, so the real skill is centring the quote.</p>
        <F>sd(sum of m hidden dice) = √(m × 35/12) ≈ 1.71 √m</F>
      </Lesson>
      <Lesson title="Adverse selection">
        <p>Some counterparties know more than you. When someone lifts your offer, the chance they are informed rises, so the value is probably higher than you thought: move your next quote up. Noise traders pay your spread; informed traders take it back with interest.</p>
      </Lesson>
      <Lesson title="Inventory and skew">
        <p>A market maker wants to earn the spread, not to bet on direction. When you are long, lower both your bid and ask a little: you sell more easily and buy less. When short, raise both. Big positions into a reveal are a gamble on the next card or die.</p>
      </Lesson>
      <Lesson title="Edge versus P&L">
        <p>Your P&L at settlement splits into two parts. Edge is the sum over trades of how far your trade price was from fair value at the time: that is what your quoting earned. The rest comes from holding inventory while fair value moved, which is mostly luck. Judge yourself on edge.</p>
      </Lesson>
      <Lesson title="Interview patterns">
        <p>"Make me a market on the sum of three dice": quote around 10.5, e.g. 9.5 / 11.5. Expect the interviewer to trade, reveal information, then ask for a new market. Update the fair value out loud, mention your inventory, and never quote a price you cannot explain.</p>
      </Lesson>
    </div>
  );
}
