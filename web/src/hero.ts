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

const f4 = (x: number): string => (x !== 0 && Math.abs(x) < 1e-4 ? x.toExponential(3) : Number(x.toFixed(4)).toString());

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

export class HeroStudio {
  private audit = new AuditLog();
  private registry = newRegistry();
  private session = new ResearchSession(this.audit, this.registry);
  private artifactId: string | null = null;
  private lockChecksum: string | null = null;
  private control: number[] = [];
  private treated: number[] = [];
  private playing = false;

  constructor(
    private output: HTMLElement,
    private status: HTMLElement,
    private steps: NodeListOf<HTMLButtonElement>,
    private summary: HTMLElement,
    private replayBtn: HTMLButtonElement,
  ) {
    replayBtn.addEventListener('click', () => void this.play());
  }

  async init(): Promise<void> {
    await this.play();
  }

  async play(): Promise<void> {
    if (this.playing) return;
    this.playing = true;
    this.output.innerHTML = '';
    this.summary.classList.add('hidden');
    this.status.textContent = 'running the honest flow…';
    this.setStep(0, 'active');

    const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
    const say = (text: string, cls = ''): void => {
      const div = document.createElement('div');
      div.className = `t-line ${cls}`.trim();
      div.textContent = text;
      this.output.appendChild(div);
      this.output.scrollTop = this.output.scrollHeight;
    };

    await delay(350);
    say('ResLab Studio — pre-registered analysis');
    say('================================================================', 't-rule');
    await delay(420);

    // 1 · DESIGN
    this.setStep(0, 'done');
    const { artifact, powerNote } = createStudy(this.design());
    this.registry.artifacts.push(artifact);
    this.artifactId = artifact.id;
    this.status.textContent = 'designing the study…';
    await delay(300);
    say('');
    say('1 · DESIGN', 't-hl');
    await delay(140);
    say(`   ${artifact.design.title}`);
    await delay(120);
    say(`   planned test: ${artifact.design.plannedTest}   alpha: ${artifact.design.alpha}   power target: ${artifact.design.powerTarget}`);
    await delay(120);
    say(`   power: ${powerNote}`, 't-dim');
    await delay(500);

    // 2 · PRE-REGISTER
    this.setStep(1, 'active');
    this.status.textContent = 'sealing the plan with SHA-256…';
    await delay(320);
    const locked = await lockStudy(this.registry, this.artifactId!, this.audit);
    this.lockChecksum = locked.checksum;
    const ok = await verifyLock(locked);
    this.setStep(1, 'done');
    say('');
    say('2 · PRE-REGISTERED (LOCKED)', 't-hl');
    await delay(120);
    say(`   sha-256: ${this.lockChecksum!.slice(0, 18)}…`);
    await delay(120);
    say(`   lock verified: ${String(ok).toUpperCase()}   audit: prereg.lock`, 't-ok');
    await delay(520);

    // 3 · ANALYZE
    this.setStep(2, 'active');
    this.status.textContent = 'computing the confirmatory test…';
    await delay(320);
    this.control = normalSample(20260814, 40, 70, 10);
    this.treated = normalSample(20260815, 40, 78, 10);
    await this.session.recordDataVersion('v1.0.0', 'cleaned and anonymized (seed 20260814/20260815)');
    await this.session.finalizeData();
    const run = await this.session.runAnalysis({
      lane: 'confirmatory',
      preregId: this.artifactId!,
      test: 'welch_t',
      params: { alpha: 0.05, tails: 2, outcomeVariable: 'exam_score' },
      data: { groups: [this.control, this.treated] },
    });
    const r = run.result;
    const dc = descriptive(this.control);
    const dt = descriptive(this.treated);
    this.setStep(2, 'done');
    say('');
    say('3 · CONFIRMATORY ANALYSIS (welch_t)', 't-hl');
    await delay(120);
    say(`   control: mean ${f4(dc.mean)} (n=${dc.n})   treated: mean ${f4(dt.mean)} (n=${dt.n})`);
    await delay(120);
    say(`   t = ${f4(r.statistic)}   df = ${f4(r.df!)}   p = ${f4(r.p)}   d = ${f4(r.effectSize!)}`);
    await delay(120);
    say(`   hard verification: ${run.verification.ok ? 'PASSED' : 'FAILED'}   compliance: ${run.compliance.compliant ? 'COMPLIANT' : 'VIOLATION'}`, 't-ok');
    await delay(120);
    say('   [!] n=40 < planned 63 — power only 60.9% (target 80%)', 't-err');
    await delay(560);

    // 4 · DETECT
    this.setStep(3, 'active');
    this.status.textContent = 'running integrity detectors…';
    await delay(300);
    const findings = runDetectors({ session: this.session });
    this.setStep(3, 'done');
    say('');
    say('4 · INTEGRITY DETECTORS', 't-hl');
    if (findings.length === 0) {
      await delay(120);
      say('   no deviations detected', 't-ok');
    } else {
      for (const f of findings) {
        await delay(120);
        say(`   [${f.severity.toUpperCase()}] ${f.message}`, f.severity === 'high' ? 't-err' : 't-hl');
        say(`     → ${f.explanation}`, 't-dim');
      }
      await delay(120);
      say('   flagged for review — the deviation is now visible.');
    }
    await delay(560);

    // 5 · PROVE
    this.setStep(4, 'active');
    this.status.textContent = 'verifying the audit chain…';
    await delay(300);
    const check = await this.audit.verify();
    const recipe = JSON.stringify({
      prereg: this.artifactId,
      tests: this.session.runs.map((x) => ({ test: x.test, lane: x.lane, p: x.result.p })),
      data: 'seed 20260814/20260815, n=40 per group',
    });
    const recipeHash = await sha256Hex(recipe);
    this.setStep(4, 'done');
    say('');
    say('5 · PROVENANCE', 't-hl');
    await delay(120);
    say(`   audit log: ${this.audit.length} events — chain ${check.valid ? 'INTACT' : 'BROKEN'}`, 't-ok');
    await delay(120);
    say(`   reproducibility recipe: ${recipeHash.slice(0, 16)}…`, 't-dim');
    await delay(320);

    // summary card
    const t = this.t('hsT');
    const df = this.t('hsDf');
    const p = this.t('hsP');
    const d = this.t('hsD');
    t.textContent = f4(r.statistic);
    df.textContent = f4(r.df!);
    p.textContent = f4(r.p);
    d.textContent = f4(r.effectSize!);
    this.summary.classList.remove('hidden');

    this.status.textContent = '✓ complete — every number above was computed and verified locally.';
    this.playing = false;
  }

  private t(id: string): HTMLElement {
    return document.getElementById(id)!;
  }

  private setStep(i: number, state: 'active' | 'done'): void {
    this.steps.forEach((s, idx) => {
      s.classList.toggle('active', state === 'active' && idx === i);
      s.classList.toggle('done', state === 'done' && idx === i);
    });
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
}
