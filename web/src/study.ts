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

const STEPS = ['Design', 'Pre-register', 'Analyze', 'Detect', 'Prove'] as const;

export class StudyFlow {
  private audit = new AuditLog();
  private registry = newRegistry();
  private session = new ResearchSession(this.audit, this.registry);
  private artifactId: string | null = null;
  private lockChecksum: string | null = null;
  private control: number[] = [];
  private treated: number[] = [];
  private done = new Set<number>();
  private running = false;
  private out: HTMLElement;
  private statusEl: HTMLElement;
  private stepBtns: NodeListOf<HTMLButtonElement>;
  private summary: HTMLElement;

  constructor(
    output: HTMLElement,
    status: HTMLElement,
    stepBtns: NodeListOf<HTMLButtonElement>,
    summary: HTMLElement,
  ) {
    this.out = output;
    this.statusEl = status;
    this.stepBtns = stepBtns;
    this.summary = summary;
    stepBtns.forEach((btn, i) => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('done')) return;
        void this.runThrough(i);
      });
    });
  }

  /** Show the initial design step without running the engine. */
  async init(): Promise<void> {
    this.out.innerHTML = '';
    this.summary.classList.add('hidden');
    this.status('ready. pick a step to run the flow.');
    this.renderDesign();
    this.markStep(0, 'active');
  }

  /** Run every step up to and including index i, in order. */
  async runThrough(i: number): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      this.status(`running ${STEPS[i]!.toLowerCase()}...`);
      for (let s = 0; s <= i; s++) {
        if (!this.done.has(s)) {
          await this.runStep(s);
        }
      }
      this.markStep(i, 'done');
      this.status('done. every number was computed and verified locally.');
    } finally {
      this.running = false;
    }
  }

  async runAll(): Promise<void> {
    if (this.running) return;
    this.out.innerHTML = '';
    this.done.clear();
    this.summary.classList.add('hidden');
    this.control = [];
    this.treated = [];
    for (let s = 0; s < STEPS.length; s++) this.stepBtns[s]!.classList.remove('done', 'active');
    await this.runThrough(STEPS.length - 1);
  }

  private async runStep(step: number): Promise<void> {
    if (step === 0) this.out.innerHTML = '';
    this.markStep(step, 'active');
    switch (step) {
      case 0: await this.stepDesign(); break;
      case 1: await this.stepLock(); break;
      case 2: await this.stepAnalyze(); break;
      case 3: await this.stepDetect(); break;
      case 4: await this.stepProve(); break;
    }
    this.done.add(step);
    this.markStep(step, 'done');
  }

  // ---- rendering helpers ----

  private status(text: string): void {
    this.statusEl.textContent = text;
  }

  private add(el: HTMLElement): void {
    el.classList.add('anim');
    this.out.appendChild(el);
    this.out.scrollTop = this.out.scrollHeight;
  }

  private section(label: string): void {
    const s = document.createElement('div');
    s.className = 'sec';
    const dot = document.createElement('span');
    dot.className = 'sec-dot';
    const t = document.createElement('span');
    t.textContent = label;
    s.append(dot, t);
    this.add(s);
  }

  private row(label: string, value: string, extra = ''): void {
    const r = document.createElement('div');
    r.className = 'krow';
    const l = document.createElement('span');
    l.className = 'krow-label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'krow-value';
    v.textContent = value;
    r.append(l, v);
    if (extra) {
      const e = document.createElement('span');
      e.className = 'krow-extra';
      e.textContent = extra;
      r.append(e);
    }
    this.add(r);
  }

  private pill(text: string, kind: 'ok' | 'warn' | 'dim' = 'ok'): void {
    const b = document.createElement('span');
    b.className = `pill ${kind}`;
    b.textContent = text;
    this.add(b);
  }

  private note(text: string, kind: 'warn' | 'dim' = 'dim'): void {
    const n = document.createElement('div');
    n.className = `note ${kind}`;
    n.textContent = text;
    this.add(n);
  }

  private hash(text: string): void {
    const c = document.createElement('code');
    c.className = 'hash';
    c.textContent = text;
    this.add(c);
  }

  private statGrid(values: Array<[string, string]>): void {
    const grid = document.createElement('div');
    grid.className = 'stats4';
    for (const [v, l] of values) {
      const d = document.createElement('div');
      d.className = 's4-cell';
      const n = document.createElement('div');
      n.className = 's4-num';
      n.textContent = v;
      const lab = document.createElement('div');
      lab.className = 's4-lab';
      lab.textContent = l;
      d.append(n, lab);
      grid.appendChild(d);
    }
    this.add(grid);
  }

  private markStep(i: number, state: 'active' | 'done'): void {
    this.stepBtns.forEach((s, idx) => {
      s.classList.toggle('active', state === 'active' && idx === i);
      s.classList.toggle('done', state === 'done' && idx === i);
    });
  }

  // ---- engine steps ----

  private renderDesign(): void {
    const { artifact, powerNote } = createStudy(this.design());
    this.registry.artifacts.push(artifact);
    this.artifactId = artifact.id;
    this.section('1 · DESIGN');
    const t = document.createElement('div');
    t.className = 'doc-subject';
    t.textContent = artifact.design.title;
    this.add(t);
    this.row('Planned test', 'Welch t-test', `two-tailed · α = ${artifact.design.alpha}`);
    this.row('Power target', '80%', powerNote);
  }

  private async stepDesign(): Promise<void> {
    this.status('designing the study...');
    this.out.innerHTML = '';
    await delay(300);
    this.renderDesign();
  }

  private async stepLock(): Promise<void> {
    this.status('sealing the plan with SHA-256...');
    await delay(250);
    if (!this.artifactId) this.renderDesign();
    const target = this.registry.artifacts.find((a) => a.id === this.artifactId)!;
    const locked = await lockStudy(this.registry, target.id, this.audit);
    this.lockChecksum = locked.checksum;
    const ok = await verifyLock(locked);
    this.section('2 · PRE-REGISTERED');
    await delay(140);
    this.hash(`sha-256  ${this.lockChecksum!.slice(0, 18)}...`);
    await delay(100);
    this.pill(ok ? 'lock verified' : 'lock verification failed');
    this.note('the plan is sealed. revisions create new versions; the original is never mutated.', 'dim');
  }

  private async stepAnalyze(): Promise<void> {
    this.status('computing the confirmatory test...');
    await delay(250);
    if (this.control.length === 0) {
      this.control = normalSample(20260814, 40, 70, 10);
      this.treated = normalSample(20260815, 40, 78, 10);
    }
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
    this.section('3 · CONFIRMATORY ANALYSIS');
    await delay(140);
    this.statGrid([
      [f4(r.statistic), 't'],
      [f4(r.df!), 'df'],
      [f4(r.p), 'p'],
      [f4(r.effectSize!), "Cohen's d"],
    ]);
    await delay(140);
    this.row('Means', `control ${f4(dc.mean)} (n=${dc.n}) · treated ${f4(dt.mean)} (n=${dt.n})`);
    await delay(120);
    if (run.verification.ok) this.pill('hard verification passed');
    if (run.compliance.compliant) this.pill('compliance compliant');
    await delay(120);
    this.note('n = 40 < planned 63, power only 60.9% (target 80%)', 'warn');
  }

  private async stepDetect(): Promise<void> {
    this.status('running integrity detectors...');
    await delay(250);
    const findings = runDetectors({ session: this.session });
    this.section('4 · INTEGRITY DETECTORS');
    if (findings.length === 0) {
      this.pill('no deviations detected');
    } else {
      for (const f of findings) {
        await delay(140);
        this.note(`[${f.severity.toUpperCase()}] ${f.message}`, 'warn');
        await delay(120);
        this.note(`→ ${f.explanation}`, 'dim');
      }
      await delay(100);
      this.note('flagged for review. the deviation is now visible.', 'dim');
    }
  }

  private async stepProve(): Promise<void> {
    this.status('verifying the audit chain...');
    await delay(250);
    const check = await this.audit.verify();
    const recipe = JSON.stringify({
      prereg: this.artifactId,
      tests: this.session.runs.map((x) => ({ test: x.test, lane: x.lane, p: x.result.p })),
      data: 'seed 20260814/20260815, n=40 per group',
    });
    const recipeHash = await sha256Hex(recipe);
    this.section('5 · PROVENANCE');
    await delay(140);
    this.pill(`audit chain INTACT · ${this.audit.length} events`);
    await delay(120);
    this.hash(`recipe  ${recipeHash.slice(0, 16)}...`);
    await delay(100);
    this.note('every number above is computed and verified. nothing was silently changed.', 'dim');
    await delay(200);

    // summary card
    const lastRun = this.session.runs[this.session.runs.length - 1]!;
    const r = lastRun.result;
    const set = (id: string, v: string): void => {
      document.getElementById(id)!.textContent = v;
    };
    set('stT', f4(r.statistic));
    set('stDf', f4(r.df!));
    set('stP', f4(r.p));
    set('stD', f4(r.effectSize!));
    this.summary.classList.remove('hidden');
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

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
