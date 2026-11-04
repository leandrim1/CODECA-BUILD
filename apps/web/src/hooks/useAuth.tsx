import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { roleCan, type TenantCapability } from '@codeca/shared';
import { useToast } from '@codeca/ui';
import { ApiError, setUnauthenticatedHandler } from '../services/api.js';
import { queryCache, replaceEqualDeep } from '../services/queryCache.js';
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
  googleAuth: false,
};

function readStoredTenant(): string | null {
  try {
    return window.localStorage.getItem(SELECTED_TENANT_KEY);
  } catch {
    return null;
  }
}

/**
 * A consulta da sessao em curso, compartilhada.
 *
 * O React em modo estrito monta o provedor duas vezes em desenvolvimento, e
 * duas consultas de sessao identicas nao tem ganho algum. Quem chega enquanto
 * uma esta em voo espera a mesma resposta.
 */
let sessionRequest: ReturnType<typeof authApi.session> | null = null;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [memberships, setMemberships] = useState<SessionMembership[]>([]);
  const [features, setFeatures] = useState<FeatureFlags>(DEFAULT_FEATURES);
  const [platform, setPlatform] = useState({ name: 'Codeca Build', url: 'https://codecabuild.com' });
  const [loading, setLoading] = useState(true);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(() => readStoredTenant());

  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const userIdRef = useRef<string | null>(null);

  const applySession = useCallback((session: SessionPayload | null) => {
    const nextId = session?.user.id ?? null;
    // Outra pessoa (ou ninguem) no mesmo navegador: nada do que foi guardado
    // para a anterior pode aparecer para a proxima.
    if (userIdRef.current !== nextId) queryCache.clear();
    userIdRef.current = nextId;
    // Uma conferencia que devolve o mesmo conteudo nao pode trocar os objetos:
    // todo consumidor do contexto refaria a tela por nada.
    setUser((atual) => replaceEqualDeep(atual, session?.user ?? null));
    setMemberships((atual) => replaceEqualDeep(atual, session?.memberships ?? []));
  }, []);

  // Uma consulta qualquer descobriu que a sessao acabou: a moldura inteira
  // precisa saber, e nao apenas a tela que levou o 401.
  useEffect(() => {
    setUnauthenticatedHandler(() => {
      if (userIdRef.current === null) return;
      applySession(null);
      toastRef.current.error('Sua sessão expirou', 'Entre novamente para continuar.');
    });
    return () => setUnauthenticatedHandler(null);
  }, [applySession]);

  const refresh = useCallback(async () => {
    try {
      sessionRequest ??= authApi.session().finally(() => {
        sessionRequest = null;
      });
      const response = await sessionRequest;
      const tinhaSessao = userIdRef.current !== null;
      applySession(response.session);
      setFeatures((atual) => replaceEqualDeep(atual, response.features));
      setPlatform((atual) => replaceEqualDeep(atual, response.platform));
      if (tinhaSessao && !response.session) {
        toastRef.current.error('Sua sessão expirou', 'Entre novamente para continuar.');
      }
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

  // Ao voltar para a aba depois de um tempo, confere se a sessao ainda vale.
  // Sem isso, um painel esquecido aberto so descobriria a expiracao no
  // proximo clique que precisasse de rede -- e um clique em tela ja guardada
  // nem isso. Silencioso: nao mexe no estado de carregamento.
  useEffect(() => {
    let ultima = Date.now();
    const aoVoltar = () => {
      if (document.visibilityState !== 'visible' || userIdRef.current === null) return;
      if (Date.now() - ultima < 60_000) return;
      ultima = Date.now();
      void refresh();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => document.removeEventListener('visibilitychange', aoVoltar);
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
      queryCache.clear();
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

  const can = useCallback(
    (capability: TenantCapability) => (tenant ? roleCan(tenant.role, capability) : false),
    [tenant],
  );

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
      can,
      isPlatformAdmin: user?.platformRole === 'platform_admin',
    }),
    [user, memberships, features, platform, loading, tenant, selectTenant, refresh, logout, applySession, can],
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
  if (!tenant) throw new Error('Nenhuma empresa selecionada.');
  return tenant.tenantId;
}
