/**
 * Special mathematical functions used by the statistics engine.
 *
 * Implementations follow Numerical Recipes (Press et al.) and
 * Abramowitz & Stegun. Each function is validated against known
 * values in test/special-functions.test.ts so the engine's
 * correctness is provable, not assumed.
 */

/** Error function (Abramowitz & Stegun 7.1.26, abs. error < 1.5e-7). */
export function erf(x: number): number {
  if (x === 0) return 0;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/** Standard normal CDF. */
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Inverse standard normal CDF (Acklam's rational approximation). */
export function invNormalCdf(p: number): number {
  if (p <= 0 || p >= 1) throw new RangeError(`invNormalCdf: p must be in (0,1), got ${p}`);
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q: number;
  let r: number;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > phigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/** Lanczos approximation of ln Gamma(z) for z > 0 (Numerical Recipes, g = 5). */
const LANCZOS = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];

export function lnGamma(z: number): number {
  const x = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < LANCZOS.length; j++) ser += LANCZOS[j]! / (x + j + 1);
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

const GAMMA_EPS = 3e-12;
const GAMMA_ITMAX = 200;
const FPMIN = 1e-300;

/** Series expansion of regularized lower incomplete gamma P(a, x). */
function gser(a: number, x: number): number {
  let sum = 1 / a;
  let ap = a;
  let del = sum;
  for (let n = 1; n <= GAMMA_ITMAX; n++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * GAMMA_EPS) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
}

/** Continued fraction for regularized upper incomplete gamma Q(a, x). */
function gcf(a: number, x: number): number {
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= GAMMA_ITMAX; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < GAMMA_EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

/** Regularized lower incomplete gamma P(a, x). */
export function gammaP(a: number, x: number): number {
  if (x < a + 1) return gser(a, x);
  return 1 - gcf(a, x);
}

/** Chi-square CDF with k degrees of freedom. */
export function chiSquareCdf(x: number, k: number): number {
  if (x <= 0) return 0;
  return gammaP(k / 2, x / 2);
}

/** Continued fraction for regularized incomplete beta (Numerical Recipes betacf). */
function betacf(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= GAMMA_ITMAX; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < GAMMA_EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function ibeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/**
 * Two-sided p-value for a t statistic with df degrees of freedom.
 * p2 = I_{df/(df+t^2)}(df/2, 1/2)
 */
export function tTwoSidedP(t: number, df: number): number {
  const x = df / (df + t * t);
  return ibeta(df / 2, 0.5, x);
}

/** Right-tail p-value for an F statistic with (d1, d2) degrees of freedom. */
export function fRightTailP(F: number, d1: number, d2: number): number {
  const x = (d1 * F) / (d1 * F + d2);
  return 1 - ibeta(d1 / 2, d2 / 2, x);
}
