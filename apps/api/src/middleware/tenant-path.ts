import type { Context } from 'hono';
import type { AppBindings } from '../types.js';

/**
 * Trecho do caminho **depois** do id da empresa.
 *
 * `/api/tenants/<uuid>/properties/<uuid>` devolve `/properties/<uuid>`;
 * a rota raiz da empresa devolve `''`.
 *
 * Existe porque as duas politicas do painel -- plano sem painel e suspensao --
 * precisam liberar rotas especificas, e faziam isso com
 * `caminho.includes('/billing')`. Isso casa no lugar errado: qualquer caminho
 * que contivesse o trecho em qualquer posicao escapava da politica. Comparar
 * o sufixo a partir do id elimina a classe inteira do problema.
 */
export function tenantSubPath(c: Context<AppBindings>): string {
  const caminho = c.req.path;
  const tenantId = c.req.param('tenantId');
  if (!tenantId) return caminho;

  const posicao = caminho.indexOf(tenantId);
  if (posicao < 0) return caminho;
  return caminho.slice(posicao + tenantId.length);
}

/**
 * O sufixo e exatamente um dos liberados, ou esta abaixo dele.
 *
 * O prefixo vazio -- a rota raiz da empresa -- exige igualdade. Tratado como
 * os outros, `''.concat('/')` viraria `startsWith('/')`, que casa com
 * **todo** caminho: a politica inteira deixaria de valer, em silencio e
 * justamente para quem ela deveria recusar.
 */
export function subPathAllowed(subPath: string, allowed: readonly string[]): boolean {
  return allowed.some((prefixo) =>
    prefixo === '' ? subPath === '' : subPath === prefixo || subPath.startsWith(`${prefixo}/`),
  );
}
