import { useEffect, useState, useSyncExternalStore } from 'react';
import { type BJMove } from '@/games/blackjack/engine';
import { handValue, isNatural, valueOf, describeRules, type BJRules } from '@/games/blackjack/rules';
import { chartMove, MOVE_LABEL } from '@/games/blackjack/strategy';
import { STYLE_LABEL } from '@/games/blackjack/players';
import { decksRemaining, deviationFor, runningCount, trueCount } from '@/games/blackjack/counting';
import { shoeCounts } from '@/games/blackjack/ev';
import { bjWorker } from '@/workers/clients';
import { Badge, Button, cx, Field, Modal, NumberField, Segmented, Stat, Toggle } from '../../components/core';
import { CommitChip, VerifyPanel } from '../../components/Fairness';
import { PlayingCard } from '../../components/PlayingCard';
import { useHotkeys, usePersistent } from '../../hooks';
import { useSettings } from '../../useSettings';
import { type BJConfig, getBJSession } from './session';

type EVResult = Awaited<ReturnType<typeof bjWorker.call<'evs'>>>;

export function useBJ() {
  const s = getBJSession();
  const snap = useSyncExternalStore(s.subscribe, s.getSnapshot);
  useEffect(() => {
    s.resume();
    const hide = (): void => s.recordSessionStats();
    window.addEventListener('pagehide', hide);
    return () => {
      window.removeEventListener('pagehide', hide);
      s.stop();
    };
  }, [s]);
  return { s, snap };
}

export function PlayBJ(): JSX.Element {
  const { s, snap } = useBJ();
  const [settings, setSettings] = useSettings();
  const [hints, setHints] = usePersistent('bj.hints', true);
  const [counting, setCounting] = usePersistent('bj.counting', false);
  const [showCount, setShowCount] = usePersistent('bj.showCount', false);
  const [checkRate, setCheckRate] = usePersistent('bj.checkRate', 0.25);
  const [tab, setTab] = useState<'hints' | 'count' | 'stats' | 'shoe'>('hints');
  const [setup, setSetup] = useState(false);
  const [verify, setVerify] = useState(false);
  const [evs, setEvs] = useState<EVResult | null>(null);
  const v = snap.view;
  s.countTraining = counting;
  s.countCheckRate = checkRate;

  const heroTurn = snap.status === 'hero';
  const hero = v.seats[snap.heroSeat]!;
  const handIdx = v.turn?.seat === snap.heroSeat ? v.turn.hand : 0;
  const curHand = hero.hands[handIdx];
  const L = heroTurn ? v.legal : null;

  // Exact EVs for the hero's decision from the composition of unseen cards.
  const decisionKey = heroTurn && curHand ? `${v.roundNo}-${handIdx}-${curHand.cards.length}-${hero.hands.length}` : '';
  useEffect(() => {
    if (!heroTurn || !curHand || !L || !hints) return;
    setEvs(null);
    const counts = Array.from(shoeCounts(v.rules.decks));
    for (const c of v.seen) counts[valueOf(c)]--;
    void bjWorker
      .call('evs', { values: curHand.cards.map(valueOf), up: valueOf(v.dealerUp!), counts, rules: v.rules, allowed: { double: L.double, split: L.split, surrender: L.surrender } })
      .then(setEvs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decisionKey, hints]);

  const act = (m: BJMove): void => {
    if (L?.[m]) s.heroAct(m);
  };
  useHotkeys(
    {
      h: () => act('hit'),
      s: () => act('stand'),
      d: () => act('double'),
      p: () => act('split'),
      r: () => act('surrender'),
      i: () => snap.status === 'insurance' && s.heroInsurance(true),
      n: () => snap.status === 'insurance' && s.heroInsurance(false),
      Enter: () => (snap.status === 'betting' || snap.status === 'done') && void s.deal(),
      ' ': () => (snap.status === 'betting' || snap.status === 'done') && void s.deal(),
    },
    snap.status !== 'count-check',
  );

  const rc = runningCount(v.seen);
  const tc = trueCount(rc, v.cardsRemaining);
  const basic = heroTurn && curHand && L ? chartMove(s.chart, { values: curHand.cards.map(valueOf), up: valueOf(v.dealerUp!), canDouble: L.double, canSplit: L.split, canSurrender: L.surrender }) : null;
  const hv = curHand ? handValue(curHand.cards) : null;
  const dev =
    heroTurn && counting && curHand && L && hv
      ? deviationFor({ hardTotal: hv.soft ? null : hv.total, pairOf: curHand.cards.length === 2 && valueOf(curHand.cards[0]) === valueOf(curHand.cards[1]) ? valueOf(curHand.cards[0]) : null, up: valueOf(v.dealerUp!), tc, canDouble: L.double, canSplit: L.split, canSurrender: L.surrender })
      : null;

  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr)_340px] gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <CommitChip commit={snap.commit} label="Shoe committed" />
          <span className="text-sm text-paper-dim">{describeRules(v.rules)}</span>
          <div className="ml-auto flex gap-2">
            <Segmented size="sm" label="Speed" value={settings.speed} onChange={(x) => setSettings({ speed: x })} options={[{ value: 0, label: 'Instant' }, { value: 0.4, label: 'Fast' }, { value: 1, label: 'Real' }]} />
            <Button size="sm" onClick={() => setSetup(true)}>
              Table setup
            </Button>
          </div>
        </div>
        <BJFelt snap={snap} showCount={counting && showCount} rc={rc} tc={tc} />
        {snap.feedback && (
          <div key={snap.feedback.id} className={cx('mt-3 rounded px-3 py-2 text-sm animate-pop', snap.feedback.ok ? 'bg-bid-soft text-bid' : 'bg-ask-soft text-ask')} role="status">
            {snap.feedback.text}
          </div>
        )}
        <div className="py-3 min-h-[120px]">
          {snap.status === 'insurance' && (
            <div className="flex flex-wrap items-center justify-center gap-3">
              <span>Dealer shows an ace. Insurance?</span>
              <Button onClick={() => s.heroInsurance(true)} kbd="I">
                Take insurance
              </Button>
              <Button variant="primary" onClick={() => s.heroInsurance(false)} kbd="N">
                No insurance
              </Button>
            </div>
          )}
          {heroTurn && L && (
            <div className="grid grid-cols-5 gap-2">
              {(['hit', 'stand', 'double', 'split', 'surrender'] as BJMove[]).map((m) => (
                <Button key={m} size="lg" variant={m === 'stand' || m === 'hit' ? 'primary' : 'secondary'} disabled={!L[m]} onClick={() => act(m)} kbd={{ hit: 'H', stand: 'S', double: 'D', split: 'P', surrender: 'R' }[m]}>
                  {MOVE_LABEL[m]}
                </Button>
              ))}
            </div>
          )}
          {(snap.status === 'betting' || snap.status === 'done') && <Betting snap={snap} onBet={(b) => s.setBet(b)} onDeal={() => void s.deal()} />}
          {(snap.status === 'bots' || snap.status === 'dealer') && <p className="text-center text-paper-dim text-sm pt-4">{snap.status === 'dealer' ? 'Dealer plays…' : 'Other players are acting…'}</p>}
        </div>
      </div>
      <aside className="panel p-3 h-fit space-y-3">
        <Segmented size="sm" value={tab} onChange={setTab} options={[{ value: 'hints', label: 'Hints' }, { value: 'count', label: 'Count' }, { value: 'stats', label: 'Stats' }, { value: 'shoe', label: 'Shoe' }]} label="Blackjack panel" />
        {tab === 'hints' && (
          <div className="space-y-3 text-sm">
            <Toggle checked={hints} onChange={setHints} label="Show hints" hint="Basic strategy for these rules, with the exact EV of every option for the cards left in this shoe." />
            {hints && heroTurn && basic && (
              <div className="space-y-2">
                <p>
                  Basic strategy: <span className="font-semibold text-signal">{MOVE_LABEL[basic.move]}</span> <span className="text-paper-dim">(chart cell {basic.cell})</span>
                </p>
                {dev && (
                  <p>
                    Count deviation: <span className="font-semibold">{dev.move}</span> ({dev.label}, index {dev.index > 0 ? '+' : ''}
                    {dev.index}, TC {tc.toFixed(1)})
                  </p>
                )}
                {evs ? (
                  <>
                    <p className="text-paper-muted">{reasonFor(basic.move, curHand!.cards.map(valueOf), valueOf(v.dealerUp!), evs)}</p>
                    <table className="w-full num">
                      <tbody>
                        {(['stand', 'hit', 'double', 'split', 'surrender'] as const).map((k) => {
                          const x = evs[k];
                          if (x === null || x === undefined) return null;
                          const best = Math.max(...(['stand', 'hit', 'double', 'split', 'surrender'] as const).map((q) => evs[q] ?? -9));
                          return (
                            <tr key={k} className={x === best ? 'text-signal' : ''}>
                              <td className="capitalize">{k}</td>
                              <td className="text-right">{x >= 0 ? '+' : '−'}{Math.abs(x).toFixed(3)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <p className="text-xs text-paper-dim">EV per unit bet, exact for the {v.cardsRemaining} unseen cards (split assumes no re-split).</p>
                  </>
                ) : (
                  <p className="text-paper-dim">Computing EVs…</p>
                )}
              </div>
            )}
            {hints && !heroTurn && <p className="text-paper-dim">Hints appear on your turn.</p>}
          </div>
        )}
        {tab === 'count' && (
          <div className="space-y-3 text-sm">
            <Toggle checked={counting} onChange={setCounting} label="Card counting trainer" hint="Grades you on Hi-Lo index plays (Illustrious 18, Fab 4) and asks for the count between rounds." />
            {counting && (
              <>
                <Toggle checked={showCount} onChange={setShowCount} label="Show the count on the table" hint="Off: keep it in your head; you'll be checked." />
                <Field label="Count checks">
                  <Segmented size="sm" value={checkRate} onChange={setCheckRate} options={[{ value: 0.1, label: 'Rare' }, { value: 0.25, label: 'Often' }, { value: 0.6, label: 'Very often' }]} />
                </Field>
                {showCount && (
                  <div className="grid grid-cols-3 gap-2">
                    <Stat size="sm" label="Running" value={rc} />
                    <Stat size="sm" label="True" value={tc.toFixed(1)} />
                    <Stat size="sm" label="Decks left" value={decksRemaining(v.cardsRemaining).estimate} />
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {tab === 'stats' && (
          <div className="grid grid-cols-2 gap-3">
            <Stat size="sm" label="Hands" value={snap.stats.hands} />
            <Stat size="sm" label="Net" value={`${snap.stats.net >= 0 ? '+' : '−'}${Math.abs(snap.stats.net)} u`} tone={snap.stats.net > 0 ? 'pos' : snap.stats.net < 0 ? 'neg' : undefined} />
            <Stat size="sm" label="Strategy accuracy" value={snap.stats.decisions ? `${Math.round((100 * snap.stats.correct) / snap.stats.decisions)}%` : '–'} sub={`${snap.stats.decisions} decisions`} />
            <Stat size="sm" label="Count accuracy" value={snap.stats.countChecks ? `${Math.round((100 * snap.stats.countCorrect) / snap.stats.countChecks)}%` : '–'} sub={`${snap.stats.countChecks} checks`} />
            <Button size="sm" variant="ghost" onClick={() => s.resetStats()}>
              Reset stats
            </Button>
          </div>
        )}
        {tab === 'shoe' && (
          <div className="space-y-3 text-sm">
            <p className="text-paper-muted">
              {v.cardsRemaining} of {v.shoeSize} cards left; the cut card sits at {Math.round(v.rules.penetration * 100)}%. The shoe's seed is revealed when it is reshuffled.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => s.shuffleNow()} disabled={!(snap.status === 'betting' || snap.status === 'done')}>
                End shoe and reveal
              </Button>
              <Button size="sm" onClick={() => setVerify(true)} disabled={!snap.lastReveal}>
                Verify last shoe
              </Button>
            </div>
          </div>
        )}
      </aside>
      <SetupModal open={setup} config={snap.config} onClose={() => setSetup(false)} onApply={(c) => s.setup(c)} onResetBankroll={() => s.resetBankroll()} />
      <Modal open={verify} onClose={() => setVerify(false)} title="Verify the last shoe" wide>
        {snap.lastReveal && <VerifyPanel reveal={snap.lastReveal} />}
      </Modal>
      <CountCheck snap={snap} onAnswer={(x) => s.answerCountCheck(x)} onSkip={() => s.skipCountCheck()} />
    </div>
  );
}

function reasonFor(move: string, values: number[], up: number, e: EVResult): string {
  const sum = values.reduce((a, b) => a + b, 0);
  const soft = values.includes(1) && sum + 10 <= 21;
  const total = soft ? sum + 10 : sum;
  const upName = up === 1 ? 'an ace' : up === 10 ? 'a ten' : `a ${up}`;
  const bust = Math.round(e.dealerBust * 100);
  const f = (x: number | null): string => (x === null ? '–' : `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(2)}`);
  switch (move) {
    case 'double':
      return `With ${soft ? 'soft ' : ''}${total} against ${upName} (dealer busts ${bust}%), doubling earns most: one card for twice the stake (${f(e.double)} vs hit ${f(e.hit)}).`;
    case 'split':
      return `Splitting turns this pair into two hands that each start better than ${total} does (split ${f(e.split)} vs best alternative ${f(Math.max(e.hit, e.stand, e.double ?? -9))}).`;
    case 'surrender':
      return `Every option loses more than half a bet on average here (best ${f(Math.max(e.hit, e.stand))}), so giving up half (−0.50) is cheapest.`;
    case 'stand':
      return total >= 17 ? `${total} is strong enough: hitting risks busting for little gain (stand ${f(e.stand)} vs hit ${f(e.hit)}).` : `Dealer ${upName} busts ${bust}% of the time: let the dealer take the risk (stand ${f(e.stand)} vs hit ${f(e.hit)}).`;
    default:
      return total <= 11 ? `You can't bust with ${total}; take a card (hit ${f(e.hit)}).` : `Against ${upName} the dealer usually makes 17 or more (busts only ${bust}%), so ${total} has to improve (hit ${f(e.hit)} vs stand ${f(e.stand)}).`;
  }
}

function Betting({ snap, onBet, onDeal }: { snap: ReturnType<typeof getBJSession>['getSnapshot'] extends () => infer S ? S : never; onBet: (b: number) => void; onDeal: () => void }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <span className="text-sm text-paper-muted">Bet</span>
      {[1, 5, 25, 100].map((c) => (
        <button key={c} type="button" onClick={() => onBet(snap.bet + c)} className="w-11 h-11 rounded-full border-2 border-dashed text-sm font-semibold num hover:brightness-110" style={{ borderColor: '#ffffff55', background: { 1: '#d9d4c7', 5: '#c8323a', 25: '#1f7a4a', 100: '#1d1d1f' }[c], color: c === 1 ? '#1d1d1f' : '#fff' }} aria-label={`Add ${c}`}>
          {c}
        </button>
      ))}
      <span className="num text-lg w-16 text-center">{snap.bet}</span>
      <Button size="sm" variant="ghost" onClick={() => onBet(1)}>
        Clear
      </Button>
      <Button variant="primary" size="lg" onClick={onDeal} kbd="↵">
        Deal
      </Button>
    </div>
  );
}

function CountCheck({ snap, onAnswer, onSkip }: { snap: ReturnType<typeof getBJSession>['getSnapshot'] extends () => infer S ? S : never; onAnswer: (x: number) => void; onSkip: () => void }): JSX.Element {
  const [x, setX] = useState('');
  const open = snap.status === 'count-check' && !!snap.countCheck;
  useEffect(() => setX(''), [open]);
  return (
    <Modal open={open} onClose={onSkip} title="Count check">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(x);
          if (x.trim() !== '' && Number.isFinite(n)) onAnswer(n);
        }}
        className="space-y-4"
      >
        <Field label={snap.countCheck?.kind === 'rc' ? "What's the running count?" : "What's the true count? (nearest half)"} hint={snap.countCheck?.kind === 'tc' ? 'Estimate decks remaining from the shoe, to the nearest half deck.' : undefined}>
          <input autoFocus className="input w-32 num text-lg" inputMode="numeric" value={x} onChange={(e) => setX(e.target.value)} aria-label="Count" />
        </Field>
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={onSkip}>
            Skip
          </Button>
          <Button variant="primary" type="submit">
            Check my count
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function SetupModal({ open, config, onClose, onApply, onResetBankroll }: { open: boolean; config: BJConfig; onClose: () => void; onApply: (c: BJConfig) => void; onResetBankroll: () => void }): JSX.Element {
  const [c, setC] = useState(config);
  useEffect(() => setC(config), [config, open]);
  const r = c.rules;
  const setR = (p: Partial<BJRules>): void => setC({ ...c, rules: { ...r, ...p } });
  return (
    <Modal open={open} onClose={onClose} title="Table setup">
      <div className="space-y-4">
        <Field label="Decks">
          <Segmented value={r.decks} onChange={(d) => setR({ decks: d })} options={[1, 2, 4, 6, 8].map((d) => ({ value: d, label: String(d) }))} />
        </Field>
        <Field label="Dealer on soft 17">
          <Segmented value={r.h17 ? 'h' : 's'} onChange={(x) => setR({ h17: x === 'h' })} options={[{ value: 's', label: 'Stands (S17)' }, { value: 'h', label: 'Hits (H17)' }]} />
        </Field>
        <Field label="Blackjack pays">
          <Segmented value={r.bjPays} onChange={(x) => setR({ bjPays: x })} options={[{ value: 1.5, label: '3:2' }, { value: 1.2, label: '6:5' }]} />
        </Field>
        <Field label="Split up to">
          <Segmented value={r.maxHands} onChange={(x) => setR({ maxHands: x })} options={[{ value: 2, label: '2 hands' }, { value: 3, label: '3' }, { value: 4, label: '4' }]} />
        </Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Toggle checked={r.das} onChange={(x) => setR({ das: x })} label="Double after split" />
          <Toggle checked={r.surrender} onChange={(x) => setR({ surrender: x })} label="Late surrender" />
          <Toggle checked={r.resplitAces} onChange={(x) => setR({ resplitAces: x })} label="Re-split aces" />
          <Toggle checked={r.hitSplitAces} onChange={(x) => setR({ hitSplitAces: x })} label="Hit split aces" />
        </div>
        <Field label={`Penetration: ${Math.round(r.penetration * 100)}%`}>
          <input type="range" min={50} max={90} step={5} value={Math.round(r.penetration * 100)} onChange={(e) => setR({ penetration: Number(e.target.value) / 100 })} className="w-full accent-signal" />
        </Field>
        <Field label="Other players at the table">
          <Segmented value={c.others} onChange={(x) => setC({ ...c, others: x })} options={[0, 1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: String(n) }))} />
        </Field>
        <Field label="Starting bankroll (units)">
          <NumberField value={c.bankroll} min={50} max={100000} onChange={(x) => setC({ ...c, bankroll: x })} />
        </Field>
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="ghost" onClick={onResetBankroll}>
            Reset bankroll
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                onApply(c);
                onClose();
              }}
            >
              Start new table
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function BJFelt({ snap, showCount, rc, tc }: { snap: ReturnType<typeof getBJSession>['getSnapshot'] extends () => infer S ? S : never; showCount: boolean; rc: number; tc: number }): JSX.Element {
  const v = snap.view;
  const dv = handValue(v.dealer);
  const seats = v.seats;
  const n = seats.length;
  return (
    <div className="relative w-full aspect-[16/9] max-h-[560px] overflow-hidden rounded-[0_0_50%_50%/0_0_60%_60%] felt shadow-[inset_0_-8px_0_#1A1511,0_20px_60px_rgba(0,0,0,.5)] select-none">
      <div className="absolute top-[30%] left-1/2 -translate-x-1/2 text-white/25 text-xs tracking-[0.2em] text-center whitespace-nowrap">
        BLACKJACK PAYS {v.rules.bjPays === 1.5 ? '3 TO 2' : '6 TO 5'} · DEALER {v.rules.h17 ? 'HITS' : 'STANDS ON'} SOFT 17
        <br />
        INSURANCE PAYS 2 TO 1
      </div>
      {/* Shoe gauge */}
      <div className="absolute right-[3%] top-[5%] flex flex-col items-end gap-1 text-[11px] text-white/60" title="Cards left in the shoe">
        <span>Shoe</span>
        <div className="w-20 h-2 rounded bg-black/40 overflow-hidden relative">
          <div className="h-full bg-white/50" style={{ width: `${(v.cardsRemaining / v.shoeSize) * 100}%` }} />
          <div className="absolute top-0 bottom-0 w-px bg-signal" style={{ left: `${(1 - v.rules.penetration) * 100}%` }} />
        </div>
        {showCount && (
          <span className="num text-white/80">
            RC {rc} · TC {tc.toFixed(1)}
          </span>
        )}
      </div>
      {/* Dealer */}
      <div className="absolute left-1/2 top-[5%] -translate-x-1/2 flex flex-col items-center gap-1">
        <div className="flex gap-1.5 min-h-[76px]">
          {v.dealerUp !== null && (
            <>
              {v.dealer.map((c, i) => (
                <PlayingCard key={`${v.roundNo}-d${i}`} card={c} size="md" animate />
              ))}
              {!v.holeRevealed && <PlayingCard key={`${v.roundNo}-hole`} faceDown size="md" animate />}
            </>
          )}
        </div>
        {v.dealerUp !== null && <span className="text-xs text-white/80 bg-black/30 rounded px-2 num">Dealer {v.holeRevealed ? `${dv.total}${isNatural(v.dealer) ? ' · Blackjack' : dv.total > 21 ? ' · Bust' : ''}` : valueOf(v.dealerUp) === 1 ? 'A' : valueOf(v.dealerUp)}</span>}
      </div>
      {/* Seats along an arc */}
      {seats.map((s, i) => {
        // First base (acts first) is on the dealer's left, i.e. on your right.
        const a = Math.PI * (0.12 + (0.76 * i) / Math.max(1, n - 1));
        const x = 50 + 41 * Math.cos(a);
        const y = 26 + 52 * Math.sin(a);
        const isHero = i === snap.heroSeat;
        if (!s) return <div key={i} className="absolute -translate-x-1/2 -translate-y-1/2 w-14 h-14 rounded-full border border-dashed border-white/10" style={{ left: `${x}%`, top: `${y}%` }} />;
        const bot = snap.bots[i];
        return (
          <div key={i} className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1" style={{ left: `${x}%`, top: `${y}%` }}>
            {snap.chat[i] && <div className="bg-paper text-ink text-xs px-2 py-1 rounded-md shadow-card animate-pop whitespace-nowrap">{snap.chat[i]}</div>}
            <div className="flex gap-2">
              {s.hands.map((h, hi) => {
                const hvv = handValue(h.cards);
                const active = v.turn?.seat === i && v.turn.hand === hi;
                return (
                  <div key={hi} className={cx('flex flex-col items-center rounded-md p-1', active && 'ring-2 ring-signal')}>
                    <div className="flex -space-x-6">
                      {h.cards.map((c, k) => (
                        <PlayingCard key={`${v.roundNo}-${i}-${hi}-${k}`} card={c} size={isHero ? 'md' : 'sm'} animate />
                      ))}
                    </div>
                    <span className="mt-0.5 text-[11px] text-white/85 bg-black/35 rounded px-1.5 num whitespace-nowrap">
                      {hvv.soft && hvv.total < 21 ? `soft ${hvv.total}` : hvv.total} · {h.bet}
                      {h.doubled ? ' (×2)' : ''}
                    </span>
                    {h.result && (
                      <Badge tone={h.net > 0 ? 'pos' : h.net < 0 ? 'neg' : 'neutral'} className="mt-0.5">
                        {h.result === 'blackjack' ? 'Blackjack' : h.result[0].toUpperCase() + h.result.slice(1)} {h.net !== 0 ? `${h.net > 0 ? '+' : '−'}${Math.abs(h.net)}` : ''}
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
            <div className={cx('text-xs px-2 py-0.5 rounded bg-ink/85 border', isHero ? 'border-signal/60' : 'border-white/10', snap.thinking === i && 'animate-pulse')} title={bot ? STYLE_LABEL[bot.style] : undefined}>
              <span className="font-medium">{s.name}</span>
              {isHero && <span className="text-paper-muted num"> · {s.bankroll} u</span>}
              {s.insurance > 0 && <span className="text-signal"> · insured</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
