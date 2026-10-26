import { newClientSeed } from '@/shared/fairness/commit';
import { Button, Field, Panel, PageHeader, Segmented, Toggle } from '../components/core';
import { PlayingCard } from '../components/PlayingCard';
import { useSettings } from '../useSettings';
import { DataPanel } from '../components/DataPanel';

export default function SettingsPage(): JSX.Element {
  const [s, set] = useSettings();
  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" />
      <div className="space-y-6">
        <Panel title="Cards and tables">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <Toggle checked={s.fourColourDeck} onChange={(v) => set({ fourColourDeck: v })} label="Four-colour deck" hint="Clubs green, diamonds blue: suits are never confused at a glance." />
              <div className="flex gap-1.5">
                {[48, 33, 18, 3].map((c) => (
                  <PlayingCard key={c} card={c} size="sm" />
                ))}
              </div>
            </div>
            <Toggle checked={s.showBB} onChange={(v) => set({ showBB: v })} label="Show poker amounts in big blinds" hint="Off shows raw chip counts." />
            <Toggle checked={s.chat} onChange={(v) => set({ chat: v })} label="Table chat" hint="Occasional short reactions from other players. Rare by design." />
            <Field label="Player think-time speed">
              <Segmented
                value={s.speed}
                onChange={(v) => set({ speed: v })}
                options={[
                  { value: 0, label: 'Instant' },
                  { value: 0.4, label: 'Fast' },
                  { value: 1, label: 'Realistic' },
                  { value: 1.6, label: 'Slow' },
                ]}
              />
            </Field>
          </div>
        </Panel>
        <Panel title="Provable fairness">
          <Field label="Your client seed" hint="Mixed into every shuffle together with the committed server seed, so neither side alone decides the deck. Change it any time; it applies from the next hand or shoe.">
            <div className="flex gap-2">
              <input className="input flex-1 font-mono text-sm" value={s.clientSeed} onChange={(e) => set({ clientSeed: e.target.value.slice(0, 64) })} aria-label="Client seed" />
              <Button onClick={() => set({ clientSeed: newClientSeed() })}>Randomise</Button>
            </div>
          </Field>
        </Panel>
        <DataPanel />
      </div>
    </div>
  );
}
