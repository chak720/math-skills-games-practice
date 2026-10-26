import { useEffect, useRef, useState } from 'react';
import { ARCHETYPE_LABEL } from '@/games/poker/bots/personality';
import { hudLine } from '@/games/poker/analysis/stats';
import { LineChart } from '../../components/charts';
import { cx, Segmented, Stat, Toggle } from '../../components/core';
import type { HeroLine, Snapshot } from './session';
import { NOTE_COLORS, useNotes } from './notes';
import { useSettings } from '../../useSettings';

export function heroSummary(lines: readonly HeroLine[]): Record<string, number> {
  const n = lines.length || 1;
  const s = (k: keyof HeroLine): number => lines.reduce((a, l) => a + (l[k] as number), 0);
  const net = s('netBB');
  return {
    hands: lines.length,
    net,
    bb100: (net / n) * 100,
    vpip: s('vpip') / n,
    pfr: s('pfr') / n,
    threeBet: s('threeBet') / Math.max(1, s('threeBetOpp')),
    wtsd: s('wtsd') / Math.max(1, s('sawFlop')),
    wsd: s('wsd') / Math.max(1, s('wtsd')),
  };
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;

export function SessionStats({ lines }: { lines: readonly HeroLine[] }): JSX.Element {
  const h = heroSummary(lines);
  let cum = 0;
  const curve = [0, ...lines.map((l) => (cum += l.netBB))];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Hands" value={h.hands} size="sm" />
        <Stat label="Net" value={`${h.net >= 0 ? '+' : '−'}${Math.abs(h.net).toFixed(1)} bb`} tone={h.net > 0 ? 'pos' : h.net < 0 ? 'neg' : undefined} size="sm" />
        <Stat label="bb/100" value={lines.length ? h.bb100.toFixed(1) : '–'} size="sm" />
        <Stat label="VPIP" value={pct(h.vpip)} size="sm" />
        <Stat label="PFR" value={pct(h.pfr)} size="sm" />
        <Stat label="3-bet" value={pct(h.threeBet)} size="sm" />
        <Stat label="WTSD" value={pct(h.wtsd)} size="sm" />
        <Stat label="W$SD" value={pct(h.wsd)} size="sm" />
      </div>
      {lines.length > 1 ? <LineChart series={[{ name: 'Net bb', values: curve }]} height={150} zeroLine xLabel="hand" yFormat={(v) => v.toFixed(0)} /> : <p className="text-sm text-paper-dim">Your profit graph appears after a couple of hands.</p>}
      {lines.length > 0 && lines.length < 200 && <p className="text-xs text-paper-dim">Small samples: poker win rates need thousands of hands to mean much (σ ≈ 80–100 bb/100).</p>}
    </div>
  );
}

export function PlayersPanel({ snap, hud, setHud, onNotes }: { snap: Snapshot; hud: boolean; setHud: (v: boolean) => void; onNotes: (seat: number) => void }): JSX.Element {
  const [notes] = useNotes();
  return (
    <div className="space-y-3">
      <Toggle checked={hud} onChange={setHud} label="Show HUD" hint="VPIP / PFR / 3-bet under each seat, from hands you've seen." />
      <ul className="divide-y divide-ink-line/60">
        {snap.seats.map((s, i) =>
          s && !s.meta.isHuman ? (
            <li key={i} className="py-2">
              <button type="button" onClick={() => onNotes(i)} className="w-full text-left">
                <div className="flex items-center gap-2">
                  {notes[s.meta.name]?.color && <span className="w-2 h-2 rounded-full" style={{ background: NOTE_COLORS[notes[s.meta.name].color as keyof typeof NOTE_COLORS] }} />}
                  <span className="font-medium">{s.meta.name}</span>
                  {snap.config.difficulty === 'easy' && s.meta.archetype && <span className="text-xs text-paper-dim">{ARCHETYPE_LABEL[s.meta.archetype]}</span>}
                </div>
                {hud && <HudRow snap={snap} playerId={s.meta.playerId} />}
                <p className="text-sm text-paper-muted truncate">{notes[s.meta.name]?.text || 'Add a note…'}</p>
              </button>
            </li>
          ) : null,
        )}
      </ul>
    </div>
  );
}

function HudRow({ snap, playerId }: { snap: Snapshot; playerId: string }): JSX.Element {
  const h = hudLine(snap.hud.get(playerId));
  return (
    <div className="grid grid-cols-5 gap-1 text-xs num text-info my-1">
      {(['VPIP', 'PFR', '3B', 'CB', 'FCB', 'AF', 'WTSD', 'W$SD', 'F3B', 'hands'] as const).map((k) => (
        <span key={k} title={k}>
          <span className="text-paper-dim">{k} </span>
          {h[k]}
        </span>
      ))}
    </div>
  );
}

export function LogPanel({ snap }: { snap: Snapshot }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [snap.log.length]);
  return (
    <div ref={ref} className="max-h-[420px] overflow-y-auto space-y-0.5 text-sm">
      {snap.log.map((l) => (
        <div key={l.id} className={cx(l.kind === 'street' && 'text-paper font-medium mt-2', l.kind === 'result' && 'text-signal', l.kind === 'info' && 'text-paper-dim', l.kind === 'action' && 'text-paper-muted')}>
          {l.text}
        </div>
      ))}
    </div>
  );
}

export function ChatPanel({ snap }: { snap: Snapshot }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [settings, setSettings] = useSettings();
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [snap.chat.length]);
  return (
    <div>
    <div className="mb-3"><Toggle checked={settings.chat} onChange={(v) => setSettings({ chat: v })} label="Table chat" hint="Short, occasional reactions from other players." /></div>
    <div ref={ref} className="max-h-[380px] overflow-y-auto space-y-1 text-sm">
      {snap.chat.map((c) => (
        <div key={c.id} className={c.system ? 'text-paper-dim italic' : ''}>
          {!c.system && <span className="font-medium">{c.name}: </span>}
          {c.text}
        </div>
      ))}
    </div>
    </div>
  );
}

export type SideTab = 'session' | 'players' | 'log' | 'chat';

export function SidePanel({ snap, hud, setHud, onNotes, extraTabs }: { snap: Snapshot; hud: boolean; setHud: (v: boolean) => void; onNotes: (seat: number) => void; extraTabs?: { value: string; label: string; content: JSX.Element }[] }): JSX.Element {
  const [tab, setTab] = useState<string>(extraTabs?.[0]?.value ?? 'session');
  const tabs = [...(extraTabs ?? []).map((t) => ({ value: t.value, label: t.label })), { value: 'session', label: 'Session' }, { value: 'players', label: 'Players' }, { value: 'log', label: 'Log' }, { value: 'chat', label: 'Chat' }];
  return (
    <aside className="panel p-3 h-fit">
      <div className="mb-3 overflow-x-auto">
        <Segmented size="sm" value={tab} onChange={setTab} options={tabs} label="Side panel" />
      </div>
      {extraTabs?.find((t) => t.value === tab)?.content}
      {tab === 'session' && <SessionStats lines={snap.session.lines} />}
      {tab === 'players' && <PlayersPanel snap={snap} hud={hud} setHud={setHud} onNotes={onNotes} />}
      {tab === 'log' && <LogPanel snap={snap} />}
      {tab === 'chat' && <ChatPanel snap={snap} />}
    </aside>
  );
}
