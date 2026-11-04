import { describe, expect, it } from 'vitest';
import { googleRedirectUri, parseEnv } from '../../apps/api/src/env.js';
import { pkceChallenge, pkceVerifier, oidcNonce } from '../../apps/api/src/lib/google-oauth.js';
import { safeNextPath } from '../../apps/api/src/lib/oauth-state.js';

const base = {
  DATABASE_URL: 'postgres://x/y',
  AUTH_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
};

describe('URL de retorno do Google', () => {
  it('vale a configurada, exatamente como foi escrita', () => {
    const env = parseEnv({ ...base, GOOGLE_REDIRECT_URI: 'https://app.exemplo.com/api/auth/google/callback' });
    expect(googleRedirectUri(env)).toBe('https://app.exemplo.com/api/auth/google/callback');
  });

  it('sem configuracao, e a rota real da API sobre o APP_URL, sem barra duplicada', () => {
    expect(googleRedirectUri(parseEnv({ ...base, APP_URL: 'https://app.exemplo.com/' }))).toBe(
      'https://app.exemplo.com/api/auth/google/callback',
    );
    expect(googleRedirectUri(parseEnv(base))).toBe('http://localhost:5173/api/auth/google/callback');
  });
});

describe('PKCE e nonce', () => {
  it('o verifier tem tamanho valido (RFC 7636) e o desafio e o SHA-256 dele', () => {
    const verifier = pkceVerifier(base.AUTH_SECRET, 'state-1');
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(pkceChallenge(verifier)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkceChallenge(verifier)).not.toBe(verifier);
  });

  it('e derivado do state e do segredo: mesmo par, mesmo valor; outro, outro', () => {
    expect(pkceVerifier('s'.repeat(32), 'a')).toBe(pkceVerifier('s'.repeat(32), 'a'));
    expect(pkceVerifier('s'.repeat(32), 'a')).not.toBe(pkceVerifier('s'.repeat(32), 'b'));
    expect(pkceVerifier('s'.repeat(32), 'a')).not.toBe(pkceVerifier('t'.repeat(32), 'a'));
    expect(oidcNonce('s'.repeat(32), 'a')).not.toBe(pkceVerifier('s'.repeat(32), 'a'));
  });
});

describe('destino depois do login', () => {
  it('aceita so caminhos do painel e da plataforma', () => {
    expect(safeNextPath('/painel')).toBe('/painel');
    expect(safeNextPath('/painel/imoveis?pagina=2')).toBe('/painel/imoveis?pagina=2');
    expect(safeNextPath('/plataforma/empresas')).toBe('/plataforma/empresas');
  });

  it('o resto cai no painel', () => {
    for (const value of [undefined, '', 'https://evil.test', '//evil.test', '/\\evil.test', '/painel@evil.test', 'javascript:alert(1)', '/outra', '/painel/../x\n']) {
      expect(safeNextPath(value), String(value)).toBe('/painel');
    }
  });
});

describe('LOGIN_CODE_REQUIRED', () => {
  it('so "true" exige; vazio, ausente ou outro texto nao derrubam o servidor', () => {
    const base = { DATABASE_URL: 'postgres://x/y', AUTH_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres' };
    expect(parseEnv({ ...base, LOGIN_CODE_REQUIRED: 'true' }).LOGIN_CODE_REQUIRED).toBe(true);
    expect(parseEnv({ ...base, LOGIN_CODE_REQUIRED: ' TRUE ' }).LOGIN_CODE_REQUIRED).toBe(true);
    for (const value of [undefined, '', 'false', 'talvez']) {
      expect(parseEnv({ ...base, LOGIN_CODE_REQUIRED: value }).LOGIN_CODE_REQUIRED, String(value)).toBe(false);
    }
  });
});
