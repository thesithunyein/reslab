import { describe, expect, it } from 'vitest';
import { AuditLog } from '../src/audit.js';
import {
  createStudy,
  isConfirmatoryEligible,
  lockStudy,
  newRegistry,
  reviseStudy,
  verifyLock,
  type StudyDesign,
} from '../src/prereg.js';

const base: StudyDesign = {
  title: 'Spaced repetition vs massed practice',
  hypothesis: 'Spaced repetition improves exam scores relative to massed practice.',
  outcomeVariable: 'exam_score',
  groupVariable: 'condition',
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
  missingDataPolicy: 'Listwise deletion; report counts in the supplement.',
};

describe('createStudy', () => {
  it('creates version 1, unlocked, with a power note', () => {
    const { artifact, powerNote } = createStudy(base);
    expect(artifact.version).toBe(1);
    expect(artifact.lockedAt).toBeNull();
    expect(artifact.checksum).toBeNull();
    expect(powerNote).toContain('63');
  });
  it('validates the design', () => {
    expect(() => createStudy({ ...base, title: '  ' })).toThrow(/title/);
    expect(() => createStudy({ ...base, alpha: 1 })).toThrow(/alpha/);
    expect(() => createStudy({ ...base, powerTarget: 0 })).toThrow(/powerTarget/);
    expect(() => createStudy({ ...base, plannedN: 1 })).toThrow(/plannedN/);
  });
});

describe('locking', () => {
  it('locks with a SHA-256 checksum and records the audit event', async () => {
    const registry = newRegistry();
    const audit = new AuditLog();
    const { artifact } = createStudy(base);
    registry.artifacts.push(artifact);

    const locked = await lockStudy(registry, artifact.id, audit);
    expect(locked.lockedAt).not.toBeNull();
    expect(locked.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyLock(locked)).toBe(true);
    expect(isConfirmatoryEligible(locked)).toBe(true);
    expect((await audit.verify()).valid).toBe(true);
    expect(audit.eventsSnapshot().map((e) => e.type)).toContain('prereg.lock');
  });

  it('cannot lock twice', async () => {
    const registry = newRegistry();
    const audit = new AuditLog();
    const { artifact } = createStudy(base);
    registry.artifacts.push(artifact);
    await lockStudy(registry, artifact.id, audit);
    await expect(lockStudy(registry, artifact.id, audit)).rejects.toThrow(/already locked/);
  });

  it('detects tampering with the locked design', async () => {
    const registry = newRegistry();
    const audit = new AuditLog();
    const { artifact } = createStudy(base);
    registry.artifacts.push(artifact);
    const locked = await lockStudy(registry, artifact.id, audit);
    const tampered = { ...locked, design: { ...locked.design, alpha: 0.1 } };
    expect(await verifyLock(tampered)).toBe(false);
  });
});

describe('revision', () => {
  it('creates a new version without touching the original artifact', async () => {
    const registry = newRegistry();
    const audit = new AuditLog();
    const { artifact } = createStudy(base);
    registry.artifacts.push(artifact);
    const locked = await lockStudy(registry, artifact.id, audit);

    const next = await reviseStudy(
      registry,
      artifact.id,
      { ...base, hypothesis: 'Revised after pilot feedback.', plannedTest: 'two_sample_t' },
      audit,
    );
    expect(next.version).toBe(2);
    expect(next.supersedes).toBe(locked.id);
    expect(next.id).not.toBe(locked.id);
    expect(registry.artifacts).toHaveLength(2);

    // The original is untouched and still verifies.
    expect(await verifyLock(registry.artifacts[0]!)).toBe(true);
    expect(registry.artifacts[1]!.design.plannedTest).toBe('two_sample_t');
    expect(audit.eventsSnapshot().map((e) => e.type)).toContain('prereg.revise');
  });
});
