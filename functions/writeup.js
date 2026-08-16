/**
 * Cloudflare Pages Function: grounded study writeup.
 *
 * The browser sends ONLY the numbers the engine already computed and verified.
 * This function validates them, asks an LLM to write Methods + Results +
 * Integrity notes using exactly those numbers, and appends a
 * "Computed statistics (source of truth)" table built server-side.
 *
 * The model interprets; the engine computes. The API key lives here as the
 * FEATHERLESS_API_KEY env var (set as a Pages secret) and never reaches the
 * client bundle.
 */

const MODELS = ['zai-org/GLM-5', 'moonshotai/Kimi-K2.5'];
const FEATHERLESS_BASE = 'https://api.featherless.ai/v1';

const fmtNum = (x, digits = 4) => {
  if (x === undefined || x === null || Number.isNaN(x)) return 'n/a';
  if (x !== 0 && Math.abs(x) < 1e-4) return x.toExponential(3);
  return String(Number(x.toFixed(digits)));
};

function corsHeaders(origin) {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

/** Validate and normalize the payload. Returns { value } or { error }. */
function validate(input) {
  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
  if (!input || typeof input !== 'object') return { error: 'invalid payload' };

  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const title = str(input.title, 200) || 'Two-group comparison';
  const hypothesis = str(input.hypothesis, 300) || 'Compare the two groups.';
  const outcomeVariable = str(input.outcomeVariable, 100) || 'outcome';
  const plannedTest = str(input.plannedTest, 100) || 'two-sample test';
  const method = str(input.method, 120) || plannedTest;

  const alpha = isNum(input.alpha) && input.alpha > 0 && input.alpha <= 0.5 ? input.alpha : 0.05;
  const tails = input.tails === 1 ? 1 : 2;

  if (!Array.isArray(input.actualN) || input.actualN.length < 1 || input.actualN.length > 10) {
    return { error: 'actualN must be a non-empty array of sizes' };
  }
  const actualN = input.actualN.map((n) => Math.round(Number(n)));
  if (!actualN.every((n) => Number.isFinite(n) && n >= 2 && n <= 1000000)) {
    return { error: 'invalid sample sizes' };
  }

  if (!Array.isArray(input.groups) || input.groups.length < 1 || input.groups.length > 10) {
    return { error: 'groups must be a non-empty array' };
  }
  const groups = input.groups.slice(0, 10).map((g) => ({
    label: str(g && g.label, 60),
    n: Math.round(Number(g && g.n)),
    mean: Number(g && g.mean),
    sd: Number(g && g.sd),
  }));
  if (!groups.every((g) => g.label && g.n >= 2 && isNum(g.mean) && isNum(g.sd))) {
    return { error: 'invalid group statistics' };
  }

  const statistic = Number(input.statistic);
  const df = input.df === undefined || input.df === null ? undefined : Number(input.df);
  const p = Number(input.p);
  const effectSize = input.effectSize === undefined || input.effectSize === null ? undefined : Number(input.effectSize);
  if (!isNum(statistic)) return { error: 'invalid statistic' };
  if (df !== undefined && (!isNum(df) || df <= 0)) return { error: 'invalid df' };
  if (!isNum(p) || p < 0 || p > 1) return { error: 'invalid p-value' };
  if (effectSize !== undefined && !isNum(effectSize)) return { error: 'invalid effect size' };

  const findings = Array.isArray(input.findings)
    ? input.findings.slice(0, 20).map((f) => ({
        pattern: str(f && f.pattern, 60),
        severity: str(f && f.severity, 20),
        message: str(f && f.message, 300),
      }))
    : [];
  const significant = input.significant === true;

  return {
    value: { title, hypothesis, outcomeVariable, plannedTest, method, alpha, tails, actualN, groups, statistic, df, p, effectSize, significant, findings },
  };
}

function buildPrompt(v) {
  const system = [
    'You are the writing engine of ResLab, a research-integrity tool.',
    'Write a Methods + Results + Integrity Notes section in Markdown for a study.',
    'HARD RULES:',
    '1. Use ONLY the exact numbers provided in the user message. Never invent, round differently, or add statistics that were not given.',
    '2. Cite each computed value inline, e.g. `t = -4.69, df = 76.3, p = 1.18e-5`.',
    '3. If the result is not significant relative to alpha, say so plainly. Never frame an exploratory finding as confirmatory.',
    '4. Describe the direction of effects from the GROUP MEANS provided (which group had the higher mean). Do not infer direction from the sign of a test statistic alone.',
    '5. If integrity findings are listed, summarize each one honestly under "Integrity notes" and mark it as flagged for review.',
    '6. Do not claim causality. Keep claims to what the statistics support.',
  ].join('\n');

  const user = [
    'STUDY',
    `- Title: ${v.title}`,
    `- Hypothesis: ${v.hypothesis}`,
    `- Outcome variable: ${v.outcomeVariable}`,
    `- Planned test: ${v.plannedTest}`,
    `- alpha: ${v.alpha}, tails: ${v.tails}`,
    '',
    'COMPUTED RESULTS (the only numbers you may cite)',
    `- Method used: ${v.method ? String(v.method).slice(0, 120) : 'two-sample test'}`,
    `- Sample sizes: ${v.actualN.join(', ')}`,
    `- Group means (use these to describe direction): ${v.groups.map((g) => `${g.label} mean = ${fmtNum(g.mean)} (n = ${g.n}, sd = ${fmtNum(g.sd)})`).join('; ')}`,
    `- Statistic: ${fmtNum(v.statistic)}`,
    `- Degrees of freedom: ${v.df === undefined ? 'n/a' : fmtNum(v.df, 2)}`,
    `- p-value: ${fmtNum(v.p)}`,
    `- Effect size: ${v.effectSize === undefined ? 'n/a' : fmtNum(v.effectSize)}`,
    `- Significant at alpha=${v.alpha}: ${v.significant ? 'YES' : 'NO'}`,
    '',
    'INTEGRITY FINDINGS (flagged for review)',
    v.findings.length === 0 ? '- None' : v.findings.map((f) => `- [${f.severity}] ${f.pattern}: ${f.message}`).join('\n'),
    '',
    'Write the section now. Use markdown headings: ## Methods, ## Results, ## Integrity notes.',
  ].join('\n');

  return { system, user };
}

function sourceTable(v) {
  return [
    '## Computed statistics (source of truth)',
    '',
    '| Quantity | Value |',
    '| --- | --- |',
    `| Test | ${v.method ? String(v.method).slice(0, 120) : 'two-sample test'} |`,
    `| Sample sizes | ${v.actualN.join(', ')} |`,
    `| Group means | ${v.groups.map((g) => `${g.label}: ${fmtNum(g.mean)}`).join(', ')} |`,
    `| Statistic | ${fmtNum(v.statistic)} |`,
    `| Degrees of freedom | ${v.df === undefined ? 'n/a' : fmtNum(v.df, 2)} |`,
    `| p-value | ${fmtNum(v.p)} |`,
    `| Effect size | ${v.effectSize === undefined ? 'n/a' : fmtNum(v.effectSize)} |`,
    `| Significant at alpha=${v.alpha} | ${v.significant ? 'Yes' : 'No'} |`,
    '',
  ].join('\n');
}

async function callFeatherless(key, model, system, user) {
  const res = await fetch(`${FEATHERLESS_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 1200,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 404 && body.includes('model')) {
      return { error: `model ${model} not found` };
    }
    return { error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  }
  const data = await res.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) return { error: 'empty completion' };
  return { content, model: data.model || model };
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get('Origin') || '';
  const key = (context.env && context.env.FEATHERLESS_API_KEY) || '';

  if (!key) {
    return json({ error: 'writeup service is not configured yet (FEATHERLESS_API_KEY missing on the server)' }, 503, origin);
  }

  let input;
  try {
    input = await context.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400, origin);
  }

  const { value, error } = validate(input);
  if (error) return json({ error }, 400, origin);

  const { system, user } = buildPrompt(value);
  let lastErr = 'unknown error';
  for (const model of MODELS) {
    const result = await callFeatherless(key, model, system, user);
    if (result.error) {
      lastErr = result.error;
      if (result.error.includes('not found')) continue; // try next model
      return json({ error: result.error }, 502, origin);
    }
    const markdown = `${result.content.trim()}\n\n---\n\n${sourceTable(value)}`;
    return json({ markdown, model: result.model }, 200, origin);
  }
  return json({ error: lastErr }, 502, origin);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders('*') });
}
