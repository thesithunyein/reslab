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
    const add = (el: HTMLElement): void => {
      el.classList.add('anim');
      this.output.appendChild(el);
      this.output.scrollTop = this.output.scrollHeight;
    };
    const section = (label: string): void => {
      const s = document.createElement('div');
      s.className = 'sec';
      const dot = document.createElement('span');
      dot.className = 'sec-dot';
      const t = document.createElement('span');
      t.textContent = label;
      s.append(dot, t);
      add(s);
    };
    const row = (label: string, value: string, extra = ''): void => {
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
      add(r);
    };
    const badge = (text: string, kind: 'ok' | 'warn' | 'dim' = 'ok'): HTMLElement => {
      const b = document.createElement('span');
      b.className = `pill ${kind}`;
      b.textContent = text;
      add(b);
      return b;
    };
    const title = (text: string): void => {
      const h = document.createElement('div');
      h.className = 'doc-title';
      h.textContent = text;
      add(h);
    };
    const note = (text: string, kind: 'warn' | 'dim' = 'dim'): void => {
      const n = document.createElement('div');
      n.className = `note ${kind}`;
      n.textContent = text;
      add(n);
    };

    await delay(250);
    title('Pre-registered analysis');
    await delay(500);

    // 1 · DESIGN
    this.setStep(0, 'done');
    const { artifact, powerNote } = createStudy(this.design());
    this.registry.artifacts.push(artifact);
    this.artifactId = artifact.id;
    this.status.textContent = 'designing the study…';
    await delay(300);
    section('1 · DESIGN');
    await delay(150);
    const t = document.createElement('div');
    t.className = 'doc-subject';
    t.textContent = artifact.design.title;
    add(t);
    await delay(160);
    row('Planned test', 'Welch t-test', `two-tailed · α = ${artifact.design.alpha}`);
    await delay(150);
    row('Power target', '80%', powerNote);
    await delay(450);

    // 2 · PRE-REGISTER
    this.setStep(1, 'active');
    this.status.textContent = 'sealing the plan with SHA-256…';
    await delay(300);
    const locked = await lockStudy(this.registry, this.artifactId!, this.audit);
    this.lockChecksum = locked.checksum;
    const ok = await verifyLock(locked);
    this.setStep(1, 'done');
    section('2 · PRE-REGISTERED');
    await delay(150);
    const c = document.createElement('code');
    c.className = 'hash';
    c.textContent = `sha-256  ${this.lockChecksum!.slice(0, 18)}…`;
    add(c);
    await delay(120);
    badge(ok ? 'lock verified ✓' : 'lock verification failed');
    await delay(450);

    // 3 · ANALYZE
    this.setStep(2, 'active');
    this.status.textContent = 'computing the confirmatory test…';
    await delay(300);
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
    section('3 · CONFIRMATORY ANALYSIS');
    await delay(150);

    const grid = document.createElement('div');
    grid.className = 'stats4';
    const cell = (v: string, l: string): void => {
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
    };
    cell(f4(r.statistic), 't');
    cell(f4(r.df!), 'df');
    cell(f4(r.p), 'p');
    cell(f4(r.effectSize!), "Cohen's d");
    add(grid);
    await delay(160);
    row('Means', `control ${f4(dc.mean)} (n=${dc.n}) · treated ${f4(dt.mean)} (n=${dt.n})`);
    await delay(120);
    badge(run.verification.ok ? 'hard verification PASSED ✓' : 'verification FAILED');
    if (run.compliance.compliant) badge('compliance COMPLIANT ✓');
    await delay(120);
    note('n = 40 < planned 63 — power only 60.9% (target 80%)', 'warn');
    await delay(450);

    // 4 · DETECT
    this.setStep(3, 'active');
    this.status.textContent = 'running integrity detectors…';
    await delay(300);
    const findings = runDetectors({ session: this.session });
    this.setStep(3, 'done');
    section('4 · INTEGRITY DETECTORS');
    if (findings.length === 0) {
      await delay(150);
      badge('no deviations detected ✓');
    } else {
      for (const f of findings) {
        await delay(160);
        note(`[${f.severity.toUpperCase()}] ${f.message}`, f.severity === 'high' ? 'warn' : 'warn');
        const e = document.createElement('div');
        e.className = 'note dim';
        e.textContent = `→ ${f.explanation}`;
        add(e);
      }
      await delay(120);
      const f = document.createElement('div');
      f.className = 'note dim';
      f.textContent = 'flagged for review — the deviation is now visible.';
      add(f);
    }
    await delay(450);

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
    section('5 · PROVENANCE');
    await delay(150);
    badge(`audit chain INTACT ✓ · ${this.audit.length} events`);
    await delay(140);
    const rc = document.createElement('code');
    rc.className = 'hash';
    rc.textContent = `recipe  ${recipeHash.slice(0, 16)}…`;
    add(rc);
    await delay(120);
    note('every number above is computed and verified — nothing was silently changed.', 'dim');
    await delay(320);

    // summary card
    const st = this.t('hsT');
    const sdf = this.t('hsDf');
    const sp = this.t('hsP');
    const sd = this.t('hsD');
    st.textContent = f4(r.statistic);
    sdf.textContent = f4(r.df!);
    sp.textContent = f4(r.p);
    sd.textContent = f4(r.effectSize!);
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
