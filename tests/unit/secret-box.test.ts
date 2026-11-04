import { describe, expect, it } from 'vitest';
import { SecretBoxError, decryptSecret, encryptSecret, parseEncryptionKey } from '../../apps/api/src/lib/secret-box.js';
import { analyticsRedirectUri, featureFlags, parseEnv } from '../../apps/api/src/env.js';
import { buildAnalyticsAuthorizationUrl, analyticsPkceChallenge, analyticsPkceVerifier } from '../../apps/api/src/lib/analytics/google.js';

const key = Buffer.alloc(32, 9);

describe('cifra de segredos (AES-256-GCM)', () => {
  it('cifra e decifra, e o texto cifrado nao contem o original', () => {
    const sealed = encryptSecret(key, 'refresh-token-secreto', 'ga4:t1:s1');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain('refresh-token-secreto');
    expect(decryptSecret(key, sealed, 'ga4:t1:s1')).toBe('refresh-token-secreto');
  });

  it('cada cifragem usa IV novo (mesmo texto, resultados diferentes)', () => {
    expect(encryptSecret(key, 'x', 'a')).not.toBe(encryptSecret(key, 'x', 'a'));
  });

  it('contexto diferente (outra empresa/site) nao decifra', () => {
    const sealed = encryptSecret(key, 'segredo', 'ga4:empresa-a:site-a');
    expect(() => decryptSecret(key, sealed, 'ga4:empresa-b:site-b')).toThrow(SecretBoxError);
  });

  it('chave errada ou texto adulterado nao decifra, com a mesma mensagem', () => {
    const sealed = encryptSecret(key, 'segredo', 'ctx');
    const parts = sealed.split('.');
    parts[3] = Buffer.from('adulterado').toString('base64url');
    expect(() => decryptSecret(Buffer.alloc(32, 1), sealed, 'ctx')).toThrow('Não foi possível decifrar');
    expect(() => decryptSecret(key, parts.join('.'), 'ctx')).toThrow('Não foi possível decifrar');
    expect(() => decryptSecret(key, 'lixo', 'ctx')).toThrow(SecretBoxError);
  });

  it('exige chave de 32 bytes', () => {
    expect(() => encryptSecret(Buffer.alloc(16), 'x', 'a')).toThrow(SecretBoxError);
  });

  it('aceita a chave em base64, base64url e hexadecimal; recusa o resto', () => {
    expect(parseEncryptionKey(key.toString('base64'))?.equals(key)).toBe(true);
    expect(parseEncryptionKey(key.toString('base64url'))?.equals(key)).toBe(true);
    expect(parseEncryptionKey(key.toString('hex'))?.equals(key)).toBe(true);
    expect(parseEncryptionKey('curta')).toBeNull();
    expect(parseEncryptionKey('')).toBeNull();
    expect(parseEncryptionKey(undefined)).toBeNull();
  });
});

describe('configuracao do Analytics', () => {
  const base = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://x/y',
    AUTH_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
    APP_URL: 'https://app.exemplo.com/',
  };

  it('a URL de retorno e propria e nao reaproveita a do login', () => {
    const env = parseEnv({ ...base, GOOGLE_REDIRECT_URI: 'https://app.exemplo.com/api/auth/google/callback' });
    expect(analyticsRedirectUri(env)).toBe('https://app.exemplo.com/api/integrations/google-analytics/callback');
  });

  it('o override explicito vale', () => {
    const env = parseEnv({ ...base, GOOGLE_ANALYTICS_REDIRECT_URI: 'https://outro.exemplo.com/cb' });
    expect(analyticsRedirectUri(env)).toBe('https://outro.exemplo.com/cb');
  });

  it('so liga com credenciais Google E chave de cifra valida', () => {
    const creds = { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'segredo' };
    expect(featureFlags(parseEnv({ ...base, ...creds })).googleAnalytics).toBe(false);
    expect(featureFlags(parseEnv({ ...base, ...creds, INTEGRATIONS_ENCRYPTION_KEY: 'curta' })).googleAnalytics).toBe(false);
    expect(featureFlags(parseEnv({ ...base, INTEGRATIONS_ENCRYPTION_KEY: key.toString('base64') })).googleAnalytics).toBe(false);
    const ok = featureFlags(parseEnv({ ...base, ...creds, INTEGRATIONS_ENCRYPTION_KEY: key.toString('base64') }));
    expect(ok.googleAnalytics).toBe(true);
    expect(ok.googleAuth).toBe(true);
  });

  it('o login continua dependendo so das credenciais (sem a chave de cifra)', () => {
    const flags = featureFlags(parseEnv({ ...base, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' }));
    expect(flags.googleAuth).toBe(true);
  });
});

describe('autorizacao do Analytics', () => {
  it('escopo minimo, offline, consentimento e PKCE', () => {
    const verifier = analyticsPkceVerifier('segredo', 'estado-1');
    const url = new URL(
      buildAnalyticsAuthorizationUrl({
        clientId: 'cid',
        redirectUri: 'https://app/cb',
        state: 'estado-1',
        codeChallenge: analyticsPkceChallenge(verifier),
      }),
    );
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/analytics.readonly');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('include_granted_scopes')).toBe('false');
    expect(url.searchParams.get('nonce')).toBeNull();
    expect(verifier).toBe(analyticsPkceVerifier('segredo', 'estado-1'));
    expect(verifier).not.toBe(analyticsPkceVerifier('segredo', 'estado-2'));
  });
});
