import { lazy, Suspense } from 'react';
import { Shell } from './ui/layout/Shell';
import { useRoute } from './ui/router';
import { SECTIONS } from './ui/sections';
import Placeholder from './ui/pages/Placeholder';

const Home = lazy(() => import('./ui/pages/Home'));
const Fairness = lazy(() => import('./ui/pages/Fairness'));
const Settings = lazy(() => import('./ui/pages/Settings'));
const Poker = lazy(() => import('./ui/sections/poker/PokerPage'));
const Blackjack = lazy(() => import('./ui/sections/blackjack/BlackjackPage'));
const Maths = lazy(() => import('./ui/sections/maths/MathsPage'));
const Puzzles = lazy(() => import('./ui/sections/puzzles/PuzzlesPage'));

/** Pages that want the full width (card tables). */
const WIDE = ['/poker', '/blackjack'];

export default function App(): JSX.Element {
  const { path, segments } = useRoute();
  const root = `/${segments[0] ?? ''}`;
  let page: JSX.Element;
  switch (root) {
    case '/':
      page = <Home />;
      break;
    case '/fairness':
      page = <Fairness />;
      break;
    case '/settings':
      page = <Settings />;
      break;
    case '/poker':
      page = <Poker />;
      break;
    case '/blackjack':
      page = <Blackjack />;
      break;
    case '/maths':
      page = <Maths />;
      break;
    case '/puzzles':
      page = <Puzzles />;
      break;
    default: {
      const s = SECTIONS.find((x) => x.path === root);
      page = <Placeholder title={s?.title ?? 'Not found'} />;
    }
  }
  return (
    <Shell wide={WIDE.some((w) => path.startsWith(w))}>
      <Suspense fallback={<div className="h-40" />}>{page}</Suspense>
    </Shell>
  );
}
