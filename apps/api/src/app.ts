import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import fstatic from '@fastify/static';
import { hasZodFastifySchemaValidationErrors, jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { authenticate, registerMockEntra } from './auth';
import { config } from './config';
import type { Services } from './context';
import { reqInfo } from './http';
import { registerAuditRoutes } from './routes/audit';
import { registerCaseRoutes } from './routes/cases';
import { registerCoreRoutes } from './routes/core';
import { registerRegistryRoutes } from './routes/registry';
import { HttpError } from './util';

declare module 'fastify' {
  interface FastifyInstance {
    services: Services;
  }
}

const seenUsers = new Map<string, number>();

export async function buildApp(services: Services): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.authorization'] },
    bodyLimit: 30 * 1024 * 1024,
    genReqId: () => `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    trustProxy: true,
  });
  app.decorate('services', services);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, { origin: true, credentials: true });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Vertragsmanagement LLV – API',
        version: '1.0.0',
        description:
          'Schnittstelle für Lieferanten, Verträge, Fristen, Dokumente und Prüfungen. Systeme melden sich per OAuth 2.0 Client Credentials an (Entra ID; im Demo-Betrieb über /api/mock-entra/oauth2/v2.0/token mit client_id «erp-connector»). Jede schreibende Anfrage wird im Audit-Protokoll festgehalten.',
      },
      servers: [{ url: config.publicBaseUrl }],
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
      security: [{ bearer: [] }],
    },
    transform: jsonSchemaTransform,
  });
  app.get('/api/openapi.json', { schema: { hide: true } }, async () => app.swagger());
  const { default: scalar } = await import('@scalar/fastify-api-reference');
  await app.register(scalar, { routePrefix: '/api/docs', configuration: { url: '/api/openapi.json', title: 'Vertragsmanagement API' } });

  app.get('/api/health', { schema: { hide: true } }, async () => ({ ok: true, db: services.db.kind, storage: services.store.kind, ai: services.ai.name, time: new Date().toISOString() }));

  // Authentication for every /api/v1 route.
  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/api/v1/')) return;
    req.principal = await authenticate(req);
    const p = req.principal;
    if (p.kind === 'user' && Date.now() - (seenUsers.get(p.oid) ?? 0) > 10 * 60_000) {
      seenUsers.set(p.oid, Date.now());
      await services.db.query(
        `insert into users (oid, name, email, roles, last_seen) values ($1,$2,$3,$4,now())
         on conflict (oid) do update set name=excluded.name, email=excluded.email, roles=excluded.roles, last_seen=now()`,
        [p.oid, p.name, p.email ?? null, JSON.stringify(p.roles)],
      );
    }
  });

  // Every change that a route did not audit itself, and every refused access.
  app.addHook('onResponse', async (req, reply) => {
    if (!req.url.startsWith('/api/v1/') || req.audited) return;
    const denied = reply.statusCode === 401 || reply.statusCode === 403;
    if (req.method === 'GET' && !denied) return;
    const p = req.principal;
    await services.audit.record({
      actor: p ? { kind: p.kind === 'api' ? 'api' : 'user', oid: p.oid, name: p.name, roles: p.roles } : { kind: 'user', oid: 'anonym', name: 'Nicht angemeldet' },
      action: denied ? 'zugriff.verweigert' : `http.${req.method.toLowerCase()}`,
      targetType: 'route',
      targetId: req.routeOptions.url ?? req.url,
      summary: `${req.method} ${req.url.split('?')[0]} → ${reply.statusCode}`,
      details: { status: reply.statusCode, durationMs: Math.round(reply.elapsedTime) },
      ...reqInfo(req),
    });
  });

  app.setErrorHandler((error, req, reply) => {
    const err = error as Error & { statusCode?: number };
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).type('application/problem+json').send({ type: 'about:blank', title: 'Ungültige Eingabe', status: 400, code: 'validation', detail: error.validation.map((v) => `${v.instancePath ?? ''} ${v.message ?? ''}`.trim()).join('; ') });
    }
    const status = err instanceof HttpError ? err.statusCode : err.statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    return reply
      .status(status)
      .type('application/problem+json')
      .send({ type: 'about:blank', title: status >= 500 ? 'Interner Fehler' : err.message, status, code: err instanceof HttpError ? err.code : 'error', detail: status >= 500 ? 'Bitte später erneut versuchen.' : err.message });
  });

  await registerMockEntra(app, async (user, req) => {
    await services.audit.record({
      actor: { kind: 'user', oid: user.oid, name: user.name, roles: user.roles },
      action: 'anmeldung',
      targetType: 'sitzung',
      targetId: user.oid,
      summary: `${user.name} hat sich angemeldet (Entra ID simuliert)`,
      details: { roles: user.roles, mode: 'mock' },
      ...reqInfo(req),
    });
    await services.db.query(
      `insert into users (oid, name, email, roles, last_seen) values ($1,$2,$3,$4,now()) on conflict (oid) do update set last_seen=now()`,
      [user.oid, user.name, user.email, JSON.stringify(user.roles)],
    );
  });

  await registerCoreRoutes(app);
  await registerRegistryRoutes(app);
  await registerCaseRoutes(app);
  await registerAuditRoutes(app);

  if (config.webDistDir && fs.existsSync(config.webDistDir)) {
    await app.register(fstatic, { root: config.webDistDir, wildcard: false });
    const index = fs.readFileSync(path.join(config.webDistDir, 'index.html'));
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).type('application/problem+json').send({ title: 'Nicht gefunden', status: 404 });
      return reply.type('text/html').send(index);
    });
  }
  return app;
}
