/**
 * ResLab report demo: run the honest flow, then generate a grounded
 * methods+results report from the ACTUAL computed statistics via
 * Featherless (GLM-5). The LLM never computes a number; it interprets
 * the verified results and cites them.
 *
 * Run with: npm run report
 * Requires FEATHERLESS_API_KEY in .env (gitignored).
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AuditLog, sha256Hex } from '../src/audit.js';
import { runDetectors } from '../src/detectors.js';
import { ResearchSession } from '../src/lanes.js';
import { generateWriteup } from '../src/llm/writeup.js';
import { createStudy, lockStudy, newRegistry } from '../src/prereg.js';
import { powerAnalysis } from '../src/power.js';
import { descriptive } from '../src/stats.js';

// Load .env manually (tsx does not auto-load it). Walk up to find the project root .env.
function loadEnv(): void {
  let dir = process.cwd();
  for (let depth = 0; depth < 4; depth++) {
    const envPath = join(dir, '.env');
    if (existsSync(envPath)) {
      for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!;
      }
      return;
    }
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
}

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

async function main(): Promise<void> {
  loadEnv();

  // --- replicate the honest flow (deterministic) ---
  const audit = new AuditLog();
  const registry = newRegistry();
  const session = new ResearchSession(audit, registry);

  const { artifact } = createStudy({
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
  await lockStudy(registry, artifact.id, audit);

  const control = normalSample(20260814, 40, 70, 10);
  const treated = normalSample(20260815, 40, 78, 10);
  const dc = descriptive(control);
  const dt = descriptive(treated);
  await session.recordDataVersion('v1.0.0', 'cleaned and anonymized (seed 20260814/20260815)');
  await session.finalizeData();

  const run = await session.runAnalysis({
    lane: 'confirmatory',
    preregId: artifact.id,
    test: 'welch_t',
    params: { alpha: 0.05, tails: 2, outcomeVariable: 'exam_score' },
    data: { groups: [control, treated] },
  });

  const underpowered = powerAnalysis({
    alpha: 0.05, powerTarget: 0.8, tails: 2, effectSizeGuess: 0.5, nPerGroup: 40,
  });

  const findings = runDetectors({ session });

  console.log('Computing from verified results:');
  console.log(`  t = ${run.result.statistic.toFixed(4)}  df = ${run.result.df!.toFixed(2)}  p = ${run.result.p.toExponential(3)}  d = ${run.result.effectSize!.toFixed(4)}`);
  console.log(`  Integrity findings: ${findings.length}`);
  console.log('Generating grounded report via Featherless (GLM-5)...\n');

  const report = await generateWriteup({
    title: artifact.design.title,
    hypothesis: artifact.design.hypothesis,
    outcomeVariable: 'exam_score',
    plannedTest: 'welch_t',
    alpha: 0.05,
    tails: 2,
    plannedN: 63,
    actualN: run.result.n,
    groups: [
      { label: 'massed practice', n: dc.n, mean: dc.mean, sd: dc.sd },
      { label: 'spaced repetition', n: dt.n, mean: dt.mean, sd: dt.sd },
    ],
    method: run.result.method,
    statistic: run.result.statistic,
    df: run.result.df,
    p: run.result.p,
    effectSize: run.result.effectSize,
    significant: run.result.p < 0.05,
    findings: findings.map((f) => ({ pattern: f.pattern, severity: f.severity, message: f.message })),
  });

  console.log(report.markdown);
  console.log(`\n[model: ${report.model} | ${report.cached ? 'served from cache' : 'live API call'}]`);

  if (underpowered.underpowered) {
    console.log(`\n[design note] ${underpowered.message}`);
  }

  // Save a copy for the submission folder (local only).
  const outDir = join(process.cwd(), 'local');
  mkdirSync(outDir, { recursive: true });
  const recipeHash = await sha256Hex(audit.toJSON());
  writeFileSync(
    join(outDir, 'report-output.md'),
    `<!-- Generated ${new Date().toISOString()} | model ${report.model} | audit recipe ${recipeHash.slice(0, 16)} -->\n\n${report.markdown}\n`,
    'utf8',
  );
  console.log(`\nSaved to local/report-output.md`);
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
