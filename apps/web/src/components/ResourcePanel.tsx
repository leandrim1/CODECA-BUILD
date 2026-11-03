import type { ReactNode } from 'react';
import { Alert, Button, Skeleton } from '@codeca/ui';
import type { ResourceState } from '../hooks/useResource.js';
import { ErrorState } from './Guards.js';

/**
 * Renderiza o conteudo somente quando o recurso carregou, cobrindo os estados
 * de carregamento e de erro de forma consistente em todas as telas.
 *
 * - Sem nada para mostrar: esqueleto (so na primeira vez que o dado e pedido).
 * - Com dado em cache: o dado, na hora. A conferencia em segundo plano nao
 *   desenha nada -- e se ela falhar, o aviso aparece **sem** tirar o que a
 *   pessoa ja estava vendo: esconder o erro seria mostrar dado velho como se
 *   fosse atual.
 */
export function ResourcePanel<T>({
  resource,
  children,
  skeleton,
}: {
  resource: ResourceState<T>;
  children: (data: T) => ReactNode;
  skeleton?: ReactNode;
}) {
  if (resource.initialLoading) {
    return (
      <>
        {skeleton ?? (
          <div className="grid gap-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        )}
      </>
    );
  }

  if (resource.error && resource.data === null) {
    return <ErrorState message={resource.error.message} onRetry={resource.reload} />;
  }

  if (resource.data === null) return null;
  return (
    <>
      {resource.error ? (
        <Alert
          tone="warning"
          title="Nao foi possivel atualizar"
          action={
            <Button variant="outline" size="sm" onClick={resource.reload} loading={resource.refreshing}>
              Tentar novamente
            </Button>
          }
        >
          Os dados abaixo sao da ultima consulta bem-sucedida e podem estar desatualizados.{' '}
          {resource.error.message}
        </Alert>
      ) : null}
      {children(resource.data)}
    </>
  );
}
