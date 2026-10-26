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
