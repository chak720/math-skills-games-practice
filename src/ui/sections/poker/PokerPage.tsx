import { lazy, Suspense } from 'react';
import { Tabs } from '../../components/core';
import { navigate, useRoute } from '../../router';
import { PlayView } from './PlayView';

const TABS = [
  { value: 'play', label: 'Play' },
  { value: 'coach', label: 'Coach' },
  { value: 'review', label: 'Hand review' },
  { value: 'equity', label: 'Equity calculator' },
  { value: 'learn', label: 'Learn' },
  { value: 'drills', label: 'Drills' },
] as const;
type Tab = (typeof TABS)[number]['value'];

const Pending = ({ what }: { what: string }): JSX.Element => <p className="text-paper-muted">{what} arrives in the next build phase.</p>;

export default function PokerPage(): JSX.Element {
  const { segments } = useRoute();
  const tab = (TABS.find((t) => t.value === segments[1])?.value ?? 'play') as Tab;
  return (
    <div>
      <div className="flex items-end justify-between gap-4 mb-2">
        <h1 className="text-2xl">Poker</h1>
      </div>
      <Tabs value={tab} onChange={(v) => navigate(v === 'play' ? '/poker' : `/poker/${v}`)} tabs={TABS} />
      <Suspense fallback={<div className="h-40" />}>
        {tab === 'play' && <PlayView mode="play" />}
        {tab === 'coach' && <Pending what="Coach mode" />}
        {tab === 'review' && <Pending what="Hand review" />}
        {tab === 'equity' && <Pending what="The equity calculator" />}
        {tab === 'learn' && <Pending what="Lessons" />}
        {tab === 'drills' && <Pending what="Drills" />}
      </Suspense>
    </div>
  );
}

export { lazy };
