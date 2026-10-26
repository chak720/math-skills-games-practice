import { useMemo } from 'react';
import { computeChart, UPS, type Cell } from '@/games/blackjack/strategy';
import { describeRules } from '@/games/blackjack/rules';
import { Panel } from '../../components/core';
import { useBJ } from './PlayBJ';

const CELL_STYLE: Record<Cell, { bg: string; fg: string; label: string }> = {
  H: { bg: '#2b3f5c', fg: '#E6EBF2', label: 'H' },
  S: { bg: '#5b3a3f', fg: '#E6EBF2', label: 'S' },
  Dh: { bg: '#1f6a4b', fg: '#E6EBF2', label: 'Dh' },
  Ds: { bg: '#2f7f5c', fg: '#E6EBF2', label: 'Ds' },
  P: { bg: '#b98222', fg: '#0D1420', label: 'P' },
  Rh: { bg: '#6b6f78', fg: '#0D1420', label: 'Rh' },
  Rs: { bg: '#6b6f78', fg: '#0D1420', label: 'Rs' },
  Rp: { bg: '#6b6f78', fg: '#0D1420', label: 'Rp' },
};

function Grid({ title, rows }: { title: string; rows: [string, Cell[]][] }): JSX.Element {
  return (
    <div>
      <h3 className="text-sm text-paper-muted mb-1">{title}</h3>
      <table className="text-xs num border-separate border-spacing-[2px]">
        <thead>
          <tr>
            <th />
            {UPS.map((u) => (
              <th key={u} className="w-8 text-paper-dim font-normal">
                {u === 1 ? 'A' : u}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, cells]) => (
            <tr key={label}>
              <th className="pr-2 text-right text-paper-muted font-normal whitespace-nowrap">{label}</th>
              {cells.map((c, i) => (
                <td key={i} className="w-8 h-6 text-center rounded-sm font-semibold" style={{ background: CELL_STYLE[c].bg, color: CELL_STYLE[c].fg }}>
                  {CELL_STYLE[c].label}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChartView(): JSX.Element {
  const { snap } = useBJ();
  const rules = snap.config.rules;
  const chart = useMemo(() => computeChart(rules), [rules]);
  const hard: [string, Cell[]][] = [];
  for (let t = 8; t <= 17; t++) hard.push([t === 8 ? '≤ 8' : t === 17 ? '17+' : String(t), chart.hard[t]]);
  const soft: [string, Cell[]][] = [];
  for (let t = 13; t <= 20; t++) soft.push([`A,${t - 11}`, chart.soft[t]]);
  const pairs: [string, Cell[]][] = [1, 10, 9, 8, 7, 6, 5, 4, 3, 2].map((c) => [c === 1 ? 'A,A' : c === 10 ? 'T,T' : `${c},${c}`, chart.pairs[c]]);
  return (
    <Panel title={`Basic strategy for ${describeRules(rules)}`}>
      <p className="text-paper-muted mb-4 max-w-3xl">
        Computed by this app's exact EV engine for these rules (not copied from a book): each cell is the action with the highest expected value, averaged over all two-card hands with that total. For 6-deck S17 DAS with surrender it matches the published chart cell for cell; change the rules in Table setup and it updates.
      </p>
      <div className="flex flex-wrap gap-8">
        <Grid title="Hard totals" rows={hard} />
        <Grid title="Soft totals" rows={soft} />
        <Grid title="Pairs" rows={pairs} />
      </div>
      <p className="text-xs text-paper-dim mt-4">H hit · S stand · Dh double, else hit · Ds double, else stand · P split · Rh/Rs/Rp surrender, else hit/stand/split.</p>
    </Panel>
  );
}
