import { describe, expect, it } from 'vitest';
import { AuditLog } from '../src/audit.js';
import { runDetectors, type DeviationPattern, type Finding } from '../src/detectors.js';
import type { AnalysisRun, Lane } from '../src/lanes.js';
import { createStudy, lockStudy, newRegistry, type PreRegistrationArtifact, type StudyDesign } from '../src/prereg.js';

function makeRun(partial: Partial<AnalysisRun> & { test: string; lane: Lane }): AnalysisRun {
  return {
    id: crypto.randomUUID(),
    preregId: null,
    params: {},
    result: {
      test: partial.test as AnalysisRun['result']['test'],
      statistic: 2.5,
      df: 38,
      p: 0.03,
      n: [40, 40],
      method: 'reference method',
    },
    verification: { ok: true, errors: [], checkedAt: new Date().toISOString() },
    compliance: { compliant: true, violations: [] },
    ranAt: new Date().toISOString(),
    ...partial,
  };
}

async function lockedArtifact(overrides: Partial<StudyDesign> = {}) {
  const audit = new AuditLog();
  const registry = newRegistry();
  const design: StudyDesign = {
    title: 'Study',
    hypothesis: 'H',
    outcomeVariable: 'exam_score',
    plannedTest: 'welch_t',
    tails: 2,
    alpha: 0.05,
    powerTarget: 0.8,
    plannedN: 40,
    exclusionCriteria: ['Remove participants who missed more than 2 sessions'],
    missingDataPolicy: 'listwise',
    ...overrides,
  };
  const { artifact } = createStudy(design);
  registry.artifacts.push(artifact);
  await lockStudy(registry, artifact.id, audit);
  return { artifact, audit, registry };
}

function patterns(findings: Finding[]): DeviationPattern[] {
  return findings.map((f) => f.pattern);
}

describe('runDetectors', () => {
  it('reports nothing for a clean, fully compliant study', async () => {
    const { artifact, audit, registry } = await lockedArtifact();
    const run = makeRun({ lane: 'confirmatory', test: 'welch_t', preregId: artifact.id });
    const findings = runDetectors({ session: { audit, registry, runs: [run] } });
    expect(findings).toEqual([]);
  });

  it('detects test switching', async () => {
    const { artifact, audit, registry } = await lockedArtifact();
    const run = makeRun({ lane: 'confirmatory', test: 'two_sample_t', preregId: artifact.id });
    const findings = runDetectors({ session: { audit, registry, runs: [run] } });
    expect(patterns(findings)).toContain('test_switching');
    const f = findings.find((x) => x.pattern === 'test_switching')!;
    expect(f.severity).toBe('high');
  });

  it('detects tail switching', async () => {
    const { artifact, audit, registry } = await lockedArtifact();
    const run = makeRun({
      lane: 'confirmatory', test: 'welch_t', preregId: artifact.id, params: { tails: 1 },
    });
    const findings = runDetectors({ session: { audit, registry, runs: [run] } });
    expect(patterns(findings)).toContain('tail_switching');
  });

  it('detects outcome switching', async () => {
    const { artifact, audit, registry } = await lockedArtifact();
    const run = makeRun({
      lane: 'confirmatory', test: 'welch_t', preregId: artifact.id, params: { outcomeVariable: 'quiz_score' },
    });
    const findings = runDetectors({ session: { audit, registry, runs: [run] } });
    expect(patterns(findings)).toContain('outcome_switching');
  });

  it('detects optional stopping when analyses predate data finalization', async () => {
    const { artifact, audit, registry } = await lockedArtifact();
    const run = makeRun({ lane: 'confirmatory', test: 'welch_t', preregId: artifact.id });
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const findings = runDetectors({
      session: { audit, registry, runs: [run] },
      dataFinalizedAt: tomorrow,
    });
    expect(patterns(findings)).toContain('optional_stopping');
  });

  it('detects a significant result from fewer participants than planned', async () => {
    const { artifact, audit, registry } = await lockedArtifact({ plannedN: 80 });
    const run = makeRun({ lane: 'confirmatory', test: 'welch_t', preregId: artifact.id });
    const findings = runDetectors({ session: { audit, registry, runs: [run] } });
    expect(patterns(findings)).toContain('optional_stopping');
  });

  it('detects a confirmatory run with no matching pre-registration', async () => {
    const { audit, registry } = await lockedArtifact();
    const run = makeRun({ lane: 'confirmatory', test: 'welch_t', preregId: 'does-not-exist' });
    const findings = runDetectors({ session: { audit, registry, runs: [run] } });
    expect(patterns(findings)).toContain('missing_preregistration');
  });

  it('detects uncorrected multiple comparisons', async () => {
    const { artifact, audit, registry } = await lockedArtifact();
    const r1 = makeRun({
      lane: 'confirmatory', test: 'welch_t', preregId: artifact.id, params: { outcomeVariable: 'exam_score' },
    });
    const r2 = makeRun({
      lane: 'confirmatory', test: 'welch_t', preregId: artifact.id, params: { outcomeVariable: 'exam_score' },
    });
    const findings = runDetectors({ session: { audit, registry, runs: [r1, r2] } });
    expect(patterns(findings)).toContain('multiple_comparisons');
  });

  it('detects subgroup slicing from repeated significant subset analyses', async () => {
    const { audit, registry } = await lockedArtifact();
    const s1 = makeRun({ lane: 'exploratory', test: 'welch_t', note: 'subset: females only' });
    const s2 = makeRun({ lane: 'exploratory', test: 'welch_t', note: 'subset: under-25s' });
    const findings = runDetectors({ session: { audit, registry, runs: [s1, s2] } });
    expect(patterns(findings)).toContain('subgroup_slicing');
  });

  it('detects undeclared outlier removal', async () => {
    const { audit, registry } = await lockedArtifact();
    await audit.append('data.transform', { kind: 'remove_outliers', description: 'Removed 2 values > 3 SD' });
    const findings = runDetectors({ session: { audit, registry, runs: [] } });
    expect(patterns(findings)).toContain('outlier_removal');
  });

  it('does not flag outlier removal that was declared in the pre-registration', async () => {
    const { audit, registry } = await lockedArtifact({
      exclusionCriteria: ['Remove outliers more than 3 SD from the group mean'],
    });
    await audit.append('data.transform', { kind: 'remove_outliers', description: 'Removed 2 values > 3 SD' });
    const findings = runDetectors({ session: { audit, registry, runs: [] } });
    expect(patterns(findings)).not.toContain('outlier_removal');
  });

  it('flags nothing for a healthy exploratory session', async () => {
    const { audit, registry } = await lockedArtifact();
    const run = makeRun({ lane: 'exploratory', test: 'pearson', note: 'post-hoc exploration' });
    const findings = runDetectors({ session: { audit, registry, runs: [run] } });
    expect(findings).toEqual([]);
  });
});

// Type-level check that PreRegistrationArtifact is exported for consumers.
void (null as unknown as PreRegistrationArtifact);
