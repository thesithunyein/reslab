import {
  AuditLog,
  descriptive,
  mannWhitney,
  newRegistry,
  recommendTwoGroupTest,
  ResearchSession,
  twoSampleT,
  verifyResult,
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
    sampleBtn: HTMLButtonElement,
  ) {
    browseLink.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('click', () => fileInput.click());
    sampleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.load(new File([sampleCsv()], 'sample-study.csv', { type: 'text/csv' }));
    });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) void this.load(file);
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
      if (file) void this.load(file);
    });
    runBtn.addEventListener('click', () => this.run());
  }

  private async load(file: File): Promise<void> {
    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length < 2) {
      this.status.textContent = '✗ Could not parse the file — expected a CSV with a header row.';
      return;
    }
    this.headers = rows[0]!.map((h) => h.trim());
    this.rows = rows.slice(1);
    if (this.headers.length === 0 || this.rows.length === 0) {
      this.status.textContent = '✗ Empty file or missing header row.';
      return;
    }
    this.populateSelects();
    this.controls.hidden = false;
    this.status.textContent = `✓ Loaded ${this.rows.length} rows × ${this.headers.length} columns from ${file.name}`;
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
    // Prefer a sensible default group column.
    const preferred = this.headers.findIndex((h) => /group|condition|arm|treatment|sex|gender|class|cohort/i.test(h));
    if (firstGroup !== null) this.groupSelect.value = preferred >= 0 ? String(preferred) : firstGroup;
    if (firstValue !== null) this.valueSelect.value = firstValue;
  }

  private run(): void {
    const valueCol = Number(this.valueSelect.value);
    const groupCol = Number(this.groupSelect.value);
    if (!Number.isFinite(valueCol) || !Number.isFinite(groupCol)) {
      this.status.textContent = '✗ Select a value column and a group column first.';
      return;
    }
    const counts = new Map<string, number>();
    for (const row of this.rows) {
      const g = (row[groupCol] ?? '').trim();
      if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
    if (top.length < 2) {
      this.status.textContent = '✗ Need at least two groups in the group column.';
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
      this.status.textContent = '✗ Each group needs at least 2 numeric values.';
      return;
    }

    void this.analyze(a, b, gA, gB, this.headers[valueCol]!, this.headers[groupCol]!);
  }

  private async analyze(a: number[], b: number[], gA: string, gB: string, valueName: string, groupName: string): Promise<void> {
    const da = descriptive(a);
    const db = descriptive(b);
    const rec = recommendTwoGroupTest(a, b);
    const result =
      rec.recommended === 'two_sample_t'
        ? twoSampleT(a, b, { equalVariance: true })
        : rec.recommended === 'welch_t'
          ? twoSampleT(a, b, { equalVariance: false })
          : mannWhitney(a, b);
    const verification = verifyResult(result);

    const audit = new AuditLog();
    const session = new ResearchSession(audit, newRegistry());
    const run = await session.runAnalysis({
      lane: 'exploratory',
      test: result.test,
      data: { groups: [a, b] },
      note: `user CSV analysis: ${groupName} → ${valueName}`,
    });
    const chain = await audit.verify();

    const lines: Array<{ text: string; cls: string }> = [];
    const push = (text: string, cls = ''): void => {
      lines.push({ text, cls });
    };
    push(`ResLab analysis — ${groupName} vs ${valueName}  (exploratory lane, labeled post-hoc)`);
    push(`========================================================================`, 't-rule');
    push(`${gA}:  n=${da.n}  mean=${f4(da.mean)}  sd=${f4(da.sd)}  median=${f4(da.median)}`);
    push(`${gB}:  n=${db.n}  mean=${f4(db.mean)}  sd=${f4(db.sd)}  median=${f4(db.median)}`);
    push('');
    push(`Assumption checks (why this test):`);
    for (const c of rec.checks) push(`  ${c.interpretation}`);
    push(`  → ${rec.explanation}`);
    push('');
    push(`Test: ${result.method}`);
    push(`  statistic = ${f4(result.statistic)}  ${result.df !== undefined ? `df = ${f4(result.df)}  ` : ''}p = ${f4(result.p)}${result.effectSize !== undefined ? `  effect = ${f4(result.effectSize)}` : ''}`);
    push(`  Hard verification: ${verification.ok ? 'PASSED ✓' : 'FAILED ✗'}   ${verification.errors.join('; ')}`, verification.ok ? 't-ok' : 't-err');
    push(`  Audit chain: ${chain.valid ? 'INTACT ✓' : 'BROKEN ✗'} (${audit.length} events)`, chain.valid ? 't-ok' : 't-err');
    push(`  Note: this is exploratory — it generates hypotheses, never conclusions.`, 't-dim');
    push(`  ${run.id.slice(0, 13)}… recorded in the audit log.`, 't-dim');

    this.status.innerHTML = lines.map((l) => `<div class="res-line ${l.cls}">${l.text}</div>`).join('');
  }
}
