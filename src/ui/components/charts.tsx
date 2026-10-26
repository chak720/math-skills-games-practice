/**
 * Small SVG chart kit. Conventions (validated palette, dark surface):
 *  - categorical series colours in fixed order, never cycled;
 *  - 2px lines, recessive grid, one y-axis;
 *  - every plot has a hover layer (crosshair + tooltip, or per-cell tooltip);
 *  - a legend whenever there are >= 2 series.
 */
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'] as const;
const GRID = '#243146';
const AXIS_TEXT = '#93A1B5';

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(120, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** "Nice" tick values covering [lo, hi] (Heckbert's algorithm). */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0];
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const nice = (x: number, round: boolean): number => {
    const e = Math.floor(Math.log10(x));
    const f = x / 10 ** e;
    const nf = round ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) : f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * 10 ** e;
  };
  const range = nice(hi - lo, false);
  const step = nice(range / (count - 1), true);
  const start = Math.floor(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 0.5; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

const defaultFmt = (v: number): string => {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(0)}k`;
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(1).replace(/\.0$/, '');
  return v.toFixed(2);
};

export interface LineSeries {
  name: string;
  values: number[];
  color?: string;
  dashed?: boolean;
}

export function Legend({ items }: { items: { name: string; color: string; dashed?: boolean }[] }): JSX.Element {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-paper-muted mb-2">
      {items.map((s) => (
        <span key={s.name} className="inline-flex items-center gap-1.5">
          <svg width="16" height="8" aria-hidden>
            <line x1="0" y1="4" x2="16" y2="4" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? '4 3' : undefined} />
          </svg>
          {s.name}
        </span>
      ))}
    </div>
  );
}

export function LineChart({
  series,
  x,
  height = 220,
  yFormat = defaultFmt,
  xFormat = (v: number) => String(v),
  zeroLine = false,
  band,
  xLabel,
  yMin,
  yMax,
  markers,
}: {
  series: LineSeries[];
  x?: number[];
  height?: number;
  yFormat?: (v: number) => string;
  xFormat?: (v: number) => string;
  zeroLine?: boolean;
  band?: { lo: number[]; hi: number[]; color?: string; name?: string };
  xLabel?: string;
  yMin?: number;
  yMax?: number;
  markers?: { y: number; label: string }[];
}): JSX.Element {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.max(0, ...series.map((s) => s.values.length));
  const xs = x ?? Array.from({ length: n }, (_, i) => i);
  const m = { l: 44, r: 12, t: 8, b: xLabel ? 34 : 22 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;

  const { ticks, sy, sx } = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const s of series) for (const v of s.values) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (band) for (let i = 0; i < band.lo.length; i++) { lo = Math.min(lo, band.lo[i]); hi = Math.max(hi, band.hi[i]); }
    for (const mk of markers ?? []) { lo = Math.min(lo, mk.y); hi = Math.max(hi, mk.y); }
    if (zeroLine) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (yMin !== undefined) lo = yMin;
    if (yMax !== undefined) hi = yMax;
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    const t = niceTicks(lo, hi);
    const a = Math.min(t[0], lo), b = Math.max(t[t.length - 1], hi);
    const x0 = xs[0] ?? 0, x1 = xs[xs.length - 1] ?? 1;
    return {
      ticks: t,
      sy: (v: number) => m.t + ih - ((v - a) / (b - a || 1)) * ih,
      sx: (v: number) => m.l + ((v - x0) / (x1 - x0 || 1)) * iw,
    };
  }, [series, band, markers, zeroLine, yMin, yMax, xs, ih, iw, m.t, m.l]);

  const path = (vals: number[]): string => {
    let d = '';
    vals.forEach((v, i) => {
      if (!Number.isFinite(v)) return;
      d += `${d ? 'L' : 'M'}${sx(xs[i]).toFixed(1)},${sy(v).toFixed(1)}`;
    });
    return d;
  };

  const onMove = (e: React.MouseEvent<SVGSVGElement>): void => {
    if (!n) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0, bd = Infinity;
    xs.forEach((xv, i) => {
      const d = Math.abs(sx(xv) - px);
      if (d < bd) { bd = d; best = i; }
    });
    setHover(best);
  };

  const xTicks = niceTicks(xs[0] ?? 0, xs[xs.length - 1] ?? 1, Math.max(2, Math.min(7, Math.floor(iw / 80)))).filter((v) => v >= (xs[0] ?? 0) && v <= (xs[xs.length - 1] ?? 1));

  return (
    <div ref={ref} className="relative w-full">
      {series.length >= 2 && <Legend items={series.map((s, i) => ({ name: s.name, color: s.color ?? SERIES[i], dashed: s.dashed }))} />}
      <svg width={width} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={series.map((s) => s.name).join(', ')}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={width - m.r} y1={sy(t)} y2={sy(t)} stroke={GRID} strokeWidth={t === 0 && zeroLine ? 1.5 : 1} />
            <text x={m.l - 6} y={sy(t)} dy="0.32em" textAnchor="end" fontSize="11" fill={AXIS_TEXT}>
              {yFormat(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={sx(t)} y={height - (xLabel ? 20 : 6)} textAnchor="middle" fontSize="11" fill={AXIS_TEXT}>
            {xFormat(t)}
          </text>
        ))}
        {xLabel && (
          <text x={m.l + iw / 2} y={height - 4} textAnchor="middle" fontSize="11" fill={AXIS_TEXT}>
            {xLabel}
          </text>
        )}
        {band && band.lo.length > 1 && (
          <path
            d={`${band.lo.map((v, i) => `${i ? 'L' : 'M'}${sx(xs[i])},${sy(v)}`).join('')}${band.hi
              .map((v, i) => [i, v] as const)
              .reverse()
              .map(([i, v]) => `L${sx(xs[i])},${sy(v)}`)
              .join('')}Z`}
            fill={band.color ?? SERIES[0]}
            opacity={0.16}
          />
        )}
        {markers?.map((mk) => (
          <g key={mk.label}>
            <line x1={m.l} x2={width - m.r} y1={sy(mk.y)} y2={sy(mk.y)} stroke={AXIS_TEXT} strokeDasharray="3 4" />
            <text x={width - m.r} y={sy(mk.y) - 4} textAnchor="end" fontSize="11" fill={AXIS_TEXT}>
              {mk.label}
            </text>
          </g>
        ))}
        {series.map((s, i) => (
          <path key={s.name} d={path(s.values)} fill="none" stroke={s.color ?? SERIES[i]} strokeWidth={2} strokeLinejoin="round" strokeDasharray={s.dashed ? '5 4' : undefined} />
        ))}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={sx(xs[hover])} x2={sx(xs[hover])} y1={m.t} y2={m.t + ih} stroke={AXIS_TEXT} strokeOpacity={0.5} />
            {series.map((s, i) =>
              Number.isFinite(s.values[hover]) ? (
                <circle key={s.name} cx={sx(xs[hover])} cy={sy(s.values[hover])} r={4} fill={s.color ?? SERIES[i]} stroke="#121B2A" strokeWidth={2} />
              ) : null,
            )}
          </g>
        )}
      </svg>
      {hover !== null && (
        <Tooltip x={sx(xs[hover])} width={width}>
          <div className="text-paper-muted">{xLabel ? `${xLabel} ` : ''}{xFormat(xs[hover])}</div>
          {series.map((s, i) => (
            <div key={s.name} className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: s.color ?? SERIES[i] }} />
              {series.length > 1 && <span className="text-paper-muted">{s.name}</span>}
              <span className="num ml-auto">{Number.isFinite(s.values[hover]) ? yFormat(s.values[hover]) : '–'}</span>
            </div>
          ))}
          {band && (
            <div className="text-paper-dim">
              {band.name ?? 'band'} {yFormat(band.lo[hover])} – {yFormat(band.hi[hover])}
            </div>
          )}
        </Tooltip>
      )}
    </div>
  );
}

function Tooltip({ x, width, children, top = 24 }: { x: number; width: number; children: ReactNode; top?: number }): JSX.Element {
  const left = x > width * 0.6 ? undefined : x + 12;
  const right = x > width * 0.6 ? width - x + 12 : undefined;
  return (
    <div className="absolute pointer-events-none bg-ink-raised border border-ink-strong rounded px-2.5 py-1.5 text-xs shadow-card min-w-[120px] space-y-0.5" style={{ top, left, right }}>
      {children}
    </div>
  );
}

export function Sparkline({ values, width = 96, height = 24, color = SERIES[0], title }: { values: number[]; width?: number; height?: number; color?: string; title?: string }): JSX.Element {
  if (values.length < 2) return <span className="text-paper-dim text-xs">–</span>;
  const lo = Math.min(...values), hi = Math.max(...values);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * (width - 4) + 2).toFixed(1)},${(height - 3 - ((v - lo) / (hi - lo || 1)) * (height - 6)).toFixed(1)}`).join('');
  return (
    <svg width={width} height={height} role="img" aria-label={title}>
      {title && <title>{title}</title>}
      <path d={d} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" />
    </svg>
  );
}

/** Vertical bar histogram with optional reference lines. */
export function Histogram({
  bins,
  height = 200,
  xFormat = defaultFmt,
  color = SERIES[0],
  refs,
  yFormat = (v: number) => String(Math.round(v)),
  label,
}: {
  bins: { x0: number; x1: number; count: number }[];
  height?: number;
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  color?: string;
  refs?: { x: number; label: string; color?: string }[];
  label?: string;
}): JSX.Element {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (!bins.length) return <div ref={ref} />;
  const m = { l: 40, r: 8, t: 14, b: 22 };
  const iw = width - m.l - m.r, ih = height - m.t - m.b;
  const x0 = bins[0].x0, x1 = bins[bins.length - 1].x1;
  const maxC = Math.max(1, ...bins.map((b) => b.count));
  const ticks = niceTicks(0, maxC, 4);
  const top = ticks[ticks.length - 1];
  const sx = (v: number): number => m.l + ((v - x0) / (x1 - x0 || 1)) * iw;
  const sy = (v: number): number => m.t + ih - (v / top) * ih;
  const xt = niceTicks(x0, x1, Math.max(2, Math.min(7, Math.floor(iw / 70)))).filter((v) => v >= x0 && v <= x1);
  return (
    <div ref={ref} className="relative w-full">
      <svg width={width} height={height} role="img" aria-label={label ?? 'histogram'} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={width - m.r} y1={sy(t)} y2={sy(t)} stroke={GRID} />
            <text x={m.l - 6} y={sy(t)} dy="0.32em" textAnchor="end" fontSize="11" fill={AXIS_TEXT}>
              {yFormat(t)}
            </text>
          </g>
        ))}
        {bins.map((b, i) => {
          const bx = sx(b.x0) + 1, bw = Math.max(1, sx(b.x1) - sx(b.x0) - 2);
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={bx - 1} y={m.t} width={bw + 2} height={ih} fill="transparent" />
              <rect x={bx} y={sy(b.count)} width={bw} height={Math.max(0, m.t + ih - sy(b.count))} rx={Math.min(3, bw / 2)} fill={color} opacity={hover === null || hover === i ? 1 : 0.55} />
            </g>
          );
        })}
        {xt.map((t) => (
          <text key={t} x={sx(t)} y={height - 6} textAnchor="middle" fontSize="11" fill={AXIS_TEXT}>
            {xFormat(t)}
          </text>
        ))}
        {refs?.map((r, i) => (
          <g key={r.label}>
            <line x1={sx(r.x)} x2={sx(r.x)} y1={m.t} y2={m.t + ih} stroke={r.color ?? '#E6EBF2'} strokeWidth={1.5} strokeDasharray="4 3" />
            <text x={sx(r.x) + 4} y={m.t + 10 + i * 13} fontSize="11" fill="#E6EBF2">
              {r.label}
            </text>
          </g>
        ))}
      </svg>
      {hover !== null && (
        <Tooltip x={sx((bins[hover].x0 + bins[hover].x1) / 2)} width={width} top={8}>
          <div className="text-paper-muted">
            {xFormat(bins[hover].x0)} to {xFormat(bins[hover].x1)}
          </div>
          <div className="num">{yFormat(bins[hover].count)}</div>
        </Tooltip>
      )}
    </div>
  );
}

export function makeBins(values: number[], count = 30, lo?: number, hi?: number): { x0: number; x1: number; count: number }[] {
  if (!values.length) return [];
  const a = lo ?? Math.min(...values), b = hi ?? Math.max(...values);
  const w = (b - a || 1) / count;
  const bins = Array.from({ length: count }, (_, i) => ({ x0: a + i * w, x1: a + (i + 1) * w, count: 0 }));
  for (const v of values) {
    const k = Math.min(count - 1, Math.max(0, Math.floor((v - a) / w)));
    bins[k].count++;
  }
  return bins;
}

/** Diverging blue ↔ grey ↔ red scale for residuals in [-1, 1]. */
export function divergingColor(t: number): string {
  const c = Math.max(-1, Math.min(1, t));
  const mid = [56, 56, 53];
  const pos = [217, 89, 38]; // orange-red pole
  const neg = [57, 135, 229]; // blue pole
  const pole = c >= 0 ? pos : neg;
  const k = Math.abs(c);
  const ch = mid.map((m, i) => Math.round(m + (pole[i] - m) * k));
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
}

/** Sequential single-hue blue scale for magnitudes in [0, 1]. */
export function sequentialColor(t: number): string {
  const c = Math.max(0, Math.min(1, t));
  const lo = [24, 35, 52], hi = [134, 182, 239];
  const ch = lo.map((l, i) => Math.round(l + (hi[i] - l) * c));
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
}

export function Heatmap({
  values,
  color,
  cell = 10,
  describe,
  label,
}: {
  values: number[][];
  color: (v: number) => string;
  cell?: number;
  describe: (r: number, c: number, v: number) => ReactNode;
  label: string;
}): JSX.Element {
  const [hover, setHover] = useState<[number, number] | null>(null);
  const rows = values.length, cols = values[0]?.length ?? 0;
  return (
    <div className="relative inline-block max-w-full overflow-x-auto">
      <svg width={cols * cell} height={rows * cell} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {values.map((row, r) =>
          row.map((v, c) => <rect key={`${r}-${c}`} x={c * cell} y={r * cell} width={cell - 1} height={cell - 1} fill={color(v)} onMouseEnter={() => setHover([r, c])} />),
        )}
        {hover && <rect x={hover[1] * cell - 0.5} y={hover[0] * cell - 0.5} width={cell} height={cell} fill="none" stroke="#E6EBF2" />}
      </svg>
      {hover && (
        <div className="absolute pointer-events-none bg-ink-raised border border-ink-strong rounded px-2.5 py-1.5 text-xs shadow-card whitespace-nowrap" style={{ left: Math.min(hover[1] * cell + 14, cols * cell - 160), top: hover[0] * cell + 14 }}>
          {describe(hover[0], hover[1], values[hover[0]][hover[1]])}
        </div>
      )}
    </div>
  );
}
