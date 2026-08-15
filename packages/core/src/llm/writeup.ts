/**
 * Grounded report writer.
 *
 * The LLM writes a Methods + Results + Integrity Notes section, but it may
 * ONLY use the exact computed numbers injected below — the report always
 * carries a "Computed statistics (source of truth)" table so the verified
 * values are present regardless of how the model phrases them.
 *
 * This is the "no LLM computes a number" rule made visible: the model
 * interprets; the engine computes.
 */
import { chatCompletion, type ChatResult } from './featherless.js';

export const DEFAULT_MODEL = 'zai-org/GLM-5';
export const CROSSCHECK_MODEL = 'moonshotai/Kimi-K2.5';

export interface WriteupFinding {
  pattern: string;
  severity: string;
  message: string;
}

export interface WriteupGroup {
  label: string;
  n: number;
  mean: number;
  sd: number;
}

export interface WriteupInput {
  title: string;
  hypothesis: string;
  outcomeVariable: string;
  plannedTest: string;
  alpha: number;
  tails: 1 | 2;
  plannedN?: number;
  actualN: number[];
  groups: WriteupGroup[];
  method: string;
  statistic: number;
  df?: number;
  p: number;
  effectSize?: number;
  significant: boolean;
  findings: WriteupFinding[];
  model?: string;
}

export interface WriteupResult extends ChatResult {
  markdown: string;
}

const fmtNum = (x: number | undefined, digits = 4): string => {
  if (x === undefined || Number.isNaN(x)) return 'n/a';
  if (x !== 0 && Math.abs(x) < 1e-4) return x.toExponential(3);
  return Number(x.toFixed(digits)).toString();
};

export function buildGroundedPrompt(input: WriteupInput): { system: string; user: string } {
  const system = [
    'You are the writing engine of ResLab, a research-integrity tool.',
    'Write a Methods + Results + Integrity Notes section in Markdown for a pre-registered study.',
    'HARD RULES:',
    '1. Use ONLY the exact numbers provided in the user message. Never invent, round differently, or add statistics that were not given.',
    '2. Cite each computed value inline, e.g. `t = -4.69, df = 76.3, p = 1.18e-5`.',
    '3. If the result is not significant relative to alpha, say so plainly. Never frame an exploratory finding as confirmatory.',
    '4. Describe the direction of effects from the GROUP MEANS provided (e.g., which group had the higher mean). Do not infer direction from the sign of a test statistic alone.',
    '5. If integrity findings are listed, summarize each one honestly under "Integrity notes" and mark it as flagged for review.',
    '6. Do not claim causality. Keep claims to what the statistics support.',
  ].join('\n');

  const user = [
    'STUDY (pre-registered)',
    `- Title: ${input.title}`,
    `- Hypothesis: ${input.hypothesis}`,
    `- Outcome variable: ${input.outcomeVariable}`,
    `- Planned test: ${input.plannedTest}`,
    `- alpha: ${input.alpha}, tails: ${input.tails}`,
    `- Planned n per group: ${input.plannedN ?? 'not specified'}`,
    '',
    'COMPUTED RESULTS (the only numbers you may cite)',
    `- Method used: ${input.method}`,
    `- Sample sizes: ${input.actualN.join(', ')}`,
    `- Group means (use these to describe direction): ${input.groups.map((g) => `${g.label} mean = ${fmtNum(g.mean)} (n = ${g.n}, sd = ${fmtNum(g.sd)})`).join('; ')}`,
    `- Statistic: ${fmtNum(input.statistic)}`,
    `- Degrees of freedom: ${input.df === undefined ? 'n/a' : fmtNum(input.df, 2)}`,
    `- p-value: ${fmtNum(input.p)}`,
    `- Effect size: ${input.effectSize === undefined ? 'n/a' : fmtNum(input.effectSize)}`,
    `- Significant at alpha=${input.alpha}: ${input.significant ? 'YES' : 'NO'}`,
    '',
    'INTEGRITY FINDINGS (flagged for review)',
    input.findings.length === 0
      ? '- None'
      : input.findings.map((f) => `- [${f.severity}] ${f.pattern}: ${f.message}`).join('\n'),
    '',
    'Write the section now. Use markdown headings: ## Methods, ## Results, ## Integrity notes.',
  ].join('\n');

  return { system, user };
}

export async function generateWriteup(input: WriteupInput): Promise<WriteupResult> {
  const { system, user } = buildGroundedPrompt(input);
  const res = await chatCompletion({
    model: input.model ?? DEFAULT_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    maxTokens: 1200,
    temperature: 0.2,
  });

  const computedTable = [
    '## Computed statistics (source of truth)',
    '',
    '| Quantity | Value |',
    '| --- | --- |',
    `| Test | ${input.method} |`,
    `| Sample sizes | ${input.actualN.join(', ')} |`,
    `| Group means | ${input.groups.map((g) => `${g.label}: ${fmtNum(g.mean)}`).join(', ')} |`,
    `| Statistic | ${fmtNum(input.statistic)} |`,
    `| Degrees of freedom | ${input.df === undefined ? 'n/a' : fmtNum(input.df, 2)} |`,
    `| p-value | ${fmtNum(input.p)} |`,
    `| Effect size | ${input.effectSize === undefined ? 'n/a' : fmtNum(input.effectSize)} |`,
    `| Significant at alpha=${input.alpha} | ${input.significant ? 'Yes' : 'No'} |`,
    '',
  ].join('\n');

  return { ...res, markdown: `${res.content.trim()}\n\n---\n\n${computedTable}` };
}
