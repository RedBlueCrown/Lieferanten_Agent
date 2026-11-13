import { create } from 'zustand';
import type { Role } from '@vm/domain';

export interface Me {
  user: { oid: string; name: string; firstName: string; email?: string; title?: string; unit?: string; initials?: string; roles: Role[]; kind: 'user' | 'api' };
  permissions: string[];
  system: {
    today: string;
    authMode: 'mock' | 'entra';
    ai: { provider: 'mock' | 'azure'; model: string; region: string; documentReader: string };
    storage: { kind: 'local' | 'onedrive'; label: string; rootName: string; webUrl?: string };
    database: string;
    mail: string;
    events: string;
  };
}

interface AuthState {
  token: string | null;
  me: Me | null;
  setToken: (t: string | null) => void;
  setMe: (m: Me | null) => void;
  logout: () => void;
}

const KEY = 'vm.token';
const read = () => {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
};

export const useAuth = create<AuthState>((set) => ({
  token: read(),
  me: null,
  setToken: (t) => {
    try {
      if (t) sessionStorage.setItem(KEY, t);
      else sessionStorage.removeItem(KEY);
    } catch {
      /* private mode */
    }
    set({ token: t });
  },
  setMe: (me) => set({ me }),
  logout: () => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    set({ token: null, me: null });
  },
}));

export const primaryRole = (me: Me | null): Role | null => me?.user.roles[0] ?? null;
