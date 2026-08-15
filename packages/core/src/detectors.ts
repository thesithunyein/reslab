/**
 * Deviation detectors: the research-integrity firewall.
 *
 * Each detector reads the audit log and the analysis runs and flags known
 * p-hacking / HARKing patterns. Detectors are guardians, not police: every
 * finding is "for review", with a severity level and a plain-language
 * explanation of the bias it introduces. The human always decides.
 */
import type { AuditEvent } from './audit.js';
import type { AnalysisRun, Lane } from './lanes.js';
import type { PreRegistrationArtifact } from './prereg.js';

export type DeviationPattern =
  | 'test_switching'
  | 'tail_switching'
  | 'outcome_switching'
  | 'optional_stopping'
  | 'subgroup_slicing'
  | 'outlier_removal'
  | 'multiple_comparisons'
  | 'missing_preregistration';

export type Severity = 'info' | 'low' | 'medium' | 'high';

export interface Finding {
  pattern: DeviationPattern;
  severity: Severity;
  message: string;
  evidence: string[];
  explanation: string;
}

export interface DetectionContext {
  session: {
    audit: { eventsSnapshot(): readonly AuditEvent[] };
    registry: { artifacts: readonly PreRegistrationArtifact[] };
    runs: readonly AnalysisRun[];
  };
  /** ISO timestamp when data collection was finalized; optional-stopping detection needs it. */
  dataFinalizedAt?: string;
}

export function runDetectors(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  const confirmatory = ctx.session.runs.filter((r) => r.lane === 'confirmatory');
  const exploratory = ctx.session.runs.filter((r) => r.lane === 'exploratory');

  for (const run of confirmatory) {
    const prereg = run.preregId ? ctx.session.registry.artifacts.find((a) => a.id === run.preregId) : undefined;
    if (!prereg) {
      findings.push({
        pattern: 'missing_preregistration',
        severity: 'high',
        message: `Confirmatory run "${run.id}" has no matching pre-registration.`,
        evidence: [run.id],
        explanation: 'A confirmatory analysis must be bound to a locked pre-registration; without one, the analysis cannot be distinguished from post-hoc fishing.',
      });
      continue;
    }
    if (run.test !== prereg.design.plannedTest) {
      findings.push({
        pattern: 'test_switching',
        severity: 'high',
        message: `Test switched: pre-registered ${prereg.design.plannedTest}, confirmatory run used ${run.test}.`,
        evidence: [run.id, `prereg:${prereg.id}`],
        explanation: 'Switching to a different statistical test after seeing the data (e.g., t-test -> Mann-Whitney) is a classic p-hacking pattern: the new test is often chosen because it yields significance.',
      });
    }
    if (run.params.tails !== undefined && prereg.design.tails !== run.params.tails) {
      findings.push({
        pattern: 'tail_switching',
        severity: 'high',
        message: `Tail direction switched: pre-registered ${prereg.design.tails}-tailed, ran ${run.params.tails}-tailed.`,
        evidence: [run.id, `prereg:${prereg.id}`],
        explanation: 'Switching from two-tailed to one-tailed after seeing results halves the p-value and inflates false positives.',
      });
    }
    if (run.params.outcomeVariable !== undefined && prereg.design.outcomeVariable !== run.params.outcomeVariable) {
      findings.push({
        pattern: 'outcome_switching',
        severity: 'high',
        message: `Outcome switched: pre-registered "${prereg.design.outcomeVariable}", analyzed "${run.params.outcomeVariable}".`,
        evidence: [run.id, `prereg:${prereg.id}`],
        explanation: 'Reporting a different dependent variable than pre-registered (HARKing) lets a researcher select whichever outcome happens to be significant.',
      });
    }
    if (ctx.dataFinalizedAt !== undefined && run.ranAt < ctx.dataFinalizedAt) {
      findings.push({
        pattern: 'optional_stopping',
        severity: 'medium',
        message: `Analysis ran before data collection was finalized (run ${run.ranAt} < finalized ${ctx.dataFinalizedAt}).`,
        evidence: [run.id, `finalized:${ctx.dataFinalizedAt}`],
        explanation: 'Analyzing while data is still being collected ("peeking") and stopping when significant inflates the false-positive rate far above the nominal alpha.',
      });
    }
    if (prereg.design.plannedN !== undefined && run.result.n[0] !== undefined && run.result.n[0] < prereg.design.plannedN && run.result.p < prereg.design.alpha) {
      findings.push({
        pattern: 'optional_stopping',
        severity: 'medium',
        message: `Sample smaller than planned yet significant: planned n=${prereg.design.plannedN}/group, ran n=${run.result.n[0]}, p=${run.result.p.toFixed(3)} < alpha=${prereg.design.alpha}.`,
        evidence: [run.id, `prereg:${prereg.id}`],
        explanation: 'A significant result from fewer participants than the power analysis demanded is consistent with stopping early once significance appeared.',
      });
    }
  }

  // Multiple comparisons: more than one confirmatory test on the same outcome without correction.
  const byOutcome = new Map<string, AnalysisRun[]>();
  for (const run of confirmatory) {
    const key = run.params.outcomeVariable ?? run.test;
    const list = byOutcome.get(key) ?? [];
    list.push(run);
    byOutcome.set(key, list);
  }
  for (const [outcome, runs] of byOutcome) {
    if (runs.length > 1) {
      findings.push({
        pattern: 'multiple_comparisons',
        severity: 'medium',
        message: `${runs.length} confirmatory tests on "${outcome}" without evidence of correction (e.g., Bonferroni).`,
        evidence: runs.map((r) => r.id),
        explanation: 'Each additional test on the same data raises the chance of a false positive; uncorrected families of tests inflate the error rate.',
      });
    }
  }

  // Subgroup slicing: repeated exploratory subset analyses that reached significance.
  const sigSubsets = exploratory.filter((r) => (r.note ?? '').toLowerCase().includes('subset') && r.result.p < (r.params.alpha ?? 0.05));
  if (sigSubsets.length >= 2) {
    findings.push({
      pattern: 'subgroup_slicing',
      severity: 'medium',
      message: `${sigSubsets.length} exploratory subset analyses reached significance (p < ${sigSubsets[0]!.params.alpha ?? 0.05}).`,
      evidence: sigSubsets.map((r) => r.id),
      explanation: 'Slicing data into subgroups until something becomes significant is a p-hacking pattern. These findings are exploratory by definition and must not be reported as confirmatory.',
    });
  }

  // Outlier removal not declared in any pre-registration.
  const declaredCriteria: string[] = [];
  for (const a of ctx.session.registry.artifacts) declaredCriteria.push(...a.design.exclusionCriteria);
  for (const e of ctx.session.audit.eventsSnapshot()) {
    if (e.type === 'data.transform') {
      const kind = (e.payload as { kind?: string }).kind;
      if (kind === 'remove_outliers' && !declaredCriteria.some((c) => /outlier/i.test(c))) {
        findings.push({
          pattern: 'outlier_removal',
          severity: 'medium',
          message: 'Outliers were removed from the data but outlier exclusion was not declared in the pre-registration.',
          evidence: [`event:${e.seq}`],
          explanation: 'Removing outliers after seeing results can flip significance. Pre-register the exclusion criteria (e.g., "> 3 SD from mean") before collecting data.',
        });
      }
    }
  }

  return findings;
}

export function severityRank(s: Severity): number {
  return { info: 0, low: 1, medium: 2, high: 3 }[s];
}

export function laneLabel(lane: Lane): string {
  return lane === 'confirmatory' ? 'Confirmatory (pre-registered)' : 'Exploratory (post-hoc)';
}
