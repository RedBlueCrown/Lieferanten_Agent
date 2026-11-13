/**
 * Authentication.
 *
 * AUTH_MODE=mock (default): a simulated Microsoft Entra ID. It signs RS256
 * tokens whose claims look like Entra v2 access tokens (oid, tid, name,
 * preferred_username, roles, scp) and publishes its keys as JWKS, so the API
 * validates mock and real tokens with the same code path.
 *
 * AUTH_MODE=entra: tokens from login.microsoftonline.com for the tenant in
 * ENTRA_TENANT_ID, audience ENTRA_API_AUDIENCE; roles come from app roles.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createLocalJWKSet, createRemoteJWKSet, exportJWK, generateKeyPair, importJWK, jwtVerify, SignJWT, type JWK, type JWTVerifyGetKey } from 'jose';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ENTRA_APP_ROLE, roleFromEntra, type Role } from '@vm/domain';
import { config } from './config';
import { HttpError } from './util';

export interface DemoUser {
  oid: string;
  firstName: string;
  name: string;
  email: string;
  title: string;
  unit: string;
  roles: Role[];
  initials: string;
}

/** The three people of the pilot. */
export const DEMO_USERS: DemoUser[] = [
  {
    oid: '7d1c5a2e-0f3b-4c1e-9a51-fabian000001',
    firstName: 'Fabian',
    name: 'Fabian Gassner',
    email: 'fabian.gassner@llv.li',
    title: 'Projektleiter',
    unit: 'Amt für Informatik',
    roles: ['projektleitung'],
    initials: 'FG',
  },
  {
    oid: '3b8e9f10-6a2d-4e7b-8c33-bjoern000002',
    firstName: 'Björn',
    name: 'Björn Marxer',
    email: 'bjoern.marxer@llv.li',
    title: 'Lieferantenmanager',
    unit: 'Amt für Informatik',
    roles: ['lieferantenmanagement'],
    initials: 'BM',
  },
  {
    oid: 'c4f2a7b9-1e8d-4a6c-b2f0-marco0000003',
    firstName: 'Marco',
    name: 'Marco Frommelt',
    email: 'marco.frommelt@llv.li',
    title: 'Jurist, Legal-Check',
    unit: 'Rechtsdienst der Regierung',
    roles: ['rechtsdienst'],
    initials: 'MF',
  },
];

/** A machine client for the API (e.g. the ERP or another third-party system). */
// In production the demo client only exists when a secret is configured.
const demoSecret = process.env.MOCK_API_CLIENT_SECRET ?? (process.env.NODE_ENV === 'production' ? undefined : 'demo-secret-bitte-aendern');
export const DEMO_API_CLIENTS = demoSecret ? [{ clientId: 'erp-connector', secret: demoSecret, name: 'ERP-Anbindung (Demo)', roles: ['Vertragsmanagement.Api.ReadWrite'] }] : [];

export interface Principal {
  kind: 'user' | 'api';
  oid: string;
  name: string;
  firstName: string;
  email?: string;
  title?: string;
  unit?: string;
  initials?: string;
  roles: Role[];
  appRoles: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
    audited?: boolean;
  }
}

const MOCK_TENANT = '00000000-0000-4000-8000-11c11c11c11c';
const issuerMock = () => `${config.publicBaseUrl}/api/mock-entra/v2.0`;

let keyset: { privateJwk: JWK; publicJwk: JWK } | undefined;
let verifyKey: JWTVerifyGetKey | undefined;

async function mockKeys() {
  if (keyset) return keyset;
  const file = path.join(config.dataDir, 'mock-entra-key.json');
  if (fs.existsSync(file)) {
    keyset = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else {
    const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
    const kid = 'mock-' + Date.now().toString(36);
    keyset = { privateJwk: { ...(await exportJWK(privateKey)), kid, alg: 'RS256' }, publicJwk: { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' } };
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(keyset), { mode: 0o600 });
  }
  return keyset!;
}

async function signMock(claims: Record<string, unknown>, subject: string) {
  const { privateJwk } = await mockKeys();
  const key = await importJWK(privateJwk, 'RS256');
  return new SignJWT({ ...claims, tid: MOCK_TENANT, ver: '2.0' })
    .setProtectedHeader({ alg: 'RS256', kid: privateJwk.kid, typ: 'JWT' })
    .setIssuer(issuerMock())
    .setAudience(config.auth.audience)
    .setSubject(subject)
    .setIssuedAt()
    .setNotBefore('0s')
    .setExpirationTime('8h')
    .sign(key);
}

export async function issueUserToken(user: DemoUser) {
  return signMock(
    {
      oid: user.oid,
      name: user.name,
      given_name: user.firstName,
      preferred_username: user.email,
      roles: user.roles.map((r) => ENTRA_APP_ROLE[r]),
      scp: 'access_as_user',
    },
    user.oid,
  );
}

async function getVerifyKey(): Promise<JWTVerifyGetKey> {
  if (verifyKey) return verifyKey;
  if (config.auth.mode === 'entra') {
    if (!config.auth.tenantId) throw new Error('ENTRA_TENANT_ID fehlt');
    verifyKey = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${config.auth.tenantId}/discovery/v2.0/keys`));
  } else {
    verifyKey = createLocalJWKSet({ keys: [(await mockKeys()).publicJwk] });
  }
  return verifyKey;
}

export async function verifyToken(token: string): Promise<Principal> {
  const issuer = config.auth.mode === 'entra' ? `https://login.microsoftonline.com/${config.auth.tenantId}/v2.0` : issuerMock();
  const { payload } = await jwtVerify(token, await getVerifyKey(), { issuer, audience: config.auth.audience });
  const appRoles = Array.isArray(payload.roles) ? (payload.roles as string[]) : [];
  const roles = appRoles.map(roleFromEntra).filter((r): r is Role => !!r);
  const isApp = !payload.scp && !payload.preferred_username;
  const oid = String(payload.oid ?? payload.sub);
  const demo = DEMO_USERS.find((u) => u.oid === oid);
  const name = String(payload.name ?? payload.app_displayname ?? payload.azp ?? 'Unbekannt');
  return {
    kind: isApp ? 'api' : 'user',
    oid,
    name,
    firstName: String(payload.given_name ?? demo?.firstName ?? name.split(' ')[0]),
    email: payload.preferred_username as string | undefined,
    title: demo?.title,
    unit: demo?.unit,
    initials: demo?.initials ?? name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase(),
    roles,
    appRoles,
  };
}

/** Machine clients get these capabilities through the app role. */
export function apiClientCan(p: Principal, what: 'read' | 'write'): boolean {
  return p.kind === 'api' && p.appRoles.some((r) => r === 'Vertragsmanagement.Api.ReadWrite' || (what === 'read' && r === 'Vertragsmanagement.Api.Read'));
}

export async function authenticate(req: FastifyRequest): Promise<Principal> {
  const h = req.headers.authorization;
  const q = (req.query as Record<string, string> | undefined)?.access_token;
  const token = h?.startsWith('Bearer ') ? h.slice(7) : q;
  if (!token) throw new HttpError(401, 'Anmeldung erforderlich', 'unauthenticated');
  try {
    return await verifyToken(token);
  } catch {
    throw new HttpError(401, 'Anmeldung abgelaufen oder ungültig', 'invalid_token');
  }
}

/** Routes of the simulated Entra ID (only in mock mode). */
export async function registerMockEntra(app: FastifyInstance, onLogin: (u: DemoUser, req: FastifyRequest) => Promise<void>) {
  if (config.auth.mode !== 'mock') return;
  const base = '/api/mock-entra';

  app.get(`${base}/v2.0/.well-known/openid-configuration`, { schema: { hide: true } }, async () => ({
    issuer: issuerMock(),
    token_endpoint: `${config.publicBaseUrl}${base}/oauth2/v2.0/token`,
    jwks_uri: `${config.publicBaseUrl}${base}/discovery/v2.0/keys`,
    response_types_supported: ['token', 'id_token'],
    id_token_signing_alg_values_supported: ['RS256'],
    note: 'Simulierte Microsoft Entra ID für Entwicklung und Demo.',
  }));

  app.get(`${base}/discovery/v2.0/keys`, { schema: { hide: true } }, async () => ({ keys: [(await mockKeys()).publicJwk] }));

  app.get(`${base}/accounts`, { schema: { hide: true } }, async () =>
    DEMO_USERS.map(({ oid, name, firstName, email, title, unit, initials, roles }) => ({ oid, name, firstName, email, title, unit, initials, roles })),
  );

  app.post(`${base}/oauth2/v2.0/token`, { schema: { hide: true } }, async (req) => {
    const body = (req.body ?? {}) as Record<string, string>;
    if (body.grant_type === 'client_credentials') {
      const client = DEMO_API_CLIENTS.find((c) => c.clientId === body.client_id && c.secret === body.client_secret);
      if (!client) throw new HttpError(401, 'Client-Anmeldung fehlgeschlagen', 'invalid_client');
      const token = await signMock({ oid: 'app-' + client.clientId, azp: client.clientId, app_displayname: client.name, roles: client.roles }, 'app-' + client.clientId);
      return { token_type: 'Bearer', expires_in: 28800, access_token: token };
    }
    if (body.grant_type === 'demo_account') {
      const user = DEMO_USERS.find((u) => u.oid === body.oid || u.email === body.username);
      if (!user) throw new HttpError(400, 'Unbekanntes Konto', 'invalid_grant');
      const token = await issueUserToken(user);
      await onLogin(user, req);
      return { token_type: 'Bearer', expires_in: 28800, access_token: token, id_token: token };
    }
    throw new HttpError(400, 'grant_type nicht unterstützt', 'unsupported_grant_type');
  });
}
