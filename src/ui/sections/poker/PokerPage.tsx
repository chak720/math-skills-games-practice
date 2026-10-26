import { lazy, Suspense } from 'react';
import { Tabs } from '../../components/core';
import { navigate, useRoute } from '../../router';
import { PlayPage } from './PlayView';
import { CoachView } from './CoachView';
import { ReviewView } from './ReviewView';
import { EquityCalc } from './EquityCalc';
import { DrillsView } from './DrillsView';
import { LearnView } from './LearnView';

const TABS = [
  { value: 'play', label: 'Play' },
  { value: 'coach', label: 'Coach' },
  { value: 'review', label: 'Hand review' },
  { value: 'equity', label: 'Equity calculator' },
  { value: 'learn', label: 'Learn' },
  { value: 'drills', label: 'Drills' },
] as const;
type Tab = (typeof TABS)[number]['value'];

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
        {tab === 'play' && <PlayPage />}
        {tab === 'coach' && <CoachView />}
        {tab === 'review' && <ReviewView />}
        {tab === 'equity' && <EquityCalc />}
        {tab === 'learn' && <LearnView />}
        {tab === 'drills' && <DrillsView />}
      </Suspense>
    </div>
  );
}

export { lazy };
