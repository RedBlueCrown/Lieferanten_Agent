/**
 * Thin database layer. Locally the API runs on PGlite (PostgreSQL compiled to
 * WebAssembly, stored in DATA_DIR); in Azure it uses Azure Database for
 * PostgreSQL with passwordless Entra authentication. Both speak the same SQL.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config';

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  /** Runs fn in a transaction; calls are serialized. */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly kind: 'pglite' | 'postgres';
}

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };

function wrap(q: Queryable, kind: Db['kind'], txImpl: Db['tx'], close: () => Promise<void>): Db {
  return {
    kind,
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await q.query(sql, params);
      return r.rows as T[];
    },
    async one<T>(sql: string, params: unknown[] = []) {
      const r = await q.query(sql, params);
      return r.rows[0] as T | undefined;
    },
    tx: txImpl,
    close,
  };
}

async function openPglite(): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = path.join(config.dataDir, 'pglite');
  fs.mkdirSync(dir, { recursive: true });
  const pg = new PGlite(dir);
  await pg.waitReady;
  // PGlite has one connection: a promise chain serializes transactions.
  let chain: Promise<unknown> = Promise.resolve();
  const db: Db = wrap(
    pg as unknown as Queryable,
    'pglite',
    async (fn) => {
      const run = chain.then(() =>
        pg.transaction(async (t) => fn(wrap(t as unknown as Queryable, 'pglite', async (f) => f(db), async () => {}))),
      );
      chain = run.catch(() => undefined);
      return run as never;
    },
    async () => pg.close(),
  );
  return db;
}

async function openPostgres(url: string): Promise<Db> {
  const { default: pg } = await import('pg');
  // Dates stay ISO strings (YYYY-MM-DD) instead of JS Date objects.
  pg.types.setTypeParser(1082, (v: string) => v);
  pg.types.setTypeParser(1700, (v: string) => Number(v));
  let password: string | (() => Promise<string>) | undefined;
  if (config.db.entraAuth) {
    const { DefaultAzureCredential } = await import('@azure/identity');
    const cred = new DefaultAzureCredential();
    password = async () => (await cred.getToken('https://ossrdbms-aad.database.windows.net/.default')).token;
  }
  const pool = new pg.Pool({ connectionString: url, password, max: 10, ssl: url.includes('sslmode=disable') ? false : { rejectUnauthorized: true } });
  const db: Db = wrap(
    pool,
    'postgres',
    async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const r = await fn(wrap(client, 'postgres', async (f) => f(db), async () => {}));
        await client.query('commit');
        return r;
      } catch (e) {
        await client.query('rollback');
        throw e;
      } finally {
        client.release();
      }
    },
    async () => pool.end(),
  );
  return db;
}

export async function openDb(): Promise<Db> {
  const db = config.db.url ? await openPostgres(config.db.url) : await openPglite();
  await migrate(db);
  return db;
}

function migrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, '../migrations'), path.resolve(here, '../../migrations'), path.resolve(process.cwd(), 'apps/api/migrations'), path.resolve(process.cwd(), 'migrations')];
  const hit = candidates.find((p) => fs.existsSync(p));
  if (!hit) throw new Error('migrations folder not found');
  return hit;
}

export async function migrate(db: Db): Promise<void> {
  await db.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await db.query<{ name: string }>('select name from schema_migrations')).map((r) => r.name));
  const dir = migrationsDir();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await execScript(db, sql);
    await db.query('insert into schema_migrations(name) values ($1)', [file]);
  }
}

async function execScript(db: Db, sql: string) {
  // Split on semicolons outside of $$-quoted blocks.
  const parts: string[] = [];
  let buf = '';
  let inDollar = false;
  for (const line of sql.split('\n')) {
    if (line.trim().startsWith('--') && !inDollar) continue;
    const count = (line.match(/\$\$/g) || []).length;
    if (count % 2 === 1) inDollar = !inDollar;
    buf += line + '\n';
    if (!inDollar && line.trim().endsWith(';')) {
      parts.push(buf);
      buf = '';
    }
  }
  if (buf.trim()) parts.push(buf);
  for (const p of parts) await db.query(p);
}
