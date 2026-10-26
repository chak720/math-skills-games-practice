/**
 * Exact rational arithmetic on BigInt. Puzzle answers are computed exactly
 * (e.g. 1225/7776), never as floating-point approximations.
 */
const abs = (x: bigint): bigint => (x < 0n ? -x : x);

export function gcd(a: bigint, b: bigint): bigint {
  a = abs(a);
  b = abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

export class Q {
  readonly n: bigint;
  readonly d: bigint;

  constructor(n: bigint | number, d: bigint | number = 1n) {
    let nn = BigInt(n);
    let dd = BigInt(d);
    if (dd === 0n) throw new RangeError('zero denominator');
    if (dd < 0n) {
      nn = -nn;
      dd = -dd;
    }
    const g = gcd(nn, dd) || 1n;
    this.n = nn / g;
    this.d = dd / g;
  }

  static readonly ZERO = new Q(0);
  static readonly ONE = new Q(1);

  static of(x: Q | bigint | number): Q {
    if (x instanceof Q) return x;
    if (typeof x === 'number' && !Number.isInteger(x)) return Q.fromDecimal(x);
    return new Q(BigInt(x));
  }

  /** Exact value of a finite decimal (via its shortest string form). */
  static fromDecimal(x: number): Q {
    const s = x.toString();
    if (s.includes('e')) throw new RangeError('exponent form not supported');
    const [i, f = ''] = s.split('.');
    return new Q(BigInt(i + f), 10n ** BigInt(f.length));
  }

  add(o: Q | bigint | number): Q { const b = Q.of(o); return new Q(this.n * b.d + b.n * this.d, this.d * b.d); }
  sub(o: Q | bigint | number): Q { const b = Q.of(o); return new Q(this.n * b.d - b.n * this.d, this.d * b.d); }
  mul(o: Q | bigint | number): Q { const b = Q.of(o); return new Q(this.n * b.n, this.d * b.d); }
  div(o: Q | bigint | number): Q { const b = Q.of(o); return new Q(this.n * b.d, this.d * b.n); }
  neg(): Q { return new Q(-this.n, this.d); }
  inv(): Q { return new Q(this.d, this.n); }
  pow(k: number): Q { return k >= 0 ? new Q(this.n ** BigInt(k), this.d ** BigInt(k)) : this.inv().pow(-k); }
  cmp(o: Q | bigint | number): number { const b = Q.of(o); const l = this.n * b.d, r = b.n * this.d; return l < r ? -1 : l > r ? 1 : 0; }
  eq(o: Q | bigint | number): boolean { return this.cmp(o) === 0; }
  isZero(): boolean { return this.n === 0n; }
  isInteger(): boolean { return this.d === 1n; }
  toNumber(): number {
    // Scale to keep precision for huge numerators/denominators.
    const num = Number(this.n), den = Number(this.d);
    if (Number.isFinite(num) && Number.isFinite(den)) return num / den;
    const shift = BigInt(Math.max(0, this.d.toString().length - 300));
    return Number(this.n / 10n ** shift) / Number(this.d / 10n ** shift);
  }
  toString(): string { return this.d === 1n ? this.n.toString() : `${this.n}/${this.d}`; }
  /** e.g. "1225/7776 ≈ 0.1575" */
  pretty(digits = 4): string {
    return this.d === 1n ? this.n.toString() : `${this.n}/${this.d} ≈ ${this.toNumber().toFixed(digits)}`;
  }
}

export const q = (n: bigint | number, d: bigint | number = 1n): Q => new Q(n, d);

export function sumQ(xs: readonly Q[]): Q {
  return xs.reduce((a, b) => a.add(b), Q.ZERO);
}

/**
 * Parses a user answer: integer, decimal, fraction "a/b", percentage "12.5%",
 * or mixed "1 1/2". Returns null if unparseable.
 */
export function parseAnswer(raw: string): number | null {
  const s = raw.trim().replace(/,/g, '').replace(/\s+/g, ' ');
  if (!s) return null;
  let m = s.match(/^(-?\d+) (\d+)\/(\d+)$/);
  if (m) {
    const whole = Number(m[1]);
    const frac = Number(m[2]) / Number(m[3]);
    return whole < 0 ? whole - frac : whole + frac;
  }
  m = s.match(/^(-?\d*\.?\d+)\s*\/\s*(-?\d*\.?\d+)$/);
  if (m) {
    const den = Number(m[2]);
    return den === 0 ? null : Number(m[1]) / den;
  }
  m = s.match(/^(-?\d*\.?\d+)\s*%$/);
  if (m) return Number(m[1]) / 100;
  if (/^-?\d*\.?\d+(e-?\d+)?$/i.test(s)) return Number(s);
  return null;
}
