import { useEffect, useState } from 'react';
import type { Card } from '@/shared/cards/card';
import { type FairnessReveal, verifyReveal, type VerifyReport } from '@/shared/fairness/commit';
import { Badge, Button, cx } from './core';
import { PlayingCard } from './PlayingCard';

export function CommitChip({ commit, label = 'Deck committed' }: { commit: string; label?: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={`SHA-256 commitment to this deal's seed:\n${commit}\nThe seed is revealed afterwards so you can verify the deck was fixed in advance.`}
      onClick={() => {
        void navigator.clipboard?.writeText(commit);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="inline-flex items-center gap-2 h-7 px-2 rounded border border-ink-line text-xs text-paper-muted hover:text-paper hover:border-ink-strong"
    >
      <svg width="12" height="12" viewBox="0 0 20 20" aria-hidden>
        <path d="M10 2.5 16 5v4.5c0 3.6-2.6 6.6-6 8-3.4-1.4-6-4.4-6-8V5z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
      <span>{copied ? 'Hash copied' : label}</span>
      <span className="font-mono text-paper-dim">{commit.slice(0, 10)}…</span>
    </button>
  );
}

/**
 * Verifies a reveal and shows the evidence: hash check, recomputed order,
 * and every observed card against its deck position.
 */
export function VerifyPanel({
  reveal,
  observed,
  observedPositions,
  positionLabel,
}: {
  reveal: FairnessReveal;
  observed?: readonly Card[];
  observedPositions?: readonly number[];
  positionLabel?: (pos: number) => string | undefined;
}): JSX.Element {
  const [report, setReport] = useState<VerifyReport | null>(null);
  useEffect(() => {
    let live = true;
    setReport(null);
    void verifyReveal(reveal, observed ?? reveal.dealt, observedPositions).then((r) => live && setReport(r));
    return () => {
      live = false;
    };
  }, [reveal, observed, observedPositions]);
  const dealtSet = new Set(observedPositions ?? (observed ?? reveal.dealt).map((_, i) => i));
  const download = (): void => {
    const blob = new Blob([JSON.stringify(reveal, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `reveal-${reveal.commit.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-2 text-sm">
        <Row k="Commit (shown before dealing)" v={reveal.commit} />
        <Row k="Server seed (revealed now)" v={reveal.serverSeed} />
        <Row k="Client seed / nonce" v={`${reveal.clientSeed} / ${reveal.nonce}`} />
      </div>
      {report ? (
        <ul className="space-y-1.5">
          <Check ok={report.hashOk} text="SHA-256 of the server seed equals the commitment" />
          {report.webCryptoOk !== null && <Check ok={report.webCryptoOk} text="Browser WebCrypto computes the same hash" />}
          <Check ok={report.orderOk} text={`Seed reproduces the revealed ${reveal.order.length}-card order`} />
          <Check ok={report.dealtOk} text={`Every dealt card matches its deck position (${dealtSet.size} checked)`} />
        </ul>
      ) : (
        <p className="text-paper-muted text-sm">Verifying…</p>
      )}
      {report && (
        <div className="flex items-center gap-3">
          <Badge tone={report.ok ? 'pos' : 'neg'}>{report.ok ? 'Verified' : 'Verification failed'}</Badge>
          <Button size="sm" onClick={download}>
            Download reveal JSON
          </Button>
        </div>
      )}
      {reveal.order.length <= 52 && (
        <div>
          <p className="text-sm text-paper-muted mb-2">Deck order, top first. Dealt positions are outlined.</p>
          <div className="flex flex-wrap gap-1.5">
            {reveal.order.map((c, i) => (
              <div key={i} className={cx('flex flex-col items-center gap-0.5 rounded p-0.5', dealtSet.has(i) && 'outline outline-1 outline-signal/70')} title={positionLabel?.(i)}>
                <PlayingCard card={c} size="xs" dim={!dealtSet.has(i)} />
                <span className="text-[10px] text-paper-dim num">{i + 1}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }): JSX.Element {
  return (
    <div className="grid sm:grid-cols-[220px_1fr] gap-1">
      <span className="text-paper-muted">{k}</span>
      <code className="font-mono text-xs break-all text-paper">{v}</code>
    </div>
  );
}

function Check({ ok, text }: { ok: boolean; text: string }): JSX.Element {
  return (
    <li className="flex items-start gap-2">
      <span className={cx('mt-0.5 inline-flex w-4 h-4 rounded-full items-center justify-center text-[10px] font-bold', ok ? 'bg-bid text-ink' : 'bg-ask text-white')} aria-label={ok ? 'pass' : 'fail'}>
        {ok ? '✓' : '✕'}
      </span>
      <span>{text}</span>
    </li>
  );
}
