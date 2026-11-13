import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SecretClient } from '@azure/keyvault-secrets';
import {
  GRAPH_BASE as G,
  ONEDRIVE_SCOPES,
  OneDriveShareStore,
  TOKEN_URL,
  UPLOAD_CHUNK_SIZE,
  createOneDriveStore,
  encodeSharingUrl,
  type OneDriveShareStoreOptions,
} from './onedrive';
import { FileTokenStore, KeyVaultTokenStore, createTokenStore, type TokenStore } from './token-store';
import { StoreNotFoundError } from './types';

// ------------------------------------------------------------------ fake Graph

interface Req {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}
type Responder = (req: Req) => Response | Promise<Response>;

const json =
  (status: number, body: unknown, headers: Record<string, string> = {}): Responder =>
  () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const graphError = (status: number, code: string, message = code, headers: Record<string, string> = {}) =>
  json(status, { error: { code, message, innerError: { 'request-id': 'req-1' } } }, headers);

const SHARE_URL = 'https://1drv.ms/f/c/0123456789abcdef/EkQ?e=Ab~cD';
const SHARE_ITEM_URL = `${G}/shares/${encodeSharingUrl(SHARE_URL)}/driveItem`;

class FakeGraph {
  readonly calls: Req[] = [];
  private routes: { method: string; url: string | RegExp; responders: Responder[] }[] = [];
  tokenCount = 0;
  tokenGate?: Promise<void>;

  constructor() {
    // Token endpoint: AT1/RT2, AT2/RT3, … (store starts with RT1).
    this.on('POST', TOKEN_URL, async () => {
      const n = ++this.tokenCount;
      if (this.tokenGate) await this.tokenGate;
      return json(200, {
        token_type: 'Bearer',
        scope: ONEDRIVE_SCOPES,
        expires_in: 3600,
        access_token: `AT${n}`,
        refresh_token: `RT${n + 1}`,
      })({} as Req);
    });
    this.on(
      'GET',
      SHARE_ITEM_URL,
      json(200, {
        id: 'ROOT',
        name: 'LLV Vertragsmanagement',
        webUrl: 'https://onedrive.live.com/?id=ROOT',
        folder: { childCount: 4 },
        parentReference: { driveId: 'D1', id: 'PARENT' },
      }),
    );
  }

  /** Later registrations win. Responders are used in order; the last one repeats. */
  on(method: string, url: string | RegExp, ...responders: Responder[]): this {
    this.routes.unshift({ method, url, responders });
    return this;
  }

  get graphCalls(): Req[] {
    return this.calls.filter((c) => c.url !== TOKEN_URL);
  }

  get tokenCalls(): Req[] {
    return this.calls.filter((c) => c.url === TOKEN_URL);
  }

  readonly fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const req: Req = { method: init.method ?? 'GET', url, headers, body: init.body ?? undefined };
    this.calls.push(req);
    for (const route of this.routes) {
      const urlMatches = typeof route.url === 'string' ? route.url === url : route.url.test(url);
      if (route.method !== req.method || !urlMatches) continue;
      const responder = route.responders.length > 1 ? route.responders.shift()! : route.responders[0];
      return responder(req);
    }
    return graphError(500, 'noFakeRoute', `${req.method} ${url}`)(req);
  }) as typeof fetch;
}

class MemoryTokenStore implements TokenStore {
  saved: string[] = [];
  constructor(public value?: string) {}
  async load() {
    return this.value;
  }
  async save(token: string) {
    this.value = token;
    this.saved.push(token);
  }
}

function setup(opts: Partial<OneDriveShareStoreOptions> = {}) {
  const graph = new FakeGraph();
  const sleeps: number[] = [];
  const logs: string[] = [];
  const clock = { now: 1_700_000_000_000 };
  const tokenStore = (opts.tokenStore as MemoryTokenStore | undefined) ?? new MemoryTokenStore('RT1');
  const store = new OneDriveShareStore({
    shareUrl: SHARE_URL,
    clientId: 'client-123',
    tokenStore,
    fetchImpl: graph.fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => clock.now,
    log: (m) => logs.push(m),
    ...opts,
  });
  return { graph, store, sleeps, logs, clock, tokenStore };
}

const tokenBody = (req: Req) => new URLSearchParams(String(req.body));
const jsonBody = (req: Req) => JSON.parse(String(req.body));
const fileItem = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  size: 1234,
  lastModifiedDateTime: '2026-11-01T10:00:00Z',
  eTag: `"{${id}},1"`,
  cTag: `"c:{${id}},5"`,
  webUrl: `https://onedrive.live.com/edit?id=${id}`,
  file: { mimeType: 'application/pdf' },
  ...extra,
});

// ------------------------------------------------------------------ tests

describe('encodeSharingUrl', () => {
  it('builds u! + unpadded base64url', () => {
    const url = 'https://onedrive.live.com/?redeem=aHR0cHM6Ly8xZHJ2Lm1zL2YvcyFB&id=ABC%21123&cid=0123>>??';
    // Standard base64 of this URL contains "/" and "==" padding.
    expect(Buffer.from(url).toString('base64')).toMatch(/\/.*==$/);
    expect(encodeSharingUrl(url)).toBe(
      'u!aHR0cHM6Ly9vbmVkcml2ZS5saXZlLmNvbS8_cmVkZWVtPWFIUjBjSE02THk4eFpISjJMbTF6TDJZdmN5RkImaWQ9QUJDJTIxMTIzJmNpZD0wMTIzPj4_Pw',
    );
  });

  it('matches the documented algorithm (base64, strip =, / → _, + → -)', () => {
    const urls = [SHARE_URL, 'https://1drv.ms/f/s!AbCdEf?e=~~~', 'https://1drv.ms/u/s!x~~~~>>>?a=1', 'https://onedrive.live.com/x?ü=1'];
    expect(urls.some((u) => Buffer.from(u).toString('base64').includes('+'))).toBe(true);
    for (const u of urls) {
      const manual = 'u!' + Buffer.from(u).toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
      expect(encodeSharingUrl(u)).toBe(manual);
      expect(encodeSharingUrl(u)).not.toMatch(/[=+/]/);
    }
  });
});

describe('share resolution', () => {
  it('redeems the link once with Prefer: redeemSharingLink and describes the folder', async () => {
    const { graph, store } = setup();
    graph.on('GET', `${G}/drives/D1/items/ROOT/children?$top=200`, json(200, { value: [] }));

    const info = await store.describe();
    expect(info).toEqual({
      kind: 'onedrive',
      label: 'OneDrive › LLV Vertragsmanagement',
      rootName: 'LLV Vertragsmanagement',
      webUrl: 'https://onedrive.live.com/?id=ROOT',
    });
    await store.describe();
    await store.list('');

    const shareCalls = graph.graphCalls.filter((c) => c.url === SHARE_ITEM_URL);
    expect(shareCalls).toHaveLength(1);
    expect(shareCalls[0].headers.prefer).toBe('redeemSharingLink');
    expect(shareCalls[0].headers.authorization).toBe('Bearer AT1');
    expect(graph.graphCalls.at(-1)!.url).toBe(`${G}/drives/D1/items/ROOT/children?$top=200`);
  });

  it('uses remoteItem.id and remoteItem.parentReference.driveId for remote items', async () => {
    const { graph, store } = setup();
    graph.on(
      'GET',
      SHARE_ITEM_URL,
      json(200, {
        id: 'LOCAL-ID',
        name: 'LLV Vertragsmanagement',
        parentReference: { driveId: 'APP-DRIVE' },
        remoteItem: {
          id: 'OWNER-ITEM',
          name: 'LLV Vertragsmanagement',
          folder: { childCount: 4 },
          webUrl: 'https://onedrive.live.com/?id=OWNER-ITEM',
          parentReference: { driveId: 'OWNER-DRIVE' },
        },
      }),
    );
    graph.on('GET', `${G}/drives/OWNER-DRIVE/items/OWNER-ITEM/children?$top=200`, json(200, { value: [] }));

    expect(await store.list('')).toEqual([]);
    expect((await store.describe()).webUrl).toBe('https://onedrive.live.com/?id=OWNER-ITEM');
  });

  it('explains an unreachable link without leaking tokens', async () => {
    const { graph, store } = setup();
    graph.on('GET', SHARE_ITEM_URL, graphError(403, 'accessDenied', 'Access denied'));
    const err = (await store.describe().catch((e) => e)) as Error;
    expect(err.message).toContain('accessDenied');
    expect(err.message).toContain('Freigabelink');
    expect(err.message).toContain('/shares/{shareId}');
    expect(err.message).not.toMatch(/AT1|RT1|RT2|u!/);
  });
});

describe('list', () => {
  it('maps items and follows @odata.nextLink', async () => {
    const { graph, store } = setup();
    const next = `${G}/drives/D1/items/ROOT/children?$top=200&$skiptoken=abc`;
    graph.on(
      'GET',
      `${G}/drives/D1/items/ROOT/children?$top=200`,
      json(200, {
        value: [
          { id: 'F1', name: 'Prüfstandards', lastModifiedDateTime: '2026-10-01T08:00:00Z', eTag: '"e1"', folder: { childCount: 3 }, webUrl: 'https://x/F1' },
          fileItem('A1', 'Liesmich.pdf'),
        ],
        '@odata.nextLink': next,
      }),
    );
    graph.on(
      'GET',
      next,
      json(200, {
        value: [
          fileItem('A2', 'Zusatz.pdf', { cTag: undefined }),
          fileItem('L1', '~$Vertrag.docx'), // Office lock file: hidden like in the local store
          { id: 'F2', name: 'Eingang', lastModifiedDateTime: '2026-10-01T08:00:00Z', folder: { childCount: 0 } },
        ],
      }),
    );

    const items = await store.list('');
    // Folders first, then names in German collation (same order as the local store).
    expect(items.map((i) => i.name)).toEqual(['Eingang', 'Prüfstandards', 'Liesmich.pdf', 'Zusatz.pdf']);
    expect(items.slice(1)).toEqual([
      { id: 'F1', path: 'Prüfstandards', name: 'Prüfstandards', isFolder: true, size: undefined, lastModified: '2026-10-01T08:00:00Z', eTag: '"e1"', webUrl: 'https://x/F1' },
      {
        id: 'A1',
        path: 'Liesmich.pdf',
        name: 'Liesmich.pdf',
        isFolder: false,
        size: 1234,
        lastModified: '2026-11-01T10:00:00Z',
        eTag: '"c:{A1},5"', // cTag preferred: changes only with the content
        webUrl: 'https://onedrive.live.com/edit?id=A1',
      },
      expect.objectContaining({ id: 'A2', path: 'Zusatz.pdf', eTag: '"{A2},1"' }),
    ]);
  });

  it('addresses sub folders by encoded path and prefixes item paths', async () => {
    const { graph, store } = setup();
    graph.on(
      'GET',
      `${G}/drives/D1/items/ROOT:/Vertr%C3%A4ge/M%C3%BCller%20%26%20S%C3%B6hne%20AG:/children?$top=200`,
      json(200, { value: [fileItem('V1', 'Rahmenvertrag 2026.pdf')] }),
    );
    const items = await store.list('/Verträge/Müller & Söhne AG/');
    expect(items.map((i) => i.path)).toEqual(['Verträge/Müller & Söhne AG/Rahmenvertrag 2026.pdf']);
  });

  it('returns [] for a missing folder', async () => {
    const { graph, store } = setup();
    graph.on('GET', `${G}/drives/D1/items/ROOT:/Export:/children?$top=200`, graphError(404, 'itemNotFound'));
    expect(await store.list('Export')).toEqual([]);
  });
});

describe('read', () => {
  it('throws StoreNotFoundError on 404', async () => {
    const { graph, store } = setup();
    graph.on('GET', `${G}/drives/D1/items/ROOT:/Eingang/fehlt.pdf:`, graphError(404, 'itemNotFound'));
    const err = await store.read('Eingang/fehlt.pdf').catch((e) => e);
    expect(err).toBeInstanceOf(StoreNotFoundError);
    expect(err.path).toBe('Eingang/fehlt.pdf');
  });

  it('reads metadata, then the content by item id', async () => {
    const { graph, store } = setup();
    graph.on('GET', `${G}/drives/D1/items/ROOT:/Eingang/Angebot.pdf:`, json(200, fileItem('ITEM!7', 'Angebot.pdf')));
    graph.on('GET', `${G}/drives/D1/items/ITEM!7/content`, () => new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 }));
    const { bytes, item } = await store.read('Eingang/Angebot.pdf');
    expect(Array.from(bytes)).toEqual([37, 80, 68, 70]);
    expect(item).toMatchObject({ id: 'ITEM!7', path: 'Eingang/Angebot.pdf', isFolder: false });
  });
});

describe('write', () => {
  it('uploads small files with one PUT to the encoded umlaut path', async () => {
    const { graph, store } = setup();
    graph.on('POST', `${G}/drives/D1/items/ROOT/children`, json(201, { id: 'F1', name: 'Prüfstandards', folder: {} }));
    const putUrl = `${G}/drives/D1/items/ROOT:/Pr%C3%BCfstandards/Klausel%20Haftung%20(v2).docx:/content?@microsoft.graph.conflictBehavior=replace`;
    graph.on('PUT', putUrl, json(201, fileItem('W1', 'Klausel Haftung (v2).docx')));

    const bytes = new TextEncoder().encode('docx');
    const item = await store.write('Prüfstandards/Klausel Haftung (v2).docx', bytes, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    expect(item).toMatchObject({ id: 'W1', path: 'Prüfstandards/Klausel Haftung (v2).docx', isFolder: false });
    const put = graph.graphCalls.find((c) => c.method === 'PUT')!;
    expect(put.url).toBe(putUrl);
    expect(put.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(put.body).toBe(bytes);
    expect(jsonBody(graph.graphCalls.find((c) => c.method === 'POST')!)).toEqual({
      name: 'Prüfstandards',
      folder: {},
      '@microsoft.graph.conflictBehavior': 'fail',
    });
  });

  it('uploads a 9 MiB file through an upload session in 320 KiB-aligned chunks', async () => {
    const { graph, store } = setup();
    graph.on('POST', /\/children$/, json(201, { id: 'F', name: 'x', folder: {} }));
    const sessionUrl = `${G}/drives/D1/items/ROOT:/Vertr%C3%A4ge/Acme%20AG/Vertrag.pdf:/createUploadSession`;
    const uploadUrl = 'https://my.microsoftpersonalcontent.com/upload/session-xyz?tempauth=SECRET';
    graph.on('POST', sessionUrl, json(200, { uploadUrl, expirationDateTime: '2026-11-13T00:00:00Z' }));
    graph.on(
      'PUT',
      uploadUrl,
      json(202, { nextExpectedRanges: ['5242880-'] }),
      json(201, fileItem('BIG', 'Vertrag.pdf', { size: 9 * 1024 * 1024 })),
    );

    const total = 9 * 1024 * 1024;
    const item = await store.write('Verträge/Acme AG/Vertrag.pdf', new Uint8Array(total));
    expect(item).toMatchObject({ id: 'BIG', path: 'Verträge/Acme AG/Vertrag.pdf', size: total });

    const session = graph.graphCalls.find((c) => c.url === sessionUrl)!;
    expect(session.headers.authorization).toBe('Bearer AT1');
    expect(jsonBody(session)).toEqual({ item: { '@microsoft.graph.conflictBehavior': 'replace' } });

    const chunks = graph.calls.filter((c) => c.url === uploadUrl);
    expect(chunks.map((c) => c.headers['content-range'])).toEqual([
      'bytes 0-5242879/9437184',
      'bytes 5242880-9437183/9437184',
    ]);
    expect(chunks.map((c) => (c.body as Uint8Array).byteLength)).toEqual([5242880, 4194304]);
    expect(UPLOAD_CHUNK_SIZE % (320 * 1024)).toBe(0);
    // The upload URL is pre-authenticated: never send the bearer token there.
    expect(chunks.every((c) => c.headers.authorization === undefined)).toBe(true);
  });

  it('cancels the upload session on failure and keeps the upload URL out of the error', async () => {
    const { graph, store } = setup();
    graph.on('POST', /\/children$/, json(201, { id: 'F', name: 'x', folder: {} }));
    const uploadUrl = 'https://my.microsoftpersonalcontent.com/upload/session-xyz?tempauth=SECRET';
    graph.on('POST', /createUploadSession$/, json(200, { uploadUrl }));
    graph.on('PUT', uploadUrl, graphError(400, 'invalidRange', 'Bad range'));
    graph.on('DELETE', uploadUrl, () => new Response(null, { status: 204 }));

    const err = (await store.write('Export/gross.zip', new Uint8Array(6 * 1024 * 1024)).catch((e) => e)) as Error;
    expect(err.message).toContain('invalidRange');
    expect(err.message).not.toContain('SECRET');
    expect(graph.calls.at(-1)!.method).toBe('DELETE');
  });
});

describe('ensureFolder', () => {
  it('creates missing segments, treats 409 as existing and caches the result', async () => {
    const { graph, store } = setup();
    graph.on('POST', `${G}/drives/D1/items/ROOT/children`, graphError(409, 'nameAlreadyExists'));
    graph.on('POST', `${G}/drives/D1/items/ROOT:/Vertr%C3%A4ge:/children`, json(201, { id: 'ACME', name: 'Acme AG', folder: {} }));

    await store.ensureFolder('Verträge/Acme AG');
    const posts = graph.graphCalls.filter((c) => c.method === 'POST');
    expect(posts.map((c) => [c.url, jsonBody(c).name, jsonBody(c)['@microsoft.graph.conflictBehavior']])).toEqual([
      [`${G}/drives/D1/items/ROOT/children`, 'Verträge', 'fail'],
      [`${G}/drives/D1/items/ROOT:/Vertr%C3%A4ge:/children`, 'Acme AG', 'fail'],
    ]);

    const before = graph.calls.length;
    await store.ensureFolder('Verträge/Acme AG');
    await store.ensureFolder('Verträge');
    await store.ensureFolder('');
    expect(graph.calls.length).toBe(before);
  });

  it('throws other errors with the Graph code', async () => {
    const { graph, store } = setup();
    graph.on('POST', `${G}/drives/D1/items/ROOT/children`, graphError(507, 'quotaLimitReached', 'Insufficient storage'));
    await expect(store.ensureFolder('Export')).rejects.toThrow(/507 quotaLimitReached: Insufficient storage/);
  });
});

describe('move', () => {
  it('PATCHes name and target parent id, creating the target folder first', async () => {
    const { graph, store } = setup();
    graph.on('GET', `${G}/drives/D1/items/ROOT:/Eingang/scan.pdf:`, json(200, fileItem('SRC', 'scan.pdf')));
    graph.on('POST', /\/children$/, graphError(409, 'nameAlreadyExists'));
    graph.on('GET', `${G}/drives/D1/items/ROOT:/Vertr%C3%A4ge/Acme%20AG:`, json(200, { id: 'ACME', name: 'Acme AG', folder: {} }));
    graph.on('PATCH', `${G}/drives/D1/items/SRC`, json(200, fileItem('SRC', 'Vertrag 2026.pdf')));

    const item = await store.move('Eingang/scan.pdf', 'Verträge/Acme AG/Vertrag 2026.pdf');
    expect(item).toMatchObject({ id: 'SRC', path: 'Verträge/Acme AG/Vertrag 2026.pdf' });
    const patch = graph.graphCalls.find((c) => c.method === 'PATCH')!;
    expect(jsonBody(patch)).toEqual({ name: 'Vertrag 2026.pdf', parentReference: { id: 'ACME' } });
  });

  it('replaces an existing target file like a rename on disk', async () => {
    const { graph, store } = setup();
    graph.on('GET', `${G}/drives/D1/items/ROOT:/Eingang/neu.pdf:`, json(200, fileItem('SRC', 'neu.pdf')));
    graph.on('POST', /\/children$/, graphError(409, 'nameAlreadyExists'));
    graph.on('GET', `${G}/drives/D1/items/ROOT:/Export:`, json(200, { id: 'EXP', name: 'Export', folder: {} }));
    graph.on('GET', `${G}/drives/D1/items/ROOT:/Export/liste.pdf:`, json(200, fileItem('OLD', 'liste.pdf')));
    graph.on('DELETE', `${G}/drives/D1/items/OLD`, () => new Response(null, { status: 204 }));
    graph.on('PATCH', `${G}/drives/D1/items/SRC`, graphError(409, 'nameAlreadyExists'), json(200, fileItem('SRC', 'liste.pdf')));

    const item = await store.move('Eingang/neu.pdf', 'Export/liste.pdf');
    expect(item).toMatchObject({ id: 'SRC', path: 'Export/liste.pdf' });
    expect(graph.graphCalls.filter((c) => c.method !== 'GET' && c.method !== 'POST').map((c) => c.method)).toEqual([
      'PATCH',
      'DELETE',
      'PATCH',
    ]);
  });

  it('throws StoreNotFoundError when the source is missing', async () => {
    const { graph, store } = setup();
    graph.on('GET', `${G}/drives/D1/items/ROOT:/Eingang/weg.pdf:`, graphError(404, 'itemNotFound'));
    await expect(store.move('Eingang/weg.pdf', 'Export/weg.pdf')).rejects.toBeInstanceOf(StoreNotFoundError);
  });
});

describe('retries', () => {
  const childrenUrl = `${G}/drives/D1/items/ROOT/children?$top=200`;

  it('retries 429 honouring Retry-After (seconds)', async () => {
    const { graph, store, sleeps } = setup();
    graph.on('GET', childrenUrl, graphError(429, 'activityLimitReached', 'Throttled', { 'Retry-After': '3' }), json(200, { value: [] }));
    expect(await store.list('')).toEqual([]);
    expect(sleeps).toEqual([3000]);
    expect(graph.graphCalls.filter((c) => c.url === childrenUrl)).toHaveLength(2);
  });

  it('falls back to exponential backoff for 503/504 and gives up after 4 retries', async () => {
    const { graph, store, sleeps } = setup();
    graph.on('GET', childrenUrl, graphError(503, 'serviceNotAvailable'), graphError(504, 'gatewayTimeout'), graphError(503, 'serviceNotAvailable'));
    await expect(store.list('')).rejects.toThrow(/503 serviceNotAvailable/);
    expect(graph.graphCalls.filter((c) => c.url === childrenUrl)).toHaveLength(5);
    expect(sleeps).toHaveLength(4);
    [1000, 2000, 4000, 8000].forEach((base, i) => {
      expect(sleeps[i]).toBeGreaterThanOrEqual(base);
      expect(sleeps[i]).toBeLessThan(base + 250);
    });
  });

  it('on 401 refreshes the token once and retries', async () => {
    const { graph, store } = setup();
    graph.on('GET', childrenUrl, graphError(401, 'InvalidAuthenticationToken'), json(200, { value: [] }));
    expect(await store.list('')).toEqual([]);
    const calls = graph.graphCalls.filter((c) => c.url === childrenUrl);
    expect(calls.map((c) => c.headers.authorization)).toEqual(['Bearer AT1', 'Bearer AT2']);
    expect(graph.tokenCalls).toHaveLength(2);
  });

  it('never puts tokens into errors or logs', async () => {
    const { graph, store, logs } = setup();
    graph.on('GET', childrenUrl, graphError(401, 'InvalidAuthenticationToken', 'expired'));
    const err = (await store.list('').catch((e) => e)) as Error;
    expect(err.message).toContain('401 InvalidAuthenticationToken');
    const text = [err.message, ...logs].join('\n');
    expect(text).not.toMatch(/\bAT\d\b|\bRT\d\b/);
  });
});

describe('tokens', () => {
  it('sends a refresh_token grant to the consumers endpoint and persists the rotated token', async () => {
    const { graph, store, tokenStore, clock } = setup();
    graph.on('GET', `${G}/drives/D1/items/ROOT/children?$top=200`, json(200, { value: [] }));

    await store.describe();
    const first = graph.tokenCalls[0];
    expect(first.url).toBe('https://login.microsoftonline.com/consumers/oauth2/v2.0/token');
    expect(first.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(tokenBody(first))).toEqual({
      client_id: 'client-123',
      grant_type: 'refresh_token',
      refresh_token: 'RT1',
      scope: 'Files.ReadWrite offline_access User.Read',
    });
    expect((tokenStore as MemoryTokenStore).saved).toEqual(['RT2']);

    // Cached until two minutes before expiry (expires_in = 3600 s).
    clock.now += (3600 - 121) * 1000;
    await store.list('');
    expect(graph.tokenCalls).toHaveLength(1);

    clock.now += 2000;
    await store.list('');
    expect(graph.tokenCalls).toHaveLength(2);
    expect(tokenBody(graph.tokenCalls[1]).get('refresh_token')).toBe('RT2');
    expect((tokenStore as MemoryTokenStore).saved).toEqual(['RT2', 'RT3']);
  });

  it('uses the initial refresh token only while the store is empty', async () => {
    const empty = setup({ tokenStore: new MemoryTokenStore(undefined), initialRefreshToken: 'RT-env' });
    await empty.store.describe();
    expect(tokenBody(empty.graph.tokenCalls[0]).get('refresh_token')).toBe('RT-env');
    expect((empty.tokenStore as MemoryTokenStore).saved).toEqual(['RT2']);

    const filled = setup({ tokenStore: new MemoryTokenStore('RT-store'), initialRefreshToken: 'RT-env' });
    await filled.store.describe();
    expect(tokenBody(filled.graph.tokenCalls[0]).get('refresh_token')).toBe('RT-store');
  });

  it('coalesces concurrent refreshes into one request', async () => {
    const { graph, store, clock } = setup();
    graph.on('GET', /\/children\?\$top=200$/, json(200, { value: [] }));
    await store.describe(); // token 1 + share resolved
    clock.now += 3600 * 1000; // expired

    let release!: () => void;
    graph.tokenGate = new Promise<void>((r) => (release = r));
    const pending = Promise.all([store.list(''), store.list('Eingang'), store.list('Export'), store.list('Prüfstandards')]);
    await new Promise((r) => setTimeout(r, 5));
    release();
    await pending;

    expect(graph.tokenCalls).toHaveLength(2);
    const lists = graph.graphCalls.filter((c) => c.url.endsWith('children?$top=200'));
    expect(lists).toHaveLength(4);
    expect(new Set(lists.map((c) => c.headers.authorization))).toEqual(new Set(['Bearer AT2']));
  });

  it('reports a missing token and invalid_grant with a hint, without the token', async () => {
    const none = setup({ tokenStore: new MemoryTokenStore(undefined) });
    await expect(none.store.describe()).rejects.toThrow(/onedrive-connect\.mjs/);
    expect(none.graph.calls).toHaveLength(0);

    const { graph, store } = setup({ tokenStore: new MemoryTokenStore('RT-secret-value') });
    graph.on(
      'POST',
      TOKEN_URL,
      json(400, {
        error: 'invalid_grant',
        error_description: 'AADSTS70000: The provided value for the code parameter is not valid.\r\nTrace ID: x',
      }),
    );
    const err = (await store.describe().catch((e) => e)) as Error;
    expect(err.message).toContain('invalid_grant');
    expect(err.message).toContain('onedrive-connect.mjs');
    expect(err.message).not.toContain('RT-secret-value');
    expect(err.message).not.toContain('Trace ID');
  });
});

describe('token stores', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('FileTokenStore creates the directory and writes the file with mode 0600', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'onedrive-token-'));
    const file = path.join(dir, 'nested', 'onedrive-token.json');
    const store = new FileTokenStore(file);
    expect(await store.load()).toBeUndefined();

    await store.save('RT-one');
    await store.save('RT-two');
    expect(await store.load()).toBe('RT-two');
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await fs.readFile(file, 'utf8')).refreshToken).toBe('RT-two');
    expect(await fs.readdir(path.dirname(file))).toEqual(['onedrive-token.json']);
  });

  it('KeyVaultTokenStore reads and writes the onedrive-refresh-token secret', async () => {
    const secrets = new Map<string, string>();
    const fake = {
      getSecret: async (name: string) => {
        if (!secrets.has(name)) throw Object.assign(new Error('not found'), { statusCode: 404, code: 'SecretNotFound' });
        return { name, value: secrets.get(name) };
      },
      setSecret: async (name: string, value: string) => {
        secrets.set(name, value);
        return { name, value };
      },
    } as unknown as SecretClient;
    const store = new KeyVaultTokenStore('https://kv-test.vault.azure.net/', undefined, () => fake);
    expect(await store.load()).toBeUndefined();
    await store.save('RT-kv');
    expect(secrets.get('onedrive-refresh-token')).toBe('RT-kv');
    expect(await store.load()).toBe('RT-kv');
  });

  it('createTokenStore picks Key Vault when KEY_VAULT_URI is set, else the file', () => {
    const base = { shareUrl: 'x', clientId: 'y', refreshToken: undefined, tokenFile: '/tmp/t.json' };
    expect(createTokenStore({ storage: { onedrive: { ...base, keyVaultUri: 'https://kv.vault.azure.net/' } } })).toBeInstanceOf(
      KeyVaultTokenStore,
    );
    expect(createTokenStore({ storage: { onedrive: { ...base, keyVaultUri: undefined } } })).toBeInstanceOf(FileTokenStore);
  });

  it('createOneDriveStore requires share URL and client id', () => {
    const od = { shareUrl: undefined, clientId: undefined, refreshToken: undefined, keyVaultUri: undefined, tokenFile: '/tmp/t.json' };
    expect(() => createOneDriveStore({ storage: { onedrive: od } })).toThrow(/ONEDRIVE_SHARE_URL und ONEDRIVE_CLIENT_ID/);
    const store = createOneDriveStore({ storage: { onedrive: { ...od, shareUrl: SHARE_URL, clientId: 'c' } } });
    expect(store.kind).toBe('onedrive');
  });
});
