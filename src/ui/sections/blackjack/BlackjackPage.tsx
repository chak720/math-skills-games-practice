import { Tabs } from '../../components/core';
import { navigate, useRoute } from '../../router';
import { ChartView } from './ChartView';
import { CountDrill } from './CountDrill';
import { LearnBJ } from './LearnBJ';
import { PlayBJ } from './PlayBJ';

const TABS = [
  { value: 'play', label: 'Play' },
  { value: 'drill', label: 'Counting drill' },
  { value: 'chart', label: 'Strategy chart' },
  { value: 'learn', label: 'Learn' },
] as const;

export default function BlackjackPage(): JSX.Element {
  const { segments } = useRoute();
  const tab = TABS.find((t) => t.value === segments[1])?.value ?? 'play';
  return (
    <div>
      <h1 className="text-2xl mb-2">Blackjack</h1>
      <Tabs value={tab} onChange={(v) => navigate(v === 'play' ? '/blackjack' : `/blackjack/${v}`)} tabs={TABS} />
      {tab === 'play' && <PlayBJ />}
      {tab === 'drill' && <CountDrill />}
      {tab === 'chart' && <ChartView />}
      {tab === 'learn' && <LearnBJ />}
    </div>
  );
}
