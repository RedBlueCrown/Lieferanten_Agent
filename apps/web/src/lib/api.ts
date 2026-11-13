import { useAuth } from './auth';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, opts: { raw?: boolean } = {}): Promise<T> {
  const token = useAuth.getState().token;
  const isForm = body instanceof FormData;
  const r = await fetch(path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body && !isForm ? { 'content-type': 'application/json' } : {}) },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  if (r.status === 401) {
    useAuth.getState().logout();
    throw new ApiError(401, 'Bitte melden Sie sich erneut an.');
  }
  if (!r.ok) {
    let msg = `Fehler ${r.status}`;
    let code: string | undefined;
    try {
      const j = await r.json();
      msg = j.detail || j.title || msg;
      code = j.code;
    } catch {
      /* not json */
    }
    throw new ApiError(r.status, msg, code);
  }
  if (opts.raw) return r as unknown as T;
  if (r.status === 204) return undefined as T;
  return r.json();
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T>(p: string, b?: unknown) => request<T>('PUT', p, b),
  patch: <T>(p: string, b?: unknown) => request<T>('PATCH', p, b),
  del: <T>(p: string) => request<T>('DELETE', p),
  upload: <T>(p: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<T>('POST', p, fd);
  },
  /** Downloads a file with the auth header and opens or saves it. */
  async download(p: string, opts: { open?: boolean } = {}) {
    const r = await request<Response>('GET', p, undefined, { raw: true });
    const blob = await r.blob();
    const cd = r.headers.get('content-disposition') ?? '';
    const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(cd)?.[1] ?? 'download');
    const url = URL.createObjectURL(blob);
    if (opts.open) window.open(url, '_blank', 'noopener');
    else {
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
};

export async function demoLogin(oid: string) {
  const r = await fetch('/api/mock-entra/oauth2/v2.0/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'demo_account', oid }) });
  if (!r.ok) throw new ApiError(r.status, 'Anmeldung fehlgeschlagen');
  return (await r.json()).access_token as string;
}
