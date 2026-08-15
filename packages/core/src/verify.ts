/**
 * Hard verification for statistical results.
 *
 * No computed result may be written to the audit log until it passes
 * these assertions. This is the difference between "the AI says the
 * result looks fine" and "the code proves the result is well-formed":
 * every p-value, statistic, and sample size is checked by actual
 * predicates, not by an LLM's opinion.
 */
import type { TestResult } from './stats.js';

export interface VerificationReport {
  ok: boolean;
  errors: string[];
  checkedAt: string;
}

export function verifyResult(r: TestResult): VerificationReport {
  const errors: string[] = [];
  if (!Number.isFinite(r.statistic)) errors.push(`statistic is not finite: ${r.statistic}`);
  if (!Number.isFinite(r.p)) errors.push(`p is not finite: ${r.p}`);
  if (r.p < 0) errors.push(`p < 0: ${r.p}`);
  if (r.p > 1 + 1e-9) errors.push(`p > 1: ${r.p}`);
  if (r.df !== undefined) {
    if (!Number.isFinite(r.df)) errors.push(`df is not finite: ${r.df}`);
    if (r.df <= 0) errors.push(`df <= 0: ${r.df}`);
  }
  if (r.n.length === 0) errors.push('n is empty');
  for (const n of r.n) {
    if (!Number.isInteger(n) || n < 2) errors.push(`n must be an integer >= 2, got ${n}`);
  }
  if (r.effectSize !== undefined && !Number.isFinite(r.effectSize)) errors.push(`effectSize is not finite: ${r.effectSize}`);
  if (r.method.length === 0) errors.push('method is empty');
  return { ok: errors.length === 0, errors, checkedAt: new Date().toISOString() };
}
