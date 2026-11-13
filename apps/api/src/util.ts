import crypto from 'node:crypto';

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(5).toString('hex')}`;
}

export function sha256(data: Uint8Array | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** JSON with sorted keys, so the same object always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`;
}

/** Field-level differences between two flat-ish records, for the audit log. */
export function diff(before: Record<string, unknown> | undefined, after: Record<string, unknown>): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]);
  for (const k of keys) {
    if (['updated_at', 'version', 'created_at'].includes(k)) continue;
    const a = before?.[k];
    const b = after[k];
    if (canonicalJson(a) !== canonicalJson(b)) out[k] = { from: a ?? null, to: b ?? null };
  }
  return out;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(public readonly statusCode: number, message: string, public readonly code = 'error') {
    super(message);
  }
}
