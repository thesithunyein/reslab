/**
 * Power analysis for the design phase.
 *
 * The point of power analysis is honesty *before* data collection: it tells
 * the researcher what effect sizes they can actually detect with the sample
 * they can afford, so they don't waste months collecting an underpowered
 * study. Normal-approximation formulas are used and documented as such.
 */
import { invNormalCdf } from './special-functions.js';
import { detectableEffectForTwoSample, powerForTwoSample, sampleSizeForTwoSample, zCritical } from './stats.js';

export interface PowerReport {
  design: {
    alpha: number;
    tails: 1 | 2;
    powerTarget: number;
  };
  inputs: {
    effectSizeGuess?: number;
    nPerGroup?: number;
  };
  outputs: {
    requiredNPerGroup?: number;
    power?: number;
    detectableEffect?: number;
  };
  underpowered: boolean;
  message: string;
}

export function powerAnalysis(opts: {
  alpha: number;
  powerTarget: number;
  tails?: 1 | 2;
  effectSizeGuess?: number; // Cohen's d
  nPerGroup?: number;
}): PowerReport {
  const tails = opts.tails ?? 2;
  if (opts.alpha <= 0 || opts.alpha >= 1) throw new RangeError('alpha must be in (0,1)');
  if (opts.powerTarget <= 0 || opts.powerTarget >= 1) throw new RangeError('powerTarget must be in (0,1)');

  if (opts.effectSizeGuess !== undefined && opts.nPerGroup === undefined) {
    const requiredN = sampleSizeForTwoSample(opts.effectSizeGuess, opts.alpha, opts.powerTarget, tails);
    return {
      design: { alpha: opts.alpha, tails, powerTarget: opts.powerTarget },
      inputs: { effectSizeGuess: opts.effectSizeGuess },
      outputs: { requiredNPerGroup: requiredN },
      underpowered: false,
      message: `To detect d = ${opts.effectSizeGuess} with ${Math.round(opts.powerTarget * 100)}% power at alpha = ${opts.alpha} (${tails}-tailed), you need ~${requiredN} participants per group (normal approximation).`,
    };
  }

  if (opts.nPerGroup !== undefined && opts.effectSizeGuess === undefined) {
    const detectable = detectableEffectForTwoSample(opts.nPerGroup, opts.alpha, opts.powerTarget, tails);
    const underpowered = detectable > 0.8;
    return {
      design: { alpha: opts.alpha, tails, powerTarget: opts.powerTarget },
      inputs: { nPerGroup: opts.nPerGroup },
      outputs: { detectableEffect: detectable },
      underpowered,
      message: underpowered
        ? `With n = ${opts.nPerGroup} per group you can only detect effects >= ${detectable.toFixed(2)} SD at ${Math.round(opts.powerTarget * 100)}% power. That is a ${detectable > 0.8 ? 'large' : detectable > 0.5 ? 'medium-large' : 'small-medium'} effect - likely underpowered for a typical study. Collect more data or reconsider.`
        : `With n = ${opts.nPerGroup} per group you can detect effects >= ${detectable.toFixed(2)} SD at ${Math.round(opts.powerTarget * 100)}% power.`,
    };
  }

  if (opts.nPerGroup !== undefined && opts.effectSizeGuess !== undefined) {
    const power = powerForTwoSample(opts.nPerGroup, opts.effectSizeGuess, opts.alpha, tails);
    const underpowered = power < opts.powerTarget;
    return {
      design: { alpha: opts.alpha, tails, powerTarget: opts.powerTarget },
      inputs: { effectSizeGuess: opts.effectSizeGuess, nPerGroup: opts.nPerGroup },
      outputs: { power },
      underpowered,
      message: `With n = ${opts.nPerGroup} per group and d = ${opts.effectSizeGuess}, estimated power is ${(power * 100).toFixed(1)}% (target ${Math.round(opts.powerTarget * 100)}%). ${underpowered ? 'You are underpowered - the study is unlikely to detect the effect even if it exists.' : 'Power is adequate.'}`,
    };
  }

  throw new RangeError('powerAnalysis: provide either effectSizeGuess, nPerGroup, or both');
}

export { zCritical, invNormalCdf };
