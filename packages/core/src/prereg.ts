/**
 * Pre-registration: the locked study plan.
 *
 * A study is designed BEFORE data collection: planned test, tails, alpha,
 * sample size, exclusion criteria, missing-data policy. Locking computes a
 * checksum over the canonical design and records the lock in the audit log.
 * The lock is tamper-evident: any edit changes the checksum, and revisions
 * always create a NEW version - the original artifact is never mutated.
 */
import { AuditLog, canonicalJson, sha256Hex } from './audit.js';
import { powerAnalysis } from './power.js';
import type { TestName } from './stats.js';

export interface StudyDesign {
  title: string;
  hypothesis: string;
  outcomeVariable: string;
  groupVariable?: string;
  plannedTest: TestName;
  tails: 1 | 2;
  alpha: number;
  powerTarget: number;
  effectSizeGuess?: number; // Cohen's d
  plannedN?: number; // per group
  exclusionCriteria: string[];
  missingDataPolicy: string;
  notes?: string;
}

export interface PreRegistrationArtifact {
  id: string;
  version: number;
  design: StudyDesign;
  createdAt: string;
  lockedAt: string | null;
  checksum: string | null;
  supersedes?: string;
  powerNote?: string;
}

export interface PreRegistrationRegistry {
  artifacts: PreRegistrationArtifact[];
}

export function createStudy(design: StudyDesign): { artifact: PreRegistrationArtifact; powerNote?: string } {
  validateDesign(design);
  let powerNote: string | undefined;
  if (design.plannedN !== undefined && design.effectSizeGuess !== undefined) {
    const report = powerAnalysis({ alpha: design.alpha, powerTarget: design.powerTarget, tails: design.tails, nPerGroup: design.plannedN, effectSizeGuess: design.effectSizeGuess });
    powerNote = report.message;
  } else if (design.effectSizeGuess !== undefined) {
    const report = powerAnalysis({ alpha: design.alpha, powerTarget: design.powerTarget, tails: design.tails, effectSizeGuess: design.effectSizeGuess });
    powerNote = report.message;
  }
  const artifact: PreRegistrationArtifact = {
    id: cryptoRandomId(),
    version: 1,
    design: structuredClone(design),
    createdAt: new Date().toISOString(),
    lockedAt: null,
    checksum: null,
    powerNote,
  };
  return { artifact, powerNote };
}

export async function lockStudy(registry: PreRegistrationRegistry, artifactId: string, audit: AuditLog): Promise<PreRegistrationArtifact> {
  const idx = findIndex(registry, artifactId);
  const artifact = registry.artifacts[idx]!;
  if (artifact.lockedAt !== null) throw new Error('study is already locked');
  const checksum = await sha256Hex(canonicalJson(artifact.design) + '|' + artifact.version);
  const locked: PreRegistrationArtifact = { ...artifact, lockedAt: new Date().toISOString(), checksum };
  registry.artifacts[idx] = locked;
  await audit.append('prereg.lock', { id: locked.id, version: locked.version, checksum });
  return structuredClone(locked);
}

export async function reviseStudy(
  registry: PreRegistrationRegistry,
  artifactId: string,
  newDesign: StudyDesign,
  audit: AuditLog,
): Promise<PreRegistrationArtifact> {
  const idx = findIndex(registry, artifactId);
  const prev = registry.artifacts[idx]!;
  validateDesign(newDesign);
  const next: PreRegistrationArtifact = {
    id: cryptoRandomId(),
    version: prev.version + 1,
    design: structuredClone(newDesign),
    createdAt: new Date().toISOString(),
    lockedAt: null,
    checksum: null,
    supersedes: prev.id,
  };
  registry.artifacts.push(next);
  await audit.append('prereg.revise', { from: prev.id, to: next.id, version: next.version, reason: 'new version created; original untouched' });
  return structuredClone(next);
}

export async function verifyLock(artifact: PreRegistrationArtifact): Promise<boolean> {
  if (!artifact.lockedAt || !artifact.checksum) return false;
  const recomputed = await sha256Hex(canonicalJson(artifact.design) + '|' + artifact.version);
  return recomputed === artifact.checksum;
}

export function isConfirmatoryEligible(artifact: PreRegistrationArtifact | null): boolean {
  return artifact !== null && artifact.lockedAt !== null && artifact.checksum !== null;
}

function validateDesign(d: StudyDesign): void {
  if (!d.title.trim()) throw new Error('design.title is required');
  if (!d.outcomeVariable.trim()) throw new Error('design.outcomeVariable is required');
  if (d.alpha <= 0 || d.alpha >= 1) throw new Error('design.alpha must be in (0,1)');
  if (d.powerTarget <= 0 || d.powerTarget >= 1) throw new Error('design.powerTarget must be in (0,1)');
  if (d.tails !== 1 && d.tails !== 2) throw new Error('design.tails must be 1 or 2');
  if (d.plannedN !== undefined && (!Number.isInteger(d.plannedN) || d.plannedN < 2)) throw new Error('design.plannedN must be an integer >= 2');
}

function findIndex(registry: PreRegistrationRegistry, id: string): number {
  const idx = registry.artifacts.findIndex((a) => a.id === id);
  if (idx === -1) throw new Error(`no artifact with id ${id}`);
  return idx;
}

export function newRegistry(): PreRegistrationRegistry {
  return { artifacts: [] };
}

function cryptoRandomId(): string {
  if (typeof globalThis.crypto !== 'undefined' && 'randomUUID' in globalThis.crypto) return globalThis.crypto.randomUUID();
  return `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}
