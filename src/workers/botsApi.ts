/**
 * Bot host. Runs inside a Web Worker: brains live here, and the only things
 * that ever cross into this thread are PlayerViews (structured-cloned) —
 * there is no shared memory with the engine.
 */
import { BotBrain, type BotSpec } from '@/games/poker/bots/brain';
import type { PlayerView } from '@/games/poker/engine/types';
import type { ChatEvent } from '@/games/poker/bots/humanize';

const brains = new Map<string, BotBrain>();

const get = (botId: string): BotBrain => {
  const b = brains.get(botId);
  if (!b) throw new Error(`unknown bot ${botId}`);
  return b;
};

export const botsApi = {
  spawn({ spec }: { spec: BotSpec }) {
    const b = new BotBrain(spec);
    brains.set(spec.botId, b);
    return { thinkBaseMs: b.base.thinkBaseMs };
  },
  remove({ botId }: { botId: string }) {
    brains.delete(botId);
    return true;
  },
  decide({ botId, view }: { botId: string; view: PlayerView }) {
    return get(botId).decide(view);
  },
  wantsToShow({ botId, view }: { botId: string; view: PlayerView }) {
    return get(botId).wantsToShow(view);
  },
  /** Every seated bot studies the finished hand's public record. */
  observe({ view, botIds }: { view: PlayerView; botIds: string[] }) {
    const lines: { botId: string; text: string }[] = [];
    for (const id of botIds) {
      const b = brains.get(id);
      if (!b) continue;
      const text = b.observe(structuredClone(view));
      if (text) lines.push({ botId: id, text });
    }
    return lines;
  },
  say({ botId, event }: { botId: string; event: ChatEvent }) {
    return brains.get(botId)?.sayOnEvent(event) ?? null;
  },
  mood({ botId }: { botId: string }) {
    const b = get(botId);
    return { tilt: b.tilt, confidence: b.confidence };
  },
  reset() {
    brains.clear();
    return true;
  },
};

export type BotsApi = typeof botsApi;
