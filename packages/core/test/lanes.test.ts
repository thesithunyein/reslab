import { describe, expect, it } from 'vitest';
import { AuditLog } from '../src/audit.js';
import { ResearchSession } from '../src/lanes.js';
import { createStudy, lockStudy, newRegistry, type StudyDesign } from '../src/prereg.js';

const G1 = [0.7, -1.6, -0.2, -1.2, -0.1, 3.4, 3.7, 0.8, 0.0, 2.0];
const G2 = [1.9, 0.8, 1.1, 0.1, -0.1, 4.4, 5.5, 1.6, 4.6, 3.4];

async function honestSession() {
  const audit = new AuditLog();
  const registry = newRegistry();
  const design: StudyDesign = {
    title: 'Sleep study',
    hypothesis: 'Extra sleep changes reaction time.',
    outcomeVariable: 'extra_sleep',
    plannedTest: 'welch_t',
    tails: 2,
    alpha: 0.05,
    powerTarget: 0.8,
    plannedN: 40,
    exclusionCriteria: [],
    missingDataPolicy: 'listwise',
  };
  const { artifact } = createStudy(design);
  registry.artifacts.push(artifact);
  await lockStudy(registry, artifact.id, audit);
  return { audit, registry, session: new ResearchSession(audit, registry), artifact };
}

describe('ResearchSession', () => {
  it('records a compliant confirmatory run with verified results', async () => {
    const { session, artifact } = await honestSession();
    const run = await session.runAnalysis({
      lane: 'confirmatory',
      preregId: artifact.id,
      test: 'welch_t',
      params: { alpha: 0.05, tails: 2, outcomeVariable: 'extra_sleep' },
      data: { groups: [G1, G2] },
    });
    expect(run.lane).toBe('confirmatory');
    expect(run.preregId).toBe(artifact.id);
    expect(run.compliance.compliant).toBe(true);
    expect(run.verification.ok).toBe(true);
    expect(run.result.p).toBeCloseTo(0.07939, 4);
    expect(session.runs).toHaveLength(1);
    expect((await session.audit.verify()).valid).toBe(true);
    expect(session.audit.eventsSnapshot().map((e) => e.type)).toContain('analysis.run');
  });

  it('flags (but does not block) a test switch in the confirmatory lane', async () => {
    const { session, artifact } = await honestSession();
    const run = await session.runAnalysis({
      lane: 'confirmatory',
      preregId: artifact.id,
      test: 'mann_whitney',
      data: { groups: [G1, G2] },
    });
    expect(run.compliance.compliant).toBe(false);
    expect(run.compliance.violations.join(' ')).toContain('test switched');
    expect(session.runs).toHaveLength(1); // recorded anyway, flagged for review
  });

  it('flags a confirmatory run without a pre-registration', async () => {
    const { session } = await honestSession();
    const run = await session.runAnalysis({
      lane: 'confirmatory',
      test: 'welch_t',
      data: { groups: [G1, G2] },
    });
    expect(run.compliance.compliant).toBe(false);
    expect(run.compliance.violations.join(' ')).toContain('pre-registration');
  });

  it('flags a confirmatory run against an unlocked pre-registration', async () => {
    const audit = new AuditLog();
    const registry = newRegistry();
    const { artifact } = createStudy({
      title: 't', hypothesis: 'h', outcomeVariable: 'x', plannedTest: 'welch_t',
      tails: 2, alpha: 0.05, powerTarget: 0.8,
      exclusionCriteria: [], missingDataPolicy: 'listwise',
    });
    registry.artifacts.push(artifact); // intentionally NOT locked
    const session = new ResearchSession(audit, registry);
    const run = await session.runAnalysis({
      lane: 'confirmatory',
      preregId: artifact.id,
      test: 'welch_t',
      data: { groups: [G1, G2] },
    });
    expect(run.compliance.compliant).toBe(false);
    expect(run.compliance.violations.join(' ')).toContain('not locked');
  });

  it('flags an outcome switch in the confirmatory lane', async () => {
    const { session, artifact } = await honestSession();
    const run = await session.runAnalysis({
      lane: 'confirmatory',
      preregId: artifact.id,
      test: 'welch_t',
      params: { outcomeVariable: 'reaction_time' },
      data: { groups: [G1, G2] },
    });
    expect(run.compliance.compliant).toBe(false);
    expect(run.compliance.violations.join(' ')).toContain('outcome switched');
  });

  it('allows exploratory analyses without a pre-registration', async () => {
    const { session } = await honestSession();
    const run = await session.runAnalysis({
      lane: 'exploratory',
      test: 'pearson',
      data: { x: G1, y: G2 },
      note: 'post-hoc correlation between groups',
    });
    expect(run.lane).toBe('exploratory');
    expect(run.compliance.compliant).toBe(true);
  });

  it('rejects malformed input data', async () => {
    const { session, artifact } = await honestSession();
    await expect(
      session.runAnalysis({
        lane: 'confirmatory',
        preregId: artifact.id,
        test: 'welch_t',
        data: { groups: [[1], [2]] },
      }),
    ).rejects.toThrow(RangeError);
  });

  it('records data versioning and finalization events', async () => {
    const { session } = await honestSession();
    await session.recordDataVersion('v1.0.0', 'cleaned and anonymized');
    await session.recordDataTransform('remove_outliers', 'Removed 2 values > 3 SD');
    const finalizedAt = await session.finalizeData();
    const types = session.audit.eventsSnapshot().map((e) => e.type);
    expect(types).toContain('data.version');
    expect(types).toContain('data.transform');
    expect(types).toContain('data.finalized');
    expect(finalizedAt).toBeTruthy();
  });
});
