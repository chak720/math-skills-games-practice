/**
 * Today's session: about 20 minutes, built once per day from your leaks,
 * techniques due for review, and the sections you have neglected. Items tick
 * themselves off when activity in that section is logged after the plan was made.
 */
import { load, save } from '@/shared/storage/store';
import { dayKey, getAttempts, getSessions, type SectionId } from '@/shared/stats/activity';
import { getDeck } from '@/shared/srs/srs';
import { allLeaks, type Leak } from './leaks';

export interface PlanItem {
  id: string;
  section: SectionId;
  title: string;
  why: string;
  minutes: number;
  to: string;
  prefs?: { key: string; value: unknown };
}

export interface DailyPlan {
  day: string;
  created: number;
  items: PlanItem[];
}

const ROTATION: { section: SectionId; title: string; minutes: number; to: string; why: string }[] = [
  { section: 'sequences', title: 'Sequence sprint', minutes: 3, to: '/sequences', why: 'Pattern spotting under time pressure.' },
  { section: 'fermi', title: 'Two Fermi estimates', minutes: 5, to: '/fermi', why: 'Keeps your interval calibration honest.' },
  { section: 'market', title: 'One market-making game', minutes: 5, to: '/market', why: 'Quoting around fair value while information arrives.' },
  { section: 'betting', title: 'A Kelly game', minutes: 5, to: '/betting', why: 'Sizing bets by edge and odds.' },
  { section: 'blackjack', title: 'Counting drill', minutes: 3, to: '/blackjack/drill', why: 'Running count at speed.' },
  { section: 'poker', title: 'Ten hands in coach mode', minutes: 6, to: '/poker/coach', why: 'Decisions checked against the equity maths.' },
];

function lastActivity(section: SectionId): number {
  const a = getAttempts(section).at(-1)?.t ?? 0;
  const s = getSessions(section).at(-1)?.t ?? 0;
  return Math.max(a, s);
}

export function buildPlan(now = Date.now(), leaks: Leak[] = allLeaks()): DailyPlan {
  const items: PlanItem[] = [{ id: 'warmup', section: 'maths', title: 'Mental maths warm-up', why: 'Arithmetic speed fades fastest; a short daily set keeps it sharp.', minutes: 3, to: '/maths' }];
  const top = leaks.find((l) => l.section !== 'maths');
  if (top) items.push({ id: `leak:${top.id}`, section: top.section, title: top.action.label, why: `Your biggest leak: ${top.title.charAt(0).toLowerCase()}${top.title.slice(1)}.`, minutes: 5, to: top.action.to, prefs: top.action.prefs });
  const deck = getDeck('puzzles');
  const due = Object.values(deck).filter((c) => c.due <= now).length;
  if (!items.some((i) => i.section === 'puzzles'))
    items.push({
      id: 'puzzles',
      section: 'puzzles',
      title: due ? 'Two puzzles on techniques due for review' : 'Two new puzzles',
      why: due ? `${due} technique${due > 1 ? 's are' : ' is'} due for spaced review.` : 'Fresh, never-repeated problems at your level.',
      minutes: 6,
      to: '/puzzles',
      prefs: due ? { key: 'puzzles.prefs', value: { category: 'any', tier: 'adaptive', focus: 'review', timer: true, interviewer: false } } : undefined,
    });
  // Fill to ~20 minutes with the most neglected sections.
  const used = new Set(items.map((i) => i.section));
  const rotation = ROTATION.filter((r) => !used.has(r.section)).sort((a, b) => lastActivity(a.section) - lastActivity(b.section));
  let total = items.reduce((s, i) => s + i.minutes, 0);
  for (const r of rotation) {
    if (total >= 19) break;
    items.push({ id: `rot:${r.section}`, section: r.section, title: r.title, why: lastActivity(r.section) ? r.why : `${r.why} You have not tried this yet.`, minutes: r.minutes, to: r.to });
    total += r.minutes;
  }
  return { day: dayKey(now), created: now, items };
}

export function todaysPlan(now = Date.now()): DailyPlan {
  const key = `daily.${dayKey(now)}`;
  const existing = load<DailyPlan | null>(key, null);
  if (existing) return existing;
  const plan = buildPlan(now);
  save(key, plan);
  return plan;
}

/** Done once there is activity in the item's section on the plan's day (practice before opening the plan counts too). */
export function isDone(item: PlanItem, plan: DailyPlan): boolean {
  const created = new Date(plan.created);
  const startOfDay = new Date(created.getFullYear(), created.getMonth(), created.getDate()).getTime();
  return lastActivity(item.section) >= startOfDay;
}
