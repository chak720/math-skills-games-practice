/**
 * Poker table session: the "dealer" that drives the engine, asks the bot
 * worker for decisions (passing only each bot's PlayerView), paces think
 * times, settles hands, persists history, and runs table dynamics (bots
 * leaving, joining, rebuying, chatting). React subscribes via
 * useSyncExternalStore; nothing here depends on React.
 */
import { Table, type HandRecord } from '@/games/poker/engine/table';
import type { PlayerAction, PlayerView } from '@/games/poker/engine/types';
import { legalize } from '@/games/poker/bots/legalize';
import { pickPoolPlayer, personalityFor, type Archetype, type Difficulty, POOL } from '@/games/poker/bots/personality';
import { extractStats, StatsTracker, type HandStatLine } from '@/games/poker/analysis/stats';
import { positionOf } from '@/games/poker/ranges/inference';
import { botsWorker } from '@/workers/clients';
import { Rng } from '@/shared/random/prng';
import { getSettings } from '@/shared/settings';
import { load, save, update } from '@/shared/storage/store';
import { recordSession } from '@/shared/stats/activity';
import { actionLabel, actionSentence, boardLabel, fmtAmt } from './format';

export type Mode = 'play' | 'coach';
export type Status = 'idle' | 'bot-thinking' | 'hero-turn' | 'animating' | 'hand-over' | 'busted';

export interface SessionConfig {
  maxSeats: number;
  sb: number;
  bb: number;
  startingBB: number;
  difficulty: Difficulty;
}

export const DEFAULT_CONFIG: SessionConfig = { maxSeats: 6, sb: 5, bb: 10, startingBB: 100, difficulty: 'medium' };

export interface SeatMeta {
  playerId: string;
  name: string;
  hue: number;
  isHuman: boolean;
  archetype?: Archetype;
  botId?: string;
}

export interface ChatMsg {
  id: number;
  name: string;
  text: string;
  system?: boolean;
}

export interface LogLine {
  id: number;
  text: string;
  kind: 'action' | 'street' | 'result' | 'info';
}

/** Compact per-hand record of the hero's play, for long-term stats and leaks. */
export interface HeroLine extends HandStatLine {
  t: number;
  netBB: number;
  pos: string;
  /** In the BB facing a single late-position steal, with no callers. */
  bbStealOpp: number;
  bbStealFold: number;
  mode: Mode;
}

export interface StoredHand {
  id: string;
  t: number;
  mode: Mode;
  heroSeat: number;
  names: Record<number, { name: string; archetype?: Archetype; isHuman: boolean }>;
  record: HandRecord;
  heroNetBB: number;
  maxSeats?: number;
  /** Coach mistake notes attached in coach mode (Phase 4). */
  coach?: unknown[];
}

export interface Snapshot {
  mode: Mode;
  config: SessionConfig;
  status: Status;
  view: PlayerView | null;
  seats: ({ meta: SeatMeta; stack: number } | null)[];
  heroSeat: number;
  thinking: number | null;
  bubbles: Record<number, string>;
  chatBubbles: Record<number, string>;
  chat: ChatMsg[];
  log: LogLine[];
  commit: string | null;
  last: StoredHand | null;
  session: { hands: number; netBB: number[]; lines: HeroLine[] };
  hud: StatsTracker;
  version: number;
}

const HERO_SEAT = 0;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class PokerSession {
  readonly mode: Mode;
  private config: SessionConfig;
  private table!: Table;
  private meta: (SeatMeta | null)[] = [];
  private rng = new Rng();
  private gen = 0;
  private running = false;
  private heroResolve: ((a: PlayerAction) => void) | null = null;
  private nextResolve: (() => void) | null = null;
  private listeners = new Set<() => void>();
  private snap!: Snapshot;
  private status: Status = 'idle';
  private thinking: number | null = null;
  private bubbles: Record<number, string> = {};
  private chatBubbles: Record<number, string> = {};
  private chat: ChatMsg[] = [];
  private log: LogLine[] = [];
  private lastStored: StoredHand | null = null;
  private sessionNet: number[] = [];
  private sessionLines: HeroLine[] = [];
  private hud = new StatsTracker();
  private ids = 1;
  private version = 0;
  private sessionId = Math.random().toString(36).slice(2, 8);
  private lastChatHand = -10;
  private pendingObserve: PlayerView | null = null;
  /** Called after each hand is stored (coach attaches notes). */
  onHandStored: ((h: StoredHand) => void) | null = null;

  constructor(mode: Mode) {
    this.mode = mode;
    this.config = { ...DEFAULT_CONFIG, ...load<Partial<SessionConfig>>(`poker.config.${mode}`, {}) };
    this.newTable(this.config);
  }

  // ------------------------------------------------------------ store plumbing

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): Snapshot => this.snap;

  private emit(): void {
    const h = this.table.current;
    this.snap = {
      mode: this.mode,
      config: this.config,
      status: this.status,
      view: h ? h.viewFor(HERO_SEAT) : null,
      seats: this.table.seats.map((o, i) => (o && this.meta[i] ? { meta: this.meta[i]!, stack: o.stack } : null)),
      heroSeat: HERO_SEAT,
      thinking: this.thinking,
      bubbles: { ...this.bubbles },
      chatBubbles: { ...this.chatBubbles },
      chat: this.chat,
      log: this.log,
      commit: this.table.commit?.commit ?? null,
      last: this.lastStored,
      session: { hands: this.sessionNet.length, netBB: this.sessionNet, lines: this.sessionLines },
      hud: this.hud,
      version: ++this.version,
    };
    this.listeners.forEach((f) => f());
  }

  // ------------------------------------------------------------ table setup

  newTable(config: SessionConfig): void {
    this.stop();
    this.recordSessionStats();
    this.config = config;
    save(`poker.config.${this.mode}`, config);
    this.table = new Table({ maxSeats: config.maxSeats, sb: config.sb, bb: config.bb, ante: 0, startingStack: config.bb * config.startingBB });
    for (const m of this.meta) if (m?.botId) void botsWorker.call('remove', { botId: m.botId });
    this.meta = new Array(config.maxSeats).fill(null);
    this.table.sit(HERO_SEAT, { playerId: 'hero', name: 'You', stack: config.bb * config.startingBB, isHuman: true });
    this.meta[HERO_SEAT] = { playerId: 'hero', name: 'You', hue: 210, isHuman: true };
    for (let s = 1; s < config.maxSeats; s++) this.seatBot(s, false);
    this.chat = [{ id: this.ids++, name: '', text: `New ${config.maxSeats}-max table, blinds ${config.sb}/${config.bb}, ${config.difficulty} difficulty`, system: true }];
    this.log = [];
    this.lastStored = null;
    this.sessionNet = [];
    this.sessionLines = [];
    this.recordedUpTo = 0;
    this.recordedAt = Date.now();
    this.hud = new StatsTracker();
    this.sessionId = Math.random().toString(36).slice(2, 8);
    this.status = 'idle';
    this.emit();
  }

  private seatBot(seat: number, announce: boolean): void {
    const exclude = new Set(this.meta.filter(Boolean).map((m) => m!.playerId));
    const p = pickPoolPlayer(this.config.difficulty, exclude, this.rng) ?? POOL[this.rng.int(POOL.length)];
    const pers = personalityFor(p.archetype, p.playerId);
    const [lo, hi] = pers.buyInBB;
    const stack = this.config.bb * Math.round(lo + this.rng.next() * (hi - lo));
    const botId = `${this.sessionId}-${seat}-${this.ids++}`;
    this.table.sit(seat, { playerId: p.playerId, name: p.name, stack, isHuman: false });
    this.meta[seat] = { playerId: p.playerId, name: p.name, hue: p.hue, isHuman: false, archetype: p.archetype, botId };
    void botsWorker.call('spawn', { spec: { botId, playerId: p.playerId, name: p.name, archetype: p.archetype, difficulty: this.config.difficulty, seed: botId } });
    if (announce) {
      this.pushChat('', `${p.name} joins the table`, true);
      void botsWorker.call('say', { botId, event: 'join' }).then((t) => t && this.say(seat, t));
    }
  }

  // ------------------------------------------------------------ chat & log

  private pushChat(name: string, text: string, system = false): void {
    this.chat = [...this.chat.slice(-60), { id: this.ids++, name, text, system }];
  }

  private say(seat: number, text: string): void {
    if (!getSettings().chat) return;
    const m = this.meta[seat];
    if (!m) return;
    this.pushChat(m.name, text);
    this.chatBubbles[seat] = text;
    setTimeout(() => {
      if (this.chatBubbles[seat] === text) {
        delete this.chatBubbles[seat];
        this.emit();
      }
    }, 3500);
    this.emit();
  }

  private pushLog(text: string, kind: LogLine['kind']): void {
    this.log = [...this.log, { id: this.ids++, text, kind }];
  }

  // ------------------------------------------------------------ main loop

  start(): void {
    if (this.running) return;
    this.running = true;
    const g = ++this.gen;
    void this.loop(g).catch((e) => {
      console.error(e);
      this.running = false;
    });
  }

  stop(): void {
    this.running = false;
    this.gen++;
    this.heroResolve = null;
    this.nextResolve?.();
    this.nextResolve = null;
  }

  get isRunning(): boolean {
    return this.running;
  }

  private speed(): number {
    return getSettings().speed;
  }

  private async pause(ms: number, g: number): Promise<boolean> {
    if (ms > 0) await sleep(ms);
    return g === this.gen;
  }

  private async loop(g: number): Promise<void> {
    while (g === this.gen) {
      let hand = this.table.current;
      if (!hand || hand.finished) {
        if (this.table.seats[HERO_SEAT]!.stack <= 0) {
          this.status = 'busted';
          this.emit();
          return;
        }
        if (this.table.activeSeats().length < 2) {
          for (let s = 1; s < this.config.maxSeats; s++) if (!this.table.seats[s]) this.seatBot(s, true);
        }
        hand = this.table.startHand(getSettings().clientSeed);
        this.bubbles = {};
        this.log = [];
        this.pushLog(`Hand #${this.table.handNo} · button ${this.meta[hand.button]?.name}`, 'info');
        for (const a of hand.actions) this.pushLog(actionSentence(a, this.meta[a.seat]!.name, this.config.bb, getSettings().showBB), 'action');
        this.status = 'animating';
        this.emit();
        if (!(await this.pause(350 * this.speed(), g))) return;
      }
      while (!hand.finished) {
        const seat = hand.toAct!;
        const streetBefore = hand.street;
        let action: PlayerAction;
        if (seat === HERO_SEAT) {
          this.status = 'hero-turn';
          this.thinking = null;
          this.emit();
          action = await new Promise<PlayerAction>((res) => (this.heroResolve = res));
          if (g !== this.gen) return;
          this.heroResolve = null;
        } else {
          const m = this.meta[seat]!;
          this.status = 'bot-thinking';
          this.thinking = seat;
          this.emit();
          const t0 = performance.now();
          const d = await botsWorker.call('decide', { botId: m.botId!, view: hand.viewFor(seat) });
          if (g !== this.gen) return;
          const wait = d.thinkMs * this.speed() - (performance.now() - t0);
          if (!(await this.pause(Math.max(0, wait), g))) return;
          action = d.action;
          this.thinking = null;
        }
        const L = hand.legal(seat);
        if (!L) return;
        hand.act(seat, legalize(L, action));
        const rec = hand.actions[hand.actions.length - 1];
        const showBB = getSettings().showBB;
        this.bubbles[seat] = actionLabel(rec, this.config.bb, showBB);
        this.pushLog(actionSentence(rec, this.meta[seat]!.name, this.config.bb, showBB), 'action');
        if (hand.street !== streetBefore || hand.finished) {
          // New street (or run-out): clear bubbles, log the board.
          for (const a of hand.actions.slice(-3)) if (a.type === 'uncalled') this.pushLog(actionSentence(a, this.meta[a.seat]!.name, this.config.bb, showBB), 'action');
          if (!hand.finished || hand.board.length) {
            const reached = hand.board.length >= 5 ? 'river' : hand.board.length === 4 ? 'turn' : hand.board.length === 3 ? 'flop' : null;
            if (reached) {
              const order = ['flop', 'turn', 'river'] as const;
              for (const st of order.slice(0, order.indexOf(reached) + 1)) {
                const line = boardLabel(hand, st);
                if (!this.log.some((l) => l.text === line)) this.pushLog(line, 'street');
              }
            }
          }
          if (!hand.finished) this.bubbles = {};
        }
        this.status = 'animating';
        this.emit();
        if (!(await this.pause((hand.street !== streetBefore ? 550 : 220) * this.speed(), g))) return;
      }
      await this.finishHand(g);
      if (g !== this.gen) return;
      // Hand-over window: results, show cards, verify. Advance automatically or on "Next hand".
      this.status = 'hand-over';
      this.emit();
      await Promise.race([sleep(Math.max(1500, 3200 * this.speed())), new Promise<void>((r) => (this.nextResolve = r))]);
      this.nextResolve = null;
      if (g !== this.gen) return;
      await this.afterHandOver();
    }
  }

  private async finishHand(g: number): Promise<void> {
    const hand = this.table.current!;
    // Bots that won uncontested may show (needling a bluff).
    for (let s = 0; s < this.config.maxSeats; s++) {
      const m = this.meta[s];
      if (!m?.botId || !hand.order.includes(s)) continue;
      if (await botsWorker.call('wantsToShow', { botId: m.botId, view: hand.viewFor(s) })) hand.show(s);
    }
    if (g !== this.gen) return;
    const showBB = getSettings().showBB;
    const pub = hand.viewFor(-1);
    for (const w of pub.winners ?? []) {
      const nm = this.meta[w.seat]!.name;
      this.pushLog(`${nm} ${nm === 'You' ? 'win' : 'wins'} ${fmtAmt(w.amount, this.config.bb, showBB)}${w.hand ? ` with ${w.hand}` : ''}${(pub.pots?.length ?? 0) > 1 ? ` (pot ${w.potIndex + 1})` : ''}`, 'result');
    }
    this.thinking = null;
    this.pendingObserve = pub;
  }

  /** After the hand-over pause: settle, store, let bots learn, run dynamics. */
  private async afterHandOver(): Promise<void> {
    const hand = this.table.current!;
    const pub = hand.viewFor(-1); // includes any voluntary shows made during the pause
    const record = this.table.settle();
    const heroPlayer = record.history.players.find((p) => p.seat === HERO_SEAT);
    const lines = extractStats(pub);
    this.hud.add(lines.filter((l) => l.playerId !== 'hero'));
    if (heroPlayer) {
      const net = (heroPlayer.stackEnd - heroPlayer.stackStart) / this.config.bb;
      this.sessionNet = [...this.sessionNet, net];
      const hl = lines.find((l) => l.playerId === 'hero')!;
      const line: HeroLine = { ...hl, t: Date.now(), netBB: net, pos: positionOf(pub, HERO_SEAT), mode: this.mode, ...bbSteal(pub, HERO_SEAT) };
      this.sessionLines = [...this.sessionLines, line];
      update<HeroLine[]>('poker.heroLines', [], (xs) => [...xs.slice(-4999), line]);
      const stored: StoredHand = {
        id: `${this.sessionId}-${record.history.handId}`,
        t: Date.now(),
        mode: this.mode,
        heroSeat: HERO_SEAT,
        names: Object.fromEntries(record.history.players.map((p) => [p.seat, { name: this.meta[p.seat]!.name, archetype: this.meta[p.seat]!.archetype, isHuman: this.meta[p.seat]!.isHuman }])),
        record,
        heroNetBB: net,
        maxSeats: this.config.maxSeats,
      };
      this.lastStored = stored;
      this.onHandStored?.(stored);
      update<StoredHand[]>('poker.hands', [], (xs) => [...xs.slice(-199), stored]);
      if (this.sessionLines.length - this.recordedUpTo >= 25) this.recordSessionStats();
    }
    // Bots study the public record of the hand.
    const botIds = this.meta.filter((m) => m?.botId).map((m) => m!.botId!);
    const said = await botsWorker.call('observe', { view: this.pendingObserve ?? pub, botIds });
    this.pendingObserve = null;
    const hn = this.table.handNo;
    if (said.length && hn - this.lastChatHand >= 2) {
      const pickLine = said[this.rng.int(said.length)];
      const seat = this.meta.findIndex((m) => m?.botId === pickLine.botId);
      if (seat >= 0) {
        this.say(seat, pickLine.text);
        this.lastChatHand = hn;
      }
    }
    await this.tableDynamics();
    this.emit();
  }

  private async tableDynamics(): Promise<void> {
    for (let s = 1; s < this.config.maxSeats; s++) {
      const o = this.table.seats[s];
      const m = this.meta[s];
      if (!o || !m?.botId) continue;
      const pers = personalityFor(m.archetype!, m.playerId);
      if (o.stack <= 0) {
        if (this.rng.chance(pers.rebuyProb)) {
          this.table.rebuy(s, this.config.bb * Math.round(pers.buyInBB[0] + this.rng.next() * (pers.buyInBB[1] - pers.buyInBB[0])));
          const t = await botsWorker.call('say', { botId: m.botId, event: 'rebuy' });
          if (t) this.say(s, t);
        } else this.leave(s, 'leave');
        continue;
      }
      const start = this.config.bb * this.config.startingBB;
      const hitAndRun = o.stack > start * 2.2 ? 0.04 : 0;
      if (this.rng.chance(pers.leaveProb + hitAndRun)) this.leave(s, 'leave');
    }
    for (let s = 1; s < this.config.maxSeats; s++) if (!this.table.seats[s] && this.rng.chance(0.45)) this.seatBot(s, true);
  }

  private leave(seat: number, ev: 'leave'): void {
    const m = this.meta[seat]!;
    void botsWorker.call('say', { botId: m.botId!, event: ev }).then((t) => {
      if (t && getSettings().chat) this.pushChat(m.name, t);
      this.emit();
    });
    void botsWorker.call('remove', { botId: m.botId! });
    this.table.leave(seat);
    this.meta[seat] = null;
    this.pushChat('', `${m.name} leaves the table`, true);
  }

  // ------------------------------------------------------------ hero controls

  /** Key of the current hand, matching StoredHand.id. */
  get handKey(): string {
    return `${this.sessionId}-${this.table.handNo}`;
  }

  heroAct(a: PlayerAction): void {
    this.heroResolve?.(a);
  }

  nextHand(): void {
    this.nextResolve?.();
  }

  heroShow(): void {
    const h = this.table.current;
    if (h?.finished && this.status === 'hand-over') {
      try {
        h.show(HERO_SEAT);
        this.pushLog('You show your cards', 'info');
        this.emit();
      } catch {
        /* folded hands can't be shown */
      }
    }
  }

  rebuy(): void {
    this.table.rebuy(HERO_SEAT, this.config.bb * this.config.startingBB);
    this.status = 'idle';
    this.emit();
    this.running = false;
    this.start();
  }

  private recordedUpTo = 0;
  private recordedAt = Date.now();

  /** Record the hands since the last call as one session in the activity log. */
  recordSessionStats(): void {
    const lines = this.sessionLines.slice(this.recordedUpTo);
    const n = lines.length;
    if (!n) return;
    const net = lines.reduce((a, l) => a + l.netBB, 0);
    const vpip = lines.reduce((a, l) => a + l.vpip, 0) / n;
    const pfr = lines.reduce((a, l) => a + l.pfr, 0) / n;
    recordSession({ section: 'poker', mode: this.mode, durationMs: Date.now() - this.recordedAt, score: net, total: n, summary: { bb100: (net / n) * 100, vpip, pfr } });
    this.recordedUpTo = this.sessionLines.length;
    this.recordedAt = Date.now();
  }
}

/** Was the hero in the BB facing a single steal from CO/BTN/SB with no callers, and did they fold? */
function bbSteal(v: PlayerView, seat: number): { bbStealOpp: number; bbStealFold: number } {
  if (positionOf(v, seat) !== 'BB') return { bbStealOpp: 0, bbStealFold: 0 };
  const pre = v.actions.filter((a) => a.street === 'preflop' && !a.type.startsWith('post'));
  const firstRaise = pre.findIndex((a) => a.type === 'raise');
  if (firstRaise < 0) return { bbStealOpp: 0, bbStealFold: 0 };
  const before = pre.slice(0, firstRaise);
  if (before.some((a) => a.type === 'call')) return { bbStealOpp: 0, bbStealFold: 0 };
  const pos = positionOf(v, pre[firstRaise].seat);
  if (!['CO', 'BTN', 'SB'].includes(pos)) return { bbStealOpp: 0, bbStealFold: 0 };
  const after = pre.slice(firstRaise + 1);
  const heroAct = after.find((a) => a.seat === seat);
  if (!heroAct || after.slice(0, after.indexOf(heroAct)).some((a) => a.type === 'call' || a.type === 'raise')) return { bbStealOpp: 0, bbStealFold: 0 };
  return { bbStealOpp: 1, bbStealFold: heroAct.type === 'fold' ? 1 : 0 };
}

const sessions: Partial<Record<Mode, PokerSession>> = {};
export function getSession(mode: Mode): PokerSession {
  return (sessions[mode] ??= new PokerSession(mode));
}
