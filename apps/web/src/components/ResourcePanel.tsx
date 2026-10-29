import type { ReactNode } from 'react';
import { Skeleton } from '@codeca/ui';
import type { ResourceState } from '../hooks/useResource.js';
import { ErrorState } from './Guards.js';

/**
 * Renderiza o conteudo somente quando o recurso carregou, cobrindo os estados
 * de carregamento e de erro de forma consistente em todas as telas.
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
  return <>{children(resource.data)}</>;
}
