/**
 * Audit log. Every action in the app ends up here: sign-ins, page views,
 * every change with before/after values, every AI run with model and prompt
 * version, every decision at a hold point, every download and export.
 *
 * Records are hash-chained: each record's hash covers its content and the
 * previous record's hash, so changing or deleting any record breaks the chain
 * from that point on. The database also refuses UPDATE and DELETE on the
 * table. In Azure every record is additionally written to an immutable Blob
 * container and to the container log (Log Analytics).
 */
import { config } from './config';
import type { Db } from './db';
import { canonicalJson, newId, sha256 } from './util';

export interface Actor {
  kind: 'user' | 'system' | 'api' | 'ai';
  oid: string;
  name: string;
  roles?: string[];
}

export const SYSTEM: Actor = { kind: 'system', oid: 'system', name: 'System' };

export interface AuditInput {
  actor: Actor;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  summary: string;
  details?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
}

export interface AuditRecord extends Required<Omit<AuditInput, 'details'>> {
  seq: number;
  id: string;
  at: string;
  details: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

const GENESIS = '0'.repeat(64);

function hashOf(prevHash: string, r: { id: string; at: string; actor: Actor; action: string; targetType: string | null; targetId: string | null; summary: string; details: Record<string, unknown> }) {
  return sha256(prevHash + '|' + canonicalJson(r));
}

type BlobWriter = (name: string, body: string) => Promise<void>;

export class AuditLog {
  private queue: Promise<unknown> = Promise.resolve();
  private blob?: BlobWriter;

  constructor(private readonly db: Db) {}

  async init() {
    if (config.audit.blobContainerUrl) {
      const { ContainerClient } = await import('@azure/storage-blob');
      const { DefaultAzureCredential } = await import('@azure/identity');
      const container = new ContainerClient(config.audit.blobContainerUrl, new DefaultAzureCredential());
      this.blob = async (name, body) => {
        await container.getBlockBlobClient(name).upload(body, Buffer.byteLength(body), { blobHTTPHeaders: { blobContentType: 'application/json' } });
      };
    }
  }

  /** Appends a record. Calls are serialized so the chain never forks. */
  record(input: AuditInput): Promise<AuditRecord> {
    const run = this.queue.then(() => this.append(input));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async append(input: AuditInput): Promise<AuditRecord> {
    const last = await this.db.one<{ hash: string }>('select hash from audit_events order by seq desc limit 1');
    const prevHash = last?.hash ?? GENESIS;
    const body = {
      id: newId('A'),
      at: new Date().toISOString(),
      actor: input.actor,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      summary: input.summary,
      details: input.details ?? {},
    };
    const hash = hashOf(prevHash, body);
    const row = await this.db.one<{ seq: string }>(
      `insert into audit_events (id, at, actor, action, target_type, target_id, summary, details, ip, user_agent, correlation_id, prev_hash, hash)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning seq`,
      [body.id, body.at, JSON.stringify(body.actor), body.action, body.targetType, body.targetId, body.summary, JSON.stringify(body.details), input.ip ?? null, input.userAgent ?? null, input.correlationId ?? null, prevHash, hash],
    );
    const rec: AuditRecord = { ...body, seq: Number(row!.seq), ip: input.ip ?? null, userAgent: input.userAgent ?? null, correlationId: input.correlationId ?? null, prevHash, hash } as AuditRecord;
    if (this.blob) {
      const day = body.at.slice(0, 10).replace(/-/g, '/');
      this.blob(`${day}/${String(rec.seq).padStart(10, '0')}-${body.id}.json`, JSON.stringify(rec)).catch((e) => console.error('audit blob write failed', e));
      console.log(JSON.stringify({ type: 'audit', ...rec }));
    }
    return rec;
  }

  async list(filter: { targetType?: string; targetId?: string; actor?: string; action?: string; q?: string; limit?: number; before?: number }) {
    const where: string[] = [];
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (filter.targetType) where.push(`target_type = ${p(filter.targetType)}`);
    if (filter.targetId) where.push(`target_id = ${p(filter.targetId)}`);
    if (filter.actor) where.push(`actor->>'oid' = ${p(filter.actor)}`);
    if (filter.action) where.push(`action like ${p(filter.action + '%')}`);
    if (filter.q) where.push(`(summary ilike ${p('%' + filter.q + '%')} or target_id ilike ${p('%' + filter.q + '%')})`);
    if (filter.before) where.push(`seq < ${p(filter.before)}`);
    const sql = `select * from audit_events ${where.length ? 'where ' + where.join(' and ') : ''} order by seq desc limit ${Math.min(filter.limit ?? 100, 500)}`;
    const rows = await this.db.query<Record<string, unknown>>(sql, params);
    return rows.map(toRecord);
  }

  /** Recomputes the whole chain. */
  async verify(): Promise<{ ok: boolean; count: number; brokenAt: number | null; lastHash: string }> {
    const rows = (await this.db.query<Record<string, unknown>>('select * from audit_events order by seq asc')).map(toRecord);
    let prev = GENESIS;
    for (const r of rows) {
      const expect = hashOf(prev, { id: r.id, at: r.at, actor: r.actor, action: r.action, targetType: r.targetType, targetId: r.targetId, summary: r.summary, details: r.details });
      if (r.prevHash !== prev || r.hash !== expect) return { ok: false, count: rows.length, brokenAt: r.seq, lastHash: prev };
      prev = r.hash;
    }
    return { ok: true, count: rows.length, brokenAt: null, lastHash: prev };
  }
}

function toRecord(r: Record<string, unknown>): AuditRecord {
  const at = r.at instanceof Date ? r.at.toISOString() : new Date(String(r.at)).toISOString();
  return {
    seq: Number(r.seq),
    id: String(r.id),
    at,
    actor: r.actor as Actor,
    action: String(r.action),
    targetType: (r.target_type as string) ?? null,
    targetId: (r.target_id as string) ?? null,
    summary: String(r.summary),
    details: (r.details as Record<string, unknown>) ?? {},
    ip: (r.ip as string) ?? null,
    userAgent: (r.user_agent as string) ?? null,
    correlationId: (r.correlation_id as string) ?? null,
    prevHash: String(r.prev_hash),
    hash: String(r.hash),
  } as AuditRecord;
}
