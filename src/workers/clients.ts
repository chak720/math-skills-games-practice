/**
 * One lazily-started worker per heavy domain. Workers are inlined into the
 * bundle (`?worker&inline`), so the built site is a single file that also runs
 * when opened straight from disk. If a worker cannot start, each client runs
 * the same API on the main thread instead.
 */
import { WorkerClient } from './rpc';
import FairnessWorker from './fairness.worker.ts?worker&inline';
import BotsWorker from './bots.worker.ts?worker&inline';
import EquityWorker from './equity.worker.ts?worker&inline';
import BjWorker from './bj.worker.ts?worker&inline';
import PuzzleWorker from './puzzle.worker.ts?worker&inline';
import type { FairnessApi } from './fairnessApi';
import type { BotsApi } from './botsApi';
import type { EquityApi } from './equityApi';
import type { BjApi } from './bjApi';
import type { PuzzleApi } from './puzzleApi';

export const fairnessWorker = new WorkerClient<FairnessApi>(
  () => new FairnessWorker(),
  () => import('./fairnessApi').then((m) => m.fairnessApi),
);

/** Bots run in their own worker: they can only ever see the views we post them. */
export const botsWorker = new WorkerClient<BotsApi>(
  () => new BotsWorker(),
  () => import('./botsApi').then((m) => m.botsApi),
);

export const equityWorker = new WorkerClient<EquityApi>(
  () => new EquityWorker(),
  () => import('./equityApi').then((m) => m.equityApi),
);

export const bjWorker = new WorkerClient<BjApi>(
  () => new BjWorker(),
  () => import('./bjApi').then((m) => m.bjApi),
);

export const puzzleWorker = new WorkerClient<PuzzleApi>(
  () => new PuzzleWorker(),
  () => import('./puzzleApi').then((m) => m.puzzleApi),
);
