import type { FastifyReply, FastifyRequest } from 'fastify';
import { can, type Permission } from '@vm/domain';
import type { Actor } from './audit';
import type { Principal } from './auth';
import { HttpError } from './util';

const API_CLIENT_PERMISSIONS: Permission[] = ['contracts:read', 'contracts:ingest', 'export', 'standards:read'];

export function principal(req: FastifyRequest): Principal {
  if (!req.principal) throw new HttpError(401, 'Anmeldung erforderlich', 'unauthenticated');
  return req.principal;
}

export function need(req: FastifyRequest, perm: Permission): Principal {
  const p = principal(req);
  const ok = p.kind === 'api' ? p.appRoles.includes('Vertragsmanagement.Api.ReadWrite') && API_CLIENT_PERMISSIONS.includes(perm) : can(p.roles, perm);
  if (!ok) throw new HttpError(403, 'Für diese Aktion fehlt Ihnen die Berechtigung.', 'forbidden');
  return p;
}

export function actor(req: FastifyRequest): Actor {
  const p = principal(req);
  return { kind: p.kind === 'api' ? 'api' : 'user', oid: p.oid, name: p.name, roles: p.roles };
}

/** Audit context of a request. */
export function reqInfo(req: FastifyRequest) {
  return { ip: req.ip, userAgent: (req.headers['user-agent'] as string) ?? null, correlationId: req.id };
}

export function markAudited(req: FastifyRequest) {
  req.audited = true;
}

export function sendFile(reply: FastifyReply, bytes: Uint8Array, name: string, type: string, inline = false) {
  return reply
    .header('content-type', type)
    .header('content-disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`)
    .send(Buffer.from(bytes));
}
