/** Hand-drawn 20px line icons (stroke = currentColor). */
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export type IconName = 'home' | 'poker' | 'blackjack' | 'maths' | 'puzzles' | 'market' | 'sequences' | 'fermi' | 'betting' | 'interview' | 'progress' | 'fairness' | 'settings' | 'menu';

export function Icon({ name, size = 20 }: { name: IconName; size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden className="shrink-0">
      {PATHS[name]}
    </svg>
  );
}

const PATHS: Record<IconName, JSX.Element> = {
  home: <path {...P} d="M3 9.5 10 3.5l7 6V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1z" />,
  poker: <path {...P} d="M10 3c2.5 3 6 4.6 6 7.6A3 3 0 0 1 11.2 13L12 17H8l.8-4A3 3 0 0 1 4 10.6C4 7.6 7.5 6 10 3z" />,
  blackjack: (
    <g {...P}>
      <rect x="3.5" y="4" width="8" height="12" rx="1.4" />
      <path d="M8.5 4.2 14.8 3a1.2 1.2 0 0 1 1.4 1l1.6 9.4a1.2 1.2 0 0 1-1 1.4l-3.3.6" />
    </g>
  ),
  maths: <path {...P} d="M4 6h5M6.5 3.5v5M11.5 6h5M4.5 13.5l4 4M8.5 13.5l-4 4M11.5 14h5M11.5 17h5" />,
  puzzles: <path {...P} d="M7.5 15.5h5M8 17.5h4M10 2.5a5 5 0 0 0-3 9c.6.5 1 1.2 1 2v.5h4V13.5c0-.8.4-1.5 1-2a5 5 0 0 0-3-9z" />,
  market: (
    <g {...P}>
      <path d="M3 5h6M3 8h8M3 11h4" />
      <path d="M17 9h-6M17 12h-8M17 15h-4" />
    </g>
  ),
  sequences: <path {...P} d="M3 15c2 0 2-3 4-3s2 2 4 2 2-6 4-6 1.5 2 2 2M3.5 5h.01M7 5h.01M10.5 5h.01M14 5h.01" />,
  fermi: <path {...P} d="M3 8c2-2 4 2 7 0s5-2 7 0M3 13c2-2 4 2 7 0s5-2 7 0" />,
  betting: <path {...P} d="M3 16.5h14M3.5 16C6 6 8 4 10 4s4.5 4 6.5 12M10 4v12.5" />,
  interview: (
    <g {...P}>
      <circle cx="10" cy="11" r="6" />
      <path d="M10 8v3.2l2 1.6M8 2.5h4M15.2 5.8l1.3-1.3" />
    </g>
  ),
  progress: <path {...P} d="M3 16.5h14M4.5 13l3.5-4 3 2.5 4.5-6M13 5.5h2.5V8" />,
  fairness: <path {...P} d="M10 2.5 16 5v4.5c0 3.6-2.6 6.6-6 8-3.4-1.4-6-4.4-6-8V5zM7.2 10l2 2 3.8-4" />,
  settings: (
    <g {...P}>
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" />
    </g>
  ),
  menu: <path {...P} d="M3 6h14M3 10h14M3 14h14" />,
};
