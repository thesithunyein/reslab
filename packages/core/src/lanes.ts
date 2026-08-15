/**
 * Research session: the glue between audit log, pre-registration, and runs.
 *
 * The core methodological rule: claims come from the CONFIRMATORY lane -
 * pre-registered tests run exactly as planned. Everything else lives in the
 * EXPLORATORY lane and is labeled as such. `runAnalysis` refuses to record
 * anything that violates this, and hard-verifies every result first.
 */
import { AuditLog } from './audit.js';
import { PreRegistrationRegistry, isConfirmatoryEligible } from './prereg.js';
import { jarqueBera, levene, mannWhitney, oneWayAnova, pairedT, pearson, twoSampleT, type TestName, type TestResult } from './stats.js';
import { verifyResult, type VerificationReport } from './verify.js';

export type Lane = 'confirmatory' | 'exploratory';

export interface RunData {
  groups?: number[][];
  pairs?: Array<[number, number]>;
  x?: number[];
  y?: number[];
}

export interface RunParams {
  alpha?: number;
  tails?: 1 | 2;
  outcomeVariable?: string;
  equalVariance?: boolean;
}

export interface RunRequest {
  lane: Lane;
  test: TestName;
  preregId?: string;
  params?: RunParams;
  data: RunData;
  note?: string;
}

export interface ComplianceReport {
  compliant: boolean;
  violations: string[];
}

export interface AnalysisRun {
  id: string;
  lane: Lane;
  preregId: string | null;
  test: TestName;
  params: RunParams;
  result: TestResult;
  verification: VerificationReport;
  compliance: ComplianceReport;
  ranAt: string;
  note?: string;
}

export class ResearchSession {
  constructor(
    public readonly audit: AuditLog,
    public readonly registry: PreRegistrationRegistry,
    public readonly runs: AnalysisRun[] = [],
  ) {}

  async runAnalysis(req: RunRequest): Promise<AnalysisRun> {
    const prereg = req.preregId ? this.registry.artifacts.find((a) => a.id === req.preregId) : undefined;
    const compliance = checkCompliance(req, prereg);

    const result = dispatchTest(req.test, req.data, req.params);
    const verification = verifyResult(result);
    if (!verification.ok) {
      throw new Error(`analysis failed hard verification: ${verification.errors.join('; ')}`);
    }

    const run: AnalysisRun = {
      id: crypto.randomUUID(),
      lane: req.lane,
      preregId: req.preregId ?? null,
      test: req.test,
      params: req.params ?? {},
      result,
      verification,
      compliance,
      ranAt: new Date().toISOString(),
      note: req.note,
    };
    this.runs.push(run);
    await this.audit.append('analysis.run', {
      runId: run.id,
      lane: run.lane,
      test: run.test,
      preregId: run.preregId,
      statistic: run.result.statistic,
      p: run.result.p,
      df: run.result.df ?? null,
      n: run.result.n,
      verificationOk: verification.ok,
      compliant: compliance.compliant,
      violations: compliance.violations,
    });
    return run;
  }

  async recordDataVersion(version: string, description: string): Promise<void> {
    await this.audit.append('data.version', { version, description });
  }

  async recordDataTransform(kind: string, description: string): Promise<void> {
    await this.audit.append('data.transform', { kind, description });
  }

  async finalizeData(): Promise<string> {
    const ts = new Date().toISOString();
    await this.audit.append('data.finalized', { at: ts });
    return ts;
  }
}

function checkCompliance(req: RunRequest, prereg: { lockedAt: string | null; design: { plannedTest: TestName; tails: 1 | 2; outcomeVariable: string; alpha: number } } | undefined): ComplianceReport {
  const violations: string[] = [];
  if (req.lane === 'confirmatory') {
    if (!prereg) violations.push('confirmatory analysis requires a pre-registration (preregId)');
    else if (!isConfirmatoryEligible(prereg as never)) violations.push('pre-registration is not locked');
    else {
      if (req.test !== prereg.design.plannedTest) violations.push(`test switched: pre-registered ${prereg.design.plannedTest}, ran ${req.test}`);
      if (req.params?.tails !== undefined && req.params.tails !== prereg.design.tails) violations.push(`tails switched: pre-registered ${prereg.design.tails}-tailed, ran ${req.params.tails}-tailed`);
      if (req.params?.outcomeVariable !== undefined && req.params.outcomeVariable !== prereg.design.outcomeVariable) violations.push(`outcome switched: pre-registered "${prereg.design.outcomeVariable}", analyzed "${req.params.outcomeVariable}"`);
      if (req.params?.alpha !== undefined && Math.abs(req.params.alpha - prereg.design.alpha) > 1e-9) violations.push(`alpha switched: pre-registered ${prereg.design.alpha}, used ${req.params.alpha}`);
    }
  }
  return { compliant: violations.length === 0, violations };
}

function dispatchTest(test: TestName, data: RunData, params: RunParams = {}): TestResult {
  switch (test) {
    case 'two_sample_t':
      return twoSampleT(requireGroups(data, 2)[0]!, requireGroups(data, 2)[1]!, { equalVariance: true, tails: params.tails });
    case 'welch_t':
      return twoSampleT(requireGroups(data, 2)[0]!, requireGroups(data, 2)[1]!, { equalVariance: false, tails: params.tails });
    case 'paired_t': {
      if (data.pairs) {
        const a = data.pairs.map((p) => p[0]);
        const b = data.pairs.map((p) => p[1]);
        return pairedT(a, b);
      }
      const groups = requireGroups(data, 2);
      return pairedT(groups[0]!, groups[1]!);
    }
    case 'one_way_anova':
      return oneWayAnova(requireGroups(data, 2));
    case 'pearson':
      if (!data.x || !data.y) throw new RangeError('pearson requires x and y');
      return pearson(data.x, data.y);
    case 'mann_whitney': {
      const groups = requireGroups(data, 2);
      return mannWhitney(groups[0]!, groups[1]!);
    }
    case 'jarque_bera':
      return jarqueBera(requireGroups(data, 1)[0]!);
    case 'levene':
      return levene(requireGroups(data, 2));
  }
}

function requireGroups(data: RunData, min: number): number[][] {
  if (!data.groups || data.groups.length < min) throw new RangeError(`expected >= ${min} groups in data`);
  return data.groups;
}
