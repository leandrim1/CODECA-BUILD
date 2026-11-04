import { createHash, createHmac, createPublicKey, verify as verifySignature, type JsonWebKey } from 'node:crypto';

/**
 * Google OAuth 2.0 / OpenID Connect, fluxo de codigo de autorizacao com PKCE.
 *
 * Tudo aqui roda no SERVIDOR. O navegador so passa pelo Google e volta com um
 * `code` de uso unico; quem troca esse codigo por tokens, com o segredo do
 * cliente, e a API. Nenhum token do Google chega ao navegador ou ao banco.
 *
 * ## O que e conferido no `id_token`
 *
 * Assinatura (RS256, chave publica do Google por `kid`), emissor, audiencia (o
 * nosso client id), expiracao, `nonce` (amarra o token a ESTA tentativa) e
 * `email_verified`. O token vem direto do endpoint do Google por TLS, o que
 * ja o autentica; a assinatura e conferida mesmo assim, porque defesa em
 * profundidade e barata aqui e porque o requisito pede.
 */

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'] as const;

/** Tolerancia a relogios desencontrados entre o Google e o servidor. */
const CLOCK_SKEW_SECONDS = 60;
const REQUEST_TIMEOUT_MS = 10_000;

export type GoogleFailure = 'invalid_token' | 'unverified_email' | 'failed';

/** Falha previsivel do fluxo: carrega o codigo que a tela sabe explicar. */
export class GoogleAuthError extends Error {
  constructor(
    public readonly code: GoogleFailure,
    message: string,
  ) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

export interface GoogleClaims {
  /** Identificador estavel da conta Google. E ele, e nao o e-mail, que identifica. */
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

// ------------------------------------------------------------------ PKCE

const b64url = (buffer: Buffer): string => buffer.toString('base64url');

/**
 * `code_verifier` derivado do `state` e do segredo da aplicacao.
 *
 * Derivar (em vez de guardar) significa que o verifier nunca fica no banco, e
 * que so este servidor consegue recalcula-lo. Quem copiasse o `state` da URL
 * nao teria como fabricar o verifier.
 */
export function pkceVerifier(secret: string, state: string): string {
  return b64url(createHmac('sha256', secret).update(`pkce-verifier:${state}`).digest());
}

export function pkceChallenge(verifier: string): string {
  return b64url(createHash('sha256').update(verifier).digest());
}

export function oidcNonce(secret: string, state: string): string {
  return b64url(createHmac('sha256', secret).update(`oidc-nonce:${state}`).digest());
}

// --------------------------------------------------------- autorizacao

export function buildGoogleAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    // So identidade: nenhum acesso a dados do Google (Gmail, Drive...).
    scope: 'openid email profile',
    state: input.state,
    nonce: input.nonce,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
    // Sem refresh token: a plataforma so precisa saber QUEM e a pessoa, uma vez.
    access_type: 'online',
    // Deixa a pessoa escolher a conta, em vez de entrar com a que estiver aberta.
    prompt: 'select_account',
  }).toString();
  return url.toString();
}

export async function exchangeAuthorizationCode(
  fetchImpl: typeof globalThis.fetch,
  input: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    code: string;
    codeVerifier: string;
  },
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: input.code,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        redirect_uri: input.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: input.codeVerifier,
      }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new GoogleAuthError('failed', 'O Google não respondeu.');
  }

  if (response.status >= 500) {
    throw new GoogleAuthError('failed', `O Google está indisponível (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    // Codigo ja usado, vencido ou de outro cliente: o Google responde 4xx.
    throw new GoogleAuthError('invalid_token', `O Google recusou o código (HTTP ${response.status}).`);
  }

  const body = (await response.json().catch(() => null)) as { id_token?: unknown } | null;
  if (!body || typeof body.id_token !== 'string' || body.id_token.length === 0) {
    throw new GoogleAuthError('invalid_token', 'O Google não devolveu o id_token.');
  }
  // `access_token` e qualquer outro campo sao descartados aqui, de proposito.
  return body.id_token;
}

// ------------------------------------------------------------- id_token

interface JwksCache {
  keys: Array<JsonWebKey & { kid?: string }>;
  expiresAt: number;
}

/** Uma cache por cliente HTTP: nos testes cada contexto tem o seu. */
const JWKS_CACHE = new WeakMap<object, JwksCache>();
const JWKS_TTL_MS = 60 * 60 * 1000;

async function loadJwks(
  fetchImpl: typeof globalThis.fetch,
  nowMs: number,
  forceRefresh: boolean,
): Promise<JwksCache['keys']> {
  const cached = JWKS_CACHE.get(fetchImpl);
  if (cached && !forceRefresh && cached.expiresAt > nowMs) return cached.keys;

  let response: Response;
  try {
    response = await fetchImpl(GOOGLE_JWKS_URL, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new GoogleAuthError('failed', 'Não foi possível obter as chaves do Google.');
  }
  if (!response.ok) throw new GoogleAuthError('failed', 'Não foi possível obter as chaves do Google.');

  const body = (await response.json().catch(() => null)) as { keys?: JwksCache['keys'] } | null;
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  JWKS_CACHE.set(fetchImpl, { keys, expiresAt: nowMs + JWKS_TTL_MS });
  return keys;
}

function decodeJson(part: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // cai no erro abaixo
  }
  throw new GoogleAuthError('invalid_token', 'id_token malformado.');
}

export async function verifyGoogleIdToken(
  fetchImpl: typeof globalThis.fetch,
  idToken: string,
  expected: { clientId: string; nonce: string; now: Date },
): Promise<GoogleClaims> {
  const parts = idToken.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new GoogleAuthError('invalid_token', 'id_token malformado.');
  }
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  const header = decodeJson(headerPart);
  // Lista fechada: `none` e algoritmos simetricos (HS256 com a chave publica
  // como segredo) sao os ataques classicos a validacao de JWT.
  if (header.alg !== 'RS256') throw new GoogleAuthError('invalid_token', 'Algoritmo do token não aceito.');
  const kid = typeof header.kid === 'string' ? header.kid : '';
  if (!kid) throw new GoogleAuthError('invalid_token', 'Token sem identificador de chave.');

  const nowMs = expected.now.getTime();
  let jwk = (await loadJwks(fetchImpl, nowMs, false)).find((key) => key.kid === kid);
  // Chave nova (o Google gira as chaves): uma segunda busca, sem cache.
  if (!jwk) jwk = (await loadJwks(fetchImpl, nowMs, true)).find((key) => key.kid === kid);
  if (!jwk) throw new GoogleAuthError('invalid_token', 'Chave de assinatura desconhecida.');

  let valid = false;
  try {
    valid = verifySignature(
      'RSA-SHA256',
      Buffer.from(`${headerPart}.${payloadPart}`),
      createPublicKey({ key: jwk, format: 'jwk' }),
      Buffer.from(signaturePart, 'base64url'),
    );
  } catch {
    valid = false;
  }
  if (!valid) throw new GoogleAuthError('invalid_token', 'Assinatura do token inválida.');

  const claims = decodeJson(payloadPart);

  if (typeof claims.iss !== 'string' || !(GOOGLE_ISSUERS as readonly string[]).includes(claims.iss)) {
    throw new GoogleAuthError('invalid_token', 'Emissor do token inválido.');
  }

  const audience = claims.aud;
  const audiences = Array.isArray(audience) ? audience : [audience];
  if (!audiences.includes(expected.clientId)) {
    throw new GoogleAuthError('invalid_token', 'O token não foi emitido para esta aplicação.');
  }
  // Com varias audiencias, `azp` diz para quem o token foi de fato pedido.
  if (audiences.length > 1 && claims.azp !== expected.clientId) {
    throw new GoogleAuthError('invalid_token', 'O token não foi emitido para esta aplicação.');
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < nowSeconds) {
    throw new GoogleAuthError('invalid_token', 'O token expirou.');
  }
  if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_SECONDS > nowSeconds) {
    throw new GoogleAuthError('invalid_token', 'O token foi emitido no futuro.');
  }

  if (claims.nonce !== expected.nonce) {
    throw new GoogleAuthError('invalid_token', 'O token não pertence a esta tentativa de entrada.');
  }

  if (typeof claims.sub !== 'string' || claims.sub.length === 0 || claims.sub.length > 255) {
    throw new GoogleAuthError('invalid_token', 'Token sem identificador de conta.');
  }
  if (typeof claims.email !== 'string' || !claims.email.includes('@')) {
    throw new GoogleAuthError('invalid_token', 'O Google não informou o e-mail.');
  }

  // Google envia booleano; versoes antigas, a string "true".
  const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
  const email = claims.email.trim().toLowerCase();
  const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : email.split('@')[0]!;

  return { sub: claims.sub, email, emailVerified, name: name.slice(0, 120) };
}
