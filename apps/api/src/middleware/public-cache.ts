import type { MiddlewareHandler } from 'hono';
import type { CachedPublicResponse } from '../lib/caches.js';
import type { AppBindings } from '../types.js';

/**
 * Cache de curta duracao das respostas da API publica, em memoria.
 *
 * ## Por que NAO e cache de CDN
 *
 * A API publica autentica por cabecalho `Authorization`. Um cache compartilhado
 * (CDN) indexado so pela URL serviria a resposta da empresa A para a empresa B
 * -- o pior defeito possivel numa plataforma multiempresa. Por isso as respostas
 * continuam `cache-control: no-store` para a rede; este cache vive DENTRO da
 * funcao, depois da autenticacao, e a chave inclui a credencial.
 *
 * ## Por que nao entrega dado velho
 *
 * - validade de `PUBLIC_CACHE_TTL_SECONDS` (padrao 5 s);
 * - qualquer escrita no painel descarta, NESTA instancia, as respostas da
 *   empresa (ver `invalidateCachesOnWrite`);
 * - quem precisa do dado exato na hora (por exemplo, o site reagindo ao webhook
 *   `content.published`) manda `Cache-Control: no-cache` e vai direto ao banco;
 * - `preview=true` (rascunho) nunca e guardado.
 *
 * O ganho: um site com 100 visitantes por segundo deixa de fazer ~14 consultas
 * por visita e passa a fazer uma por rota a cada 5 s.
 */
export function publicResponseCache(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const ctx = c.get('ctx');
    const cache = ctx.caches.publicResponse;
    if (!cache.enabled || c.req.method !== 'GET') return next();

    const url = new URL(c.req.url);
    const direct = /no-cache|no-store|max-age=0/i.test(c.req.header('cache-control') ?? '');
    if (direct || url.searchParams.get('preview') === 'true') return next();

    const credencial = c.get('apiKey');
    // Origem na chave: a chave publicavel devolve `access-control-allow-origin`
    // conforme quem pediu, e uma resposta nao pode servir a origem errada.
    const origin = credencial.kind === 'publishable' ? (c.req.header('origin') ?? '') : '';
    const key = `${credencial.keyId}|${origin}|${url.pathname}${url.search}`;

    // `produced` distingue quem EXECUTOU a rota (a resposta real ja esta em
    // `c.res`) de quem recebeu o resultado de outra requisicao, em andamento ou
    // guardado.
    let produced = false;
    const entry = await cache.getOrLoad(key, async (): Promise<CachedPublicResponse> => {
      produced = true;
      await next();
      const res = c.res;
      const headers: Array<[string, string]> = [];
      res.headers.forEach((value, name) => {
        if (name !== 'set-cookie' && name !== 'x-request-id') headers.push([name, value]);
      });
      return {
        tenantId: credencial.tenantId,
        siteId: credencial.siteId,
        status: res.status,
        body: await res.clone().text(),
        headers,
      };
    });

    // So respostas de sucesso ficam guardadas: erro (404 de slug, 5xx, 429)
    // vale uma vez e nunca e repassado a outra requisicao.
    if (entry.status !== 200) cache.delete(key);

    if (produced) return;
    if (entry.status !== 200) return next();

    return new Response(entry.body, { status: entry.status, headers: [...entry.headers, ['x-cache', 'HIT']] });
  };
}
