import {
  AuditLog,
  descriptive,
  mannWhitney,
  newRegistry,
  recommendTwoGroupTest,
  ResearchSession,
  twoSampleT,
  verifyResult,
  type DescriptiveStats,
  type TestRecommendation,
  type TestResult,
  type VerificationReport,
} from '@reslab/core';
import { parseCsv } from './csv-parser';

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

/** Deterministic sample: spaced-repetition vs massed-practice exam scores (n=40 each). */
function sampleCsv(): string {
  const rand = mulberry32(20260814);
  const gauss = (): number => {
    const u = Math.max(rand(), 1e-12);
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const lines: string[] = ['study_condition,exam_score'];
  for (let i = 0; i < 40; i++) lines.push(`spaced,${(78 + 10 * gauss()).toFixed(2)}`);
  for (let i = 0; i < 40; i++) lines.push(`massed,${(67.5 + 10 * gauss()).toFixed(2)}`);
  return lines.join('\n');
}

export class CsvAnalyzer {
  private rows: string[][] = [];
  private headers: string[] = [];

  constructor(
    private dropzone: HTMLElement,
    private fileInput: HTMLInputElement,
    private browseLink: HTMLElement,
    private controls: HTMLElement,
    private valueSelect: HTMLSelectElement,
    private groupSelect: HTMLSelectElement,
    private runBtn: HTMLButtonElement,
    private status: HTMLElement,
    private result: HTMLElement,
    sampleBtn: HTMLButtonElement,
    private downloadBtn: HTMLButtonElement,
    private advToggle: HTMLButtonElement,
    private advPanel: HTMLElement,
    private alphaSel: HTMLSelectElement,
    private tailsSel: HTMLSelectElement,
  ) {
    browseLink.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('click', () => fileInput.click());
    sampleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.load(new File([sampleCsv()], 'sample-study.csv', { type: 'text/csv' }), true);
    });
    downloadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const blob = new Blob([sampleCsv()], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'reslab-sample.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
    advToggle.addEventListener('click', () => {
      this.advPanel.classList.toggle('hidden');
      this.advToggle.classList.toggle('open');
    });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) void this.load(file, false);
    });
    for (const ev of ['dragover', 'dragenter']) {
      dropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropzone.classList.add('drag');
      });
    }
    for (const ev of ['dragleave', 'drop']) {
      dropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropzone.classList.remove('drag');
      });
    }
    dropzone.addEventListener('drop', (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (file) void this.load(file, false);
    });
    runBtn.addEventListener('click', () => this.run());
  }

  private async load(file: File, autoRun: boolean): Promise<void> {
    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length < 2) {
      this.status.textContent = 'Could not parse the file. Expected a CSV with a header row.';
      return;
    }
    this.headers = rows[0]!.map((h) => h.trim());
    this.rows = rows.slice(1);
    if (this.headers.length === 0 || this.rows.length === 0) {
      this.status.textContent = 'Empty file or missing header row.';
      return;
    }
    this.populateSelects();
    this.controls.hidden = false;
    this.status.textContent = `Loaded ${this.rows.length} rows from ${file.name}. Ready to analyze.`;
    if (autoRun) {
      this.status.textContent = 'Analyzing the sample dataset...';
      await new Promise((r) => setTimeout(r, 80));
      this.run();
    }
  }

  private populateSelects(): void {
    const numeric = new Map<number, number>();
    const distinct = new Map<number, Set<string>>();
    for (let c = 0; c < this.headers.length; c++) {
      let num = 0;
      const seen = new Set<string>();
      for (const row of this.rows) {
        const raw = (row[c] ?? '').trim();
        if (raw !== '' && Number.isFinite(Number(raw))) num++;
        if (raw !== '') seen.add(raw);
      }
      numeric.set(c, num);
      distinct.set(c, seen);
    }
    this.valueSelect.innerHTML = '';
    this.groupSelect.innerHTML = '';
    let firstValue: string | null = null;
    let firstGroup: string | null = null;
    for (let c = 0; c < this.headers.length; c++) {
      const numericness = numeric.get(c)!;
      const uniq = distinct.get(c)!.size;
      const isValue = numericness / Math.max(this.rows.length, 1) > 0.6;
      const isGroup = !isValue && uniq >= 2 && uniq <= 50;
      this.valueSelect.add(new Option(`${this.headers[c]}${isValue ? '  (numeric ✓)' : ''}`, String(c), false, isValue));
      this.groupSelect.add(new Option(`${this.headers[c]}${isGroup ? `  (${uniq} groups ✓)` : ''}`, String(c), false, isGroup));
      if (isValue && firstValue === null) firstValue = String(c);
      if (isGroup && firstGroup === null) firstGroup = String(c);
    }
    const preferred = this.headers.findIndex((h) => /group|condition|arm|treatment|sex|gender|class|cohort/i.test(h));
    if (firstGroup !== null) this.groupSelect.value = preferred >= 0 ? String(preferred) : firstGroup;
    if (firstValue !== null) this.valueSelect.value = firstValue;
  }

  private run(): void {
    const valueCol = Number(this.valueSelect.value);
    const groupCol = Number(this.groupSelect.value);
    if (!Number.isFinite(valueCol) || !Number.isFinite(groupCol)) {
      this.status.textContent = 'Select a value column and a group column first.';
      return;
    }
    const counts = new Map<string, number>();
    for (const row of this.rows) {
      const g = (row[groupCol] ?? '').trim();
      if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
    if (top.length < 2) {
      this.status.textContent = 'Need at least two groups in the group column.';
      return;
    }
    const [gA, gB] = [top[0]![0], top[1]![0]];
    const collect = (g: string): number[] => {
      const vals: number[] = [];
      for (const row of this.rows) {
        if ((row[groupCol] ?? '').trim() !== g) continue;
        const v = Number((row[valueCol] ?? '').trim());
        if (Number.isFinite(v)) vals.push(v);
      }
      return vals;
    };
    const a = collect(gA);
    const b = collect(gB);
    if (a.length < 2 || b.length < 2) {
      this.status.textContent = 'Each group needs at least 2 numeric values.';
      return;
    }
    void this.analyze(a, b, gA, gB, this.headers[valueCol]!, this.headers[groupCol]!);
  }

  private async analyze(a: number[], b: number[], gA: string, gB: string, valueName: string, groupName: string): Promise<void> {
    const alpha = Number(this.alphaSel.value);
    const tails = Number(this.tailsSel.value) as 1 | 2;
    const da = descriptive(a);
    const db = descriptive(b);
    const rec = recommendTwoGroupTest(a, b);
    const result: TestResult =
      rec.recommended === 'two_sample_t'
        ? twoSampleT(a, b, { equalVariance: true, tails })
        : rec.recommended === 'welch_t'
          ? twoSampleT(a, b, { equalVariance: false, tails })
          : mannWhitney(a, b);
    const verification = verifyResult(result);

    const audit = new AuditLog();
    const session = new ResearchSession(audit, newRegistry());
    await session.runAnalysis({
      lane: 'exploratory',
      test: result.test,
      data: { groups: [a, b] },
      note: `user CSV analysis: ${groupName} → ${valueName}`,
    });
    const chain = await audit.verify();

    this.render(result, verification, chain.valid, audit.length, rec, alpha, da, db, gA, gB);
  }

  private render(
    r: TestResult,
    verification: VerificationReport,
    chainValid: boolean,
    events: number,
    rec: TestRecommendation,
    alpha: number,
    da: DescriptiveStats,
    db: DescriptiveStats,
    gA: string,
    gB: string,
  ): void {
    this.result.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'csv-result';

    const head = document.createElement('div');
    head.className = 'sr-head';
    const check = document.createElement('span');
    check.className = 'sr-check';
    check.textContent = '✓';
    const title = document.createElement('span');
    title.textContent = 'Verified result';
    head.append(check, title);
    card.appendChild(head);

    // plain-English verdict: the answer first
    const significant = r.p < alpha;
    const hi = da.mean >= db.mean ? gA : gB;
    const lo = hi === gA ? gB : gA;
    const hiM = Math.max(da.mean, db.mean);
    const loM = Math.min(da.mean, db.mean);
    const gap = Math.abs(da.mean - db.mean);
    const chance = r.p < 0.001 ? 'less than 0.1%' : `about ${(r.p * 100).toFixed(2)}%`;
    const f1 = (x: number): string => Number(x.toFixed(1)).toString();
    const verdict = document.createElement('div');
    verdict.className = 'sr-verdict';
    verdict.textContent = significant
      ? `${hi} averaged ${f1(hiM)} vs ${f1(loM)} for ${lo}, a ${f1(gap)}-point difference. That is statistically significant: the chance it is luck is ${chance}.`
      : `${hi} averaged ${f1(hiM)} vs ${f1(loM)} for ${lo}, but the difference is not statistically significant (p = ${f4(r.p)}). It could easily be luck; more data would give a clearer answer.`;
    card.appendChild(verdict);

    const sub = document.createElement('div');
    sub.className = 'sr-sub';
    sub.textContent = 'The numbers behind it';
    card.appendChild(sub);

    const grid = document.createElement('div');
    grid.className = 'hs-grid';
    const tiles: Array<[string, string]> = [[f4(r.statistic), r.test === 'mann_whitney' ? 'U' : 't']];
    if (r.df !== undefined) tiles.push([f4(r.df), 'df']);
    tiles.push([f4(r.p), 'p']);
    if (r.effectSize !== undefined) tiles.push([f4(r.effectSize), "Cohen's d"]);
    for (const [v, l] of tiles) {
      const cell = document.createElement('div');
      cell.className = 'hs-cell';
      const n = document.createElement('div');
      n.className = 'hs-num';
      n.textContent = v;
      const lab = document.createElement('div');
      lab.className = 'hs-lab';
      lab.textContent = l;
      cell.append(n, lab);
      grid.appendChild(cell);
    }
    card.appendChild(grid);

    const why = document.createElement('div');
    why.className = 'sr-why';
    const whyText: Record<string, string> = {
      two_sample_t: 'Used the pooled t-test (both groups look normal with similar spreads).',
      welch_t: "Used Welch's t-test (the groups differ in spread, so variance is not assumed equal).",
      mann_whitney: 'Used the Mann-Whitney test (the data is not normally shaped).',
    };
    why.textContent = whyText[rec.recommended] ?? rec.explanation;
    card.appendChild(why);

    const chips = document.createElement('div');
    chips.className = 'hs-chips';
    const sig = document.createElement('span');
    sig.className = significant ? 'chip ok' : 'chip dim';
    sig.textContent = significant ? 'statistically significant' : 'not statistically significant';
    const ver = document.createElement('span');
    ver.className = verification.ok ? 'chip ok' : 'chip err';
    ver.textContent = verification.ok ? 'every number verified' : 'verification failed';
    const aud = document.createElement('span');
    aud.className = chainValid ? 'chip dim' : 'chip err';
    aud.textContent = chainValid ? `recorded on the audit trail · ${events} event${events === 1 ? '' : 's'}` : 'audit trail broken';
    chips.append(sig, ver, aud);
    card.appendChild(chips);

    const use = document.createElement('div');
    use.className = 'sr-use';
    use.textContent = 'For any two-group comparison: exam scores, click rates, experiment results. The first line is the answer; the numbers below are the receipt.';
    card.appendChild(use);

    this.result.appendChild(card);
    this.result.classList.remove('hidden');
    this.status.textContent = '';
  }
}
