import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import type { TestClient } from './api.js';

/**
 * Google falso para os testes do login.
 *
 * Reproduz o que importa do Google de verdade: valida o PKCE de ponta a ponta
 * (o `code_verifier` enviado na troca precisa bater com o `code_challenge` da
 * autorizacao), confere o segredo e a URL de retorno, trata o codigo como de
 * uso unico, assina o `id_token` com RS256 e publica as chaves em `certs`.
 * Nenhuma chamada de rede real acontece.
 */

export const GOOGLE_CLIENT_ID = 'cliente-de-teste.apps.googleusercontent.com';
export const GOOGLE_CLIENT_SECRET = 'segredo-google-de-teste';

export interface GoogleIdentity {
  sub: string;
  email: string;
  name?: string;
  emailVerified?: boolean | string;
}

export interface TokenTamper {
  iss?: string;
  aud?: string | string[];
  azp?: string;
  /** Segundos relativos a agora; negativo = ja vencido. */
  expiresInSeconds?: number;
  nonce?: string;
  alg?: string;
  /** Assina com outra chave, mantendo o `kid` do Google. */
  wrongKey?: boolean;
  kid?: string;
  omitSub?: boolean;
}

interface PendingCode {
  identity: GoogleIdentity;
  nonce: string;
  challenge: string;
  redirectUri: string;
  tamper: TokenTamper;
  used: boolean;
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

export function createFakeGoogle(options: { now?: () => Date; redirectUri?: string } = {}) {
  const now = options.now ?? (() => new Date());
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const otherPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'chave-de-teste-1';
  const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };

  const codes = new Map<string, PendingCode>();
  const calls: string[] = [];
  const state = { failToken: false, failCerts: false };

  function sign(header: Record<string, unknown>, payload: Record<string, unknown>, wrongKey: boolean): string {
    const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
    const signer = createSign('RSA-SHA256').update(signingInput);
    const signature = signer.sign(wrongKey ? otherPair.privateKey : pair.privateKey);
    return `${signingInput}.${b64url(signature)}`;
  }

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);

    if (url.startsWith('https://www.googleapis.com/oauth2/v3/certs')) {
      if (state.failCerts) return new Response('erro', { status: 500 });
      return Response.json({ keys: [jwk] });
    }

    if (url === 'https://oauth2.googleapis.com/token') {
      if (state.failToken) return new Response('erro', { status: 500 });
      const form = new URLSearchParams(String(init?.body ?? ''));
      const pending = codes.get(form.get('code') ?? '');
      const bad = () => Response.json({ error: 'invalid_grant' }, { status: 400 });
      if (!pending || pending.used) return bad();
      pending.used = true;
      if (form.get('client_id') !== GOOGLE_CLIENT_ID || form.get('client_secret') !== GOOGLE_CLIENT_SECRET) {
        return Response.json({ error: 'invalid_client' }, { status: 401 });
      }
      if (form.get('grant_type') !== 'authorization_code') return bad();
      if (form.get('redirect_uri') !== pending.redirectUri) return bad();
      // PKCE de verdade: S256(code_verifier) == code_challenge.
      const verifier = form.get('code_verifier') ?? '';
      if (b64url(createHash('sha256').update(verifier).digest()) !== pending.challenge) return bad();

      const t = pending.tamper;
      const issuedAt = Math.floor(now().getTime() / 1000);
      const payload: Record<string, unknown> = {
        iss: t.iss ?? 'https://accounts.google.com',
        aud: t.aud ?? GOOGLE_CLIENT_ID,
        azp: t.azp ?? GOOGLE_CLIENT_ID,
        sub: pending.identity.sub,
        email: pending.identity.email,
        email_verified: pending.identity.emailVerified ?? true,
        name: pending.identity.name ?? 'Pessoa de Teste',
        nonce: t.nonce ?? pending.nonce,
        iat: issuedAt,
        exp: issuedAt + (t.expiresInSeconds ?? 3600),
      };
      if (t.omitSub) delete payload.sub;
      const idToken = sign({ alg: t.alg ?? 'RS256', kid: t.kid ?? kid, typ: 'JWT' }, payload, t.wrongKey ?? false);
      // O `access_token` existe de proposito: a API tem que descarta-lo.
      return Response.json({ access_token: 'ya29.token-que-nunca-deve-ser-guardado', id_token: idToken, token_type: 'Bearer' });
    }

    return new Response('nao mockado', { status: 404 });
  };

  return {
    fetch,
    calls,
    state,
    /** Simula o usuario aprovando no Google: devolve o `code` para o retorno. */
    authorize(authorizationUrl: string, identity: GoogleIdentity, tamper: TokenTamper = {}): string {
      const params = new URL(authorizationUrl).searchParams;
      const code = `code_${randomBytes(12).toString('hex')}`;
      codes.set(code, {
        identity,
        nonce: params.get('nonce') ?? '',
        challenge: params.get('code_challenge') ?? '',
        redirectUri: params.get('redirect_uri') ?? options.redirectUri ?? '',
        tamper,
        used: false,
      });
      return code;
    },
  };
}

export type FakeGoogle = ReturnType<typeof createFakeGoogle>;

/** Resposta de um redirecionamento, ja separada. */
export interface Redirect {
  status: number;
  location: string;
  headers: Headers;
}

/** Faz o caminho completo do navegador: inicio, Google, retorno. */
export async function signInWithGoogle(
  client: TestClient,
  google: FakeGoogle,
  identity: GoogleIdentity,
  options: { next?: string; tamper?: TokenTamper } = {},
): Promise<Redirect & { authorizationUrl: string; state: string }> {
  const start = await client.post('/api/auth/google/start', {
    intent: 'continue',
    ...(options.next ? { next: options.next } : {}),
  });
  if (start.status !== 200) throw new Error(`start falhou: ${start.status} ${start.errorMessage}`);
  const authorizationUrl = (start.body as { authorizationUrl: string }).authorizationUrl;
  const state = new URL(authorizationUrl).searchParams.get('state')!;
  const code = google.authorize(authorizationUrl, identity, options.tamper);
  const callback = await callbackOf(client, { code, state });
  return { ...callback, authorizationUrl, state };
}

export async function callbackOf(
  client: TestClient,
  query: Record<string, string>,
): Promise<Redirect> {
  const response = await client.get(`/api/auth/google/callback?${new URLSearchParams(query).toString()}`);
  return {
    status: response.status,
    location: response.headers.get('location') ?? '',
    headers: response.headers,
  };
}
