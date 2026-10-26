import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react';
import { cardToString } from '@/shared/cards/card';
import { ARCHETYPE_BLURB, ARCHETYPE_LABEL, type Difficulty } from '@/games/poker/bots/personality';
import { Badge, Button, Field, Modal, Segmented, Toggle } from '../../components/core';
import { CommitChip, VerifyPanel } from '../../components/Fairness';
import { useHotkeys, usePersistent } from '../../hooks';
import { navigate } from '../../router';
import { useSettings } from '../../useSettings';
import { ActionBar } from './ActionBar';
import { NOTE_COLORS, type NoteColor, useNotes } from './notes';
import { type Mode, type SessionConfig, type StoredHand, getSession } from './session';
import { SidePanel } from './SidePanel';
import { TableView } from './TableView';

export function usePokerSession(mode: Mode) {
  const session = getSession(mode);
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => {
    session.start();
    const onHide = (): void => session.recordSessionStats();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      session.stop();
    };
  }, [session]);
  return { session, snap };
}

function useCompact(): boolean {
  const [c, setC] = useState(() => typeof window !== 'undefined' && window.innerWidth < 720);
  useEffect(() => {
    const on = (): void => setC(window.innerWidth < 720);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return c;
}

export function PlayView({
  mode,
  coach,
  beforeAct,
}: {
  mode: Mode;
  /** Extra side-panel tab (coach). */
  coach?: { label: string; content: (ctx: ReturnType<typeof usePokerSession>) => ReactNode };
  /** Intercept the hero's action (coach quiz mode). Return false to block. */
  beforeAct?: () => boolean;
}): JSX.Element {
  const ctx = usePokerSession(mode);
  const { session, snap } = ctx;
  const [settings, setSettings] = useSettings();
  const [hud, setHud] = usePersistent('poker.hud', false);
  const compact = useCompact();
  const [notesSeat, setNotesSeat] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [verify, setVerify] = useState<StoredHand | null>(null);

  const handOver = snap.status === 'hand-over';
  const heroFolded = snap.view?.seats.find((s) => s.seat === snap.heroSeat)?.folded ?? true;
  const heroShown = !!snap.view?.seats.find((s) => s.seat === snap.heroSeat)?.shown;
  useHotkeys({ ' ': () => handOver && session.nextHand(), n: () => handOver && session.nextHand() }, handOver);

  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr)_340px] gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          {snap.commit && <CommitChip commit={snap.commit} />}
          <span className="text-sm text-paper-dim">
            {snap.config.maxSeats}-max · {snap.config.difficulty} · blinds {snap.config.sb}/{snap.config.bb}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Segmented
              size="sm"
              label="Speed"
              value={settings.speed}
              onChange={(v) => setSettings({ speed: v })}
              options={[
                { value: 0, label: 'Instant' },
                { value: 0.4, label: 'Fast' },
                { value: 1, label: 'Real' },
              ]}
            />
            <Button size="sm" onClick={() => setShowSettings(true)}>
              Table setup
            </Button>
          </div>
        </div>
        <TableView snap={snap} showBB={settings.showBB} hud={hud} onSeatClick={(s) => s !== snap.heroSeat && setNotesSeat(s)} compact={compact} />
        {snap.status === 'busted' ? (
          <div className="flex flex-col items-center gap-3 pt-10 pb-6">
            <p>You're out of chips.</p>
            <Button variant="primary" onClick={() => session.rebuy()}>
              Rebuy {snap.config.startingBB} bb
            </Button>
          </div>
        ) : handOver ? (
          <div className="flex flex-wrap items-center justify-center gap-2 pt-8 pb-4 min-h-[104px]">
            <Button variant="primary" onClick={() => session.nextHand()} kbd="N">
              Next hand
            </Button>
            {!heroFolded && !heroShown && (
              <Button onClick={() => session.heroShow()}>Show my cards</Button>
            )}
            {snap.last && (
              <>
                <Button onClick={() => setVerify(snap.last)}>Verify deck</Button>
                <Button variant="ghost" onClick={() => navigate(`/poker/review?id=${snap.last!.id}`)}>
                  Review hand
                </Button>
              </>
            )}
          </div>
        ) : (
          <ActionBar
            view={snap.view}
            active={snap.status === 'hero-turn'}
            showBB={settings.showBB}
            onAct={(a) => {
              if (beforeAct && !beforeAct()) return;
              session.heroAct(a);
            }}
          />
        )}
      </div>
      <SidePanel
        snap={snap}
        hud={hud}
        setHud={setHud}
        onNotes={setNotesSeat}
        extraTabs={coach ? [{ value: 'coach', label: coach.label, content: <>{coach.content(ctx)}</> }] : undefined}
      />
      <NotesModal seat={notesSeat} snap={snap} onClose={() => setNotesSeat(null)} />
      <TableSettingsModal open={showSettings} config={snap.config} onClose={() => setShowSettings(false)} onApply={(c) => session.newTable(c)} />
      <Modal open={!!verify} onClose={() => setVerify(null)} title={`Verify hand #${verify?.record.history.handId ?? ''}`} wide>
        {verify && (
          <VerifyPanel
            reveal={verify.record.reveal}
            observed={verify.record.history.dealt.map((d) => d.card)}
            positionLabel={(i) => {
              const d = verify.record.history.dealt[i];
              if (!d) return 'not dealt';
              return d.kind === 'hole' ? `hole card: ${verify.names[d.seat!]?.name}` : d.kind === 'burn' ? 'burn card' : `board ${cardToString(d.card)}`;
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function NotesModal({ seat, snap, onClose }: { seat: number | null; snap: ReturnType<typeof getSession>['getSnapshot'] extends () => infer S ? S : never; onClose: () => void }): JSX.Element {
  const [notes, setNote] = useNotes();
  const meta = seat !== null ? snap.seats[seat]?.meta : undefined;
  const existing = meta ? notes[meta.name] : undefined;
  const [text, setText] = useState('');
  const [color, setColor] = useState<NoteColor>('');
  useEffect(() => {
    setText(existing?.text ?? '');
    setColor(existing?.color ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seat]);
  return (
    <Modal open={seat !== null && !!meta} onClose={onClose} title={meta ? `Notes on ${meta.name}` : ''}>
      {meta && (
        <div className="space-y-4">
          {snap.config.difficulty === 'easy' && meta.archetype && (
            <p className="text-sm text-paper-muted">
              <Badge tone="info">{ARCHETYPE_LABEL[meta.archetype]}</Badge> {ARCHETYPE_BLURB[meta.archetype]}
            </p>
          )}
          <Field label="Colour tag">
            <div className="flex gap-2">
              {(['', 'red', 'amber', 'green', 'blue'] as NoteColor[]).map((c) => (
                <button
                  key={c || 'none'}
                  type="button"
                  aria-label={c || 'no tag'}
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full border-2 ${color === c ? 'border-paper' : 'border-transparent'}`}
                  style={{ background: c ? NOTE_COLORS[c] : '#243146' }}
                />
              ))}
            </div>
          </Field>
          <Field label="Note" hint="Saved on this device and shown whenever this player sits at your table.">
            <textarea className="input w-full h-28" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. folds to 3-bets a lot; overbets only with the nuts" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setNote(meta.name, { text, color, updated: Date.now() });
                onClose();
              }}
            >
              Save note
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function TableSettingsModal({ open, config, onClose, onApply }: { open: boolean; config: SessionConfig; onClose: () => void; onApply: (c: SessionConfig) => void }): JSX.Element {
  const [c, setC] = useState(config);
  useEffect(() => setC(config), [config, open]);
  return (
    <Modal open={open} onClose={onClose} title="Table setup">
      <div className="space-y-5">
        <Field label="Players">
          <Segmented value={c.maxSeats} onChange={(v) => setC({ ...c, maxSeats: v })} options={[2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ value: n, label: String(n) }))} />
        </Field>
        <Field label="Difficulty" hint="Easy: exploitable players with visible styles. Hard: solid, adaptive regulars with hidden styles.">
          <Segmented<Difficulty>
            value={c.difficulty}
            onChange={(v) => setC({ ...c, difficulty: v })}
            options={[
              { value: 'easy', label: 'Easy' },
              { value: 'medium', label: 'Medium' },
              { value: 'hard', label: 'Hard' },
            ]}
          />
        </Field>
        <Field label="Blinds (chips)">
          <Segmented
            value={c.bb}
            onChange={(bb) => setC({ ...c, bb, sb: bb / 2 })}
            options={[
              { value: 10, label: '5/10' },
              { value: 20, label: '10/20' },
              { value: 50, label: '25/50' },
            ]}
          />
        </Field>
        <Field label="Starting stack">
          <Segmented
            value={c.startingBB}
            onChange={(v) => setC({ ...c, startingBB: v })}
            options={[
              { value: 40, label: '40 bb' },
              { value: 100, label: '100 bb' },
              { value: 200, label: '200 bb' },
            ]}
          />
        </Field>
        <p className="text-sm text-paper-muted">Starting a new table ends the current one.</p>
        <div className="flex justify-end gap-2">
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
    </Modal>
  );
}

export { Toggle };
