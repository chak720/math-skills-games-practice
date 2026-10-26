/** Exact linear algebra over the rationals (for Markov-chain puzzles). */
import { Q } from './rational';

/** Solve A x = b by Gauss–Jordan elimination with exact rationals. Throws if singular. */
export function solveLinear(A: Q[][], b: Q[]): Q[] {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = -1;
    for (let r = col; r < n; r++) if (!M[r][col].isZero()) { piv = r; break; }
    if (piv < 0) throw new Error('singular system');
    [M[col], M[piv]] = [M[piv], M[col]];
    const p = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] = M[col][c].div(p);
    for (let r = 0; r < n; r++) {
      if (r === col || M[r][col].isZero()) continue;
      const f = M[r][col];
      for (let c = col; c <= n; c++) M[r][c] = M[r][c].sub(f.mul(M[col][c]));
    }
  }
  return M.map((row) => row[n]);
}

/** Inverse of a square matrix (Gauss–Jordan on [A | I]). */
export function invert(A: Q[][]): Q[][] {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? Q.ONE : Q.ZERO))]);
  for (let col = 0; col < n; col++) {
    let piv = -1;
    for (let r = col; r < n; r++) if (!M[r][col].isZero()) { piv = r; break; }
    if (piv < 0) throw new Error('singular matrix');
    [M[col], M[piv]] = [M[piv], M[col]];
    const p = M[col][col];
    for (let c = 0; c < 2 * n; c++) M[col][c] = M[col][c].div(p);
    for (let r = 0; r < n; r++) {
      if (r === col || M[r][col].isZero()) continue;
      const f = M[r][col];
      for (let c = 0; c < 2 * n; c++) M[r][c] = M[r][c].sub(f.mul(M[col][c]));
    }
  }
  return M.map((row) => row.slice(n));
}

export function matMul(A: Q[][], B: Q[][]): Q[][] {
  return A.map((row) => B[0].map((_, j) => row.reduce((s, a, k) => s.add(a.mul(B[k][j])), Q.ZERO)));
}

export type Pt = [Q, Q];

/** Clip a convex polygon by the half-plane a·x + b·y <= c (Sutherland–Hodgman), exactly. */
export function clipHalfPlane(poly: Pt[], a: Q, b: Q, c: Q): Pt[] {
  const inside = (p: Pt): boolean => a.mul(p[0]).add(b.mul(p[1])).cmp(c) <= 0;
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i], R = poly[(i + 1) % poly.length];
    const pi = inside(P), ri = inside(R);
    if (pi) out.push(P);
    if (pi !== ri) {
      // Intersection of segment PR with the line: t = (c − a·P) / (a·(R−P))
      const dx = R[0].sub(P[0]), dy = R[1].sub(P[1]);
      const denom = a.mul(dx).add(b.mul(dy));
      const t = c.sub(a.mul(P[0]).add(b.mul(P[1]))).div(denom);
      out.push([P[0].add(dx.mul(t)), P[1].add(dy.mul(t))]);
    }
  }
  return out;
}

/** Exact polygon area by the shoelace formula. */
export function area(poly: Pt[]): Q {
  let s = Q.ZERO;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    s = s.add(x1.mul(y2).sub(x2.mul(y1)));
  }
  const a = s.div(2);
  return a.cmp(0) < 0 ? a.neg() : a;
}
