/**
 * Tamper-evident, hash-chained audit log.
 *
 * Every event is appended with a SHA-256 hash that covers the previous
 * event's hash plus this event's canonical payload. Any silent edit to a
 * past event breaks the chain, and `verify()` reports exactly where.
 * This is the provenance spine of ResLab: pre-registration locks,
 * analysis runs, data versions, and transformations are all recorded here.
 */

export interface AuditEvent {
  seq: number;
  ts: string; // ISO timestamp
  type: string;
  actor?: string;
  payload: unknown;
  prevHash: string;
  hash: string;
}

export interface AuditVerification {
  valid: boolean;
  brokenAt?: number; // seq of the first event whose hash no longer matches
  reason?: string;
  eventCount: number;
}

/** Deterministic JSON serialization with sorted keys so hashing is stable. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function canonicalEventBody(e: Omit<AuditEvent, 'hash'>): string {
  return canonicalJson({ seq: e.seq, ts: e.ts, type: e.type, actor: e.actor ?? null, payload: e.payload, prevHash: e.prevHash });
}

export class AuditLog {
  private events: AuditEvent[] = [];

  get length(): number {
    return this.events.length;
  }

  eventsSnapshot(): readonly AuditEvent[] {
    return this.events.map((e) => ({ ...e, payload: structuredClone(e.payload) }));
  }

  async append(type: string, payload: unknown, actor?: string): Promise<AuditEvent> {
    const seq = this.events.length;
    const prevHash = seq === 0 ? 'GENESIS' : this.events[seq - 1]!.hash;
    const body: Omit<AuditEvent, 'hash'> = {
      seq,
      ts: new Date().toISOString(),
      type,
      actor,
      payload,
      prevHash,
    };
    const hash = await sha256Hex(canonicalEventBody(body));
    const event: AuditEvent = { ...body, hash };
    this.events.push(event);
    return { ...event, payload: structuredClone(event.payload) };
  }

  /** Recompute every hash and confirm each event links to the previous. */
  async verify(): Promise<AuditVerification> {
    let prev = 'GENESIS';
    for (let i = 0; i < this.events.length; i++) {
      const e = this.events[i]!;
      if (e.prevHash !== prev) {
        return { valid: false, brokenAt: e.seq, reason: `event ${e.seq} does not link to event ${e.seq - 1}`, eventCount: this.events.length };
      }
      const recomputed = await sha256Hex(canonicalEventBody({ seq: e.seq, ts: e.ts, type: e.type, actor: e.actor, payload: e.payload, prevHash: e.prevHash }));
      if (recomputed !== e.hash) {
        return { valid: false, brokenAt: e.seq, reason: `event ${e.seq} payload was modified (hash mismatch)`, eventCount: this.events.length };
      }
      prev = e.hash;
    }
    return { valid: true, eventCount: this.events.length };
  }

  toJSON(): string {
    return JSON.stringify(this.events);
  }

  static fromJSON(json: string): AuditLog {
    const log = new AuditLog();
    const parsed = JSON.parse(json) as AuditEvent[];
    if (!Array.isArray(parsed)) throw new Error('AuditLog.fromJSON: expected an array');
    log.events = parsed.map((e) => ({ ...e, payload: structuredClone(e.payload) }));
    return log;
  }
}
