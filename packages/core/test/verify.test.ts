import { describe, expect, it } from 'vitest';
import { verifyResult } from '../src/verify.js';
import type { TestResult } from '../src/stats.js';

const good: TestResult = {
  test: 'welch_t',
  statistic: -1.86,
  df: 17.78,
  p: 0.0794,
  effectSize: -0.83,
  n: [10, 10],
  method: "Welch's t-test (unequal variances)",
};

describe('verifyResult', () => {
  it('accepts a well-formed result', () => {
    const v = verifyResult(good);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });
  it('rejects NaN / infinite statistics', () => {
    expect(verifyResult({ ...good, statistic: NaN }).ok).toBe(false);
    expect(verifyResult({ ...good, statistic: Infinity }).ok).toBe(false);
  });
  it('rejects out-of-range p-values', () => {
    expect(verifyResult({ ...good, p: -0.01 }).ok).toBe(false);
    expect(verifyResult({ ...good, p: 1.5 }).ok).toBe(false);
    expect(verifyResult({ ...good, p: NaN }).ok).toBe(false);
  });
  it('rejects non-positive or non-finite degrees of freedom', () => {
    expect(verifyResult({ ...good, df: 0 }).ok).toBe(false);
    expect(verifyResult({ ...good, df: NaN }).ok).toBe(false);
  });
  it('rejects invalid sample sizes', () => {
    expect(verifyResult({ ...good, n: [1, 10] }).ok).toBe(false);
    expect(verifyResult({ ...good, n: [10.5, 10] }).ok).toBe(false);
    expect(verifyResult({ ...good, n: [] }).ok).toBe(false);
  });
  it('rejects a missing method string', () => {
    expect(verifyResult({ ...good, method: '' }).ok).toBe(false);
  });
});
