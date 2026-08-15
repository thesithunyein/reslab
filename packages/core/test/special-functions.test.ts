import { describe, expect, it } from 'vitest';
import {
  chiSquareCdf,
  erf,
  fRightTailP,
  gammaP,
  invNormalCdf,
  lnGamma,
  normalCdf,
  tTwoSidedP,
} from '../src/special-functions.js';

describe('erf / normal CDF', () => {
  it('erf(1) matches Abramowitz & Stegun', () => {
    expect(erf(1)).toBeCloseTo(0.8427008, 6);
  });
  it('erf(0) = 0', () => {
    expect(erf(0)).toBe(0);
  });
  it('normalCdf(0) = 0.5', () => {
    expect(normalCdf(0)).toBe(0.5);
  });
  it('normalCdf(1.96) ~ 0.975 and normalCdf(-1.96) ~ 0.025', () => {
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
});

describe('inverse normal CDF', () => {
  it('invNormalCdf(0.975) ~ 1.959964', () => {
    expect(invNormalCdf(0.975)).toBeCloseTo(1.959964, 5);
  });
  it('invNormalCdf(0.5) = 0', () => {
    expect(invNormalCdf(0.5)).toBeCloseTo(0, 10);
  });
  it('round-trips the normal CDF', () => {
    for (const z of [-2.5, -1.234, -0.5, 0.3, 1.234, 2.5]) {
      expect(invNormalCdf(normalCdf(z))).toBeCloseTo(z, 5);
    }
  });
  it('rejects p outside (0, 1)', () => {
    expect(() => invNormalCdf(0)).toThrow(RangeError);
    expect(() => invNormalCdf(1)).toThrow(RangeError);
  });
});

describe('gamma', () => {
  it('lnGamma(1) = 0 and lnGamma(5) = ln(24)', () => {
    expect(lnGamma(1)).toBeCloseTo(0, 9);
    expect(lnGamma(5)).toBeCloseTo(Math.log(24), 9);
  });
  it('gammaP(1, x) = 1 - e^-x', () => {
    expect(gammaP(1, 2.9955)).toBeCloseTo(1 - Math.exp(-2.9955), 9);
  });
});

describe('distribution tails match published statistical tables', () => {
  it('t(10) two-sided 0.05 critical value is 2.228', () => {
    expect(tTwoSidedP(2.228, 10)).toBeCloseTo(0.05, 3);
  });
  it('t(20) two-sided 0.05 critical value is 2.086', () => {
    expect(tTwoSidedP(2.086, 20)).toBeCloseTo(0.05, 3);
  });
  it('t(1000) at 1.96 ~ 0.0503 (approaches the normal)', () => {
    expect(tTwoSidedP(1.96, 1000)).toBeCloseTo(0.0503, 3);
  });
  it('chi-square(2) 95th percentile is 5.991', () => {
    expect(chiSquareCdf(5.991, 2)).toBeCloseTo(0.95, 3);
  });
  it('F(2,27) 95th percentile is 3.354', () => {
    expect(fRightTailP(3.354, 2, 27)).toBeCloseTo(0.05, 3);
  });
  it('known paired t p-value (sleep study, t = -4.0621, df = 9)', () => {
    expect(tTwoSidedP(-4.0621277, 9)).toBeCloseTo(0.002833, 5);
  });
});
