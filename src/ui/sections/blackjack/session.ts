/**
 * Blackjack table session: rounds, bots acting with think times, dealer
 * pacing, hints/accuracy tracking and count checks. React subscribes to it.
 */
import { BJTable, type BJMove, type BJView } from '@/games/blackjack/engine';
import { DEFAULT_RULES, type BJRules, handValue, valueOf } from '@/games/blackjack/rules';
import { chartMove, computeChart, type Chart } from '@/games/blackjack/strategy';
import { botBet, botChat, botInsurance, botMove, randomBot, type BJBotSpec } from '@/games/blackjack/players';
import { deviationFor, runningCount, trueCount } from '@/games/blackjack/counting';
import { Rng } from '@/shared/random/prng';
import { getSettings } from '@/shared/settings';
import { load, save, update } from '@/shared/storage/store';
import { recordAttempt, recordSession } from '@/shared/stats/activity';
import { recordReview } from '@/shared/srs/srs';
import type { FairnessReveal } from '@/shared/fairness/commit';

export interface BJConfig {
  rules: BJRules;
  others: number;
  bankroll: number;
}
export const DEFAULT_BJ_CONFIG: BJConfig = { rules: DEFAULT_RULES, others: 2, bankroll: 1000 };

export interface BJStats {
  hands: number;
  net: number;
  decisions: number;
  correct: number;
  countChecks: number;
  countCorrect: number;
}
const EMPTY_STATS: BJStats = { hands: 0, net: 0, decisions: 0, correct: 0, countChecks: 0, countCorrect: 0 };

export interface Feedback {
  id: number;
  ok: boolean;
  text: string;
}

export interface BJSnapshot {
  config: BJConfig;
  view: BJView;
  heroSeat: number;
  bots: Record<number, BJBotSpec>;
  status: 'betting' | 'insurance' | 'hero' | 'bots' | 'dealer' | 'done' | 'count-check';
  thinking: number | null;
  bet: number;
  feedback: Feedback | null;
  chat: Record<number, string>;
  stats: BJStats;
  commit: string;
  lastReveal: FairnessReveal | null;
  countCheck: null | { kind: 'rc' | 'tc'; answer: number };
  version: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const SEATS = 7;

export class BlackjackSession {
  private table!: BJTable;
  config: BJConfig;
  private bots: Record<number, BJBotSpec> = {};
  private heroSeat = 3;
  private rng = new Rng();
  private listeners = new Set<() => void>();
  private snap!: BJSnapshot;
  private status: BJSnapshot['status'] = 'betting';
  private thinking: number | null = null;
  private bet = 10;
  private feedback: Feedback | null = null;
  private chat: Record<number, string> = {};
  private stats: BJStats;
  private gen = 0;
  private countCheck: BJSnapshot['countCheck'] = null;
  private ids = 1;
  private sessionStart = Date.now();
  private bankrollBefore = 0;
  private sessionHands = 0;
  private sessionNet = 0;
  chart!: Chart;
  /** Hints-on decisions are graded too; the UI sets these. */
  countTraining = false;
  countCheckRate = 0.25;

  constructor() {
    this.config = { ...DEFAULT_BJ_CONFIG, ...load<Partial<BJConfig>>('bj.config', {}) };
    this.stats = { ...EMPTY_STATS, ...load<Partial<BJStats>>('bj.stats', {}) };
    this.setup(this.config);
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = (): BJSnapshot => this.snap;

  private emit(): void {
    this.snap = {
      config: this.config,
      view: this.table.view(this.heroSeat),
      heroSeat: this.heroSeat,
      bots: this.bots,
      status: this.status,
      thinking: this.thinking,
      bet: this.bet,
      feedback: this.feedback,
      chat: { ...this.chat },
      stats: this.stats,
      commit: this.table.commit.commit,
      lastReveal: this.table.lastReveal,
      countCheck: this.countCheck,
      version: (this.snap?.version ?? 0) + 1,
    };
    this.listeners.forEach((f) => f());
  }

  setup(config: BJConfig): void {
    this.gen++;
    this.recordSessionStats();
    this.config = config;
    save('bj.config', config);
    this.chart = computeChart(config.rules);
    this.table = new BJTable(config.rules, SEATS, getSettings().clientSeed);
    this.heroSeat = config.others >= 2 ? 3 : 0;
    const prev = load<number | null>('bj.bankroll', null);
    this.table.sit(this.heroSeat, { id: 'hero', name: 'You', isHuman: true, bankroll: prev ?? config.bankroll });
    this.bots = {};
    const free = Array.from({ length: SEATS }, (_, i) => i).filter((i) => i !== this.heroSeat);
    const taken = new Set<string>();
    for (const s of this.rng.sample(free, Math.min(config.others, free.length))) {
      const b = randomBot(this.rng, taken);
      taken.add(b.name);
      this.bots[s] = b;
      this.table.sit(s, { id: b.id, name: b.name, isHuman: false, bankroll: 1e6 });
    }
    this.status = 'betting';
    this.feedback = null;
    this.emit();
  }

  get hero(): number {
    return this.heroSeat;
  }

  setBet(b: number): void {
    this.bet = Math.max(1, Math.min(500, Math.round(b)));
    this.emit();
  }

  private speed(): number {
    return getSettings().speed;
  }

  /** Deal a round with the hero's current bet. */
  async deal(): Promise<void> {
    if (this.status !== 'betting' && this.status !== 'done') return;
    const g = ++this.gen;
    const heroBank = this.table.seats[this.heroSeat]!.bankroll;
    this.bankrollBefore = heroBank;
    if (heroBank < this.bet) {
      this.feedback = { id: this.ids++, ok: false, text: heroBank <= 0 ? 'Out of chips: reset your bankroll in Table setup.' : `Your bet is larger than your bankroll (${heroBank}).` };
      this.emit();
      return;
    }
    const bets: Record<number, number> = { [this.heroSeat]: this.bet };
    const v0 = this.table.view(this.heroSeat);
    for (const [s, b] of Object.entries(this.bots)) bets[+s] = botBet(b, { ...v0, me: +s }, this.rng, 5);
    const shoeBefore = this.table.shoeNo;
    this.table.startRound(bets, getSettings().clientSeed);
    if (this.table.shoeNo !== shoeBefore) this.feedback = { id: this.ids++, ok: true, text: 'New shoe shuffled. The previous shoe can now be verified.' };
    else this.feedback = null;
    this.chat = {};
    await this.drive(g);
  }

  /** Advance automatically until the hero must act or the round ends. */
  private async drive(g: number): Promise<void> {
    const t = this.table;
    while (g === this.gen) {
      if (t.phase === 'insurance') {
        for (const s of t.insurancePending()) {
          if (s === this.heroSeat) {
            this.status = 'insurance';
            this.emit();
            return;
          }
          t.decideInsurance(s, botInsurance(this.bots[s], { ...t.view(s) }, this.rng));
        }
        continue;
      }
      if (t.phase === 'player' && t.turn) {
        const seat = t.turn.seat;
        if (seat === this.heroSeat) {
          this.status = 'hero';
          this.thinking = null;
          this.emit();
          return;
        }
        this.status = 'bots';
        this.thinking = seat;
        this.emit();
        const bot = this.bots[seat];
        const { move, thinkMs } = botMove(bot, t.view(seat), this.chart, this.rng);
        await sleep(thinkMs * this.speed());
        if (g !== this.gen) return;
        const before = t.seats[seat]!.hands.length;
        t.act(seat, move);
        const h = t.seats[seat]!.hands.at(-1)!;
        const line = move === 'split' && t.seats[seat]!.hands.length > before ? botChat(bot, 'split', this.rng) : handValue(h.cards).total > 21 ? botChat(bot, 'bust', this.rng) : null;
        if (line && getSettings().chat) this.chat[seat] = line;
        this.thinking = null;
        this.emit();
        await sleep(250 * this.speed());
        continue;
      }
      if (t.phase === 'dealer') {
        this.status = 'dealer';
        this.emit();
        await sleep(550 * this.speed());
        while (t.dealerStep()) {
          this.emit();
          await sleep(600 * this.speed());
          if (g !== this.gen) return;
        }
        t.finishDealer();
      }
      if (t.phase === 'done') {
        this.roundOver();
        return;
      }
    }
  }

  private roundOver(): void {
    const t = this.table;
    const hero = t.seats[this.heroSeat]!;
    const net = hero.bankroll - this.bankrollBefore;
    this.stats = { ...this.stats, hands: this.stats.hands + 1, net: this.stats.net + net };
    save('bj.stats', this.stats);
    save('bj.bankroll', hero.bankroll);
    this.sessionHands++;
    this.sessionNet += net;
    if (this.sessionHands >= 30) this.recordSessionStats();
    const dealerBJ = t.dealer.length === 2 && handValue(t.dealer).total === 21;
    const dealerBust = handValue(t.dealer).total > 21;
    for (const [s, b] of Object.entries(this.bots)) {
      const line = botChat(b, dealerBJ ? 'dealerBJ' : dealerBust ? 'dealerBust' : t.seats[+s]!.hands.some((h) => h.result === 'blackjack') ? 'blackjack' : 'bust', this.rng);
      if (line && getSettings().chat && (dealerBJ || dealerBust || this.rng.chance(0.3))) {
        this.chat[+s] = line;
        break;
      }
    }
    this.status = 'done';
    if (this.countTraining && this.rng.chance(this.countCheckRate)) {
      const rc = runningCount(t.seen);
      const kind = this.rng.chance(0.65) ? 'rc' : 'tc';
      this.countCheck = { kind, answer: kind === 'rc' ? rc : Math.round(trueCount(rc, t.cardsRemaining) * 2) / 2 };
      this.status = 'count-check';
    }
    this.emit();
  }

  answerCountCheck(x: number): boolean {
    if (!this.countCheck) return false;
    const ok = this.countCheck.kind === 'rc' ? x === this.countCheck.answer : Math.abs(x - this.countCheck.answer) <= 0.5;
    this.stats = { ...this.stats, countChecks: this.stats.countChecks + 1, countCorrect: this.stats.countCorrect + (ok ? 1 : 0) };
    save('bj.stats', this.stats);
    recordAttempt({ section: 'blackjack', skill: this.countCheck.kind === 'rc' ? 'running-count' : 'true-count', correct: ok });
    recordReview('blackjack', this.countCheck.kind === 'rc' ? 'running-count' : 'true-count', ok ? 4 : 1);
    this.feedback = { id: this.ids++, ok, text: ok ? `Correct: ${this.countCheck.kind === 'rc' ? 'running' : 'true'} count ${this.countCheck.answer}.` : `The ${this.countCheck.kind === 'rc' ? 'running' : 'true'} count was ${this.countCheck.answer} (you said ${x}).` };
    this.countCheck = null;
    this.status = 'done';
    this.emit();
    return ok;
  }

  skipCountCheck(): void {
    this.countCheck = null;
    this.status = 'done';
    this.emit();
  }

  heroInsurance(take: boolean): void {
    if (this.status !== 'insurance') return;
    const v = this.table.view(this.heroSeat);
    const tc = trueCount(runningCount(v.seen), v.cardsRemaining);
    const right = this.countTraining ? take === tc >= 3 : !take;
    this.grade(right, right ? (take ? `Insurance is +EV at true count ${tc.toFixed(1)} (≥ 3).` : 'Declining insurance is right: it is a side bet that the hole card is a ten, and it loses money unless the shoe is ten-rich.') : take ? 'Basic strategy never takes insurance: it pays 2:1 on a ten, but fewer than 1 in 3 unseen cards are tens.' : `At true count ${tc.toFixed(1)} insurance is profitable (index +3).`, 'insurance');
    this.table.decideInsurance(this.heroSeat, take);
    void this.drive(this.gen);
  }

  /** Hero action with basic-strategy (and optional count deviation) grading. */
  heroAct(move: BJMove): void {
    if (this.status !== 'hero') return;
    const v = this.table.view(this.heroSeat);
    const L = v.legal!;
    if (!L[move]) return;
    const h = v.seats[this.heroSeat]!.hands[v.turn!.hand];
    const values = h.cards.map(valueOf);
    const up = valueOf(v.dealerUp!);
    const basic = chartMove(this.chart, { values, up, canDouble: L.double, canSplit: L.split, canSurrender: L.surrender });
    let correct = basic.move;
    let devNote = '';
    if (this.countTraining) {
      const hv = handValue(h.cards);
      const tc = trueCount(runningCount(v.seen), v.cardsRemaining);
      const dev = deviationFor({ hardTotal: hv.soft ? null : hv.total, pairOf: values.length === 2 && values[0] === values[1] ? values[0] : null, up, tc, canDouble: L.double, canSplit: L.split, canSurrender: L.surrender });
      if (dev && dev.move !== 'insure') {
        correct = dev.move as BJMove;
        devNote = ` (count deviation ${dev.label}: index ${dev.index > 0 ? '+' : ''}${dev.index}, true count ${tc.toFixed(1)})`;
      }
    }
    const ok = move === correct;
    const label = { hit: 'hit', stand: 'stand', double: 'double', split: 'split', surrender: 'surrender' };
    this.grade(ok, ok ? `Correct: ${label[move]}${devNote}.` : `Basic strategy says ${label[correct]}${devNote}; you chose ${label[move]}.`, `${basic.row}v${up}`);
    this.table.act(this.heroSeat, move);
    void this.drive(this.gen);
  }

  private grade(ok: boolean, text: string, skill: string): void {
    this.stats = { ...this.stats, decisions: this.stats.decisions + 1, correct: this.stats.correct + (ok ? 1 : 0) };
    save('bj.stats', this.stats);
    recordAttempt({ section: 'blackjack', skill: `bs-${skill}`, correct: ok });
    if (!ok) update<string[]>('bj.misses', [], (xs) => [...xs.slice(-299), skill]);
    this.feedback = { id: this.ids++, ok, text };
  }

  /** End the current shoe now and reveal it for verification. */
  shuffleNow(): void {
    if (this.status !== 'betting' && this.status !== 'done') return;
    this.table.newShoe(getSettings().clientSeed);
    this.feedback = { id: this.ids++, ok: true, text: 'Shoe ended and revealed. A new committed shoe is in play.' };
    this.emit();
  }

  resetBankroll(): void {
    this.table.seats[this.heroSeat]!.bankroll = this.config.bankroll;
    save('bj.bankroll', this.config.bankroll);
    this.emit();
  }

  resetStats(): void {
    this.stats = { ...EMPTY_STATS };
    save('bj.stats', this.stats);
    this.emit();
  }

  stop(): void {
    this.gen++;
  }

  resume(): void {
    // If we were mid-round (e.g. navigated away during bots' turns), continue.
    const g = ++this.gen;
    if (this.table.phase === 'player' || this.table.phase === 'dealer' || this.table.phase === 'insurance') void this.drive(g);
  }

  recordSessionStats(): void {
    if (!this.sessionHands) return;
    recordSession({ section: 'blackjack', mode: 'play', durationMs: Date.now() - this.sessionStart, score: this.sessionNet, total: this.sessionHands, summary: { accuracy: this.stats.decisions ? this.stats.correct / this.stats.decisions : 0 } });
    this.sessionHands = 0;
    this.sessionNet = 0;
    this.sessionStart = Date.now();
  }
}

let session: BlackjackSession | null = null;
export const getBJSession = (): BlackjackSession => (session ??= new BlackjackSession());
