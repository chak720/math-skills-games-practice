import type { IconName } from './components/icons';
import type { SectionId } from '@/shared/stats/activity';

export interface SectionDef {
  id: SectionId | 'progress';
  title: string;
  path: string;
  icon: IconName;
  group: 'Tables' | 'Speed' | 'Reasoning' | 'Trading' | 'Simulate' | 'Review';
  blurb: string;
}

export const SECTIONS: SectionDef[] = [
  { id: 'poker', title: 'Poker', path: '/poker', icon: 'poker', group: 'Tables', blurb: 'No-limit hold’em against human-like bots, with a coach that shows the maths.' },
  { id: 'blackjack', title: 'Blackjack', path: '/blackjack', icon: 'blackjack', group: 'Tables', blurb: 'Basic strategy, exact EV per option, and a Hi-Lo counting trainer.' },
  { id: 'maths', title: 'Mental maths', path: '/maths', icon: 'maths', group: 'Speed', blurb: 'Speed arithmetic, 80-in-8, fractions, estimation and trading maths.' },
  { id: 'sequences', title: 'Sequences', path: '/sequences', icon: 'sequences', group: 'Speed', blurb: 'Timed numerical reasoning with one verified rule per sequence.' },
  { id: 'puzzles', title: 'Puzzles', path: '/puzzles', icon: 'puzzles', group: 'Reasoning', blurb: 'Generated probability, combinatorics, EV and logic problems that never repeat.' },
  { id: 'fermi', title: 'Fermi estimation', path: '/fermi', icon: 'fermi', group: 'Reasoning', blurb: 'Structured estimates with 90% intervals, scored on calibration.' },
  { id: 'market', title: 'Market making', path: '/market', icon: 'market', group: 'Trading', blurb: 'Quote two-way prices on hidden quantities against informed and noise traders.' },
  { id: 'betting', title: 'Betting & sizing', path: '/betting', icon: 'betting', group: 'Trading', blurb: 'Bet a bankroll on known edges and compare with Kelly.' },
  { id: 'interview', title: 'Interview simulator', path: '/interview', icon: 'interview', group: 'Simulate', blurb: 'Timed mixed rounds in the style of trading-firm screens.' },
  { id: 'progress', title: 'Progress', path: '/progress', icon: 'progress', group: 'Review', blurb: 'Trends, leaks and a daily plan built from your weakest areas.' },
];

export const GROUPS = ['Tables', 'Speed', 'Reasoning', 'Trading', 'Simulate', 'Review'] as const;
