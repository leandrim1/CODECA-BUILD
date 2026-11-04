import { afterAll, describe, expect, it } from 'vitest';
import { createTestApi } from '../helpers/api.js';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, callbackOf, createFakeGoogle } from '../helpers/google.js';

/**
 * O login com Google em ambientes diferentes: sem credenciais (desenvolvimento
 * ou preview sem configuracao) e como roda na Vercel (producao: HTTPS, cookie
 * `Secure`, URL de retorno explicita).
 */

const PROD_ORIGIN = 'https://app.codecabuild.com';
const closers: Array<() => Promise<void>> = [];
afterAll(async () => {
  for (const close of closers) await close();
});

describe('sem credenciais do Google', () => {
  it('o recurso aparece desligado e a rota recusa, sem simular sucesso', async () => {
    const api = await createTestApi();
    closers.push(api.close);

    const session = await api.client().get('/api/auth/session');
    expect(session.body.features.googleAuth).toBe(false);

    const start = await api.client().post('/api/auth/google/start', { intent: 'continue' });
    expect(start.status).toBe(501);
    expect(start.errorCode).toBe('integration_not_configured');
    expect(start.errorMessage).toMatch(/GOOGLE_CLIENT_ID/);

    const callback = await callbackOf(api.client(), { code: 'x', state: 'y' });
    expect(callback.location).toBe('/entrar?google=not_configured');
  });

  it('so o ID, sem o segredo, tambem conta como nao configurado', async () => {
    const api = await createTestApi({ env: { GOOGLE_CLIENT_ID } });
    closers.push(api.close);
    expect((await api.client().get('/api/auth/session')).body.features.googleAuth).toBe(false);
  });
});

describe('como na Vercel (producao)', () => {
  it('usa a URL de retorno configurada, cookies Secure e o login completo funciona em HTTPS', async () => {
    const redirectUri = `${PROD_ORIGIN}/api/auth/google/callback`;
    const google = createFakeGoogle({ redirectUri });
    const api = await createTestApi({
      fetch: google.fetch,
      env: {
        NODE_ENV: 'production',
        COOKIE_SECURE: 'true',
        APP_URL: PROD_ORIGIN,
        GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET,
        GOOGLE_REDIRECT_URI: redirectUri,
      },
    });
    closers.push(api.close);

    const client = api.client();
    const start = await client.post('/api/auth/google/start', { intent: 'continue' }, { origin: PROD_ORIGIN });
    expect(start.status, start.errorMessage ?? '').toBe(200);
    expect(new URL(start.body.authorizationUrl).searchParams.get('redirect_uri')).toBe(redirectUri);
    const stateCookie = start.headers.getSetCookie().find((c) => c.startsWith('codeca_oauth_state='))!;
    expect(stateCookie).toMatch(/Secure/i);
    expect(stateCookie).toMatch(/HttpOnly/i);

    const code = google.authorize(start.body.authorizationUrl, { sub: 'sub-prod', email: 'maria@gmail.com' });
    const state = new URL(start.body.authorizationUrl).searchParams.get('state')!;
    const callback = await callbackOf(client, { code, state });

    expect(callback.location).toBe('/criar-empresa');
    const session = callback.headers.getSetCookie().find((c) => c.startsWith('codeca_session='))!;
    expect(session).toMatch(/Secure/i);
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
  });

  it('sem GOOGLE_REDIRECT_URI, a URL de retorno e a rota real da API sobre o APP_URL', async () => {
    const google = createFakeGoogle();
    const api = await createTestApi({
      fetch: google.fetch,
      env: { APP_URL: `${PROD_ORIGIN}/`, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET },
    });
    closers.push(api.close);

    const start = await api.client().post('/api/auth/google/start', { intent: 'continue' });
    expect(new URL(start.body.authorizationUrl).searchParams.get('redirect_uri')).toBe(
      `${PROD_ORIGIN}/api/auth/google/callback`,
    );
  });

  it('o inicio so e aceito da origem do painel em producao', async () => {
    const google = createFakeGoogle();
    const api = await createTestApi({
      fetch: google.fetch,
      env: { NODE_ENV: 'production', COOKIE_SECURE: 'true', APP_URL: PROD_ORIGIN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET },
    });
    closers.push(api.close);

    const estranha = await api.client().post('/api/auth/google/start', { intent: 'continue' }, { origin: 'https://evil.test' });
    expect(estranha.status).toBe(403);
    const propria = await api.client().post('/api/auth/google/start', { intent: 'continue' }, { origin: PROD_ORIGIN });
    expect(propria.status).toBe(200);
  });
});
