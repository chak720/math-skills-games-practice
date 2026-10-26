/** The mental-maths tricks library: each trick names the drill that practises it. */
import type { SkillId } from './generators';

export interface Trick {
  id: string;
  title: string;
  skill: SkillId;
  /** Paragraphs of explanation (plain text with inline maths). */
  body: string[];
  examples: string[];
}

export const TRICKS: Trick[] = [
  {
    id: 'sq50', title: 'Squaring numbers near 50', skill: 'sq-50',
    body: ['Write the number as 50 + d. Then (50 + d)² = 2500 + 100d + d²: add d hundreds to 2500 and append d² (as two digits).', 'Works for d negative too: 47² = 2500 − 300 + 9.'],
    examples: ['53² = 2500 + 300 + 9 = 2809', '46² = 2500 − 400 + 16 = 2116', '58² = 2500 + 800 + 64 = 3364'],
  },
  {
    id: 'sq100', title: 'Squaring numbers near 100 (or 1000)', skill: 'sq-100',
    body: ['(100 + d)² = 10000 + 200d + d². Equivalently: the first part is the number plus d, then d² as two digits.', 'Near 1000: (1000 + d)² = 1,000,000 + 2000d + d², with d² as three digits.'],
    examples: ['104² = 10816 (104 + 4 = 108, then 16)', '97² = 9409 (97 − 3 = 94, then 09)', '1006² = 1,012,036'],
  },
  {
    id: 'mul25', title: 'Multiplying by 25 and 125', skill: 'mul-25',
    body: ['25 = 100/4 and 125 = 1000/8. So × 25 is "divide by 4, then × 100", and × 125 is "divide by 8, then × 1000".', 'Choose whichever order keeps the numbers whole.'],
    examples: ['25 × 48 = 48/4 × 100 = 1200', '125 × 64 = 64/8 × 1000 = 8000', '25 × 37 = 37/4 × 100 = 925'],
  },
  {
    id: 'diffsq', title: 'Difference of squares', skill: 'diff-sq',
    body: ['When two numbers sit symmetrically around a round number m, (m − d)(m + d) = m² − d².', 'Look for the midpoint: 47 × 53 has midpoint 50 and d = 3.'],
    examples: ['47 × 53 = 2500 − 9 = 2491', '68 × 72 = 4900 − 4 = 4896', '195 × 205 = 40000 − 25 = 39975'],
  },
  {
    id: 'mul11', title: 'Multiplying by 11', skill: 'mul-11',
    body: ['For a two-digit number ab: 11 × ab = a (a + b) b, carrying if a + b ≥ 10.', 'For longer numbers, write the last digit, then the sums of neighbouring digits right to left, then the first digit.'],
    examples: ['11 × 63 = 6 (9) 3 = 693', '11 × 78 = 7 (15) 8 → 858', '11 × 243 = 2 (6) (7) 3 = 2673'],
  },
  {
    id: 'mul9', title: 'Multiplying by 9, 99, 999', skill: 'mul-9s',
    body: ['x × 99 = x × 100 − x. Same idea for 9 and 999: multiply by the next power of ten and subtract.'],
    examples: ['47 × 99 = 4700 − 47 = 4653', '236 × 999 = 236000 − 236 = 235764'],
  },
  {
    id: 'fractions', title: 'Fraction benchmarks', skill: 'frac-dec',
    body: [
      'Know these cold: 1/8 = 0.125, 1/16 = 0.0625, 1/32 = 0.03125; 1/3 = 0.333…, 1/6 = 0.1667, 1/9 = 0.111…, 1/11 = 0.0909…, 1/12 = 0.0833.',
      '1/7 = 0.142857 repeating, and k/7 is the same six digits starting elsewhere: 2/7 = 0.285714, 3/7 = 0.428571.',
      'Build others by addition: 5/16 = 1/4 + 1/16 = 0.3125; 7/12 = 1/2 + 1/12 = 0.5833.',
    ],
    examples: ['3/8 = 0.375', '5/7 = 0.714285…', '11/16 = 0.6875'],
  },
  {
    id: 'pctswap', title: 'The percentage swap', skill: 'pct-swap',
    body: ['x% of y = (x·y)/100 = y% of x. Pick the easier order.'],
    examples: ['8% of 25 = 25% of 8 = 2', '16% of 50 = 50% of 16 = 8', '4% of 75 = 75% of 4 = 3'],
  },
  {
    id: 'compound', title: 'Compounding and the rule of 72', skill: 'compound',
    body: [
      '(1 + r)ⁿ = 1 + nr + n(n−1)r²/2 + …; the first two or three terms are enough for small r. For example 1.05³ ≈ 1 + 0.15 + 0.0075 = 1.1575 (exact 1.157625).',
      'Doubling time ≈ 72 / (rate in %): at 8%, about 9 years. It comes from ln 2 ≈ 0.693 and ln(1 + r) ≈ r − r²/2; 72 has many divisors and corrects for typical rates.',
    ],
    examples: ['1.1⁴ ≈ 1 + 0.4 + 0.06 + 0.004 = 1.464 (exact 1.4641)', 'At 6%, money doubles in ≈ 12 years'],
  },
  {
    id: 'estimate', title: 'Estimating products and roots', skill: 'est-mul',
    body: ['Round one factor up and the other down to keep the product honest, then correct: 47.3 × 21.8 ≈ 47 × 22 = 1034 (true 1031).', 'Square roots: √(a² + d) ≈ a + d/(2a). √2000 = √(44² + 64) ≈ 44 + 64/88 ≈ 44.73 (true 44.72).'],
    examples: ['68 × 0.49 ≈ 68/2 − 68 × 0.01 = 33.32', '√150 ≈ 12 + 6/24 = 12.25 (true 12.247)'],
  },
];
