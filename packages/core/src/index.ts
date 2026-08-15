/**
 * ResLab core - the lab notebook that keeps science honest.
 *
 * Design -> pre-register -> analyze -> verify -> detect. Every result is
 * hard-verified, every action is recorded in a tamper-evident audit log,
 * and confirmatory claims are enforced against the locked plan.
 */
export * from './audit.js';
export * from './detectors.js';
export * from './lanes.js';
export * from './power.js';
export * from './prereg.js';
export * from './special-functions.js';
export * from './stats.js';
export * from './verify.js';
// NOTE: the LLM writer (llm/*) is Node-only (node:crypto, node:fs) and is
// intentionally NOT exported from the barrel so the core stays browser-safe.
