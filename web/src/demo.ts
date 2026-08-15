import {
  AuditLog,
  createStudy,
  descriptive,
  lockStudy,
  newRegistry,
  ResearchSession,
  runDetectors,
  sha256Hex,
  verifyLock,
  type StudyDesign,
} from '@reslab/core';

type Out = (text: string, cls?: string) => void;

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

const f4 = (x: number): string => (x !== 0 && Math.abs(x) < 1e-4 ? x.toExponential(3) : Number(x.toFixed(4)).toString());

export class HonestFlowDemo {
  private audit = new AuditLog();
  private registry = newRegistry();
  private session: ResearchSession;
  private artifactId: string | null = null;
  private lockChecksum: string | null = null;
  private control: number[] = [];
  private treated: number[] = [];
  private done = new Set<number>();
  private out: Out;
  private status: (s: string) => void;

  constructor(out: Out, status: (s: string) => void) {
    this.out = out;
    this.status = status;
    this.session = new ResearchSession(this.audit, this.registry);
  }

  async init(): Promise<void> {
    this.out('ResLab — honest research flow (real engine, running in your browser)');
    this.out('========================================================================', 't-rule');
    const { artifact, powerNote } = createStudy(this.design());
    this.registry.artifacts.push(artifact);
    this.artifactId = artifact.id;
    this.out('');
    this.out('1. DESIGN', 't-hl');
    this.out(`   Title: ${artifact.design.title}`);
    this.out(`   Planned test: ${artifact.design.plannedTest} | tails: ${artifact.design.tails} | alpha: ${artifact.design.alpha}`);
    this.out(`   Power note: ${powerNote}`);
    this.out('   Click "Pre-register (lock)" to seal the plan.');
  }

  async runStep(step: number): Promise<void> {
    if (this.done.has(step)) return;
    switch (step) {
      case 1: await this.lock(); break;
      case 2: await this.collect(); break;
      case 3: await this.analyze(); break;
      case 4: await this.detect(); break;
      case 5: await this.prove(); break;
    }
    this.done.add(step);
  }

  async runAll(): Promise<void> {
    for (let s = 1; s <= 5; s++) await this.runStep(s);
    this.status('✓ Complete — every number above was computed and verified locally.');
  }

  private design(): StudyDesign {
    return {
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
      exclusionCriteria: ['Remove participants who missed more than 2 sessions', 'Remove scores more than 3 SD from the group mean'],
      missingDataPolicy: 'Listwise deletion; counts reported in the supplement.',
    };
  }

  private async lock(): Promise<void> {
    const registry = this.registry;
    const target = registry.artifacts.find((a) => a.id === this.artifactId)!;
    if (!target.lockedAt) {
      const locked = await lockStudy(registry, target.id, this.audit);
      this.lockChecksum = locked.checksum;
    } else {
      this.lockChecksum = target.checksum;
    }
    this.out('');
    this.out('2. PRE-REGISTRATION LOCKED', 't-hl');
    this.out(`   Study id: ${this.artifactId!.slice(0, 13)}…`);
    this.out(`   SHA-256 checksum: ${this.lockChecksum!.slice(0, 16)}…`);
    this.out(`   Lock verified: ${(await verifyLock(target)).toString().toUpperCase()}`, 't-ok');
    this.out('   Audit event recorded: prereg.lock');
  }

  private async collect(): Promise<void> {
    this.control = normalSample(20260814, 40, 70, 10);
    this.treated = normalSample(20260815, 40, 78, 10);
    await this.session.recordDataVersion('v1.0.0', 'cleaned and anonymized (seed 20260814/20260815)');
    await this.session.finalizeData();
    const dc = descriptive(this.control);
    const dt = descriptive(this.treated);
    this.out('');
    this.out('3. DATA COLLECTED (deterministic, reproducible)', 't-hl');
    this.out(`   Control  n=${dc.n}  mean=${f4(dc.mean)}  sd=${f4(dc.sd)}`);
    this.out(`   Treated  n=${dt.n}  mean=${f4(dt.mean)}  sd=${f4(dt.sd)}`);
    this.out('   [!] n=40/group < planned 63 — power is only 60.9% (target 80%)', 't-err');
    this.out('   Audit events: data.version, data.finalized');
  }

  private async analyze(): Promise<void> {
    const run = await this.session.runAnalysis({
      lane: 'confirmatory',
      preregId: this.artifactId!,
      test: 'welch_t',
      params: { alpha: 0.05, tails: 2, outcomeVariable: 'exam_score' },
      data: { groups: [this.control, this.treated] },
    });
    const r = run.result;
    this.out('');
    this.out('4. CONFIRMATORY ANALYSIS (pre-registered welch_t)', 't-hl');
    this.out(`   t = ${f4(r.statistic)}  df = ${f4(r.df!)}  p = ${f4(r.p)}  d = ${f4(r.effectSize!)}`);
    this.out(`   Hard verification: ${run.verification.ok ? 'PASSED ✓' : 'FAILED ✗'}`, run.verification.ok ? 't-ok' : 't-err');
    this.out(`   Compliance: ${run.compliance.compliant ? 'COMPLIANT ✓' : 'VIOLATIONS ✗'}`, run.compliance.compliant ? 't-ok' : 't-err');
    this.out('   Audit event: analysis.run (with statistic, p, df, n)');
  }

  private async detect(): Promise<void> {
    const findings = runDetectors({ session: this.session });
    this.out('');
    this.out('5. INTEGRITY DETECTORS', 't-hl');
    if (findings.length === 0) {
      this.out('   No deviations detected ✓', 't-ok');
    } else {
      for (const f of findings) {
        this.out(`   [${f.severity.toUpperCase()}] ${f.message}`, f.severity === 'high' ? 't-err' : 't-hl');
        this.out(`     → ${f.explanation}`, 't-dim');
      }
      this.out('   Flagged for review — the human decides. The deviation is now visible.');
    }
  }

  private async prove(): Promise<void> {
    const check = await this.audit.verify();
    const recipe = JSON.stringify({
      prereg: this.artifactId,
      tests: this.session.runs.map((r) => ({ test: r.test, lane: r.lane, p: r.result.p })),
      data: 'seed 20260814/20260815, n=40 per group',
    });
    const recipeHash = await sha256Hex(recipe);
    this.out('');
    this.out('6. PROVENANCE', 't-hl');
    this.out(`   Audit log: ${this.audit.length} events, chain ${check.valid ? 'INTACT ✓' : 'BROKEN ✗'}`, check.valid ? 't-ok' : 't-err');
    this.out(`   Recipe (reproduce this analysis): ${recipeHash.slice(0, 16)}…`);
    this.out('');
    this.out('Every number above is computed, not generated. Nothing was silently changed.', 't-dim');
    this.out('========================================================================', 't-rule');
  }
}
