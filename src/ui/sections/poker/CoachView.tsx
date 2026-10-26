import { useEffect, useRef, useState } from 'react';
import type { CoachAction, CoachAnalysis } from '@/games/poker/coach/coach';
import { judge } from '@/games/poker/coach/coach';
import { cardToString } from '@/shared/cards/card';
import { recordAttempt } from '@/shared/stats/activity';
import { recordReview } from '@/shared/srs/srs';
import { equityWorker } from '@/workers/clients';
import { Badge, Button, cx, Disclosure, fmtPct, Toggle } from '../../components/core';
import { CardText } from '../../components/PlayingCard';
import { usePersistent } from '../../hooks';
import { navigate } from '../../router';
import { PlayView, usePokerSession } from './PlayView';
import type { Snapshot } from './session';

export interface Mistake {
  id: number;
  t: number;
  handKey: string;
  street: string;
  hand: string;
  board: string;
  did: string;
  best: string;
  evLostBB: number | null;
  note: string;
}

const decisionKey = (s: Snapshot): string | null => (s.status === 'hero-turn' && s.view ? `${s.view.handId}-${s.view.actions.length}` : null);

export function CoachView(): JSX.Element {
  const ctx = usePokerSession('coach');
  const { session, snap } = ctx;
  const [quiz, setQuiz] = usePersistent('poker.coach.quiz', false);
  const [mistakes, setMistakes] = usePersistent<Mistake[]>('poker.mistakes', []);
  const [analysis, setAnalysis] = useState<CoachAnalysis | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [answered, setAnswered] = useState<Record<string, { action: CoachAction; eq: number }>>({});
  const [blocked, setBlocked] = useState<string | null>(null);
  const pending = useRef<{ key: string; handKey: string; a: CoachAnalysis; judged: boolean }[]>([]);

  // Analyse each hero decision as it arrives.
  const key = decisionKey(snap);
  useEffect(() => {
    if (!key || !snap.view || loadingKey === key) return;
    setLoadingKey(key);
    setBlocked(null);
    const view = snap.view;
    const tendencies: Record<number, ReturnType<typeof snap.hud.tendencies>> = {};
    const names: Record<number, string> = {};
    for (const s of view.seats) {
      names[s.seat] = s.name;
      if (s.seat !== view.me) tendencies[s.seat] = snap.hud.tendencies(s.playerId, 12);
    }
    const handKey = session.handKey;
    void equityWorker.call('coach', { view, tendencies, names, iterations: 12000 }).then((a) => {
      setAnalysis(a);
      pending.current = [...pending.current.slice(-20), { key, handKey, a, judged: false }];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Judge the hero's actual action against the analysis for that decision.
  useEffect(() => {
    const v = snap.view;
    if (!v) return;
    for (const p of pending.current) {
      if (p.judged || p.a.handId !== v.handId) continue;
      const heroAct = v.actions.slice(p.a.actionsSeen).find((x) => x.seat === v.me);
      if (!heroAct || heroAct.type.startsWith('post') || heroAct.type === 'uncalled') continue;
      p.judged = true;
      const did = { type: heroAct.type as CoachAction, to: heroAct.to };
      const j = judge(p.a, did);
      const bb = p.a.bb;
      const severe = p.a.recommendation.closeness === 'clear' && !j.matches && (j.evLost === null || j.evLost >= Math.max(0.5 * bb, 0.05 * p.a.pot));
      recordAttempt({ section: 'poker', skill: `coach-${p.a.street}`, correct: !severe });
      if (severe) {
        const m: Mistake = {
          id: Date.now(),
          t: Date.now(),
          handKey: p.handKey,
          street: p.a.street,
          hand: p.a.hand,
          board: v.board.slice(0, { preflop: 0, flop: 3, turn: 4, river: 5 }[p.a.street]).map(cardToString).join(' '),
          did: heroAct.type === 'raise' || heroAct.type === 'bet' ? `${heroAct.type} to ${(heroAct.to / bb).toFixed(1)}bb` : heroAct.type,
          best: p.a.recommendation.label,
          evLostBB: j.evLost === null ? null : j.evLost / bb,
          note: j.note,
        };
        setMistakes((xs) => [...xs.slice(-499), m]);
      }
    }
  }, [snap.version, snap.view, setMistakes]);

  // Attach this hand's mistakes to the stored hand for review.
  useEffect(() => {
    session.onHandStored = (h) => {
      h.coach = mistakes.filter((m) => m.handKey === h.id);
    };
    return () => {
      session.onHandStored = null;
    };
  }, [session, mistakes]);

  const current = analysis && key && analysis.handId === snap.view?.handId && analysis.actionsSeen === snap.view?.actions.length ? analysis : null;
  const nonTrivial = !!snap.view && (snap.view.street !== 'preflop' || snap.view.currentBet > snap.view.bb);
  const needsQuiz = quiz && !!key && nonTrivial && !answered[key];

  const beforeAct = (): boolean => {
    if (needsQuiz) {
      setBlocked('Answer the coach’s quiz first, or switch quiz mode off.');
      return false;
    }
    return true;
  };

  return (
    <PlayView
      ctx={ctx}
      beforeAct={beforeAct}
      blockedMessage={blocked}
      coach={{
        label: 'Coach',
        content: () => (
          <div className="space-y-4">
            <Toggle checked={quiz} onChange={setQuiz} label="Quiz before hint" hint="Commit to an action and an equity estimate first, then see the analysis and your score." />
            {!key && <p className="text-sm text-paper-muted">The coach analyses each of your decisions here as soon as it is your turn.</p>}
            {key && !current && <p className="text-sm text-paper-muted">Analysing…</p>}
            {key && current && needsQuiz && (
              <Quiz
                analysis={current}
                onSubmit={(action, eq) => {
                  setAnswered((x) => ({ ...x, [key]: { action, eq } }));
                  setBlocked(null);
                  const err = Math.abs(eq - current.equity.value);
                  const sameKind = action === current.recommendation.action || (['bet', 'raise'].includes(action) && ['bet', 'raise'].includes(current.recommendation.action));
                  recordAttempt({ section: 'poker', skill: 'equity-estimate', correct: err <= 0.08, score: err });
                  recordReview('poker', 'equity-estimate', err <= 0.05 ? 5 : err <= 0.1 ? 4 : err <= 0.15 ? 2 : 1);
                  recordAttempt({ section: 'poker', skill: 'quiz-decision', correct: sameKind || current.recommendation.closeness !== 'clear' });
                }}
              />
            )}
            {key && current && !needsQuiz && <AnalysisView a={current} quizAnswer={answered[key]} />}
            <MistakeLog mistakes={mistakes} onClear={() => setMistakes([])} />
          </div>
        ),
      }}
    />
  );
}

function Quiz({ analysis, onSubmit }: { analysis: CoachAnalysis; onSubmit: (a: CoachAction, eq: number) => void }): JSX.Element {
  const actions = [...new Set(analysis.options.map((o) => o.action))];
  const [action, setAction] = useState<CoachAction | null>(null);
  const [eq, setEq] = useState('');
  const eqNum = Number(eq) / 100;
  return (
    <div className="space-y-3 border border-signal/40 rounded p-3">
      <p className="font-medium">Your call first</p>
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button key={a} type="button" onClick={() => setAction(a)} className={cx('h-8 px-3 rounded border text-sm capitalize', action === a ? 'border-signal text-signal' : 'border-ink-line text-paper-muted hover:text-paper')}>
            {a}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="label">Your equity against their likely range (%)</span>
        <input className="input w-28 num" inputMode="decimal" value={eq} onChange={(e) => setEq(e.target.value)} aria-label="Equity estimate" />
      </label>
      <Button variant="primary" size="sm" disabled={!action || !(eqNum >= 0 && eqNum <= 1) || eq === ''} onClick={() => action && onSubmit(action, eqNum)}>
        Reveal the analysis
      </Button>
    </div>
  );
}

function AnalysisView({ a, quizAnswer }: { a: CoachAnalysis; quizAnswer?: { action: CoachAction; eq: number } }): JSX.Element {
  const bb = a.bb;
  const best = Math.max(...a.options.map((o) => (Number.isFinite(o.ev) ? o.ev : -Infinity)));
  return (
    <div className="space-y-4 text-sm">
      {quizAnswer && (
        <div className="border border-ink-line rounded p-3 space-y-1">
          <div>
            Your action: <span className="capitalize font-medium">{quizAnswer.action}</span>{' '}
            {quizAnswer.action === a.recommendation.action || (['bet', 'raise'].includes(quizAnswer.action) && ['bet', 'raise'].includes(a.recommendation.action)) ? (
              <Badge tone="pos">matches</Badge>
            ) : a.recommendation.closeness !== 'clear' ? (
              <Badge tone="info">close spot</Badge>
            ) : (
              <Badge tone="neg">coach prefers {a.recommendation.label.toLowerCase()}</Badge>
            )}
          </div>
          <div>
            Your equity estimate {fmtPct(quizAnswer.eq, 0)} vs {fmtPct(a.equity.value, 1)}: error {(Math.abs(quizAnswer.eq - a.equity.value) * 100).toFixed(1)} points
          </div>
        </div>
      )}
      <section>
        <h3 className="text-paper-muted mb-1">Your hand</h3>
        <p>
          <span className="font-medium">{a.hand}</span> · {a.made}
          {a.draws && <span className="text-paper-muted"> · {a.draws}</span>}
        </p>
        {a.texture && <p className="text-paper-muted">Board: {a.texture}</p>}
        {a.preflop && <p className="text-paper-muted">{a.preflop.position}: {a.preflop.cls} is top {fmtPct(a.preflop.percentile, 0)}. {a.preflop.chart}.</p>}
      </section>
      {a.outs.length > 0 && (
        <section>
          <h3 className="text-paper-muted mb-1">Outs ({a.hit?.outs ?? 0})</h3>
          <div className="flex flex-wrap gap-1.5">
            {a.outs.map((o) => (
              <span key={o.card} title={`${o.description}${o.note ? ` — ${o.note}` : ''}`} className={cx('px-1.5 py-0.5 rounded border text-xs', o.kind === 'clean' ? 'border-bid/50' : o.kind === 'dirty' ? 'border-signal/60' : 'border-ask/60 line-through opacity-70')}>
                <CardText card={o.card} />
              </span>
            ))}
          </div>
          <p className="text-xs text-paper-dim mt-1">Green border clean, amber dirty (may still lose), struck-through counterfeit. Hover a card for details.</p>
        </section>
      )}
      <section>
        <h3 className="text-paper-muted mb-1">Probabilities</h3>
        <table className="w-full num">
          <tbody>
            {a.hit && a.hit.outs > 0 && (
              <>
                <tr>
                  <td className="text-paper-muted pr-2">Hit next card</td>
                  <td className="text-right">{fmtPct(a.hit.next)}</td>
                  <td className="text-right text-paper-dim">rule of 2: {fmtPct(a.hit.rule2, 0)}</td>
                </tr>
                {a.hit.byRiver !== null && (
                  <tr>
                    <td className="text-paper-muted pr-2">Hit by river</td>
                    <td className="text-right">{fmtPct(a.hit.byRiver)}</td>
                    <td className="text-right text-paper-dim">rule of 4: {fmtPct(a.hit.rule4!, 0)}</td>
                  </tr>
                )}
              </>
            )}
            <tr>
              <td className="text-paper-muted pr-2">Equity vs range</td>
              <td className="text-right font-semibold">{fmtPct(a.equity.value)}</td>
              <td className="text-right text-paper-dim">
                95% CI {fmtPct(a.equity.lo)}–{fmtPct(a.equity.hi)}, n = {a.equity.n.toLocaleString()}
              </td>
            </tr>
            {a.potOdds !== null && (
              <tr>
                <td className="text-paper-muted pr-2">Equity needed</td>
                <td className="text-right">{fmtPct(a.potOdds)}</td>
                <td className="text-right text-paper-dim">price {(a.pot / a.toCall).toFixed(2)} : 1</td>
              </tr>
            )}
          </tbody>
        </table>
        {a.impliedNeeded !== null && a.impliedNeeded > 0 && <p className="text-xs text-paper-muted mt-1">Implied odds: you need to win about {(a.impliedNeeded / bb).toFixed(1)}bb more on average when you hit to make this call break even.</p>}
        <ul className="mt-2 space-y-0.5">
          {a.ranges.map((r) => (
            <li key={r.seat} className="text-xs text-paper-muted">
              {r.name}: ≈ {fmtPct(r.pct, 0)} of hands, most likely {r.top}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="text-paper-muted mb-1">EV of each option</h3>
        <table className="w-full num">
          <tbody>
            {a.options.map((o) => (
              <tr key={o.label} className={cx(o.ev === best && 'text-signal')}>
                <td className="pr-2">{o.label}</td>
                <td className="text-right">{Number.isFinite(o.ev) ? `${o.ev >= 0 ? '+' : '−'}${Math.abs(o.ev / bb).toFixed(2)} bb` : 'chart'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="border border-ink-line rounded p-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold">{a.recommendation.label}</span>
          <Badge tone={a.recommendation.closeness === 'clear' ? 'pos' : 'info'}>{a.recommendation.closeness === 'clear' ? 'clear' : a.recommendation.closeness === 'close' ? 'close' : 'either is fine'}</Badge>
        </div>
        <ul className="list-disc pl-5 space-y-0.5 text-paper-muted">
          {a.recommendation.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </section>
      <Disclosure summary="Show me the maths">
        <div className="prose-math text-[15px]">
          {a.maths.map((m) => (
            <div key={m.title}>
              <h3>{m.title}</h3>
              <ol>
                {m.lines.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </Disclosure>
    </div>
  );
}

function MistakeLog({ mistakes, onClear }: { mistakes: Mistake[]; onClear: () => void }): JSX.Element {
  const recent = [...mistakes].reverse().slice(0, 12);
  const total = mistakes.reduce((a, m) => a + (m.evLostBB ?? 0), 0);
  return (
    <section className="border-t border-ink-line pt-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium">Mistake log</h3>
        {mistakes.length > 0 && (
          <Button size="sm" variant="ghost" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
      {mistakes.length === 0 ? (
        <p className="text-sm text-paper-dim">Clear deviations from the coach's best option appear here with the estimated EV lost.</p>
      ) : (
        <>
          <p className="text-sm text-paper-muted mb-2">
            {mistakes.length} flagged · ≈ {total.toFixed(1)} bb lost where measurable
          </p>
          <ul className="space-y-2 text-sm">
            {recent.map((m) => (
              <li key={m.id} className="border-l-2 border-ask/60 pl-2">
                <div>
                  <span className="capitalize">{m.street}</span> · {m.hand} {m.board && <span className="text-paper-dim">on {m.board}</span>}
                </div>
                <div className="text-paper-muted">
                  You: {m.did}. Better: {m.best}
                  {m.evLostBB !== null ? ` (−${m.evLostBB.toFixed(1)} bb)` : ''}
                </div>
                <button type="button" className="text-xs text-info hover:underline" onClick={() => navigate(`/poker/review?id=${m.handKey}`)}>
                  Review hand
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
