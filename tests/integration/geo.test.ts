import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@codeca/database';
import type { GeoResult, GeocodingProvider, NormalizedAddress, PostalCodeProvider } from '@codeca/shared';
import { createTestApi, registerAccount, type TestApi } from '../helpers/api.js';
import { consultarBusca, consultarCep, consultarReverso } from '../../apps/api/src/lib/geo/servico.js';
import { reiniciarFila } from '../../apps/api/src/lib/geo/fila.js';
import { tamanhoDoCache } from '../../apps/api/src/lib/geo/cache.js';

/**
 * As rotas de geolocalizacao e a troca de provedor.
 *
 * O teste de contrato e o mais importante daqui: um provedor FALSO, que so
 * implementa as interfaces, atravessa o servico inteiro e chega a mesma forma
 * de dado. E a prova de que trocar Nominatim por Google, Mapbox ou uma
 * instancia propria nao encosta em tela nenhuma.
 */

let api: TestApi;
let conta: Awaited<ReturnType<typeof registerAccount>>;

beforeAll(async () => {
  api = await createTestApi();
  conta = await registerAccount(api, { email: 'geo@a.com.br', companyName: 'Alpha' });
});

afterAll(async () => {
  await api.close();
});

beforeEach(() => {
  reiniciarFila();
  vi.restoreAllMocks();
});

// --------------------------------------------------------- provedor falso

const ENDERECO_FALSO: NormalizedAddress = {
  street: 'Avenida Inventada',
  number: '42',
  neighborhood: 'Bairro Novo',
  city: 'Cidade Teste',
  state: 'MG',
  postalCode: '30110000',
  country: 'BR',
  lat: -19.9,
  lng: -43.93,
};

function provedorFalso(): { geocoding: GeocodingProvider; cep: PostalCodeProvider; chamadas: string[] } {
  const chamadas: string[] = [];
  return {
    chamadas,
    geocoding: {
      id: 'falso',
      async search(consulta): Promise<GeoResult[]> {
        chamadas.push(`search:${consulta}`);
        return [{ label: 'Avenida Inventada, 42', address: ENDERECO_FALSO, lat: -19.9, lng: -43.93 }];
      },
      async reverse(lat, lng) {
        chamadas.push(`reverse:${lat},${lng}`);
        return ENDERECO_FALSO;
      },
    },
    cep: {
      id: 'falso-cep',
      async lookup(cep) {
        chamadas.push(`cep:${cep}`);
        return ENDERECO_FALSO;
      },
    },
  };
}

describe('contrato: trocar o provedor nao muda o formato do dado', () => {
  it('um provedor inventado atravessa o servico inteiro', async () => {
    const falso = provedorFalso();
    const ctx = { db: api.db, provedores: falso, agora: () => new Date() };

    const porCep = await consultarCep(ctx, '30110-000');
    const porPonto = await consultarReverso(ctx, -19.9, -43.93);
    const porTexto = await consultarBusca(ctx, 'avenida inventada');

    // A forma e a mesma, venha de onde vier.
    for (const endereco of [porCep, porPonto, porTexto[0]?.address]) {
      expect(endereco).toMatchObject({ city: 'Cidade Teste', state: 'MG', country: 'BR', postalCode: '30110000' });
    }
    expect(falso.chamadas).toEqual(['cep:30110-000', 'reverse:-19.9,-43.93', 'search:avenida inventada']);
  });

  it('o adaptador nao precisa de rede nem de chave para existir', () => {
    const falso = provedorFalso();
    // O contrato e so isto: tres metodos e um id.
    expect(typeof falso.geocoding.search).toBe('function');
    expect(typeof falso.geocoding.reverse).toBe('function');
    expect(typeof falso.cep.lookup).toBe('function');
    expect(falso.geocoding.id).toBe('falso');
  });
});

describe('cache', () => {
  it('a segunda pergunta igual nao chega ao provedor', async () => {
    const falso = provedorFalso();
    const ctx = { db: api.db, provedores: falso, agora: () => new Date() };

    await consultarCep(ctx, '40110000');
    await consultarCep(ctx, '40110-000'); // mesma chave depois de normalizar
    expect(falso.chamadas.filter((c) => c.startsWith('cep:'))).toHaveLength(1);
  });

  it('coordenadas a centimetros de distancia compartilham a resposta', async () => {
    const falso = provedorFalso();
    const ctx = { db: api.db, provedores: falso, agora: () => new Date() };

    await consultarReverso(ctx, -21.100001, -45.230002);
    await consultarReverso(ctx, -21.1000012, -45.2300021);
    expect(falso.chamadas.filter((c) => c.startsWith('reverse:'))).toHaveLength(1);
  });

  it('a resposta vencida e perguntada de novo', async () => {
    const falso = provedorFalso();
    const agora = new Date('2026-01-01T12:00:00Z');
    const depois = new Date('2026-03-01T12:00:00Z'); // alem dos 30 dias
    await consultarCep({ db: api.db, provedores: falso, agora: () => agora }, '31000000');
    await consultarCep({ db: api.db, provedores: falso, agora: () => depois }, '31000000');
    expect(falso.chamadas.filter((c) => c.startsWith('cep:'))).toHaveLength(2);
  });

  it('CEP inexistente tambem e guardado, para o erro repetido nao custar', async () => {
    const vazio = { ...provedorFalso(), cep: { id: 'vazio', lookup: vi.fn(async () => null) } };
    const ctx = { db: api.db, provedores: vazio, agora: () => new Date() };
    expect(await consultarCep(ctx, '99999999')).toBeNull();
    expect(await consultarCep(ctx, '99999999')).toBeNull();
    expect(vazio.cep.lookup).toHaveBeenCalledTimes(1);
  });

  it('o que guarda e o endereco normalizado, nao a resposta do provedor', async () => {
    const antes = await tamanhoDoCache(api.db);
    const falso = provedorFalso();
    await consultarCep({ db: api.db, provedores: falso, agora: () => new Date() }, '32000000');
    expect(await tamanhoDoCache(api.db)).toBe(antes + 1);

    const [linha] = await api.db.select().from(schema.geoCache).limit(1);
    expect(linha?.value).toHaveProperty('country', 'BR');
  });
});

describe('rotas /api/geo', () => {
  it('exigem sessao do painel', async () => {
    const anonimo = await api.client().get('/api/geo/cep/13010000');
    expect(anonimo.status).toBe(401);
  });

  it('busca curta nao chega ao provedor', async () => {
    /*
      O cliente de teste desembrulha `data`, como faz com o resto da API: o
      envelope `{ ok, data }` convive com a convencao existente em vez de
      brigar com ela.
    */
    const resposta = await conta.client.get('/api/geo/search?q=ru');
    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual([]);
  });

  it('o envelope diz "nao achei" sem fingir erro de servidor', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((async () =>
      ({ ok: true, json: async () => ({ erro: true }) }) as Response) as typeof fetch);

    const resposta = await conta.client.get('/api/geo/cep/99999999');
    expect(resposta.status).toBe(200);
    expect(resposta.errorCode).toBe('not_found');
  });

  it('provedor fora do ar vira aviso, e o formulario continua utilizavel', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((async () => {
      throw new Error('rede fora');
    }) as typeof fetch);

    const resposta = await conta.client.get('/api/geo/reverse?lat=-27.59&lng=-48.55');
    expect(resposta.status).toBe(200);
    expect(resposta.errorCode).toBe('upstream_error');
    expect(resposta.errorMessage).toContain('à mão');
  });

  it('coordenada fora do mundo e erro de quem chamou', async () => {
    const resposta = await conta.client.get('/api/geo/reverse?lat=999&lng=0');
    expect(resposta.status).toBe(422);
  });
});
