import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Alert, Button, EmptyState, Spinner } from '@codeca/ui';
import { Building2, PackageOpen } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.js';
import type { ModuleKey } from '@codeca/shared';
import { useSiteModules } from '../hooks/useSiteModules.js';

/** Telas de espera, protecao de rotas e estados de erro reutilizaveis. */

export function LoadingScreen({ label = 'Carregando o painel' }: { label?: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50">
      <div className="grid justify-items-center gap-3">
        <Spinner label={label} />
        <p className="text-sm text-slate-500">{label}...</p>
      </div>
    </div>
  );
}

/** Exige sessao ativa. A decisao final e sempre do servidor. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;
  if (!user) {
    return <Navigate to="/entrar" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

/** Exige uma empresa vinculada ao usuario. */
export function RequireTenant({ children }: { children: ReactNode }) {
  const { tenant, memberships, loading, isPlatformAdmin } = useAuth();

  if (loading) return <LoadingScreen />;

  if (memberships.length === 0) {
    return (
      <div className="panel-shell">
        <EmptyState
          icon={<Building2 aria-hidden="true" className="size-10" />}
          title="Nenhuma construtora vinculada a sua conta"
          description={
            isPlatformAdmin
              ? 'Sua conta e de administrador da plataforma. Use o painel da plataforma para gerenciar as empresas.'
              : 'Pedir ao responsavel da construtora que envie um convite para o seu e-mail.'
          }
          action={
            isPlatformAdmin ? (
              <Button onClick={() => window.location.assign('/plataforma')}>Abrir painel da plataforma</Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  if (!tenant) return <LoadingScreen />;
  return <>{children}</>;
}

/** Exige papel global de administrador da plataforma. */
export function RequirePlatformAdmin({ children }: { children: ReactNode }) {
  const { isPlatformAdmin, loading, user } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/entrar" replace />;
  if (!isPlatformAdmin) {
    return (
      <div className="panel-shell">
        <Alert tone="danger" title="Area restrita">
          Esta area e exclusiva de administradores da plataforma. Se precisa de acesso, fale com o
          responsavel pela conta.
        </Alert>
      </div>
    );
  }
  return <>{children}</>;
}

/**
 * Exige que o modulo esteja habilitado para o site da empresa.
 *
 * O menu nao mostra a tela, mas o endereco continua digitavel e um link
 * antigo continua existindo. Aqui a resposta e explicita: este site nao tem
 * esse modulo, e quem resolve isso e a CODECA IA -- nao e falha do cliente
 * nem algo que ele possa ligar sozinho.
 */
export function RequireModule({
  moduleKey,
  children,
}: {
  moduleKey: ModuleKey;
  children: ReactNode;
}) {
  const { enabled, loading, module } = useSiteModules();

  if (loading) {
    return (
      <div className="panel-shell">
        <Spinner label="Carregando o site" />
      </div>
    );
  }

  if (!enabled(moduleKey)) {
    return (
      <div className="panel-shell">
        <EmptyState
          icon={<PackageOpen aria-hidden="true" className="size-10" />}
          title={`${module(moduleKey)?.name ?? 'Este recurso'} nao faz parte deste site`}
          description="Cada site da CODECA IA e montado com os modulos que o projeto precisa. Para incluir este, fale com a equipe que desenvolveu o seu site."
        />
      </div>
    );
  }

  return <>{children}</>;
}

/** Mensagem padrao para falhas de carregamento, com acao de tentar de novo. */
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Alert
      tone="danger"
      title="Nao foi possivel carregar"
      action={
        onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Tentar novamente
          </Button>
        ) : undefined
      }
    >
      {message}
    </Alert>
  );
}

/** Exibe o controle somente quando o papel permite; o servidor reconfere. */
export function Can({
  capability,
  children,
  fallback = null,
}: {
  capability: Parameters<ReturnType<typeof useAuth>['can']>[0];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can } = useAuth();
  return <>{can(capability) ? children : fallback}</>;
}
