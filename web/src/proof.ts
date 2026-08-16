import {
  descriptive,
  type AuditEvent,
  type TestRecommendation,
  type TestResult,
  type VerificationReport,
} from '@reslab/core';

export interface ProofGroup {
  name: string;
  values: number[];
}

export interface ProofOptions {
  fileName: string;
  rawText: string;
  dataHash: string;
  groupName: string;
  valueName: string;
  groups: [ProofGroup, ProofGroup];
  result: TestResult;
  verification: VerificationReport;
  auditEvents: readonly AuditEvent[];
  auditValid: boolean;
  alpha: number;
}

const f4 = (x: number): string => (x !== 0 && Math.abs(x) < 1e-4 ? x.toExponential(3) : Number(x.toFixed(4)).toString());
const NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function svgEl(tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

function headIco(markup: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'vc-ico proof-ico';
  span.innerHTML = markup;
  return span;
}

function download(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function buildProof(opts: ProofOptions, container: HTMLElement): void {
  container.innerHTML = '';
  const wrap = el('div', 'proof-wrap');
  wrap.appendChild(buildGraph(opts));
  const grid = el('div', 'proof-grid');
  grid.appendChild(buildStats(opts));
  grid.appendChild(buildAnalysis(opts));
  wrap.appendChild(grid);
  wrap.appendChild(buildAudit(opts));
  wrap.appendChild(buildActions(opts));
  container.appendChild(wrap);
  container.classList.remove('hidden');
}

// ---- interactive strip-plot graph ----

function buildGraph(opts: ProofOptions): HTMLElement {
  const card = el('div', 'proof-card');
  const head = el('div', 'proof-head');
  head.append(
    headIco(
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 20v-6"/><path d="M12 20V8"/><path d="M19 20v-9"/><path d="M3 20h18"/></svg>',
    ),
    el('span', '', 'The data, plotted'),
  );
  card.appendChild(head);

  const wrap = el('div', 'graph-wrap');
  const tip = el('div', 'tip');
  tip.style.display = 'none';
  wrap.appendChild(tip);

  const all = opts.groups.flatMap((g) => g.values);
  const rawLo = Math.min(...all);
  const rawHi = Math.max(...all);
  const pad = (rawHi - rawLo) * 0.08 || 1;
  const min = rawLo - pad;
  const max = rawHi + pad;
  const W = 560;
  const H = 250;
  const L = 44;
  const R = 16;
  const T = 18;
  const B = 38;
  const plotW = W - L - R;
  const plotH = H - T - B;
  const y = (v: number): number => T + ((max - v) / (max - min)) * plotH;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'proof-graph', role: 'img' });
  for (const v of [min, (min + max) / 2, max]) {
    svg.appendChild(svgEl('line', { x1: L, y1: y(v), x2: W - R, y2: y(v), stroke: '#e8ece1', 'stroke-width': 1 }));
    svg.appendChild(svgEl('text', { x: L - 8, y: y(v) + 3.5, class: 'g-lab', 'text-anchor': 'end' }, f4(v)));
  }

  const palette = ['#7fae4e', '#f0b450'] as const;
  const meanStroke = ['#5c8f37', '#c98f2b'] as const;

  opts.groups.forEach((g, gi) => {
    const color = palette[gi]!;
    const stroke = meanStroke[gi]!;
    const cx = L + plotW * (gi === 0 ? 0.27 : 0.73);
    const mean = descriptive(g.values).mean;
    svg.appendChild(svgEl('line', { x1: cx - 36, y1: y(mean), x2: cx + 36, y2: y(mean), stroke, 'stroke-width': 2.5 }));
    svg.appendChild(svgEl('text', { x: cx + 42, y: y(mean) + 4, class: 'g-mean', 'text-anchor': 'start' }, `mean ${f4(mean)}`));
    g.values.forEach((v, i) => {
      const jitter = ((i * 37) % 9) - 4;
      const c = svgEl('circle', {
        cx: cx + jitter * 5,
        cy: y(v),
        r: 4.5,
        class: 'pt',
        fill: color,
        'fill-opacity': 0.85,
      });
      const show = (): void => {
        tip.textContent = `${g.name}: ${f4(v)}`;
        tip.style.display = 'block';
        const w = wrap.getBoundingClientRect();
        const r = c.getBoundingClientRect();
        tip.style.left = `${r.left - w.left + r.width / 2}px`;
        tip.style.top = `${r.top - w.top - 6}px`;
        tip.style.transform = 'translate(-50%, -100%)';
        c.setAttribute('r', '6.5');
        c.setAttribute('fill-opacity', '1');
      };
      const hide = (): void => {
        tip.style.display = 'none';
        c.setAttribute('r', '4.5');
        c.setAttribute('fill-opacity', '0.85');
      };
      c.addEventListener('mouseenter', show);
      c.addEventListener('mousemove', show);
      c.addEventListener('mouseleave', hide);
      svg.appendChild(c);
    });
    svg.appendChild(
      svgEl('text', { x: cx, y: H - 12, class: 'g-name', 'text-anchor': 'middle' }, `${g.name} · n = ${g.values.length}`),
    );
  });

  wrap.appendChild(svg);
  card.appendChild(wrap);
  return card;
}

// ---- structured report ----

function buildStats(opts: ProofOptions): HTMLElement {
  const card = el('div', 'proof-card');
  const head = el('div', 'proof-head');
  head.append(
    headIco(
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    ),
    el('span', '', 'Group statistics'),
  );
  card.appendChild(head);

  const table = document.createElement('table');
  table.className = 'proof-table';
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const h of ['Group', 'n', 'Mean', 'Median', 'SD']) {
    const th = document.createElement('th');
    th.textContent = h;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const g of opts.groups) {
    const d = descriptive(g.values);
    const tr = document.createElement('tr');
    for (const cell of [g.name, String(d.n), f4(d.mean), f4(d.median), f4(d.sd)]) {
      const td = document.createElement('td');
      td.textContent = cell;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  card.appendChild(table);
  return card;
}

function buildAnalysis(opts: ProofOptions): HTMLElement {
  const card = el('div', 'proof-card');
  const head = el('div', 'proof-head');
  head.append(
    headIco(
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    ),
    el('span', '', 'Analysis'),
  );
  card.appendChild(head);

  const r = opts.result;
  const rows: Array<[string, string, boolean]> = [
    ['Data file', opts.fileName, false],
    ['Columns', `${opts.groupName} → ${opts.valueName}`, false],
    ['Test', r.method, false],
    ['Statistic', `${r.test === 'mann_whitney' ? 'U' : 't'} = ${f4(r.statistic)}`, false],
    ...(r.df !== undefined ? ([['df', f4(r.df), false]] as Array<[string, string, boolean]>) : []),
    ['p', f4(r.p), false],
    ...(r.effectSize !== undefined ? ([['Effect size', f4(r.effectSize), false]] as Array<[string, string, boolean]>) : []),
    ['Significance', r.p < opts.alpha ? `significant at α = ${opts.alpha}` : `not significant at α = ${opts.alpha}`, false],
    ['Verification', opts.verification.ok ? 'passed' : `failed: ${opts.verification.errors.join('; ')}`, true],
    ['Data hash', `${opts.dataHash.slice(0, 20)}…`, true],
  ];
  for (const [label, value, mono] of rows) {
    const row = el('div', 'proof-row');
    const l = el('span', 'proof-label', label);
    const v = el(mono ? 'code' : 'b', '', value);
    row.append(l, v);
    card.appendChild(row);
  }
  return card;
}

function buildAudit(opts: ProofOptions): HTMLElement {
  const card = el('div', 'proof-card');
  const head = el('div', 'proof-head');
  head.append(
    headIco(
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    ),
    el('span', '', 'Chain of custody'),
    el('span', `chip ${opts.auditValid ? 'ok' : 'err'}`, opts.auditValid ? `intact · ${opts.auditEvents.length} events` : 'broken'),
  );
  card.appendChild(head);

  const list = el('div', 'audit-list');
  for (const e of opts.auditEvents) {
    const row = el('div', 'audit-row');
    const when = new Date(e.ts).toISOString().slice(11, 19);
    row.append(
      el('span', 'a-seq', `#${e.seq}`),
      el('span', 'a-type', e.type),
      el('span', 'a-time', when),
      el('span', 'a-hash', `${e.hash.slice(0, 12)}…`),
    );
    list.appendChild(row);
  }
  card.appendChild(list);
  return card;
}

function buildActions(opts: ProofOptions): HTMLElement {
  const card = el('div', 'proof-card proof-actions-card');
  const head = el('div', 'proof-head');
  head.append(
    headIco(
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
    ),
    el('span', '', 'Raw data'),
  );
  card.appendChild(head);

  const actions = el('div', 'proof-actions');
  const csvBtn = el('button', 'btn btn-primary sample-btn', 'Download raw data (CSV)');
  csvBtn.addEventListener('click', () => download(opts.fileName, opts.rawText, 'text/csv'));
  const jsonBtn = el('button', 'btn btn-ghost sample-btn', 'Download report (JSON)');
  jsonBtn.addEventListener('click', () => {
    const report = {
      reslab: 'verified two-group analysis',
      generatedAt: new Date().toISOString(),
      dataFile: opts.fileName,
      dataHash: opts.dataHash,
      columns: { group: opts.groupName, value: opts.valueName },
      groups: Object.fromEntries(
        opts.groups.map((g) => {
          const d = descriptive(g.values);
          return [g.name, { n: d.n, mean: d.mean, median: d.median, sd: d.sd, min: d.min, max: d.max, values: g.values }];
        }),
      ),
      test: {
        method: opts.result.method,
        test: opts.result.test,
        statistic: opts.result.statistic,
        df: opts.result.df,
        p: opts.result.p,
        effectSize: opts.result.effectSize,
      },
      significance: { alpha: opts.alpha, significant: opts.result.p < opts.alpha },
      verification: { ok: opts.verification.ok, errors: opts.verification.errors },
      auditTrail: { valid: opts.auditValid, events: opts.auditEvents },
    };
    download('reslab-report.json', JSON.stringify(report, null, 2), 'application/json');
  });
  actions.append(csvBtn, jsonBtn);
  card.appendChild(actions);

  const hash = el(
    'div',
    'proof-hash',
    `data file sha-256 · ${opts.dataHash.slice(0, 24)}… · this exact file produced every number above`,
  );
  card.appendChild(hash);
  return card;
}
