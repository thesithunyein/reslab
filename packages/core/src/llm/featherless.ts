/**
 * Featherless client (OpenAI-compatible chat completions).
 *
 * - Reads FEATHERLESS_API_KEY / FEATHERLESS_BASE_URL from the environment
 *   (the key lives in .env, which is gitignored — never in the repo).
 * - Retries transient failures with exponential backoff.
 * - Caches responses to .cache/llm/ keyed by (model + messages), so
 *   development and demo re-runs do not burn credits.
 * - Never logs the API key.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOpts {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Set false to always call the API (bypass cache). */
  useCache?: boolean;
}

export interface ChatResult {
  content: string;
  model: string;
  cached: boolean;
  cacheKey?: string;
}

export class FeatherlessError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'FeatherlessError';
  }
}

function apiKey(): string {
  const key = process.env.FEATHERLESS_API_KEY;
  if (!key) {
    throw new Error('FEATHERLESS_API_KEY is not set (see .env.example; put your key in .env)');
  }
  return key;
}

function baseUrl(): string {
  return process.env.FEATHERLESS_BASE_URL ?? 'https://api.featherless.ai/v1';
}

function cachePath(model: string, messages: ChatMessage[]): { key: string; path: string } {
  const key = createHash('sha256').update(JSON.stringify({ model, messages })).digest('hex');
  return { key, path: join(process.cwd(), '.cache', 'llm', `${key}.json`) };
}

export async function chatCompletion(opts: ChatOpts): Promise<ChatResult> {
  const { key, path } = cachePath(opts.model, opts.messages);
  if (opts.useCache !== false && existsSync(path)) {
    const cached = JSON.parse(readFileSync(path, 'utf8')) as { content: string; model: string };
    return { ...cached, cached: true, cacheKey: key };
  }

  const maxTokens = opts.maxTokens ?? 1024;
  const temperature = opts.temperature ?? 0.2;
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${baseUrl()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey()}`,
        },
        body: JSON.stringify({
          model: opts.model,
          messages: opts.messages,
          max_tokens: maxTokens,
          temperature,
        }),
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        if (res.status === 429 || res.status >= 500) {
          lastError = new FeatherlessError(`HTTP ${res.status}: ${body.slice(0, 200)}`, res.status);
          await sleep(attempt * 1000);
          continue;
        }
        throw new FeatherlessError(`HTTP ${res.status}: ${body.slice(0, 300)}`, res.status);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        model?: string;
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new FeatherlessError('empty completion from model');

      if (opts.useCache !== false) {
        mkdirSync(join(process.cwd(), '.cache', 'llm'), { recursive: true });
        writeFileSync(path, JSON.stringify({ content, model: opts.model }), 'utf8');
      }
      return { content, model: data.model ?? opts.model, cached: false, cacheKey: key };
    } catch (err) {
      lastError = err;
      if (attempt < 3 && isTransient(err)) await sleep(attempt * 1000);
      else break;
    }
  }
  throw lastError instanceof Error ? lastError : new FeatherlessError(String(lastError));
}

function isTransient(err: unknown): boolean {
  return err instanceof FeatherlessError && (err.status === 429 || (err.status ?? 0) >= 500);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
