import type { Database } from '@codeca/database';
import {
  chaveDeBusca,
  chaveDeCep,
  chaveDeCoordenada,
  type GeoResult,
  type NormalizedAddress,
} from '@codeca/shared';
import { lerDoCache, gravarNoCache } from './cache.js';
import { espacar } from './fila.js';
import type { ProvedoresDeGeo } from './registry.js';

/**
 * As tres consultas, com cache e espacamento.
 *
 * Fica entre a rota e o adaptador para que a rota nao saiba de cache nem de
 * fila, e o adaptador nao saiba de banco. Cada consulta segue o mesmo caminho:
 * chave normalizada, olhar o cache, so entao perguntar ao provedor -- passando
 * pela fila -- e guardar o que voltou.
 */

export interface ContextoDeGeo {
  db: Database;
  provedores: ProvedoresDeGeo;
  agora: () => Date;
}

/** Minimo de tres caracteres: menos que isso e ruido para o provedor. */
export const MINIMO_DA_BUSCA = 3;

export async function consultarCep(
  ctx: ContextoDeGeo,
  cep: string,
): Promise<NormalizedAddress | null> {
  const chave = chaveDeCep(cep);
  const guardado = await lerDoCache<NormalizedAddress | { vazio: true }>(ctx.db, 'cep', chave, ctx.agora());
  if (guardado) return 'vazio' in guardado ? null : guardado;

  const encontrado = await ctx.provedores.cep.lookup(cep);
  /*
    CEP inexistente tambem e guardado, como `{ vazio: true }`.

    Sem isso, o unico caso que SEMPRE vai ao provedor seria justamente o do
    cliente que digitou errado e vai tentar de novo -- e o erro repetido sai
    mais caro que o acerto.
  */
  await gravarNoCache(ctx.db, 'cep', chave, encontrado ?? { vazio: true }, ctx.agora(), ctx.provedores.cep.id);
  return encontrado;
}

export async function consultarReverso(
  ctx: ContextoDeGeo,
  lat: number,
  lng: number,
): Promise<NormalizedAddress | null> {
  const chave = chaveDeCoordenada(lat, lng);
  const guardado = await lerDoCache<NormalizedAddress | { vazio: true }>(ctx.db, 'reverse', chave, ctx.agora());
  if (guardado) return 'vazio' in guardado ? null : guardado;

  const encontrado = await espacar(() => ctx.provedores.geocoding.reverse(lat, lng));
  await gravarNoCache(
    ctx.db,
    'reverse',
    chave,
    encontrado ?? { vazio: true },
    ctx.agora(),
    ctx.provedores.geocoding.id,
  );
  return encontrado;
}

export async function consultarBusca(ctx: ContextoDeGeo, consulta: string): Promise<GeoResult[]> {
  const chave = chaveDeBusca(consulta);
  if (chave.length < MINIMO_DA_BUSCA) return [];

  const guardado = await lerDoCache<GeoResult[]>(ctx.db, 'search', chave, ctx.agora());
  if (guardado) return guardado;

  const encontrados = await espacar(() => ctx.provedores.geocoding.search(consulta, { limit: 5 }));
  await gravarNoCache(ctx.db, 'search', chave, encontrados, ctx.agora(), ctx.provedores.geocoding.id);
  return encontrados;
}
