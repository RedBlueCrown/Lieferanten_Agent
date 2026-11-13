export type Role = 'projektleitung' | 'lieferantenmanagement' | 'rechtsdienst';

export const ROLE_LABEL: Record<Role, string> = {
  projektleitung: 'Projektleitung',
  lieferantenmanagement: 'Lieferantenmanagement',
  rechtsdienst: 'Rechtsdienst',
};

/** App roles as they appear in the Entra ID token (roles claim). */
export const ENTRA_APP_ROLE: Record<Role, string> = {
  projektleitung: 'Vertragsmanagement.Projektleitung',
  lieferantenmanagement: 'Vertragsmanagement.Lieferantenmanagement',
  rechtsdienst: 'Vertragsmanagement.Rechtsdienst',
};

export type Permission =
  | 'contracts:read'
  | 'contracts:write'
  | 'contracts:ingest'
  | 'contracts:decide'
  | 'suppliers:write'
  | 'cases:create'
  | 'reviews:decide'
  | 'standards:read'
  | 'audit:read'
  | 'export'
  | 'settings:write';

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  projektleitung: ['contracts:read', 'cases:create', 'standards:read', 'audit:read'],
  lieferantenmanagement: [
    'contracts:read',
    'contracts:write',
    'contracts:ingest',
    'contracts:decide',
    'suppliers:write',
    'standards:read',
    'audit:read',
    'export',
    'settings:write',
  ],
  rechtsdienst: ['contracts:read', 'reviews:decide', 'standards:read', 'audit:read'],
};

export function can(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((r) => ROLE_PERMISSIONS[r]?.includes(permission));
}

export function roleFromEntra(appRole: string): Role | null {
  const hit = (Object.entries(ENTRA_APP_ROLE) as [Role, string][]).find(([, v]) => v === appRole);
  return hit ? hit[0] : null;
}
