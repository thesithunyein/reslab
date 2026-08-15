import { describe, expect, it } from 'vitest';
import { AuditLog, canonicalJson, sha256Hex } from '../src/audit.js';

describe('canonicalJson', () => {
  it('sorts object keys so hashing is stable', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });
  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).not.toBe(canonicalJson([1, 2, 3]));
  });
  it('is stable for nested structures', () => {
    const value = { x: { y: [1, { z: 2 }] }, w: null, t: 'str' };
    expect(canonicalJson(value)).toBe(canonicalJson(JSON.parse(canonicalJson(value))));
  });
});

describe('sha256Hex', () => {
  it('produces a 64-character lowercase hex digest', async () => {
    const h = await sha256Hex('reslab');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('AuditLog hash chain', () => {
  it('appends events linked by prevHash, starting from GENESIS', async () => {
    const log = new AuditLog();
    const e1 = await log.append('design.created', { title: 'A study' });
    const e2 = await log.append('prereg.lock', { checksum: 'abc' }, 'researcher');
    expect(e1.seq).toBe(0);
    expect(e1.prevHash).toBe('GENESIS');
    expect(e2.seq).toBe(1);
    expect(e2.prevHash).toBe(e1.hash);
    expect(log.length).toBe(2);
    const v = await log.verify();
    expect(v.valid).toBe(true);
    expect(v.eventCount).toBe(2);
  });

  it('detects tampering with an earlier payload', async () => {
    const log = new AuditLog();
    await log.append('design.created', { title: 'Original' });
    await log.append('prereg.lock', { checksum: 'abc' });
    const snapshot = log.eventsSnapshot();
    (snapshot[0] as { payload: { title: string } }).payload.title = 'CHANGED';
    const tampered = AuditLog.fromJSON(JSON.stringify(snapshot));
    const v = await tampered.verify();
    expect(v.valid).toBe(false);
    expect(v.brokenAt).toBe(0);
  });

  it('detects a forged prevHash link', async () => {
    const log = new AuditLog();
    await log.append('a', {});
    await log.append('b', {});
    const snap = log.eventsSnapshot();
    (snap[1] as { prevHash: string }).prevHash = 'forged';
    const tampered = AuditLog.fromJSON(JSON.stringify(snap));
    const v = await tampered.verify();
    expect(v.valid).toBe(false);
  });

  it('round-trips through toJSON/fromJSON without breaking the chain', async () => {
    const log = new AuditLog();
    await log.append('design.created', { title: 'x' });
    await log.append('analysis.run', { p: 0.03, t: -4.06 });
    const restored = AuditLog.fromJSON(log.toJSON());
    expect(restored.length).toBe(2);
    expect((await restored.verify()).valid).toBe(true);
  });

  it('returns cloned events so callers cannot mutate the log', async () => {
    const log = new AuditLog();
    const e = await log.append('design.created', { title: 'Original' });
    (e.payload as { title: string }).title = 'Mutated';
    const v = await log.verify();
    expect(v.valid).toBe(true);
  });
});
