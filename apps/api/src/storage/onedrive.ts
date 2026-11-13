/**
 * DocumentStore backed by ONE OneDrive folder that the owner shared with the
 * app's own Microsoft account (personal account, "consumers" authority).
 *
 * The app signs in as that dedicated account with a delegated refresh token and
 * only ever addresses items through the sharing link, so it reaches the shared
 * folder and nothing else of the owner's OneDrive.
 *
 *   share link ──/shares/{u!…}/driveItem──▶ { driveId, rootId }
 *   "Verträge/Acme/x.pdf" ──▶ /drives/{driveId}/items/{rootId}:/Vertr%C3%A4ge/Acme/x.pdf:
 *
 * Tokens never appear in logs or error messages. Upload session URLs carry
 * their own credentials and are never logged either.
 */
import type { Config } from '../config';
import { StoreNotFoundError, type DocumentStore, type StoreInfo, type StoreItem } from './types';
import { createTokenStore, type TokenStore } from './token-store';

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
export const TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
export const ONEDRIVE_SCOPES = 'Files.ReadWrite offline_access User.Read';

/** Files up to this size go in a single PUT; larger ones use an upload session. */
export const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024;
/** Upload session chunk: 16 × 320 KiB = 5 MiB (Graph requires multiples of 320 KiB). */
export const UPLOAD_CHUNK_SIZE = 16 * 320 * 1024;

const MAX_RETRIES = 4;
const RETRY_STATUSES = new Set([429, 503, 504]);
const MAX_RETRY_DELAY_MS = 120_000;
/** Refresh the access token this long before it expires. */
const TOKEN_SKEW_MS = 2 * 60_000;

export interface OneDriveShareStoreOptions {
  shareUrl: string;
  clientId: string;
  tokenStore: TokenStore;
  /** Used only while the token store is still empty (first start). */
  initialRefreshToken?: string;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
  /** Test hooks. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

interface ShareRoot {
  driveId: string;
  rootId: string;
  name: string;
  webUrl?: string;
}

interface GraphItem {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  eTag?: string;
  cTag?: string;
  webUrl?: string;
  folder?: { childCount?: number };
  file?: { mimeType?: string };
  parentReference?: { driveId?: string; id?: string };
  remoteItem?: GraphItem;
}

/** Error from Microsoft Graph or the token endpoint. Never contains a token. */
export class OneDriveError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'OneDriveError';
  }
}

/** shareId = "u!" + unpadded base64url of the sharing URL. */
export function encodeSharingUrl(shareUrl: string): string {
  return 'u!' + Buffer.from(shareUrl.trim(), 'utf8').toString('base64url').replace(/=+$/, '');
}

/** "a//b/" → "a/b"; rejects ".." so no path can climb out of the shared folder. */
export function normalizePath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter((s) => s !== '' && s !== '.');
  if (parts.includes('..')) throw new Error(`Ungültiger Pfad: ${p}`);
  return parts.join('/');
}

export function encodePath(p: string): string {
  return normalizePath(p).split('/').map(encodeURIComponent).join('/');
}

function splitPath(p: string): { parent: string; name: string } {
  const i = p.lastIndexOf('/');
  return i < 0 ? { parent: '', name: p } : { parent: p.slice(0, i), name: p.slice(i + 1) };
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class OneDriveShareStore implements DocumentStore {
  readonly kind = 'onedrive' as const;

  private readonly shareUrl: string;
  private readonly clientId: string;
  private readonly tokenStore: TokenStore;
  private readonly initialRefreshToken?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly log: (msg: string) => void;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  private refreshToken?: string;
  private accessToken?: { token: string; expiresAt: number };
  private refreshing?: Promise<string>;
  private share?: Promise<ShareRoot>;
  private readonly knownFolders = new Set<string>();

  constructor(opts: OneDriveShareStoreOptions) {
    this.shareUrl = opts.shareUrl.trim();
    this.clientId = opts.clientId;
    this.tokenStore = opts.tokenStore;
    this.initialRefreshToken = opts.initialRefreshToken?.trim() || undefined;
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
    this.log = opts.log ?? (() => undefined);
    this.sleep = opts.sleep ?? defaultSleep;
    this.now = opts.now ?? Date.now;
  }

  // ---------------------------------------------------------------- DocumentStore

  async describe(): Promise<StoreInfo> {
    const root = await this.resolveShare();
    return { kind: 'onedrive', label: `OneDrive › ${root.name}`, rootName: root.name, webUrl: root.webUrl };
  }

  async list(folder: string): Promise<StoreItem[]> {
    const dir = normalizePath(folder);
    const items: StoreItem[] = [];
    let next: string | undefined = (await this.itemUrl(dir, 'children')) + '?$top=200';
    while (next) {
      const res = await this.graph('GET', next);
      if (res.status === 404) {
        await drain(res);
        if (items.length === 0) this.forgetFolders(dir);
        return items;
      }
      if (!res.ok) throw await this.graphError(res, 'GET', next);
      const page = (await res.json()) as { value?: GraphItem[]; '@odata.nextLink'?: string };
      for (const raw of page.value ?? []) {
        // Same as the local store: hide dot files and Office lock files (~$…).
        if (raw.name.startsWith('.') || raw.name.startsWith('~$')) continue;
        items.push(toStoreItem(raw, dir));
      }
      next = page['@odata.nextLink'];
    }
    return items.sort((a, b) => Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name, 'de'));
  }

  async read(path: string): Promise<{ bytes: Uint8Array; item: StoreItem }> {
    const p = normalizePath(path);
    const raw = await this.getItem(p);
    if (!raw || raw.folder) throw new StoreNotFoundError(path);
    const { driveId } = await this.resolveShare();
    const url = `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(raw.id)}/content`;
    // Graph answers with a 302 to a pre-authenticated download URL; fetch follows
    // it and drops the Authorization header on the cross-origin hop.
    const res = await this.graph('GET', url);
    if (res.status === 404) {
      await drain(res);
      throw new StoreNotFoundError(path);
    }
    if (!res.ok) throw await this.graphError(res, 'GET', url);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { bytes, item: toStoreItem(raw, splitPath(p).parent) };
  }

  async write(path: string, bytes: Uint8Array, opts?: { contentType?: string }): Promise<StoreItem> {
    const p = normalizePath(path);
    if (!p) throw new Error('Ungültiger Pfad: leer');
    const { parent } = splitPath(p);
    await this.ensureFolder(parent);
    let raw: GraphItem | undefined;
    try {
      raw = await this.upload(p, bytes, opts?.contentType);
    } catch (err) {
      // The parent folder was removed behind our back (stale cache): recreate once.
      if (!(err instanceof OneDriveError && err.status === 404)) throw err;
      this.forgetFolders(parent);
      await this.ensureFolder(parent);
      raw = await this.upload(p, bytes, opts?.contentType);
    }
    return toStoreItem(raw, parent);
  }

  async ensureFolder(path: string): Promise<void> {
    const p = normalizePath(path);
    if (!p || this.knownFolders.has(p)) return;
    try {
      await this.createFolders(p);
    } catch (err) {
      if (!(err instanceof OneDriveError && err.status === 404)) throw err;
      // A cached parent no longer exists; start over without the cache.
      this.forgetFolders(p.split('/')[0]);
      await this.createFolders(p);
    }
  }

  async move(from: string, to: string): Promise<StoreItem> {
    const src = normalizePath(from);
    const dst = normalizePath(to);
    if (!src || !dst) throw new Error(`Ungültiger Pfad: ${!src ? from : to}`);
    const raw = await this.getItem(src);
    if (!raw) throw new StoreNotFoundError(from);
    const { parent, name } = splitPath(dst);
    await this.ensureFolder(parent);
    const root = await this.resolveShare();
    let parentId = root.rootId;
    if (parent) {
      const parentItem = await this.getItem(parent);
      if (!parentItem) throw new StoreNotFoundError(parent);
      parentId = parentItem.id;
    }
    const url = `/drives/${encodeURIComponent(root.driveId)}/items/${encodeURIComponent(raw.id)}`;
    const patch = () => this.graph('PATCH', url, { json: { name, parentReference: { id: parentId } } });
    let res = await patch();
    if (res.status === 409) {
      // Like a rename on disk, an existing file at the target is replaced. Graph
      // refuses that, so the old file goes to the OneDrive recycle bin first.
      const existing = await this.getItem(dst);
      if (!existing || existing.folder || existing.id === raw.id) throw await this.graphError(res, 'PATCH', url);
      await drain(res);
      const delUrl = `/drives/${encodeURIComponent(root.driveId)}/items/${encodeURIComponent(existing.id)}`;
      const del = await this.graph('DELETE', delUrl);
      if (!del.ok && del.status !== 404) throw await this.graphError(del, 'DELETE', delUrl);
      await drain(del);
      this.log(`Verschieben: vorhandene Datei ${dst} ersetzt (alte Fassung im OneDrive-Papierkorb).`);
      res = await patch();
    }
    if (res.status === 404) {
      await drain(res);
      throw new StoreNotFoundError(from);
    }
    if (!res.ok) throw await this.graphError(res, 'PATCH', url);
    return toStoreItem((await res.json()) as GraphItem, parent);
  }

  // ---------------------------------------------------------------- share + paths

  /** Redeems the sharing link once and caches drive and folder ids. */
  private resolveShare(): Promise<ShareRoot> {
    this.share ??= this.redeemShare().catch((err) => {
      this.share = undefined;
      throw err;
    });
    return this.share;
  }

  private async redeemShare(): Promise<ShareRoot> {
    const url = `/shares/${encodeSharingUrl(this.shareUrl)}/driveItem`;
    const res = await this.graph('GET', url, { headers: { Prefer: 'redeemSharingLink' } });
    if (!res.ok) {
      const err = await this.graphError(res, 'GET', url);
      if (res.status === 403 || res.status === 404) {
        err.message +=
          ' – Der Freigabelink ist für das App-Konto nicht erreichbar. Ist der Ordner mit diesem Konto geteilt (Bearbeiten)?';
      }
      throw err;
    }
    const item = (await res.json()) as GraphItem;
    const remote = item.remoteItem;
    // A remote item (shared from another drive) carries the real drive and id inside remoteItem.
    const driveId = remote?.parentReference?.driveId ?? item.parentReference?.driveId;
    const rootId = remote?.id ?? item.id;
    const isFolder = Boolean(item.folder ?? remote?.folder);
    if (!driveId || !rootId) throw new Error('OneDrive: Der Freigabelink liefert keine Laufwerks- oder Element-ID.');
    if (!isFolder) throw new Error('OneDrive: Der Freigabelink zeigt auf eine Datei, nicht auf einen Ordner.');
    const name = item.name || remote?.name || 'OneDrive';
    this.log(`Freigegebener Ordner verbunden: ${name}`);
    return { driveId, rootId, name, webUrl: remote?.webUrl ?? item.webUrl };
  }

  /** Graph path of an item relative to the shared folder, optionally with a sub-resource. */
  private async itemUrl(path: string, suffix?: string): Promise<string> {
    const { driveId, rootId } = await this.resolveShare();
    const base = `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(rootId)}`;
    const p = normalizePath(path);
    if (!p) return suffix ? `${base}/${suffix}` : base;
    const addressed = `${base}:/${encodePath(p)}:`;
    return suffix ? `${addressed}/${suffix}` : addressed;
  }

  private async getItem(path: string): Promise<GraphItem | undefined> {
    const url = await this.itemUrl(path);
    const res = await this.graph('GET', url);
    if (res.status === 404) {
      await drain(res);
      return undefined;
    }
    if (!res.ok) throw await this.graphError(res, 'GET', url);
    return (await res.json()) as GraphItem;
  }

  private async createFolders(p: string): Promise<void> {
    const segments = p.split('/');
    for (let i = 0; i < segments.length; i++) {
      const current = segments.slice(0, i + 1).join('/');
      if (this.knownFolders.has(current)) continue;
      const parent = segments.slice(0, i).join('/');
      const url = await this.itemUrl(parent, 'children');
      const res = await this.graph('POST', url, {
        json: { name: segments[i], folder: {}, '@microsoft.graph.conflictBehavior': 'fail' },
      });
      // 409 = a folder with this name already exists, which is what we want.
      if (!res.ok && res.status !== 409) throw await this.graphError(res, 'POST', url);
      await drain(res);
      this.knownFolders.add(current);
    }
  }

  private forgetFolders(prefix: string): void {
    if (!prefix) {
      this.knownFolders.clear();
      return;
    }
    for (const f of this.knownFolders) {
      if (f === prefix || f.startsWith(prefix + '/') || prefix.startsWith(f + '/')) this.knownFolders.delete(f);
    }
  }

  // ---------------------------------------------------------------- uploads

  private async upload(path: string, bytes: Uint8Array, contentType?: string): Promise<GraphItem> {
    if (bytes.byteLength <= SIMPLE_UPLOAD_LIMIT) {
      const url = (await this.itemUrl(path, 'content')) + '?@microsoft.graph.conflictBehavior=replace';
      const res = await this.graph('PUT', url, {
        body: bytes,
        headers: { 'Content-Type': contentType ?? 'application/octet-stream' },
      });
      if (!res.ok) throw await this.graphError(res, 'PUT', url);
      return (await res.json()) as GraphItem;
    }
    return this.uploadInChunks(path, bytes);
  }

  private async uploadInChunks(path: string, bytes: Uint8Array): Promise<GraphItem> {
    const sessionUrl = await this.itemUrl(path, 'createUploadSession');
    const res = await this.graph('POST', sessionUrl, {
      json: { item: { '@microsoft.graph.conflictBehavior': 'replace' } },
    });
    if (!res.ok) throw await this.graphError(res, 'POST', sessionUrl);
    const { uploadUrl } = (await res.json()) as { uploadUrl?: string };
    if (!uploadUrl) throw new Error('OneDrive: Upload-Sitzung ohne uploadUrl.');

    const total = bytes.byteLength;
    try {
      for (let start = 0; start < total; start += UPLOAD_CHUNK_SIZE) {
        const end = Math.min(start + UPLOAD_CHUNK_SIZE, total);
        // The upload URL is pre-authenticated: no Authorization header (Graph rejects it).
        const chunkRes = await this.send(
          uploadUrl,
          { method: 'PUT', headers: { 'Content-Range': `bytes ${start}-${end - 1}/${total}` }, body: bytes.subarray(start, end) },
          'Upload-Sitzung',
        );
        if (!chunkRes.ok) throw await this.graphError(chunkRes, 'PUT', 'Upload-Sitzung');
        if (end === total) {
          if (chunkRes.status === 200 || chunkRes.status === 201) return (await chunkRes.json()) as GraphItem;
          await drain(chunkRes);
          const item = await this.getItem(path);
          if (!item) throw new Error(`OneDrive: Upload von ${path} nicht abgeschlossen.`);
          return item;
        }
        await drain(chunkRes);
      }
    } catch (err) {
      // Best effort: discard the unfinished session.
      await this.fetchImpl(uploadUrl, { method: 'DELETE' }).then(drain, () => undefined);
      throw err;
    }
    throw new Error(`OneDrive: Upload von ${path} nicht abgeschlossen.`);
  }

  // ---------------------------------------------------------------- HTTP

  /** Authenticated Graph request; refreshes the token once on 401. */
  private async graph(
    method: string,
    pathOrUrl: string,
    opts: { json?: unknown; body?: Uint8Array | string; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    const url = pathOrUrl.startsWith('https://') ? pathOrUrl : GRAPH_BASE + pathOrUrl;
    const headers: Record<string, string> = { ...opts.headers };
    let body = opts.body;
    if (opts.json !== undefined) {
      body = JSON.stringify(opts.json);
      headers['Content-Type'] = 'application/json';
    }
    const label = `${method} ${redact(url)}`;
    let token = await this.getAccessToken();
    let res = await this.send(url, { method, body, headers: { ...headers, Authorization: `Bearer ${token}` } }, label);
    if (res.status === 401) {
      await drain(res);
      this.log(`Graph 401 bei ${label} – Zugriffstoken wird erneuert.`);
      this.invalidateAccessToken(token);
      token = await this.getAccessToken();
      res = await this.send(url, { method, body, headers: { ...headers, Authorization: `Bearer ${token}` } }, label);
    }
    return res;
  }

  /** fetch with retries for 429/503/504 and network errors, honouring Retry-After. */
  private async send(url: string, init: RequestInit, label: string): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, init);
      } catch (err) {
        if (attempt >= MAX_RETRIES) {
          throw new Error(`OneDrive: ${label} fehlgeschlagen: ${(err as Error).message}`);
        }
        const delay = backoff(attempt);
        this.log(`Netzwerkfehler bei ${label} – neuer Versuch in ${Math.round(delay / 1000)} s (${attempt + 1}/${MAX_RETRIES}).`);
        await this.sleep(delay);
        continue;
      }
      if (!RETRY_STATUSES.has(res.status) || attempt >= MAX_RETRIES) return res;
      const delay = retryDelay(res.headers.get('Retry-After'), attempt, this.now());
      await drain(res);
      this.log(`HTTP ${res.status} bei ${label} – neuer Versuch in ${Math.round(delay / 1000)} s (${attempt + 1}/${MAX_RETRIES}).`);
      await this.sleep(delay);
    }
  }

  private async graphError(res: Response, method: string, url: string): Promise<OneDriveError> {
    let code: string | undefined;
    let message: string | undefined;
    let requestId: string | undefined;
    try {
      const data = (await res.json()) as {
        error?: { code?: string; message?: string; innerError?: { 'request-id'?: string } };
      };
      code = data.error?.code;
      message = data.error?.message;
      requestId = data.error?.innerError?.['request-id'];
    } catch {
      /* body is not JSON */
    }
    requestId ??= res.headers.get('request-id') ?? undefined;
    const target = url === 'Upload-Sitzung' ? url : redact(url.startsWith('https://') ? url : GRAPH_BASE + url);
    const text = `OneDrive ${res.status}${code ? ` ${code}` : ''}: ${message || res.statusText || 'Fehler'} (${method} ${target})`;
    return new OneDriveError(text + (requestId ? ` [request-id ${requestId}]` : ''), res.status, code, requestId);
  }

  // ---------------------------------------------------------------- tokens

  private getAccessToken(): Promise<string> {
    const cached = this.accessToken;
    if (cached && this.now() < cached.expiresAt - TOKEN_SKEW_MS) return Promise.resolve(cached.token);
    // One refresh at a time: concurrent callers share the same promise.
    this.refreshing ??= this.refreshAccessToken().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private invalidateAccessToken(failedToken: string): void {
    if (this.accessToken?.token === failedToken) this.accessToken = undefined;
  }

  private async refreshAccessToken(): Promise<string> {
    if (!this.refreshToken) {
      this.refreshToken = (await this.tokenStore.load()) ?? this.initialRefreshToken;
    }
    const refreshToken = this.refreshToken;
    if (!refreshToken) {
      throw new Error(
        'OneDrive: Kein Refresh-Token vorhanden. Bitte einmalig scripts/onedrive-connect.mjs ausführen (siehe docs/onedrive-setup.md).',
      );
    }
    const body = new URLSearchParams({
      client_id: this.clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: ONEDRIVE_SCOPES,
    }).toString();
    const res = await this.send(
      TOKEN_URL,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body },
      'POST Token-Endpunkt',
    );
    const data = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number | string;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !data.access_token) {
      const desc = (data.error_description ?? '').split(/\r?\n/)[0];
      const hint =
        data.error === 'invalid_grant'
          ? ' – Das Refresh-Token ist abgelaufen oder widerrufen. Bitte scripts/onedrive-connect.mjs erneut ausführen.'
          : '';
      throw new OneDriveError(
        `OneDrive-Anmeldung fehlgeschlagen (${res.status} ${data.error ?? 'unbekannt'}): ${desc}${hint}`,
        res.status,
        data.error,
      );
    }
    const expiresIn = Number(data.expires_in) || 3600;
    this.accessToken = { token: data.access_token, expiresAt: this.now() + expiresIn * 1000 };

    // Microsoft rotates refresh tokens: keep the newest one and persist it.
    if (data.refresh_token && data.refresh_token !== refreshToken) {
      this.refreshToken = data.refresh_token;
      try {
        await this.tokenStore.save(data.refresh_token);
        this.log('Zugriffstoken erneuert, neues Refresh-Token gespeichert.');
      } catch (err) {
        // The previous refresh token stays valid, so this is not fatal; retry on the next refresh.
        this.log(`Neues Refresh-Token konnte nicht gespeichert werden: ${(err as Error).message}`);
      }
    } else {
      this.log('Zugriffstoken erneuert.');
    }
    return data.access_token;
  }
}

// ------------------------------------------------------------------ helpers

function toStoreItem(raw: GraphItem, folder: string): StoreItem {
  return {
    id: raw.id,
    path: folder ? `${folder}/${raw.name}` : raw.name,
    name: raw.name,
    isFolder: Boolean(raw.folder),
    size: raw.size,
    lastModified: raw.lastModifiedDateTime ?? new Date(0).toISOString(),
    eTag: raw.cTag ?? raw.eTag,
    webUrl: raw.webUrl,
  };
}

/** Drops the shares id (it encodes the sharing link) and query strings from log/error text. */
function redact(url: string): string {
  return url
    .replace(GRAPH_BASE, '')
    .replace(/\/shares\/[^/?]+/, '/shares/{shareId}')
    .replace(/\?.*$/, '');
}

function backoff(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

function retryDelay(retryAfter: string | null, attempt: number, now: number): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.min(Math.max(0, date - now), MAX_RETRY_DELAY_MS);
  }
  return backoff(attempt);
}

async function drain(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    /* ignore */
  }
}

type OneDriveConfig = Config['storage']['onedrive'];

/** Builds the store from config.storage.onedrive (ONEDRIVE_* and KEY_VAULT_URI). */
export function createOneDriveStore(
  cfg: { storage: { onedrive: OneDriveConfig } },
  overrides: Partial<Pick<OneDriveShareStoreOptions, 'fetchImpl' | 'log' | 'tokenStore'>> = {},
): OneDriveShareStore {
  const od = cfg.storage.onedrive;
  const missing = [!od.shareUrl && 'ONEDRIVE_SHARE_URL', !od.clientId && 'ONEDRIVE_CLIENT_ID'].filter(Boolean);
  if (missing.length) {
    throw new Error(`STORAGE_PROVIDER=onedrive braucht ${missing.join(' und ')} (siehe docs/onedrive-setup.md).`);
  }
  return new OneDriveShareStore({
    shareUrl: od.shareUrl!,
    clientId: od.clientId!,
    tokenStore: overrides.tokenStore ?? createTokenStore(cfg),
    initialRefreshToken: od.refreshToken,
    fetchImpl: overrides.fetchImpl,
    log: overrides.log ?? ((msg) => console.log(`[onedrive] ${msg}`)),
  });
}
