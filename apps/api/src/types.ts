import type { AppContext } from './context.js';
import type { TenantContext } from './lib/authz.js';
import type { ApiKeyContext } from './lib/integration/keys.js';
import type { AuthenticatedSession } from './lib/session.js';

/** Variaveis disponiveis no contexto do Hono em toda a aplicacao. */
export interface AppBindings {
  Variables: {
    ctx: AppContext;
    requestId: string;
    session: AuthenticatedSession | null;
    tenant: TenantContext;
    /** Credencial de integracao do site, nas rotas publicas `/api/v1`. */
    apiKey: ApiKeyContext;
    /**
     * Aviso neutro para o visitante, quando o plano pede um na suspensao.
     *
     * `null` na grande maioria das requisicoes. Vive no contexto porque a
     * decisao e tomada uma vez, no middleware, e so `GET /v1/site` a le.
     */
    publicNotice: string | null;
  };
}
