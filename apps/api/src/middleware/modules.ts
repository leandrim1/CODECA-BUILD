import type { MiddlewareHandler } from 'hono';
import type { ModuleKey } from '@codeca/shared';
import { assertModuleEnabled } from '../lib/modules.js';
import type { AppBindings } from '../types.js';

/**
 * Exige que o modulo esteja habilitado para o site.
 *
 * O painel esconde o que o site nao tem, mas esconder na tela nao e proteger:
 * a rota continua acessivel para quem souber o endereco, e um site que nao
 * tem o modulo nao deveria acumular registro nenhum dele -- nem para leitura,
 * porque o painel que mostra uma lista vazia sugere que ela poderia ser
 * preenchida.
 *
 * Roda depois de `tenantMiddleware`, que e quem resolve o site da requisicao.
 */
export function requireModule(moduleKey: ModuleKey): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const ctx = c.get('ctx');
    await assertModuleEnabled(ctx.db, c.get('tenant').siteId, moduleKey);
    await next();
  };
}
