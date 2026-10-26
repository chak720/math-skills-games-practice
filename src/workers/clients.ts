/**
 * One lazily-started worker per heavy domain. `new Worker(new URL(...))` must
 * appear literally here so Vite can bundle each worker.
 */
import { WorkerClient } from './rpc';
import type { FairnessApi } from './fairnessApi';

export const fairnessWorker = new WorkerClient<FairnessApi>(
  () => new Worker(new URL('./fairness.worker.ts', import.meta.url), { type: 'module' }),
  () => import('./fairnessApi').then((m) => m.fairnessApi),
);

import type { BotsApi } from './botsApi';

/** Bots run in their own worker: they can only ever see the views we post them. */
export const botsWorker = new WorkerClient<BotsApi>(
  () => new Worker(new URL('./bots.worker.ts', import.meta.url), { type: 'module' }),
  () => import('./botsApi').then((m) => m.botsApi),
);

import type { EquityApi } from './equityApi';

export const equityWorker = new WorkerClient<EquityApi>(
  () => new Worker(new URL('./equity.worker.ts', import.meta.url), { type: 'module' }),
  () => import('./equityApi').then((m) => m.equityApi),
);
