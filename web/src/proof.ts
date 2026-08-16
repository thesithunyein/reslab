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
  tails: 1 | 2;
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
  wrap.appendChild(buildWriteup(opts));
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

// ---- study writeup (LLM-grounded, with a deterministic local fallback) ----

interface WriteupPayload {
  title: string;
  hypothesis: string;
  outcomeVariable: string;
  groupName: string;
  plannedTest: string;
  method: string;
  alpha: number;
  tails: 1 | 2;
  actualN: number[];
  groups: Array<{ label: string; n: number; mean: number; sd: number }>;
  statistic: number;
  df?: number;
  p: number;
  effectSize?: number;
  significant: boolean;
  findings: Array<{ pattern: string; severity: string; message: string }>;
}

function buildWriteupPayload(opts: ProofOptions): WriteupPayload {
  return {
    title: `${opts.valueName} by ${opts.groupName}: a two-group comparison`,
    hypothesis: `Compare ${opts.valueName} between the two groups in ${opts.groupName}.`,
    outcomeVariable: opts.valueName,
    groupName: opts.groupName,
    plannedTest: opts.result.method,
    method: opts.result.method,
    alpha: opts.alpha,
    tails: opts.tails,
    actualN: opts.groups.map((g) => g.values.length),
    groups: opts.groups.map((g) => {
      const d = descriptive(g.values);
      return { label: g.name, n: d.n, mean: d.mean, sd: d.sd };
    }),
    statistic: opts.result.statistic,
    df: opts.result.df,
    p: opts.result.p,
    effectSize: opts.result.effectSize,
    significant: opts.result.p < opts.alpha,
    findings: [
      {
        pattern: 'exploratory analysis',
        severity: 'info',
        message:
          'This analysis was run after data collection, without a pre-registered plan. Treat the result as hypothesis-generating, not confirmatory.',
      },
    ],
  };
}

function sourceTable(v: WriteupPayload): string {
  const fmt = (x?: number, digits = 4): string => {
    if (x === undefined || x === null || Number.isNaN(x)) return 'n/a';
    return x !== 0 && Math.abs(x) < 1e-4 ? x.toExponential(3) : String(Number(x.toFixed(digits)));
  };
  const rows: string[] = [
    '## Computed statistics (source of truth)',
    '',
    '| Quantity | Value |',
    '| --- | --- |',
    `| Test | ${v.method} |`,
    `| Sample sizes | ${v.actualN.join(', ')} |`,
    `| Group means | ${v.groups.map((g) => `${g.label}: ${fmt(g.mean)}`).join(', ')} |`,
    `| Statistic | ${fmt(v.statistic)} |`,
    `| Degrees of freedom | ${v.df === undefined ? 'n/a' : fmt(v.df, 2)} |`,
    `| p-value | ${fmt(v.p)} |`,
    `| Effect size | ${v.effectSize === undefined ? 'n/a' : fmt(v.effectSize)} |`,
    `| Significant at alpha=${v.alpha} | ${v.significant ? 'Yes' : 'No'} |`,
    '',
  ];
  return rows.join('\n');
}

/** Deterministic fallback: the same structure, built locally from the verified numbers. */
function localWriteup(v: WriteupPayload): string {
  const fmt = (x?: number, digits = 4): string => {
    if (x === undefined || x === null || Number.isNaN(x)) return 'n/a';
    return x !== 0 && Math.abs(x) < 1e-4 ? x.toExponential(3) : String(Number(x.toFixed(digits)));
  };
  const [gA, gB] = v.groups;
  const hi = gA!.mean >= gB!.mean ? gA! : gB!;
  const lo = hi === gA ? gB! : gA!;
  const direction = hi.mean !== lo.mean ? `${hi.label} averaged ${fmt(hi.mean, 1)} vs ${fmt(lo.mean, 1)} for ${lo.label}` : 'the two groups averaged the same';
  const verdict = v.significant
    ? `The difference was statistically significant (p = ${fmt(v.p)}), so chance is an unlikely explanation.`
    : `The difference was not statistically significant (p = ${fmt(v.p)}); it could easily be luck.`;
  return [
    '## Methods',
    '',
    `${v.title}. The outcome variable was ${v.outcomeVariable}, compared across the two groups in ${v.groupName ?? 'the data'}. ${v.method} was used with alpha = ${v.alpha} and ${v.tails === 1 ? 'one' : 'two'}-sided testing.`,
    '',
    '## Results',
    '',
    `${direction}, a gap of ${fmt(Math.abs(gA!.mean - gB!.mean), 1)} points. ${verdict} Full details are in the computed statistics table below.`,
    '',
    '## Integrity notes',
    '',
    ...v.findings.map((f) => `- [${f.severity}] ${f.pattern}: ${f.message} (flagged for review)`),
    '',
    sourceTable(v),
  ].join('\n');
}

/** Minimal safe markdown renderer: headings, lists, tables, bold, inline code. */
function renderMarkdown(md: string, container: HTMLElement): void {
  const lines = md.split(/\r?\n/);
  const pushInline = (node: HTMLElement, text: string): void => {
    for (const part of text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)) {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        const b = document.createElement('strong');
        b.textContent = part.slice(2, -2);
        node.appendChild(b);
      } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        const c = document.createElement('code');
        c.textContent = part.slice(1, -1);
        node.appendChild(c);
      } else if (part) {
        node.appendChild(document.createTextNode(part));
      }
    }
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trim();
    if (!line || line === '---') {
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      const h = document.createElement('h3');
      h.className = 'w-h';
      pushInline(h, line.slice(3));
      container.appendChild(h);
      i++;
      continue;
    }
    if (line.startsWith('- ')) {
      const ul = document.createElement('ul');
      ul.className = 'w-list';
      while (i < lines.length && lines[i]!.trim().startsWith('- ')) {
        const li = document.createElement('li');
        pushInline(li, lines[i]!.trim().slice(2));
        ul.appendChild(li);
        i++;
      }
      container.appendChild(ul);
      continue;
    }
    if (line.startsWith('|')) {
      const table = document.createElement('table');
      table.className = 'proof-table w-table';
      let firstRow = true;
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) {
        const cells = lines[i]!.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
        const isSep = cells.every((c) => /^:?-+:?$/.test(c));
        if (!isSep) {
          const tr = document.createElement('tr');
          for (const cell of cells) {
            const td = document.createElement(firstRow ? 'th' : 'td');
            pushInline(td, cell);
            tr.appendChild(td);
          }
          table.appendChild(tr);
          firstRow = false;
        }
        i++;
      }
      if (table.childElementCount) container.appendChild(table);
      continue;
    }
    const p = document.createElement('p');
    p.className = 'w-p';
    pushInline(p, line);
    container.appendChild(p);
    i++;
  }
}

function buildWriteup(opts: ProofOptions): HTMLElement {
  const card = el('div', 'proof-card');
  const head = el('div', 'proof-head');
  head.append(
    headIco(
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    ),
    el('span', '', 'Write up your study'),
  );
  card.appendChild(head);

  const note = el(
    'p',
    'w-note',
    'Turns these verified numbers into a Methods + Results + Integrity notes section you can paste into a paper or report. The AI only receives the numbers above; it cannot invent statistics.',
  );
  card.appendChild(note);

  const btn = el('button', 'btn btn-primary sample-btn', 'Generate writeup');
  const out = el('div', 'w-out');
  out.classList.add('hidden');
  card.append(btn, out);

  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.textContent = 'Writing...';
    out.classList.remove('hidden');
    out.innerHTML = '';
    const payload = buildWriteupPayload(opts);
    const render = (md: string, label: string): void => {
      const badge = el('div', 'w-badge', label);
      out.appendChild(badge);
      renderMarkdown(md, out);
      btn.disabled = false;
      btn.textContent = 'Regenerate writeup';
      out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    fetch('/api/writeup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { markdown?: string; error?: string } | null;
        if (res.ok && data && data.markdown) {
          render(data.markdown, 'Written by the ResLab writing engine');
        } else {
          const reason = data && data.error ? ` (${data.error})` : '';
          render(
            localWriteup(payload),
            `The AI writing service is not connected yet${reason ? `: ${reason}` : ''}. This writeup was generated locally from the same verified numbers.`,
          );
        }
      })
      .catch(() => {
        render(
          localWriteup(payload),
          'The AI writing service could not be reached. This writeup was generated locally from the same verified numbers.',
        );
      });
  });
  return card;
}
