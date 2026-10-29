import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { roleCan, type TenantCapability } from '@codeca/shared';
import { ApiError } from '../services/api.js';
import { authApi } from '../services/endpoints.js';
import type { FeatureFlags, SessionMembership, SessionPayload, SessionUser } from '../types/index.js';

/**
 * Estado de autenticacao do painel.
 *
 * A sessao vive em cookie HttpOnly: este contexto apenas espelha o que o
 * servidor informa em `/api/auth/session`. A empresa selecionada fica no
 * `localStorage` por conveniencia, mas o acesso e sempre reconferido no
 * servidor em cada requisicao.
 */

const SELECTED_TENANT_KEY = 'codeca:tenant-selecionado';

interface AuthContextValue {
  user: SessionUser | null;
  memberships: SessionMembership[];
  features: FeatureFlags;
  platform: { name: string; url: string };
  loading: boolean;
  /** Empresa ativa no painel. */
  tenant: SessionMembership | null;
  selectTenant: (tenantId: string) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  applySession: (session: SessionPayload | null) => void;
  /** Permissao conforme o papel na empresa ativa; o servidor decide de fato. */
  can: (capability: TenantCapability) => boolean;
  isPlatformAdmin: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const DEFAULT_FEATURES: FeatureFlags = {
  blobStorage: false,
  vercelDomains: false,
  transactionalEmail: false,
};

function readStoredTenant(): string | null {
  try {
    return window.localStorage.getItem(SELECTED_TENANT_KEY);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [memberships, setMemberships] = useState<SessionMembership[]>([]);
  const [features, setFeatures] = useState<FeatureFlags>(DEFAULT_FEATURES);
  const [platform, setPlatform] = useState({ name: 'Codeca Build', url: 'https://codecabuild.com' });
  const [loading, setLoading] = useState(true);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(() => readStoredTenant());

  const applySession = useCallback((session: SessionPayload | null) => {
    setUser(session?.user ?? null);
    setMemberships(session?.memberships ?? []);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await authApi.session();
      applySession(response.session);
      setFeatures(response.features);
      setPlatform(response.platform);
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthenticated) {
        applySession(null);
      }
    } finally {
      setLoading(false);
    }
  }, [applySession]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectTenant = useCallback((tenantId: string) => {
    setSelectedTenantId(tenantId);
    try {
      window.localStorage.setItem(SELECTED_TENANT_KEY, tenantId);
    } catch {
      // Navegacao privada pode bloquear o armazenamento; seguimos em memoria.
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      applySession(null);
      try {
        window.localStorage.removeItem(SELECTED_TENANT_KEY);
      } catch {
        // Ignorado.
      }
    }
  }, [applySession]);

  const tenant = useMemo(() => {
    if (memberships.length === 0) return null;
    const stored = memberships.find((item) => item.tenantId === selectedTenantId);
    return stored ?? memberships[0] ?? null;
  }, [memberships, selectedTenantId]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      memberships,
      features,
      platform,
      loading,
      tenant,
      selectTenant,
      refresh,
      logout,
      applySession,
      can: (capability) => (tenant ? roleCan(tenant.role, capability) : false),
      isPlatformAdmin: user?.platformRole === 'platform_admin',
    }),
    [user, memberships, features, platform, loading, tenant, selectTenant, refresh, logout, applySession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth precisa estar dentro de <AuthProvider>.');
  return value;
}

/** Empresa ativa, para telas que so existem dentro de um tenant. */
export function useTenantId(): string {
  const { tenant } = useAuth();
  if (!tenant) throw new Error('Nenhuma construtora selecionada.');
  return tenant.tenantId;
}
