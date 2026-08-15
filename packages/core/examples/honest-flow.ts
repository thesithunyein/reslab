/**
 * ResLab end-to-end demo: the honest research flow.
 *
 * Design -> pre-register -> lock -> collect -> analyze -> verify -> detect.
 *
 * Uses deterministic seeded data, so every run produces the same numbers -
 * the reproducibility story is part of the product.
 *
 * Run with: npm run demo
 */
import { AuditLog, canonicalJson, sha256Hex } from '../src/audit.js';
import { runDetectors, severityRank } from '../src/detectors.js';
import { ResearchSession } from '../src/lanes.js';
import { createStudy, lockStudy, newRegistry, verifyLock } from '../src/prereg.js';
import { powerAnalysis } from '../src/power.js';
import { descriptive } from '../src/stats.js';

// ---------------------------------------------------------------------------
// Deterministic pseudo-random generation (mulberry32 + Box-Muller)
// ---------------------------------------------------------------------------
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

function fmt(x: number, digits = 4): string {
  if (Number.isNaN(x)) return 'n/a';
  if (x !== 0 && Math.abs(x) < 1e-4) return x.toExponential(3);
  return Number(x.toFixed(digits)).toString();
}

function line(s = ''): void {
  console.log(s);
}

async function main(): Promise<void> {
  const rule = '='.repeat(72);
  line(rule);
  line('  ResLab - the lab notebook that keeps science honest');
  line('  Design -> pre-register -> analyze -> verify -> detect');
  line(rule);

  // ---------------------------------------------------------------------
  // 1. DESIGN - before any data exists
  // ---------------------------------------------------------------------
  const audit = new AuditLog();
  const registry = newRegistry();
  const session = new ResearchSession(audit, registry);

  const { artifact, powerNote } = createStudy({
    title: 'Spaced repetition vs. massed practice for online learners',
    hypothesis: 'Spaced repetition improves end-of-course exam scores relative to massed practice.',
    outcomeVariable: 'exam_score',
    groupVariable: 'study_condition',
    plannedTest: 'welch_t',
    tails: 2,
    alpha: 0.05,
    powerTarget: 0.8,
    effectSizeGuess: 0.5,
    plannedN: 63,
    exclusionCriteria: [
      'Remove participants who missed more than 2 sessions',
      'Remove scores more than 3 SD from the group mean',
    ],
    missingDataPolicy: 'Listwise deletion; counts reported in the supplement.',
  });
  registry.artifacts.push(artifact);

  line();
  line('1. DESIGN');
  line(`   Title: ${artifact.design.title}`);
  line(`   Planned test: ${artifact.design.plannedTest} | tails: ${artifact.design.tails} | alpha: ${artifact.design.alpha}`);
  line(`   Power note: ${powerNote}`);

  // ---------------------------------------------------------------------
  // 2. PRE-REGISTER - lock the plan before seeing data
  // ---------------------------------------------------------------------
  const locked = await lockStudy(registry, artifact.id, audit);
  line();
  line(`2. PRE-REGISTRATION LOCKED  (${locked.id})`);
  line(`   Checksum: ${locked.checksum!.slice(0, 16)}...`);
  line(`   Lock verified: ${(await verifyLock(locked)).toString().toUpperCase()}`);

  // ---------------------------------------------------------------------
  // 3. COLLECT - deterministic data, and note: fewer than planned
  // ---------------------------------------------------------------------
  const control = normalSample(20260814, 40, 70, 10); // mean 70
  const treated = normalSample(20260815, 40, 78, 10); // mean 78, d ~ 0.8
  await session.recordDataVersion('v1.0.0', 'cleaned and anonymized (seed 20260814/20260815)');
  await session.finalizeData();

  const dc = descriptive(control);
  const dt = descriptive(treated);
  line();
  line('3. DATA COLLECTED (deterministic, reproducible)');
  line(`   Control  n=${dc.n}  mean=${fmt(dc.mean)}  sd=${fmt(dc.sd)}`);
  line(`   Treated  n=${dt.n}  mean=${fmt(dt.mean)}  sd=${fmt(dt.sd)}`);

  const underpowered = powerAnalysis({
    alpha: 0.05, powerTarget: 0.8, tails: 2,
    effectSizeGuess: 0.5, nPerGroup: 40,
  });
  line(`   [!] ${underpowered.message}`);

  // ---------------------------------------------------------------------
  // 4. ANALYZE - confirmatory lane, exactly as pre-registered
  // ---------------------------------------------------------------------
  line();
  line('4. CONFIRMATORY ANALYSIS (pre-registered welch_t on exam_score)');
  const confirmatoryRun = await session.runAnalysis({
    lane: 'confirmatory',
    preregId: artifact.id,
    test: 'welch_t',
    params: { alpha: 0.05, tails: 2, outcomeVariable: 'exam_score' },
    data: { groups: [control, treated] },
  });
  const r = confirmatoryRun.result;
  line(`   t = ${fmt(r.statistic)}  df = ${fmt(r.df!, 2)}  p = ${fmt(r.p)}  d = ${fmt(r.effectSize ?? NaN)}`);
  line(`   Hard verification: ${confirmatoryRun.verification.ok ? 'PASSED [OK]' : 'FAILED [!!]'}`);
  line(`   Compliance: ${confirmatoryRun.compliance.compliant ? 'COMPLIANT [OK]' : 'VIOLATIONS [!!]'}`);
  if (!confirmatoryRun.compliance.compliant) {
    for (const v of confirmatoryRun.compliance.violations) line(`     - ${v}`);
  }

  // A tempting post-hoc test - allowed, but walled off as exploratory.
  line();
  line('5. EXPLORATORY ANALYSIS (post-hoc Mann-Whitney, labeled, not confirmatory)');
  const exploratoryRun = await session.runAnalysis({
    lane: 'exploratory',
    test: 'mann_whitney',
    data: { groups: [control, treated] },
    note: 'post-hoc robustness check (non-parametric)',
  });
  line(`   U = ${fmt(exploratoryRun.result.statistic)}  p = ${fmt(exploratoryRun.result.p)}`);

  // ---------------------------------------------------------------------
  // 6. DETECT - the integrity firewall
  // ---------------------------------------------------------------------
  line();
  line('6. INTEGRITY DETECTORS');
  const findings = runDetectors({ session });
  if (findings.length === 0) {
    line('   No deviations detected. [OK]');
  } else {
    for (const f of [...findings].sort((a, b) => severityRank(b.severity) - severityRank(a.severity))) {
      line(`   [${f.severity.toUpperCase()}] ${f.message}`);
      line(`     -> ${f.explanation}`);
    }
  }

  // ---------------------------------------------------------------------
  // 7. PROVENANCE - audit chain + reproducibility artifact
  // ---------------------------------------------------------------------
  line();
  line('7. PROVENANCE');
  const auditCheck = await audit.verify();
  line(`   Audit log: ${audit.length} events, chain ${auditCheck.valid ? 'INTACT [OK]' : 'BROKEN [!!]'}`);
  const recipe = canonicalJson({
    prereg: locked.id,
    checksum: locked.checksum,
    tests: session.runs.map((x) => ({ test: x.test, lane: x.lane, p: x.result.p })),
    data: 'seed 20260814/20260815, n=40 per group',
  });
  const recipeHash = await sha256Hex(recipe);
  line(`   Recipe (reproduce this analysis): ${recipeHash.slice(0, 16)}...`);
  line();
  line(rule);
  line('Every number above is computed, not generated. The pre-registration');
  line('is tamper-evident, the lanes are separated, and the audit chain');
  line('proves nothing was silently changed.');
  line(rule);
}

void main();
