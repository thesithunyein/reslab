import { describe, expect, it } from 'vitest';
import {
  cohensD,
  descriptive,
  detectableEffectForTwoSample,
  jarqueBera,
  levene,
  mannWhitney,
  oneWayAnova,
  pairedT,
  pearson,
  powerForTwoSample,
  recommendTwoGroupTest,
  sampleSizeForTwoSample,
  twoSampleT,
  zCritical,
} from '../src/stats.js';

// R "sleep" dataset (extra sleep hours, two groups of 10).
const SLEEP_G1 = [0.7, -1.6, -0.2, -1.2, -0.1, 3.4, 3.7, 0.8, 0.0, 2.0];
const SLEEP_G2 = [1.9, 0.8, 1.1, 0.1, -0.1, 4.4, 5.5, 1.6, 4.6, 3.4];

// R "PlantGrowth" dataset (three groups of 10).
const PG_CTRL = [4.17, 5.58, 5.18, 6.11, 4.5, 4.61, 5.17, 4.53, 5.33, 5.14];
const PG_TRT1 = [4.81, 4.17, 4.41, 3.59, 5.87, 3.83, 6.03, 4.89, 4.32, 4.69];
const PG_TRT2 = [6.31, 5.12, 5.54, 5.5, 5.37, 5.29, 4.92, 6.15, 5.8, 5.26];

// Anscombe's quartet, dataset I.
const ANSCOMBE_X = [10, 8, 13, 9, 11, 14, 6, 4, 12, 7, 5];
const ANSCOMBE_Y = [8.04, 6.95, 7.58, 8.81, 8.33, 9.96, 7.24, 4.26, 10.84, 4.82, 5.68];

describe('descriptive', () => {
  it('matches numpy on the sleep group 1 sample', () => {
    const d = descriptive(SLEEP_G1);
    expect(d.n).toBe(10);
    expect(d.mean).toBeCloseTo(0.75, 9);
    expect(d.variance).toBeCloseTo(3.2005555556, 8);
    expect(d.sd).toBeCloseTo(1.7890096578, 8);
    expect(d.median).toBeCloseTo(0.35, 9);
    expect(d.q1).toBeCloseTo(-0.175, 9);
    expect(d.q3).toBeCloseTo(1.7, 9);
    expect(d.min).toBe(-1.6);
    expect(d.max).toBe(3.7);
    expect(d.skewness).toBeCloseTo(0.4898753250, 6);
    expect(d.kurtosisExcess).toBeCloseTo(-0.9017177044, 6);
  });
  it('throws on an empty sample', () => {
    expect(() => descriptive([])).toThrow(RangeError);
  });
});

describe('two-sample t-tests (published R values for the sleep dataset)', () => {
  it('Student pooled t: t = -1.8608, df = 18, p = 0.0792', () => {
    const r = twoSampleT(SLEEP_G1, SLEEP_G2, { equalVariance: true });
    expect(r.statistic).toBeCloseTo(-1.8608135, 5);
    expect(r.df).toBe(18);
    expect(r.p).toBeCloseTo(0.0791867, 5);
    expect(r.n).toEqual([10, 10]);
    expect(r.effectSize).toBeCloseTo(-0.8321811, 5);
  });
  it('Welch: t = -1.8608, df = 17.776, p = 0.0794', () => {
    const r = twoSampleT(SLEEP_G1, SLEEP_G2, { equalVariance: false });
    expect(r.statistic).toBeCloseTo(-1.8608135, 5);
    expect(r.df).toBeCloseTo(17.7764735, 5);
    expect(r.p).toBeCloseTo(0.0793941, 5);
  });
  it('cohensD is computed from the pooled variance', () => {
    expect(cohensD(SLEEP_G1, SLEEP_G2)).toBeCloseTo(-0.8321811, 5);
  });
});

describe('paired t-test', () => {
  it('sleep dataset: t = -4.0621, df = 9, p = 0.002833', () => {
    const r = pairedT(SLEEP_G1, SLEEP_G2);
    expect(r.statistic).toBeCloseTo(-4.0621277, 5);
    expect(r.df).toBe(9);
    expect(r.p).toBeCloseTo(0.0028329, 5);
    expect(r.effectSize).toBeCloseTo(-1.2845576, 4);
  });
  it('requires equal-length samples', () => {
    expect(() => pairedT([1, 2], [1])).toThrow(RangeError);
  });
});

describe('one-way ANOVA', () => {
  it('PlantGrowth: F = 4.8461, df = (2, 27), p = 0.01591', () => {
    const r = oneWayAnova([PG_CTRL, PG_TRT1, PG_TRT2]);
    expect(r.statistic).toBeCloseTo(4.8460879, 5);
    expect(r.df).toBe(2);
    expect(r.p).toBeCloseTo(0.01591, 4);
    expect(r.n).toEqual([10, 10, 10]);
    expect(r.extra?.df2).toBe(27);
    expect(r.extra?.etaSquared).toBeCloseTo(0.2641483, 4);
  });
});

describe('Pearson correlation', () => {
  it('Anscombe I: r = 0.81642, t = 4.2415, p = 0.00217', () => {
    const r = pearson(ANSCOMBE_X, ANSCOMBE_Y);
    expect(r.statistic).toBeCloseTo(0.8164205, 5);
    expect(r.p).toBeCloseTo(0.0021696, 5);
    expect(r.df).toBe(9);
  });
  it('perfect linear data gives r = +/- 1', () => {
    expect(pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]).statistic).toBeCloseTo(1, 9);
    expect(pearson([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]).statistic).toBeCloseTo(-1, 9);
  });
});

describe('Mann-Whitney U', () => {
  it('exact two-sided p for fully separated groups: U = 0, p = 2/70', () => {
    const r = mannWhitney([1, 2, 3, 4], [5, 6, 7, 8]);
    expect(r.statistic).toBe(0);
    expect(r.p).toBeCloseTo(0.0285714, 6);
  });
  it('uses the normal approximation (with tie correction) for larger samples', () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const b = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    const r = mannWhitney(a, b);
    expect(r.p).toBeGreaterThan(0);
    expect(r.p).toBeLessThanOrEqual(1);
  });
});

describe('Levene / Jarque-Bera assumption checks', () => {
  it('Levene on sleep data: F = 0.6197, p = 0.4414', () => {
    const r = levene([SLEEP_G1, SLEEP_G2]);
    expect(r.statistic).toBeCloseTo(0.6197235, 5);
    expect(r.p).toBeCloseTo(0.4413931, 4);
    expect(r.df).toBe(1);
    expect(r.extra?.df2).toBe(18);
  });
  it('Jarque-Bera on 1..8: JB = 0.5110, p = 0.7745', () => {
    const r = jarqueBera([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(r.statistic).toBeCloseTo(0.5109599, 5);
    expect(r.p).toBeCloseTo(0.7745447, 4);
    expect(r.df).toBe(2);
  });
});

// Deterministic normal generator (mulberry32 + Box-Muller) so the
// assumption checks below are reproducible.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normalSample(seed: number, n: number, mean: number, sd: number): number[] {
  const rand = mulberry32(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const u = Math.max(rand(), 1e-12);
    const v = rand();
    out.push(mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
  }
  return out;
}

describe('assumption-aware test recommendation', () => {
  it('normal + equal variances -> Student t', () => {
    const rec = recommendTwoGroupTest(SLEEP_G1, SLEEP_G2);
    expect(rec.recommended).toBe('two_sample_t');
    expect(rec.checks.length).toBe(2);
  });
  it('normal + unequal variances -> Welch t', () => {
    const a = normalSample(42, 30, 0, 1);
    const b = normalSample(1337, 30, 0, 8);
    const rec = recommendTwoGroupTest(a, b);
    expect(rec.recommended).toBe('welch_t');
  });
  it('heavy skew -> Mann-Whitney', () => {
    const a = [1, 1, 1, 1, 2, 2, 2, 3, 3, 4, 5, 6, 8, 12, 20, 40];
    const b = [3, 3, 3, 3, 4, 4, 4, 5, 5, 6, 7, 8, 10, 14, 22, 42];
    const rec = recommendTwoGroupTest(a, b);
    expect(rec.recommended).toBe('mann_whitney');
  });
});

describe('power analysis', () => {
  it('n = 63 per group detects d = 0.5 at 80% power, alpha = 0.05', () => {
    expect(sampleSizeForTwoSample(0.5, 0.05, 0.8, 2)).toBe(63);
  });
  it('detectable effect with n = 25 is d ~ 0.7924', () => {
    expect(detectableEffectForTwoSample(25, 0.05, 0.8, 2)).toBeCloseTo(0.7924, 3);
  });
  it('power for the computed n is ~0.80', () => {
    const p = powerForTwoSample(63, 0.5, 0.05, 2);
    expect(p).toBeGreaterThan(0.79);
    expect(p).toBeLessThan(0.81);
  });
  it('zCritical(0.05, two-tailed) = 1.959964', () => {
    expect(zCritical(0.05, 2)).toBeCloseTo(1.959964, 5);
  });
});
