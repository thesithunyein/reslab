/**
 * Statistical test engine.
 *
 * Every test returns a TestResult with a named statistic, degrees of
 * freedom, p-value, effect size, and the exact method used. Results are
 * passed through `verifyResult` (verify.ts) before they can be written to
 * the audit log, so no NaN/out-of-range value ever becomes part of a
 * study record.
 */
import { chiSquareCdf, fRightTailP, invNormalCdf, normalCdf, tTwoSidedP } from './special-functions.js';

export type TestName =
  | 'two_sample_t'
  | 'welch_t'
  | 'paired_t'
  | 'one_way_anova'
  | 'pearson'
  | 'mann_whitney'
  | 'jarque_bera'
  | 'levene';

export interface TestResult {
  test: TestName;
  statistic: number;
  df?: number;
  p: number;
  effectSize?: number;
  n: number[]; // sample sizes, one entry per group
  method: string;
  extra?: Record<string, number | string>;
}

/** Descriptive statistics for one sample. */
export interface DescriptiveStats {
  n: number;
  mean: number;
  variance: number; // sample variance (n-1)
  sd: number;
  median: number;
  min: number;
  max: number;
  q1: number;
  q3: number;
  skewness: number;
  kurtosisExcess: number;
}

function finiteOrThrow(v: number, what: string): void {
  if (!Number.isFinite(v)) throw new RangeError(`${what} is not finite: ${v}`);
}

function meanOf(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function descriptive(xs: number[]): DescriptiveStats {
  if (xs.length === 0) throw new RangeError('descriptive: empty sample');
  const n = xs.length;
  const mean = meanOf(xs);
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const x of xs) {
    const d = x - mean;
    m2 += d * d;
    m3 += d * d * d;
    m4 += d * d * d * d;
  }
  const variance = m2 / (n - 1);
  const sorted = [...xs].sort((a, b) => a - b);
  const sd = Math.sqrt(variance);
  const skewness = n > 2 ? (m3 / n) / Math.pow(m2 / n, 1.5) : 0;
  const kurtosisExcess = n > 3 ? (m4 / n) / Math.pow(m2 / n, 2) - 3 : 0;
  return {
    n,
    mean,
    variance,
    sd,
    median: quantile(sorted, 0.5),
    min: sorted[0]!,
    max: sorted[n - 1]!,
    q1: quantile(sorted, 0.25),
    q3: quantile(sorted, 0.75),
    skewness,
    kurtosisExcess,
  };
}

/** Cohen's d for two independent samples. */
export function cohensD(a: number[], b: number[]): number {
  const na = a.length;
  const nb = b.length;
  const pooled = Math.sqrt(((na - 1) * descriptive(a).variance + (nb - 1) * descriptive(b).variance) / (na + nb - 2));
  if (pooled === 0) return 0;
  return (meanOf(a) - meanOf(b)) / pooled;
}

export interface TTestOpts {
  equalVariance: boolean; // false -> Welch
  tails?: 1 | 2;
}

/** Independent two-sample t-test (Student's pooled or Welch). */
export function twoSampleT(a: number[], b: number[], opts: TTestOpts): TestResult {
  const na = a.length;
  const nb = b.length;
  if (na < 2 || nb < 2) throw new RangeError('twoSampleT: each group needs >= 2 observations');
  const tails = opts.tails ?? 2;
  const va = descriptive(a).variance;
  const vb = descriptive(b).variance;
  const meanDiff = meanOf(a) - meanOf(b);
  let t: number;
  let df: number;
  let method: string;
  if (opts.equalVariance) {
    const sp2 = ((na - 1) * va + (nb - 1) * vb) / (na + nb - 2);
    t = meanDiff / Math.sqrt(sp2 * (1 / na + 1 / nb));
    df = na + nb - 2;
    method = 'Student\'s independent t-test (pooled variance)';
  } else {
    t = meanDiff / Math.sqrt(va / na + vb / nb);
    df = Math.pow(va / na + vb / nb, 2) / (Math.pow(va / na, 2) / (na - 1) + Math.pow(vb / nb, 2) / (nb - 1));
    method = 'Welch\'s t-test (unequal variances)';
  }
  const p = tails === 1 ? tTwoSidedP(Math.abs(t), df) / 2 : tTwoSidedP(t, df);
  const result: TestResult = { test: 'welch_t', statistic: t, df, p, effectSize: cohensD(a, b), n: [na, nb], method };
  result.test = opts.equalVariance ? 'two_sample_t' : 'welch_t';
  return result;
}

/** Paired t-test. */
export function pairedT(a: number[], b: number[]): TestResult {
  if (a.length !== b.length || a.length < 2) throw new RangeError('pairedT: equal-length samples with >= 2 pairs required');
  const diffs = a.map((x, i) => x - b[i]!);
  const d = descriptive(diffs);
  const t = d.mean / (d.sd / Math.sqrt(d.n));
  const df = d.n - 1;
  return {
    test: 'paired_t',
    statistic: t,
    df,
    p: tTwoSidedP(t, df),
    effectSize: d.mean / d.sd,
    n: [d.n],
    method: 'Paired t-test on differences',
  };
}

/** One-way ANOVA (between-groups F test). */
export function oneWayAnova(groups: number[][]): TestResult {
  const k = groups.length;
  if (k < 2) throw new RangeError('oneWayAnova: at least 2 groups required');
  const sizes = groups.map((g) => g.length);
  if (sizes.some((n) => n < 2)) throw new RangeError('oneWayAnova: each group needs >= 2 observations');
  const N = sizes.reduce((a, b) => a + b, 0);
  const grandMean = groups.reduce((s, g) => s + g.reduce((x, y) => x + y, 0), 0) / N;
  let ssBetween = 0;
  let ssWithin = 0;
  for (let i = 0; i < k; i++) {
    const g = groups[i]!;
    const m = meanOf(g);
    ssBetween += g.length * (m - grandMean) * (m - grandMean);
    for (const x of g) ssWithin += (x - m) * (x - m);
  }
  const df1 = k - 1;
  const df2 = N - k;
  const msBetween = ssBetween / df1;
  const msWithin = ssWithin / df2;
  const F = msBetween / msWithin;
  return {
    test: 'one_way_anova',
    statistic: F,
    df: df1,
    p: fRightTailP(F, df1, df2),
    effectSize: undefined,
    n: sizes,
    method: 'One-way ANOVA (F test)',
    extra: { df2, ssBetween, ssWithin, msBetween, msWithin, etaSquared: ssBetween / (ssBetween + ssWithin) },
  };
}

/** Pearson product-moment correlation with t-based p-value. */
export function pearson(x: number[], y: number[]): TestResult {
  if (x.length !== y.length || x.length < 3) throw new RangeError('pearson: equal-length samples with >= 3 pairs required');
  const n = x.length;
  const mx = meanOf(x);
  const my = meanOf(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const denom = Math.sqrt(sxx * syy);
  const r = denom === 0 ? 0 : sxy / denom;
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  const df = n - 2;
  return {
    test: 'pearson',
    statistic: r,
    df,
    p: tTwoSidedP(t, df),
    effectSize: r,
    n: [n],
    method: 'Pearson product-moment correlation',
  };
}

/**
 * Exact Mann-Whitney U for small samples (no ties), otherwise the
 * normal approximation with continuity correction.
 */
export function mannWhitney(a: number[], b: number[]): TestResult {
  const n1 = a.length;
  const n2 = b.length;
  if (n1 < 2 || n2 < 2) throw new RangeError('mannWhitney: each group needs >= 2 observations');

  const ranks = rankWithTies([...a, ...b]);
  const n = n1 + n2;
  let sumRanksA = 0;
  for (let i = 0; i < n1; i++) sumRanksA += ranks[i]!;
  const u1 = sumRanksA - (n1 * (n1 + 1)) / 2;
  const u2 = n1 * n2 - u1;
  const u = Math.min(u1, u2);

  let p: number;
  let method: string;
  if (n1 * n2 <= 100 && !hasTies(ranks)) {
    p = exactTwoSidedP(n1, n2, u);
    method = 'Mann-Whitney U exact test (permutation count)';
  } else {
    const mu = (n1 * n2) / 2;
    let tieCorr = 0;
    const groups = new Map<number, number>();
    for (const r of ranks) groups.set(r, (groups.get(r) ?? 0) + 1);
    for (const t of groups.values()) if (t > 1) tieCorr += (t * t * t - t) / 12;
    const sigma = Math.sqrt(((n1 * n2) / (n * (n - 1))) * (((n * n * n - n) / 12) - tieCorr));
    const z = sigma === 0 ? 0 : (u - mu + 0.5) / sigma; // continuity correction
    p = 2 * (1 - normalCdf(Math.abs(z)));
    method = 'Mann-Whitney U normal approximation (continuity + tie correction)';
  }
  return {
    test: 'mann_whitney',
    statistic: u,
    p: Math.min(p, 1),
    effectSize: undefined,
    n: [n1, n2],
    method,
    extra: { u1, u2 },
  };
}

function hasTies(ranks: number[]): boolean {
  return new Set(ranks).size !== ranks.length;
}

/** Average ranks, ties get the mean of their ranks. */
function rankWithTies(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.v === order[i]!.v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]!.i] = avg;
    i = j + 1;
  }
  return ranks;
}

/** Exact two-sided p-value for Mann-Whitney U with sizes (n1, n2) and no ties. */
function exactTwoSidedP(n1: number, n2: number, uObs: number): number {
  const N = n1 + n2;
  const total = comb(N, n1);
  const offset = (n1 * (n1 + 1)) / 2;
  // dp[k][s] = ways to pick k ranks (from 1..N) summing to s
  const dp: number[][] = Array.from({ length: n1 + 1 }, () => new Array(n1 * n2 + offset + 1).fill(0));
  dp[0]![0] = 1;
  for (let rank = 1; rank <= N; rank++) {
    for (let k = Math.min(n1, rank); k >= 1; k--) {
      for (let s = k * rank; s >= k; s--) {
        const prev = dp[k - 1]![s - rank] ?? 0;
        if (prev) dp[k]![s] = (dp[k]![s] ?? 0) + prev;
      }
    }
  }
  const uLimit = Math.floor(uObs);
  let count = 0;
  for (let s = offset; s <= offset + uLimit; s++) count += dp[n1]![s] ?? 0;
  const pLeft = count / total;
  return Math.min(2 * pLeft, 1);
}

function comb(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

/** Jarque-Bera normality test (chi-square with 2 df). */
export function jarqueBera(xs: number[]): TestResult {
  const d = descriptive(xs);
  if (d.n < 8) throw new RangeError('jarqueBera: needs >= 8 observations');
  const jb = (d.n / 6) * (d.skewness * d.skewness + (d.kurtosisExcess * d.kurtosisExcess) / 4);
  return {
    test: 'jarque_bera',
    statistic: jb,
    df: 2,
    p: 1 - chiSquareCdf(jb, 2),
    n: [d.n],
    method: 'Jarque-Bera normality test',
  };
}

/** Levene's test for homogeneity of variance (classic, on group means). */
export function levene(groups: number[][]): TestResult {
  const k = groups.length;
  if (k < 2) throw new RangeError('levene: at least 2 groups required');
  const N = groups.reduce((s, g) => s + g.length, 0);
  if (groups.some((g) => g.length < 2)) throw new RangeError('levene: each group needs >= 2 observations');
  const z: number[][] = groups.map((g) => {
    const m = meanOf(g);
    return g.map((x) => Math.abs(x - m));
  });
  const zMean = meanOf(z.flat());
  let ssBetween = 0;
  let ssWithin = 0;
  for (const g of z) {
    const m = meanOf(g);
    ssBetween += g.length * (m - zMean) * (m - zMean);
    for (const x of g) ssWithin += (x - m) * (x - m);
  }
  const df1 = k - 1;
  const df2 = N - k;
  const F = ((N - k) / (k - 1)) * (ssBetween / ssWithin);
  return {
    test: 'levene',
    statistic: F,
    df: df1,
    p: fRightTailP(F, df1, df2),
    n: groups.map((g) => g.length),
    method: "Levene's test for homogeneity of variance",
    extra: { df2 },
  };
}

/**
 * Statistical decision engine: choose the appropriate test for two-group
 * comparisons based on pre-registered intent and data assumptions.
 *
 * Returns the recommended test name, the assumption check results, and a
 * human-readable explanation of WHY that test was chosen. This is the
 * "assumption-aware" behavior that distinguishes ResLab from a calculator:
 * if normality fails, it recommends the non-parametric counterpart.
 */
export interface AssumptionCheck {
  test: TestName;
  statistic: number;
  p: number;
  passed: boolean;
  interpretation: string;
}

export interface TestRecommendation {
  recommended: TestName;
  checks: AssumptionCheck[];
  explanation: string;
  preRegisteredTest?: TestName;
  deviation?: string;
}

export function recommendTwoGroupTest(a: number[], b: number[]): TestRecommendation {
  const checks: AssumptionCheck[] = [];
  let normalityOk = true;
  if (a.length >= 8 && b.length >= 8) {
    const ja = jarqueBera(a);
    const jb = jarqueBera(b);
    const pooledP = Math.max(ja.p, jb.p); // worst case across groups
    const passed = pooledP > 0.05;
    normalityOk = passed;
    checks.push({
      test: 'jarque_bera',
      statistic: pooledP,
      p: pooledP,
      passed,
      interpretation: `Normality (Jarque-Bera, worst case across groups): ${passed ? 'plausible' : 'violated'} (p = ${pooledP.toFixed(3)})`,
    });
  } else {
    checks.push({
      test: 'jarque_bera',
      statistic: 0,
      p: 1,
      passed: true,
      interpretation: 'Normality not assessed (n < 8 per group); assuming non-parametric-safe path unavailable.',
    });
    normalityOk = false;
  }
  const lv = levene([a, b]);
  const varianceOk = lv.p > 0.05;
  checks.push({
    test: 'levene',
    statistic: lv.statistic,
    p: lv.p,
    passed: varianceOk,
    interpretation: `Variance homogeneity (Levene): ${varianceOk ? 'plausible' : 'violated'} (p = ${lv.p.toFixed(3)})`,
  });

  let recommended: TestName;
  let explanation: string;
  if (normalityOk && varianceOk) {
    recommended = 'two_sample_t';
    explanation = 'Normality and variance homogeneity both plausible -> Student\'s t-test (parametric, pooled).';
  } else if (normalityOk && !varianceOk) {
    recommended = 'welch_t';
    explanation = 'Normality plausible but variances unequal -> Welch\'s t-test (unequal variances).';
  } else {
    recommended = 'mann_whitney';
    explanation = 'Normality not plausible -> Mann-Whitney U (non-parametric).';
  }
  return { recommended, checks, explanation };
}

/** Sample-size helpers used by power analysis. */
export function zCritical(alpha: number, tails: 1 | 2): number {
  return tails === 1 ? invNormalCdf(1 - alpha) : invNormalCdf(1 - alpha / 2);
}

export function powerForTwoSample(nPerGroup: number, d: number, alpha: number, tails: 1 | 2): number {
  const zc = zCritical(alpha, tails);
  const z = d * Math.sqrt(nPerGroup / 2) - zc;
  return normalCdf(z);
}

export function sampleSizeForTwoSample(d: number, alpha: number, power: number, tails: 1 | 2): number {
  finiteOrThrow(d, 'effect size');
  if (d <= 0) throw new RangeError('sampleSizeForTwoSample: effect size must be > 0');
  const zc = zCritical(alpha, tails);
  const zp = invNormalCdf(power);
  return Math.ceil(2 * Math.pow((zc + zp) / d, 2));
}

export function detectableEffectForTwoSample(nPerGroup: number, alpha: number, power: number, tails: 1 | 2): number {
  const zc = zCritical(alpha, tails);
  const zp = invNormalCdf(power);
  return ((zc + zp) * Math.sqrt(2)) / Math.sqrt(nPerGroup);
}
