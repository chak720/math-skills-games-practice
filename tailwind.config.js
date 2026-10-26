/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#0D1420', // page
          panel: '#121B2A',
          raised: '#172234',
          hover: '#1C293D',
          line: '#243146',
          strong: '#33445F',
        },
        paper: { DEFAULT: '#E6EBF2', muted: '#93A1B5', dim: '#64748B' },
        signal: { DEFAULT: '#E8A93A', hover: '#F0BC5E', deep: '#B98222' },
        bid: { DEFAULT: '#34B37E', soft: '#163B30' },
        ask: { DEFAULT: '#E2626B', soft: '#3E1C24' },
        info: { DEFAULT: '#6CA6E8', soft: '#1B2D46' },
        felt: { edge: '#09301F', DEFAULT: '#0F4D37', glow: '#156446', rail: '#1A1511' },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['"Source Serif 4 Variable"', 'Georgia', 'serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // Modular scale (ratio ~1.2) anchored at 15px body.
        xs: ['12px', '16px'],
        sm: ['13px', '18px'],
        base: ['15px', '22px'],
        md: ['17px', '24px'],
        lg: ['20px', '28px'],
        xl: ['24px', '30px'],
        '2xl': ['29px', '34px'],
        '3xl': ['35px', '40px'],
        '4xl': ['48px', '52px'],
      },
      borderRadius: { sm: '4px', DEFAULT: '6px', md: '8px', lg: '12px' },
      boxShadow: {
        card: '0 1px 1px rgba(0,0,0,.35), 0 4px 12px rgba(0,0,0,.35)',
        lift: '0 8px 30px rgba(0,0,0,.45)',
      },
      keyframes: {
        deal: { from: { transform: 'translateY(-12px) scale(.96)', opacity: '0' }, to: { transform: 'none', opacity: '1' } },
        pop: { '0%': { transform: 'scale(.9)', opacity: '0' }, '100%': { transform: 'scale(1)', opacity: '1' } },
      },
      animation: { deal: 'deal .22s ease-out both', pop: 'pop .16s ease-out both' },
    },
  },
  plugins: [],
};
