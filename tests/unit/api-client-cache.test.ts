import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  api,
  setUnauthenticatedHandler,
  subscribeToWrites,
} from '../../apps/web/src/services/api.js';
import { queryCache } from '../../apps/web/src/services/queryCache.js';

/**
 * A ligacao entre a rede e o cache: o que acontece quando uma escrita termina e
 * quando a sessao acaba no meio do uso. Sem a primeira, o painel mostraria
 * contagens velhas; sem a segunda, cada tela mostraria o proprio erro com a
 * moldura do painel de pe.
 */

function resposta(status: number, corpo: unknown): Response {
  return new Response(corpo === undefined ? null : JSON.stringify(corpo), { status });
}

function simular(status: number, corpo?: unknown) {
  const fetchFalso = vi.fn(() => Promise.resolve(resposta(status, corpo)));
  vi.stubGlobal('fetch', fetchFalso);
  return fetchFalso;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthenticatedHandler(null);
  queryCache.clear();
});

describe('escritas envelhecem o cache', () => {
  it('uma escrita bem-sucedida avisa os observadores; uma leitura nao', async () => {
    const aviso = vi.fn();
    const parar = subscribeToWrites(aviso);

    simular(200, { data: { ok: true } });
    await api.get('/api/tenants/t/banners');
    expect(aviso).not.toHaveBeenCalled();

    await api.post('/api/tenants/t/banners', { title: 'x' });
    expect(aviso).toHaveBeenCalledTimes(1);

    await api.patch('/api/tenants/t/banners/1', {});
    await api.delete('/api/tenants/t/banners/1');
    expect(aviso).toHaveBeenCalledTimes(3);
    parar();
  });

  it('uma escrita que falha NAO envelhece nada: o dado guardado segue valendo', async () => {
    const aviso = vi.fn();
    const parar = subscribeToWrites(aviso);
    simular(422, { error: { code: 'validation_error', message: 'Dados invalidos' } });
    await expect(api.post('/api/tenants/t/banners', {})).rejects.toThrow();
    expect(aviso).not.toHaveBeenCalled();
    parar();
  });

  it('o cache real esta ligado: depois de salvar, o dado guardado fica marcado como velho', async () => {
    queryCache.write('lista', [1, 2, 3]);
    expect(queryCache.read('lista').invalidated).toBe(false);

    simular(204);
    await api.delete('/api/tenants/t/banners/1');

    expect(queryCache.read('lista').invalidated).toBe(true);
    // E o dado continua la: a tela nao e esvaziada por causa disso.
    expect(queryCache.read('lista').data).toEqual([1, 2, 3]);
  });
});

describe('sessao expirada no meio do uso', () => {
  const semSessao = { error: { code: 'unauthenticated', message: 'Sessao invalida' } };

  it('um 401 em rota de dados chama o tratador', async () => {
    const tratador = vi.fn();
    setUnauthenticatedHandler(tratador);
    simular(401, semSessao);
    await expect(api.get('/api/tenants/t/properties')).rejects.toThrow();
    expect(tratador).toHaveBeenCalledTimes(1);
  });

  it('consultar a sessao e entrar respondem 401 de forma esperada e nao disparam o tratador', async () => {
    const tratador = vi.fn();
    setUnauthenticatedHandler(tratador);
    simular(401, semSessao);
    await expect(api.get('/api/auth/session')).rejects.toThrow();
    await expect(api.post('/api/auth/login', {})).rejects.toThrow();
    expect(tratador).not.toHaveBeenCalled();
  });

  it('outro erro (403, 500) nao e sessao expirada', async () => {
    const tratador = vi.fn();
    setUnauthenticatedHandler(tratador);
    simular(403, { error: { code: 'forbidden', message: 'Sem permissao' } });
    await expect(api.get('/api/tenants/t/members')).rejects.toThrow();
    simular(500, { error: { code: 'internal_error', message: 'Falhou' } });
    await expect(api.get('/api/tenants/t/members')).rejects.toThrow();
    expect(tratador).not.toHaveBeenCalled();
  });

  it('sem tratador registrado, o 401 so vira o erro normal', async () => {
    simular(401, semSessao);
    await expect(api.get('/api/tenants/t/properties')).rejects.toMatchObject({ status: 401 });
  });
});
