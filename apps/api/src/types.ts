import type { AppContext } from './context.js';
import type { TenantContext } from './lib/authz.js';
import type { AuthenticatedSession } from './lib/session.js';

/** Variaveis disponiveis no contexto do Hono em toda a aplicacao. */
export interface AppBindings {
  Variables: {
    ctx: AppContext;
    requestId: string;
    session: AuthenticatedSession | null;
    tenant: TenantContext;
  };
}
