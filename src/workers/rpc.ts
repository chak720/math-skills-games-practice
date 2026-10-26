/**
 * Typed request/response RPC over Web Workers.
 *
 *   worker file:   expose(api)
 *   main thread:   const client = new WorkerClient(() => new Worker(...), () => import('./api'))
 *                  await client.call('method', args, onProgress)
 *
 * If a Worker cannot be created (e.g. module workers on file://), the client
 * transparently loads the same API module on the main thread. Arguments are
 * still passed through structuredClone in that case, so callee code can never
 * hold references to caller objects — the isolation guarantee bots rely on
 * holds in both modes.
 */
export interface Ctx {
  progress(p: unknown): void;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handler<A = any, R = any> = (args: A, ctx: Ctx) => R | Promise<R>;
export type Api = Record<string, Handler>;
type ArgsOf<F> = F extends Handler<infer A, unknown> ? A : never;
type ResOf<F> = F extends Handler<never, infer R> ? Awaited<R> : never;

interface Req { id: number; method: string; args: unknown }
type Res = { id: number; result: unknown } | { id: number; error: string } | { id: number; progress: unknown };

export function expose(api: Api): void {
  const scope = self as unknown as { onmessage: ((e: MessageEvent<Req>) => void) | null; postMessage(m: Res): void };
  scope.onmessage = async (e) => {
    const { id, method, args } = e.data;
    try {
      const fn = api[method];
      if (!fn) throw new Error(`unknown method ${method}`);
      const result = await fn(args, { progress: (p) => scope.postMessage({ id, progress: p }) });
      scope.postMessage({ id, result });
    } catch (err) {
      scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
    }
  };
}

interface Pending { resolve(v: unknown): void; reject(e: Error): void; onProgress?: (p: unknown) => void }

export class WorkerClient<A extends Api> {
  private worker: Worker | null = null;
  private fallbackApi: Promise<A> | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private failed = false;

  constructor(
    private readonly factory: () => Worker,
    private readonly loadFallback: () => Promise<A>,
  ) {}

  /** True once we've fallen back to main-thread execution. */
  get inline(): boolean {
    return this.failed;
  }

  private ensureWorker(): Worker | null {
    if (this.failed) return null;
    if (this.worker) return this.worker;
    try {
      if (typeof Worker === 'undefined') throw new Error('no Worker');
      const w = this.factory();
      w.onmessage = (e: MessageEvent<Res>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        if ('progress' in e.data) p.onProgress?.(e.data.progress);
        else {
          this.pending.delete(e.data.id);
          if ('error' in e.data) p.reject(new Error(e.data.error));
          else p.resolve(e.data.result);
        }
      };
      w.onerror = (e) => {
        // Worker failed to load: re-run everything in flight on the main thread.
        e.preventDefault?.();
        this.failed = true;
        this.worker = null;
        const inflight = [...this.pending.entries()];
        this.pending.clear();
        for (const [, p] of inflight) p.reject(new Error('__retry_inline__'));
      };
      this.worker = w;
      return w;
    } catch {
      this.failed = true;
      return null;
    }
  }

  async call<K extends keyof A & string>(method: K, args: ArgsOf<A[K]>, onProgress?: (p: unknown) => void): Promise<ResOf<A[K]>> {
    const w = this.ensureWorker();
    if (w) {
      try {
        return await new Promise<ResOf<A[K]>>((resolve, reject) => {
          const id = this.nextId++;
          this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
          w.postMessage({ id, method, args });
        });
      } catch (e) {
        if (!(e instanceof Error) || e.message !== '__retry_inline__') throw e;
      }
    }
    this.fallbackApi ??= this.loadFallback();
    const api = await this.fallbackApi;
    // Yield first so the UI can paint, then run with cloned args.
    await new Promise((r) => setTimeout(r, 0));
    return (await api[method](structuredClone(args), { progress: (p) => onProgress?.(structuredClone(p)) })) as ResOf<A[K]>;
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const [, p] of this.pending) p.reject(new Error('terminated'));
    this.pending.clear();
  }
}
