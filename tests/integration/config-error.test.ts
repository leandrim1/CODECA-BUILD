import { describe, expect, it } from 'vitest';
import { createConfigErrorApp, createSiteConfigErrorApp, parseEnv } from '@codeca/api';

/**
 * Ambiente incompleto.
 *
 * Sem estas respostas, uma variavel faltando derruba a funcao na carga do
 * modulo: o navegador recebe a pagina de erro da plataforma, sem corpo JSON, e
 * o painel so consegue dizer "nao foi possivel concluir a operacao" -- quem
 * opera fica sem saber o que corrigir.
 */

/** O erro que o `parseEnv` lanca quando falta configuracao. */
function envError(source: Record<string, string | undefined>): unknown {
  try {
    parseEnv(source);
    throw new Error('parseEnv deveria ter falhado neste ambiente.');
  } catch (error) {
    return error;
  }
}

describe('API com ambiente incompleto', () => {
  it('o health diz exatamente quais variaveis faltam', async () => {
    const app = createConfigErrorApp(envError({ NODE_ENV: 'production' }));

    const response = await app.request('http://app.localhost/api/health');
    expect(response.status).toBe(503);

    const body = (await response.json()) as {
      data: { status: string; issues: string[]; hint: string };
    };
    expect(body.data.status).toBe('misconfigured');
    expect(body.data.issues.join(' ')).toContain('DATABASE_URL');
    expect(body.data.issues.join(' ')).toContain('AUTH_SECRET');
    expect(body.data.hint).toMatch(/Vercel/i);
  });

  it('aponta o segredo curto demais, nao apenas o ausente', async () => {
    const app = createConfigErrorApp(
      envError({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://exemplo/base',
        AUTH_SECRET: 'curto-demais',
      }),
    );

    const body = (await (await app.request('http://app.localhost/api/health')).json()) as {
      data: { issues: string[] };
    };
    expect(body.data.issues).toHaveLength(1);
    expect(body.data.issues[0]).toContain('AUTH_SECRET');
    expect(body.data.issues[0]).toMatch(/32 caracteres/);
  });

  it('as demais rotas respondem com o envelope de erro de sempre', async () => {
    const app = createConfigErrorApp(envError({ NODE_ENV: 'production' }));

    const response = await app.request('http://app.localhost/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'contato@construtora.com.br' }),
    });

    expect(response.status).toBe(501);
    const body = (await response.json()) as {
      error: { code: string; message: string; details: { issues: string[] } };
    };
    // Envelope reconhecido pelo painel: a tela exibe a causa, nao a mensagem
    // generica de "nao foi possivel concluir a operacao".
    expect(body.error.code).toBe('integration_not_configured');
    expect(body.error.message).toMatch(/\/api\/health/);
    expect(body.error.details.issues.join(' ')).toContain('DATABASE_URL');
  });

  it('nomeia variaveis, nunca valores', async () => {
    const app = createConfigErrorApp(
      envError({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://usuario:SENHA_SECRETA@host/base',
        AUTH_SECRET: 'curto',
      }),
    );

    const text = await (await app.request('http://app.localhost/api/health')).text();
    expect(text).toContain('AUTH_SECRET');
    expect(text).not.toContain('SENHA_SECRETA');
    expect(text).not.toContain('curto');
  });
});

describe('sites publicos com ambiente incompleto', () => {
  it('o visitante recebe uma pagina de manutencao, sem detalhe tecnico', async () => {
    const app = createSiteConfigErrorApp(
      envError({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://usuario:SENHA_SECRETA@host/base',
      }),
    );

    const response = await app.request('https://www.construtora-exemplo.com.br/');
    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toContain('text/html');

    const html = await response.text();
    expect(html).toContain('temporariamente indisponivel');
    expect(html).toContain('noindex');
    // Quem visita o site de um cliente nao ve nome de variavel nem segredo.
    expect(html).not.toContain('AUTH_SECRET');
    expect(html).not.toContain('DATABASE_URL');
    expect(html).not.toContain('SENHA_SECRETA');
  });
});
